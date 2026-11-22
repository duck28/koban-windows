import {
  FinancialAccount,
  LedgerState,
  MergeSummary,
  MonthlyBudgetEntry,
  NetWorthSnapshot,
} from '../types';

export interface MergeOptions {
  /** Which side wins when the exact same record key differs without a newer timestamp. */
  prefer?: 'local' | 'remote';
}

export interface MergeResult {
  merged: LedgerState;
  summary: MergeSummary;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Merges two arrays of keyed records cleanly without duplicating unchanged entries.
 * Preserves local item ordering and appends unseen remote records deterministically.
 */
function mergeKeyedCollection<T>(
  localItems: T[],
  remoteItems: T[],
  getKey: (item: T) => string,
  chooseWinner: (local: T, remote: T) => 'local' | 'remote'
): { items: T[]; added: number; updated: number } {
  const result: T[] = [];
  const localByKey = new Map<string, T>();
  const remoteByKey = new Map<string, T>();

  for (const item of localItems) {
    localByKey.set(getKey(item), item);
  }
  for (const item of remoteItems) {
    remoteByKey.set(getKey(item), item);
  }

  let added = 0;
  let updated = 0;

  for (const localItem of localItems) {
    const key = getKey(localItem);
    const remoteItem = remoteByKey.get(key);
    if (!remoteItem) {
      result.push(localItem);
      continue;
    }
    if (stableJson(localItem) === stableJson(remoteItem)) {
      result.push(localItem);
      continue;
    }
    if (chooseWinner(localItem, remoteItem) === 'remote') {
      result.push(remoteItem);
      updated += 1;
    } else {
      result.push(localItem);
    }
  }

  for (const remoteItem of remoteItems) {
    const key = getKey(remoteItem);
    if (!localByKey.has(key)) {
      result.push(remoteItem);
      added += 1;
    }
  }

  return { items: result, added, updated };
}

function compareAccountRecency(
  localAcc: FinancialAccount,
  remoteAcc: FinancialAccount,
  fallback: 'local' | 'remote'
): 'local' | 'remote' {
  if (remoteAcc.updatedAt > localAcc.updatedAt) return 'remote';
  if (localAcc.updatedAt > remoteAcc.updatedAt) return 'local';
  return fallback;
}

function compareSnapshotRecency(
  localSnap: NetWorthSnapshot,
  remoteSnap: NetWorthSnapshot,
  fallback: 'local' | 'remote'
): 'local' | 'remote' {
  if (remoteSnap.recordedAt > localSnap.recordedAt) return 'remote';
  if (localSnap.recordedAt > remoteSnap.recordedAt) return 'local';
  return fallback;
}

/**
 * Deterministic record-level merge between two decrypted Koban LedgerState objects.
 *
 * Used identically by:
 * - WebDAV three-way conflict dialog ("Merge Both Versions")
 * - External cloud-folder file changes detected by SHA-256 watcher (Synology Drive, OneDrive, iCloud, Dropbox)
 *
 * Local machine paths and sync configuration (`backupDir`, `autoBackup`, `maxBackups`,
 * `lastBackupAt`, `lastBackupPath`, `webdav`) stay scoped to the active device so synced
 * Windows and macOS ledgers never clobber each other's local filesystem paths.
 */
export function mergeLedgers(
  local: LedgerState,
  remote: LedgerState,
  options: MergeOptions = {}
): MergeResult {
  const fallback = options.prefer ?? 'local';
  const defaultWinner = () => fallback;

  const groups = mergeKeyedCollection(
    local.groups ?? [],
    remote.groups ?? [],
    (g) => g.id,
    defaultWinner
  );

  const categories = mergeKeyedCollection(
    local.categories ?? [],
    remote.categories ?? [],
    (c) => c.id,
    defaultWinner
  );

  const monthlyBudgets = mergeKeyedCollection(
    local.monthlyBudgets ?? [],
    remote.monthlyBudgets ?? [],
    (b: MonthlyBudgetEntry) => `${b.monthKey}::${b.categoryId}`,
    defaultWinner
  );

  const transactions = mergeKeyedCollection(
    local.transactions ?? [],
    remote.transactions ?? [],
    (tx) => tx.id,
    defaultWinner
  );

  transactions.items.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.id.localeCompare(b.id);
  });

  const recurringRules = mergeKeyedCollection(
    local.recurringRules ?? [],
    remote.recurringRules ?? [],
    (r) => r.id,
    defaultWinner
  );

  const savingsGoals = mergeKeyedCollection(
    local.savingsGoals ?? [],
    remote.savingsGoals ?? [],
    (g) => g.id,
    defaultWinner
  );

  const accounts = mergeKeyedCollection(
    local.accounts ?? [],
    remote.accounts ?? [],
    (a) => a.id,
    (l, r) => compareAccountRecency(l, r, fallback)
  );

  const snapshots = mergeKeyedCollection(
    local.netWorthSnapshots ?? [],
    remote.netWorthSnapshots ?? [],
    (s) => s.id,
    (l, r) => compareSnapshotRecency(l, r, fallback)
  );

  const planItems = mergeKeyedCollection(
    local.yearlyPlanItems ?? [],
    remote.yearlyPlanItems ?? [],
    (p) => p.id,
    defaultWinner
  );

  const mergedSettings = {
    ...(fallback === 'remote' ? remote.settings : local.settings),
    setupCompleted:
      Boolean(local.settings?.setupCompleted) || Boolean(remote.settings?.setupCompleted),
    ownerDisplayName:
      local.settings?.ownerDisplayName || remote.settings?.ownerDisplayName,
    // Keep device-local filesystem and WebDAV target configuration intact
    backupDir: local.settings?.backupDir ?? remote.settings?.backupDir ?? '',
    autoBackup: local.settings?.autoBackup ?? true,
    maxBackups: local.settings?.maxBackups ?? 10,
    lastBackupAt: local.settings?.lastBackupAt,
    lastBackupPath: local.settings?.lastBackupPath,
    webdav: local.settings?.webdav ?? remote.settings?.webdav,
  };

  const merged: LedgerState = {
    version: Math.max(local.version ?? 1, remote.version ?? 1),
    settings: mergedSettings,
    groups: groups.items,
    categories: categories.items,
    monthlyBudgets: monthlyBudgets.items,
    transactions: transactions.items,
    recurringRules: recurringRules.items,
    savingsGoals: savingsGoals.items,
    accounts: accounts.items,
    netWorthSnapshots: snapshots.items,
    yearlyPlanItems: planItems.items,
  };

  const summary: MergeSummary = {
    groupsAdded: groups.added,
    categoriesAdded: categories.added,
    budgetsMerged: monthlyBudgets.added + monthlyBudgets.updated,
    transactionsAdded: transactions.added,
    transactionsUpdated: transactions.updated,
    rulesMerged: recurringRules.added + recurringRules.updated,
    goalsMerged: savingsGoals.added + savingsGoals.updated,
    accountsMerged: accounts.added + accounts.updated,
    snapshotsMerged: snapshots.added + snapshots.updated,
    planItemsMerged: planItems.added + planItems.updated,
    totalChanges:
      groups.added +
      categories.added +
      monthlyBudgets.added +
      monthlyBudgets.updated +
      transactions.added +
      transactions.updated +
      recurringRules.added +
      recurringRules.updated +
      savingsGoals.added +
      savingsGoals.updated +
      accounts.added +
      accounts.updated +
      snapshots.added +
      snapshots.updated +
      planItems.added +
      planItems.updated,
  };

  return { merged, summary };
}
