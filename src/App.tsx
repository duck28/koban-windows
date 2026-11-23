import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  ActiveWorkspace,
  AppSettings,
  BankImportProfile,
  CategoryGroup,
  CategoryItem,
  CategoryKind,
  FinancialAccount,
  ImportRule,
  LedgerMode,
  LedgerState,
  MonthCopyScope,
  NetWorthSnapshot,
  PendingImportFile,
  ProfileSetupMode,
  RecurringRule,
  SavingsGoal,
  TransactionItem,
  VaultStatus,
  ViewTab,
  WebDavConfig,
  YearlyPlanItem,
  YearlyPlanSchedule,
} from './types';
import {
  createDefaultOnboardingAccounts,
  createInitialLedgerState,
  formatMonthKey,
  ZEN_PALETTE,
} from './data/templates';
import {
  buildRecurringTransactionsForMonth,
  isAccountTransfer,
  isScheduledRule,
  TRANSFER_CATEGORY_ID,
  computeAnnualSeries,
  computeMonthSummary,
  computeNetWorthMetrics,
  recurringMonthlyEquivalent,
} from './utils/calculations';
import {
  applyDeviceBackupDir,
  archiveImportedFile,
  base64ToUint8,
  checkExternalVaultChange,
  createVault,
  downloadVaultFromWebDav,
  enrollDeviceUnlock,
  exportSqliteDatabaseCopy,
  forgetWebDavSyncState,
  getDeviceImportWatchDir,
  getVaultStatus,
  isExternalDbModifiedError,
  isTauriEnv,
  loadLedgerFromDb,
  lockVault,
  pickFolderDialog,
  pickOpenFileDialog,
  rememberDeviceBackupDir,
  rememberDeviceImportWatchDir,
  restoreFromBackupFile,
  revealPathInExplorer,
  runManualBackup,
  saveAuthSettings,
  saveLedgerToDb,
  scanImportFolder,
  changeVaultCredentials,
} from './utils/storage';
import { clearLegacyLocalAuthCache } from './utils/auth';
import { mergeLedgers } from './utils/ledgerMerge';
import {
  applyStagedTransactionsToLedger,
  parseBankStatementBuffer,
  StagedBankTransaction,
} from './utils/bankImport';
import {
  exportExcelWorkbook,
  exportMonthlyBudgetCsv,
  exportTransactionsCsv,
  importBudgetSheetFromBuffer,
} from './utils/exportImport';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { AuthLockScreen } from './components/AuthLockScreen';
import { OnboardingModal } from './components/OnboardingModal';
import {
  ImportDataModal,
  ImportKind,
  ImportPreviewData,
} from './components/ImportDataModal';
import { ImportRulesModal } from './components/ImportRulesModal';
import { MonthlyWorksheetView } from './components/MonthlyWorksheetView';
import { YearlyBudgetPlannerView } from './components/YearlyBudgetPlannerView';
import { TransactionsView } from './components/TransactionsView';
import { ConfirmDialog, ConfirmOptions } from './components/ConfirmDialog';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { AccountsNetWorthView } from './components/AccountsNetWorthView';
import { ReportsChartsView } from './components/ReportsChartsView';
import { CategoriesStudioView } from './components/CategoriesStudioView';
import { RecurringView } from './components/RecurringView';
import { SavingsGoalsView } from './components/SavingsGoalsView';
import { BackupsExportView } from './components/BackupsExportView';
import { SettingsView } from './components/SettingsView';
import { RecoveryKeyModal } from './components/RecoveryKeyModal';
import { WebDavConflictDialog } from './components/WebDavConflictDialog';
import {
  WebDavOpenVaultModal,
  WebDavOpenVaultRequest,
} from './components/WebDavOpenVaultModal';
import { useWebDavSync, WebDavSyncContext } from './hooks/useWebDavSync';
import {
  UpdateCheckResult,
  checkForAppUpdates,
  openExternalUrl,
} from './utils/updater';
import { CheckCircle2, Download, ExternalLink, FolderSearch, X } from 'lucide-react';
import { useI18n } from './i18n';
import './App.css';

interface ToastNotice {
  message: string;
  filePath?: string;
}

function normalizeLedger(loaded: LedgerState): LedgerState {
  return {
    ...loaded,
    accounts:
      loaded.accounts ??
      createDefaultOnboardingAccounts(loaded.settings.setupMode || 'both'),
    netWorthSnapshots: loaded.netWorthSnapshots ?? [],
    yearlyPlanItems: loaded.yearlyPlanItems ?? [],
    importProfiles: loaded.importProfiles ?? [],
    importRules: loaded.importRules ?? [],
  };
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value) ?? '';
  const obj = value as Record<string, unknown>;
  return JSON.stringify(
    Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = obj[k];
        return acc;
      }, {})
  );
}

/**
 * After a WebDAV pull, keep this device's WebDAV connection settings (like the manual pull).
 * Returns the loaded state unchanged when nothing differs, so no needless save/upload follows.
 */
function keepDeviceWebDav(loaded: LedgerState, local?: WebDavConfig): LedgerState {
  if (!local) return loaded;
  const remote = loaded.settings?.webdav;
  const merged: WebDavConfig = {
    ...(remote ?? local),
    enabled: local.enabled,
    url: local.url,
    username: local.username,
    password: local.password,
    remoteFileName: local.remoteFileName,
    mode: local.mode,
    autoSync: local.autoSync,
  };
  if (remote && stableJson(merged) === stableJson(remote)) return loaded;
  return { ...loaded, settings: { ...loaded.settings, webdav: merged } };
}

/**
 * An imported or restored ledger must not change where this device sends its data: a crafted
 * backup could otherwise point WebDAV sync or the backup folder at an attacker (and prune the
 * local backup history). The current device's settings for these always win.
 */
function keepDeviceSettings(incoming: LedgerState, current: LedgerState): LedgerState {
  if (!incoming.settings || !current.settings) return incoming;
  return {
    ...incoming,
    settings: {
      ...incoming.settings,
      webdav: current.settings.webdav,
      backupDir: current.settings.backupDir,
      autoBackup: current.settings.autoBackup,
      maxBackups: current.settings.maxBackups,
    },
  };
}

export function App() {
  const [state, setState] = useState<LedgerState>(() =>
    createInitialLedgerState('both', 'CHF', '', false)
  );
  const [isLoaded, setIsLoaded] = useState(false);
  const { t, tf, setLanguage, tGroupName, tCategoryName, tAccountName, tGoalName } = useI18n();
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);
  const didStartupUpdateCheckRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  // Themed confirm dialog (replaces window.confirm) and the keyboard-shortcut overview
  const [confirmRequest, setConfirmRequest] = useState<
    (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  >(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  /** Ask the Transactions view to focus its new-entry form or its search box. */
  const [txFocusRequest, setTxFocusRequest] = useState<{
    target: 'new' | 'search';
    nonce: number;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>('worksheet');
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showImportRulesModal, setShowImportRulesModal] = useState(false);
  const [importWatchDir, setImportWatchDir] = useState<string>(() =>
    getDeviceImportWatchDir()
  );
  const [pendingImportFiles, setPendingImportFiles] = useState<PendingImportFile[]>([]);
  const [importBannerDismissed, setImportBannerDismissed] = useState(false);
  const [initialPendingFilePath, setInitialPendingFilePath] = useState<string | null>(
    null
  );
  const [pendingImportPreview, setPendingImportPreview] =
    useState<ImportPreviewData | null>(null);
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [pendingRecoveryKey, setPendingRecoveryKey] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  const refreshImportWatchFolder = async (dirOverride?: string) => {
    const dir = (dirOverride ?? importWatchDir).trim();
    if (!dir || !isTauriEnv() || isLocked) {
      setPendingImportFiles([]);
      return;
    }
    try {
      const files = await scanImportFolder(dir);
      setPendingImportFiles(files);
      if (files.length > 0) setImportBannerDismissed(false);
    } catch {
      // ignore folder read glitches
    }
  };

  useEffect(() => {
    if (!isLoaded || isLocked || !importWatchDir || !isTauriEnv()) return;
    void refreshImportWatchFolder(importWatchDir);
    const onFocus = () => void refreshImportWatchFolder(importWatchDir);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isLocked, importWatchDir]);

  const handlePickImportWatchDir = async () => {
    const picked = await pickFolderDialog('Select Bank Statement Watch Folder');
    if (!picked) return;
    rememberDeviceImportWatchDir(picked);
    setImportWatchDir(picked);
    await refreshImportWatchFolder(picked);
  };

  const handleClearImportWatchDir = () => {
    rememberDeviceImportWatchDir('');
    setImportWatchDir('');
    setPendingImportFiles([]);
  };
  const [preselectedCategoryId, setPreselectedCategoryId] = useState<string | null>(
    null
  );
  const [preselectedAccountId, setPreselectedAccountId] = useState<string | null>(
    null
  );
  const [toast, setToast] = useState<ToastNotice | null>(null);

  const showNotification = (message: string, filePath?: string) => {
    setToast({ message, filePath });
    window.clearTimeout((window as unknown as { __toastTimer?: number }).__toastTimer);
    (window as unknown as { __toastTimer?: number }).__toastTimer = window.setTimeout(
      () => setToast(null),
      5000
    );
  };

  const handleCheckForUpdates = async (silent = false) => {
    setIsCheckingUpdate(true);
    setUpdateCheckError(null);
    try {
      const result = await checkForAppUpdates();
      setUpdateInfo(result);
      if (result.update_available) {
        setUpdateBannerDismissed(false);
        if (!silent) {
          showNotification(
            t('settings.updates.available')
              .replace('{latest}', result.latest_version)
              .replace('{current}', result.current_version)
          );
        }
      } else if (!silent) {
        showNotification(
          t('settings.updates.upToDate').replace('{version}', result.current_version)
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUpdateCheckError(msg);
      if (!silent) {
        showNotification(t('settings.updates.error').replace('{error}', msg));
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  useEffect(() => {
    if (!isLoaded || !state.settings.setupCompleted) return;
    if (didStartupUpdateCheckRef.current) return;
    if ((state.settings.autoCheckUpdates ?? true) === false) return;
    didStartupUpdateCheckRef.current = true;
    void handleCheckForUpdates(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, state.settings.setupCompleted, state.settings.autoCheckUpdates]);

  // ================= PERSISTENCE & WEBDAV SYNC ENGINE =================
  const latestStateRef = useRef(state);
  latestStateRef.current = state;
  /** JSON of the ledger as it is stored in the local DB (skip no-op saves). */
  const lastSavedJsonRef = useRef<string | null>(null);
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const suppressSavesRef = useRef(0);
  /** Blocks saves while the local DB holds a vault we could not decrypt yet (custom passphrase). */
  const [saveBlocked, setSaveBlockedState] = useState(false);
  const saveBlockedRef = useRef(false);
  const setSaveBlocked = (blocked: boolean) => {
    saveBlockedRef.current = blocked;
    setSaveBlockedState(blocked);
  };
  /** WebDAV config to apply once a vault downloaded via "Open Vault from WebDAV" is unlocked. */
  const pendingWebDavRef = useRef<WebDavConfig | null>(null);
  const notifySavedRef = useRef<() => void>(() => {});
  const [showWebDavOpenModal, setShowWebDavOpenModal] = useState(false);

  const persistLatest = (): Promise<boolean> => {
    const run = async (): Promise<boolean> => {
      if (suppressSavesRef.current > 0 || saveBlockedRef.current) return false;
      const snapshot = latestStateRef.current;
      const json = JSON.stringify(snapshot);
      if (json === lastSavedJsonRef.current) return false;
      setIsSaving(true);
      try {
        rememberDeviceBackupDir(snapshot.settings?.backupDir ?? '');
        try {
          await saveLedgerToDb(snapshot);
          lastSavedJsonRef.current = json;
          notifySavedRef.current();
          return true;
        } catch (e) {
          if (isExternalDbModifiedError(e)) {
            const ext = await checkExternalVaultChange();
            if (ext.externalStateJson) {
              const externalState = normalizeLedger(
                JSON.parse(ext.externalStateJson) as LedgerState
              );
              const { merged, summary } = mergeLedgers(snapshot, externalState, {
                prefer: 'local',
              });
              const normalizedMerged = applyDeviceBackupDir(merged);
              const mergedJson = JSON.stringify(normalizedMerged);
              latestStateRef.current = normalizedMerged;
              setState(normalizedMerged);
              await saveLedgerToDb(normalizedMerged, { forceOverwrite: true });
              lastSavedJsonRef.current = mergedJson;
              notifySavedRef.current();
              if (summary.totalChanges > 0) {
                showNotification(t('merge.externalConflictMerged'));
              }
              return true;
            }
          }
          throw e;
        }
      } catch (e) {
        console.error('Encrypted auto-save failed:', e);
        return false;
      } finally {
        setIsSaving(false);
      }
    };
    const p = saveChainRef.current.then(run, run);
    saveChainRef.current = p.catch(() => undefined);
    return p;
  };

  const withSavesSuspended = async <T,>(fn: () => Promise<T>): Promise<T> => {
    suppressSavesRef.current += 1;
    try {
      await saveChainRef.current;
      return await fn();
    } finally {
      suppressSavesRef.current -= 1;
    }
  };

  /** Applies a ledger freshly read from the local DB. */
  const applyLoadedLedger = (loadedFromDb: LedgerState, keepWebDav?: WebDavConfig) => {
    // This device's backup folder replaces the synced one. Counted as already saved, so loading
    // never writes (and in primary mode pushes) a different folder back to the shared vault.
    const loaded = applyDeviceBackupDir(loadedFromDb);
    lastSavedJsonRef.current = JSON.stringify(loaded);
    let next = loaded;
    const pending = pendingWebDavRef.current;
    if (pending) {
      pendingWebDavRef.current = null;
      next = {
        ...next,
        settings: {
          ...next.settings,
          webdav: { ...(next.settings.webdav ?? {}), ...pending },
        },
      };
    } else if (keepWebDav) {
      next = keepDeviceWebDav(next, keepWebDav);
    }
    const normalized = normalizeLedger(next);
    latestStateRef.current = normalized;
    setState(normalized);
  };

  /** Strict cryptographic lock: flushes pending edits while still unlocked, then clears DEK & plaintext ledger. */
  const lockVaultNow = async () => {
    if (!saveBlockedRef.current && vaultStatus?.unlocked) {
      await persistLatest().catch(() => false);
    }
    await lockVault().catch(() => {});
    setSaveBlocked(true);
    const cleared = createInitialLedgerState('both', 'EUR', '', false);
    latestStateRef.current = cleared;
    lastSavedJsonRef.current = null;
    setState(cleared);
    const st = await getVaultStatus().catch(() => null);
    if (st) setVaultStatus(st);
    setIsLocked(true);
  };

  /** Reloads the ledger from the local DB (after a WebDAV pull), keeping this device's WebDAV settings. */
  const reloadLedgerFromDb = async (): Promise<boolean> => {
    const st = await getVaultStatus().catch(() => null);
    if (st) setVaultStatus(st);
    if (st && !st.unlocked) {
      pendingWebDavRef.current = latestStateRef.current.settings.webdav ?? null;
      setSaveBlocked(true);
      setIsLocked(true);
      return false;
    }
    const loaded = await loadLedgerFromDb();
    if (!loaded || !loaded.settings) {
      pendingWebDavRef.current = latestStateRef.current.settings.webdav ?? null;
      setSaveBlocked(true);
      setIsLocked(true);
      return false;
    }
    applyLoadedLedger(loaded, latestStateRef.current.settings.webdav);
    setSaveBlocked(false);
    return true;
  };

  const mergeRemoteLedgerJson = async (remoteJson: string): Promise<void> => {
    const remoteState = normalizeLedger(JSON.parse(remoteJson) as LedgerState);
    const { merged } = mergeLedgers(latestStateRef.current, remoteState, {
      prefer: 'local',
    });
    const normalized = applyDeviceBackupDir(merged);
    latestStateRef.current = normalized;
    setState(normalized);
    await saveLedgerToDb(normalized, { forceOverwrite: true });
    lastSavedJsonRef.current = JSON.stringify(normalized);
  };

  const webdavSync = useWebDavSync({
    config: state.settings.webdav,
    ready: isLoaded && !saveBlocked && !isLocked,
    flushSave: persistLatest,
    withSavesSuspended,
    reloadFromDb: reloadLedgerFromDb,
    mergeWithRemoteJson: mergeRemoteLedgerJson,
    notify: (message) => showNotification(message),
    setMode: (mode) =>
      setState((prev) =>
        prev.settings.webdav
          ? {
              ...prev,
              settings: {
                ...prev.settings,
                webdav: { ...prev.settings.webdav, mode },
              },
            }
          : prev
      ),
  });
  notifySavedRef.current = webdavSync.notifyLocalSave;

  const refreshInitialVaultState = async () => {
    clearLegacyLocalAuthCache();
    const st = await getVaultStatus().catch(() => null);
    setVaultStatus(st);
    if (!st || !st.exists || !st.hasLedgerState) {
      setSaveBlocked(true);
      setIsLocked(false);
      setShowSetupModal(true);
      return;
    }
    if (st.unlocked) {
      const loaded = await loadLedgerFromDb();
      if (loaded && loaded.settings) {
        applyLoadedLedger(loaded);
        setSaveBlocked(false);
        setIsLocked(false);
        if (!loaded.settings.setupCompleted) {
          setShowSetupModal(true);
        }
        return;
      }
    }
    setSaveBlocked(true);
    setIsLocked(true);
  };

  // Load initial Vault Format v2 status on mount (never bypasses cryptographic unlock)
  useEffect(() => {
    (async () => {
      await refreshInitialVaultState();
      setIsLoaded(true);
    })();
  }, []);

  const handleVaultUnlocked = async (
    loadedState: LedgerState,
    nextStatus: VaultStatus
  ) => {
    setVaultStatus(nextStatus);
    applyLoadedLedger(loadedState);
    setSaveBlocked(false);
    setIsLocked(false);
    if (!loadedState.settings.setupCompleted) {
      setShowSetupModal(true);
    }
    showNotification(
      `Signed in as ${loadedState.settings.ownerDisplayName || 'Koban Owner'}.`
    );
  };

  const handleVaultMigrated = async (
    loadedState: LedgerState,
    nextStatus: VaultStatus,
    recoveryKey: string | null
  ) => {
    setVaultStatus(nextStatus);
    applyLoadedLedger(loadedState);
    setSaveBlocked(false);
    setIsLocked(false);
    if (recoveryKey) {
      setPendingRecoveryKey(recoveryKey);
    }
    showNotification('Upgraded database cleanly to Vault Format v2 (Argon2id + AES-256-GCM).');
  };

  // External cloud-folder change watcher (Synology Drive / OneDrive / iCloud / Dropbox)
  const lastExtCheckRef = useRef(0);
  useEffect(() => {
    if (!isLoaded || isLocked || saveBlocked || !vaultStatus?.unlocked || !isTauriEnv()) {
      return;
    }
    const checkExternal = async () => {
      const now = Date.now();
      if (now - lastExtCheckRef.current < 3000) return;
      lastExtCheckRef.current = now;
      try {
        const ext = await checkExternalVaultChange();
        if (!ext.changed) return;
        if (ext.externalStateJson) {
          const remoteState = normalizeLedger(
            JSON.parse(ext.externalStateJson) as LedgerState
          );
          const { merged, summary } = mergeLedgers(
            latestStateRef.current,
            remoteState,
            { prefer: 'local' }
          );
          const normalized = applyDeviceBackupDir(merged);
          latestStateRef.current = normalized;
          setState(normalized);
          if (summary.totalChanges > 0) {
            await saveLedgerToDb(normalized, { forceOverwrite: true });
            lastSavedJsonRef.current = JSON.stringify(normalized);
            showNotification(
              t('merge.externalSyncedToast').replace(
                '{summary}',
                `${summary.totalChanges} change(s)`
              )
            );
          } else {
            lastSavedJsonRef.current = JSON.stringify(normalized);
          }
        } else if (ext.error) {
          showNotification('External vault changed with updated credentials — please unlock.');
          await lockVaultNow();
        }
      } catch (err) {
        console.warn('External vault check skipped:', err);
      }
    };

    const onFocus = () => {
      void checkExternal();
    };
    window.addEventListener('focus', onFocus);
    const interval = window.setInterval(() => {
      void checkExternal();
    }, 30_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(interval);
    };
  }, [isLoaded, isLocked, saveBlocked, vaultStatus?.unlocked]);

  // Inactivity Auto-Lock & Lock-on-Minimize
  useEffect(() => {
    const idleMins = vaultStatus?.authSettings.autoLockMinutes ?? 0;
    const lockOnMin = vaultStatus?.authSettings.lockOnMinimize ?? false;
    if (!isLoaded || isLocked || (!idleMins && !lockOnMin)) return;

    let timer = idleMins
      ? window.setTimeout(() => void lockVaultNow(), idleMins * 60 * 1000)
      : undefined;

    const resetTimer = () => {
      if (!idleMins) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void lockVaultNow(), idleMins * 60 * 1000);
    };

    const onVisibilityChange = () => {
      if (lockOnMin && document.hidden) {
        void lockVaultNow();
      }
    };

    window.addEventListener('pointerdown', resetTimer);
    window.addEventListener('keydown', resetTimer);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('pointerdown', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [
    isLoaded,
    isLocked,
    vaultStatus?.authSettings.autoLockMinutes,
    vaultStatus?.authSettings.lockOnMinimize,
  ]);

  // Sync UI language from persisted ledger settings
  useEffect(() => {
    if (isLoaded && state.settings.language) {
      setLanguage(state.settings.language);
    }
  }, [isLoaded, state.settings.language, setLanguage]);

  // Apply theme & personalization attributes to document root
  useEffect(() => {
    const root = document.documentElement;
    if (state.settings.theme === 'light') {
      root.setAttribute('data-theme', 'light');
    } else if (state.settings.theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }

    const palette = state.settings.themePalette || 'default';
    root.setAttribute('data-palette', palette);

    const density = state.settings.density || 'comfortable';
    root.setAttribute('data-density', density);

    if (state.settings.highContrastAmounts) {
      root.setAttribute('data-high-contrast', 'true');
    } else {
      root.removeAttribute('data-high-contrast');
    }
  }, [
    state.settings.theme,
    state.settings.themePalette,
    state.settings.density,
    state.settings.highContrastAmounts,
  ]);

  // Auto-save to AES-256-GCM encrypted SQLite + auto-backup when state changes
  useEffect(() => {
    if (!isLoaded) return;
    const timer = window.setTimeout(() => {
      void persistLatest();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [state, isLoaded]);

  // Global keyboard shortcuts (oriented on ZenPDF)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // No app shortcuts on the lock screen (e.g. Ctrl+S could set a new backup folder),
      // and none while a dialog handles its own keys.
      if (isLocked || confirmRequest || showShortcuts) return;
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;

      // Month navigation: Alt+← / Alt+→ anywhere, T for the current month
      if (e.altKey && !mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        shiftActiveMonth(e.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      // Ctrl+[ / Ctrl+] — same as ⌘[ / ⌘] on the Mac
      if (mod && !e.altKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        shiftActiveMonth(e.key === '[' ? -1 : 1);
        return;
      }
      if (!inInput && !mod && !e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        const now = new Date();
        updateSettings({ activeYear: now.getFullYear(), activeMonth: now.getMonth() + 1 });
        return;
      }

      // Shortcut overview: ? or F1
      if ((!inInput && e.key === '?') || e.key === 'F1') {
        e.preventDefault();
        setShowShortcuts(true);
        return;
      }

      if (mod && e.key === ',') {
        e.preventDefault();
        setActiveTab('settings');
        return;
      }

      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setActiveTab('transactions');
        setTxFocusRequest({ target: 'search', nonce: Date.now() });
        return;
      }

      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        handleApplyRecurringToMonth();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsSidebarOpen((v) => !v);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleManualBackup();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setActiveTab('transactions');
        setTxFocusRequest({ target: 'new', nonce: Date.now() });
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setShowImportModal(true);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        void lockVaultNow();
        return;
      }

      if (!inInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tabMap: Record<string, ViewTab> = {
          '1': 'worksheet',
          '2': 'yearly_planner',
          '3': 'transactions',
          '4': 'accounts',
          '5': 'reports',
          '6': 'categories',
          '7': 'recurring',
          '8': 'goals',
          '9': 'backups',
          '0': 'settings',
        };
        if (tabMap[e.key]) {
          setActiveTab(tabMap[e.key]);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state, isLocked, confirmRequest, showShortcuts]);

  const monthKey = formatMonthKey(
    state.settings.activeYear,
    state.settings.activeMonth
  );

  const prevYear =
    state.settings.activeMonth === 1
      ? state.settings.activeYear - 1
      : state.settings.activeYear;
  const prevMonth =
    state.settings.activeMonth === 1 ? 12 : state.settings.activeMonth - 1;
  const prevMonthKey = formatMonthKey(prevYear, prevMonth);

  const summary = computeMonthSummary(
    state,
    monthKey,
    state.settings.activeWorkspace
  );

  const prevSummary = computeMonthSummary(
    state,
    prevMonthKey,
    state.settings.activeWorkspace
  );
  const previousMonthHasData =
    prevSummary.incomeBudget > 0 ||
    prevSummary.incomeActual > 0 ||
    prevSummary.totalOutflowBudget > 0 ||
    prevSummary.totalOutflowActual > 0;

  const annualSeries = computeAnnualSeries(
    state,
    state.settings.activeYear,
    state.settings.activeWorkspace
  );

  const netWorthMetrics = computeNetWorthMetrics(
    state,
    state.settings.activeWorkspace,
    summary.totalOutflowActual
  );

  // ================= STATE UPDATERS =================

  /** Opens the themed confirm dialog; resolves true when confirmed. */
  const askConfirm = (opts: ConfirmOptions) =>
    new Promise<boolean>((resolve) => {
      setConfirmRequest({ ...opts, resolve });
    });

  /** Asks before deleting, unless "Confirm before deleting" is turned off in Settings. */
  const confirmDelete = async (title: string, message?: string) => {
    if (state.settings.confirmBeforeDelete === false) return true;
    return askConfirm({ title, message, offerDontAsk: true });
  };

  const shiftActiveMonth = (delta: number) => {
    const idx = state.settings.activeYear * 12 + (state.settings.activeMonth - 1) + delta;
    updateSettings({ activeYear: Math.floor(idx / 12), activeMonth: (idx % 12) + 1 });
  };

  const updateSettings = (patch: Partial<AppSettings>) => {
    setState((prev) => ({
      ...prev,
      settings: { ...prev.settings, ...patch },
    }));
  };

  const handleCompleteSetup = async (opts: {
    setupMode: ProfileSetupMode;
    currency: string;
    backupDir: string;
    autoBackup: boolean;
    defaultVatRate: number;
    taxReserveRate: number;
    applyCategorySelection: boolean;
    selectedHomeIds: Set<string>;
    selectedFreelancerIds: Set<string>;
    recurringCategoryIds: Set<string>;
    customItemsByGroup: Record<string, string[]>;
    accounts?: FinancialAccount[];
    skipAccountsSetup: boolean;
    ownerDisplayName: string;
    vaultPassphrase?: string;
    keyfilePath?: string | null;
    rememberKeyfile?: boolean;
    createRecoveryKey: boolean;
    enrollWindowsHello: boolean;
    autoLockMinutes: number;
    lockOnMinimize: boolean;
    confirmBeforeMonthCopy: boolean;
    monthCopyScope: MonthCopyScope;
    autoPromptCopyOnEmptyMonth: boolean;
  }) => {
    const chosenAccounts = opts.skipAccountsSetup
      ? state.accounts
      : opts.accounts ?? state.accounts;

    let nextState = state;
    if (opts.applyCategorySelection) {
      const fresh = createInitialLedgerState(
        opts.setupMode,
        opts.currency,
        opts.backupDir,
        true,
        opts.selectedHomeIds,
        opts.selectedFreelancerIds,
        opts.customItemsByGroup,
        chosenAccounts,
        state.netWorthSnapshots,
        opts.recurringCategoryIds
      );
      fresh.settings.autoBackup = opts.autoBackup;
      fresh.settings.defaultVatRate = opts.defaultVatRate;
      fresh.settings.taxReserveRate = opts.taxReserveRate;
      fresh.settings.confirmBeforeMonthCopy = opts.confirmBeforeMonthCopy;
      fresh.settings.monthCopyScope = opts.monthCopyScope;
      fresh.settings.autoPromptCopyOnEmptyMonth =
        opts.autoPromptCopyOnEmptyMonth;
      fresh.settings.ownerDisplayName = opts.ownerDisplayName;
      fresh.settings.language = state.settings.language;
      fresh.settings.autoCheckUpdates = state.settings.autoCheckUpdates ?? true;
      nextState = fresh;
    } else {
      const nextWorkspace: ActiveWorkspace =
        opts.setupMode === 'freelancer'
          ? 'freelancer'
          : opts.setupMode === 'home'
            ? 'home'
            : state.settings.activeWorkspace;
      const updatedCategories = state.categories.map((c) => ({
        ...c,
        isRecurring: opts.recurringCategoryIds.has(c.id),
      }));
      const existingRecByCat = new Map(
        state.recurringRules.map((r) => [r.categoryId, r])
      );
      const nextRecurringRules: RecurringRule[] = [];
      for (const cat of updatedCategories) {
        if (cat.isRecurring) {
          const existing = existingRecByCat.get(cat.id);
          if (existing) {
            nextRecurringRules.push({ ...existing, active: true });
          } else {
            nextRecurringRules.push({
              id: `rec-init-${cat.id}`,
              mode: cat.mode,
              type: cat.kind === 'income' ? 'income' : 'expense',
              categoryId: cat.id,
              description: cat.name,
              amount: cat.defaultBudget || 0,
              frequency: 'monthly',
              dayOfMonth: cat.kind === 'income' ? 25 : 1,
              taxRate: cat.taxRate ?? 0,
              deductiblePct: cat.deductiblePct ?? 100,
              active: true,
            });
          }
        }
      }
      nextState = {
        ...state,
        categories: updatedCategories,
        recurringRules: nextRecurringRules,
        accounts: chosenAccounts,
        settings: {
          ...state.settings,
          setupCompleted: true,
          setupMode: opts.setupMode,
          activeWorkspace: nextWorkspace,
          currency: opts.currency,
          backupDir: opts.backupDir,
          autoBackup: opts.autoBackup,
          defaultVatRate: opts.defaultVatRate,
          taxReserveRate: opts.taxReserveRate,
          ownerDisplayName: opts.ownerDisplayName,
          confirmBeforeMonthCopy: opts.confirmBeforeMonthCopy,
          monthCopyScope: opts.monthCopyScope,
          autoPromptCopyOnEmptyMonth: opts.autoPromptCopyOnEmptyMonth,
        },
      };
    }

    const normalizedNext = normalizeLedger(applyDeviceBackupDir(nextState));
    latestStateRef.current = normalizedNext;
    setState(normalizedNext);

    try {
      const needsVaultCreate = !vaultStatus?.exists || !vaultStatus?.hasLedgerState;
      let nextStatus = vaultStatus;
      let recoveryKeyToShow: string | null = null;

      if (needsVaultCreate) {
        if (!opts.vaultPassphrase) {
          throw new Error('Master Password is required to create Vault Format v2.');
        }
        const created = await createVault({
          passphrase: opts.vaultPassphrase,
          keyfilePath: opts.keyfilePath ?? null,
          createRecoveryKey: opts.createRecoveryKey,
          initialState: normalizedNext,
          rememberKeyfile: opts.rememberKeyfile,
        });
        nextStatus = created.status;
        recoveryKeyToShow = created.recoveryKey ?? null;
        lastSavedJsonRef.current = JSON.stringify(normalizedNext);
      } else if (vaultStatus?.unlocked && opts.vaultPassphrase) {
        nextStatus = await changeVaultCredentials({
          newPassphrase: opts.vaultPassphrase,
          newKeyfilePath: opts.keyfilePath ?? null,
          rekeyDek: false,
          rememberKeyfile: opts.rememberKeyfile,
          currentState: normalizedNext,
        });
      }

      if (opts.enrollWindowsHello && nextStatus?.windowsHelloAvailable && !nextStatus.deviceSlotEnrolled) {
        try {
          nextStatus = await enrollDeviceUnlock();
        } catch (helloErr) {
          console.warn('Windows Hello enrollment skipped during setup:', helloErr);
        }
      }

      nextStatus = await saveAuthSettings({
        autoPromptDevice: true,
        autoLockMinutes: opts.autoLockMinutes,
        lockOnMinimize: opts.lockOnMinimize,
      });

      setVaultStatus(nextStatus);
      setSaveBlocked(false);
      setIsLocked(false);
      setShowSetupModal(false);
      if (recoveryKeyToShow) {
        setPendingRecoveryKey(recoveryKeyToShow);
      }
      showNotification(
        opts.skipAccountsSetup
          ? 'Koban setup complete (Vault Format v2 encrypted).'
          : 'Koban setup, accounts, and Vault Format v2 configured.'
      );
    } catch (err) {
      showNotification(`Vault setup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleUpdateBudget = (categoryId: string, newBudget: number) => {
    setState((prev) => {
      // Budgets driven by a scheduled recurring rule (bi-weekly, bi-monthly…)
      // vary per month: a typed value only overrides this month.
      const hasScheduledRule = prev.recurringRules.some(
        (r) => r.active && r.categoryId === categoryId && isScheduledRule(r)
      );
      if (hasScheduledRule) {
        const sIdx = prev.monthlyBudgets.findIndex(
          (mb) => mb.monthKey === monthKey && mb.categoryId === categoryId
        );
        const scheduledBudgets = [...prev.monthlyBudgets];
        if (sIdx >= 0) {
          scheduledBudgets[sIdx] = {
            ...scheduledBudgets[sIdx],
            budget: newBudget,
            budgetManual: true,
          };
        } else {
          scheduledBudgets.push({
            monthKey,
            categoryId,
            budget: newBudget,
            directActual: null,
            budgetManual: true,
          });
        }
        return { ...prev, monthlyBudgets: scheduledBudgets };
      }

      const prevCat = prev.categories.find((c) => c.id === categoryId);
      const oldDefaultBudget = prevCat?.defaultBudget ?? 0;

      const idx = prev.monthlyBudgets.findIndex(
        (mb) => mb.monthKey === monthKey && mb.categoryId === categoryId
      );
      const nextBudgets = [...prev.monthlyBudgets];
      if (idx >= 0) {
        nextBudgets[idx] = { ...nextBudgets[idx], budget: newBudget };
      } else {
        nextBudgets.push({
          monthKey,
          categoryId,
          budget: newBudget,
          directActual: null,
        });
      }
      const nextCats = prev.categories.map((c) =>
        c.id === categoryId ? { ...c, defaultBudget: newBudget } : c
      );
      const nextRecurring = prev.recurringRules.map((r) =>
        r.categoryId === categoryId &&
        (r.amount === 0 || Math.abs(r.amount - oldDefaultBudget) < 0.01)
          ? { ...r, amount: newBudget }
          : r
      );
      return {
        ...prev,
        categories: nextCats,
        monthlyBudgets: nextBudgets,
        recurringRules: nextRecurring,
      };
    });
  };

  const handleResetScheduledBudget = (categoryId: string) => {
    setState((prev) => ({
      ...prev,
      monthlyBudgets: prev.monthlyBudgets.map((mb) =>
        mb.monthKey === monthKey && mb.categoryId === categoryId
          ? { ...mb, budgetManual: false }
          : mb
      ),
    }));
  };

  const handleUpdateDirectActual = (
    categoryId: string,
    newActual: number | null
  ) => {
    setState((prev) => {
      const idx = prev.monthlyBudgets.findIndex(
        (mb) => mb.monthKey === monthKey && mb.categoryId === categoryId
      );
      const cat = prev.categories.find((c) => c.id === categoryId);
      const nextBudgets = [...prev.monthlyBudgets];
      if (idx >= 0) {
        nextBudgets[idx] = { ...nextBudgets[idx], directActual: newActual };
      } else {
        nextBudgets.push({
          monthKey,
          categoryId,
          budget: cat?.defaultBudget ?? 0,
          directActual: newActual,
        });
      }
      return {
        ...prev,
        monthlyBudgets: nextBudgets,
      };
    });
  };

  const handleApplyBudgetsToAllMonths = () => {
    setState((prev) => {
      const nextBudgets = [...prev.monthlyBudgets];
      const year = prev.settings.activeYear;

      for (const cat of prev.categories) {
        const currentMb = prev.monthlyBudgets.find(
          (mb) => mb.monthKey === monthKey && mb.categoryId === cat.id
        );
        const budgetToCopy = currentMb ? currentMb.budget : cat.defaultBudget;

        for (let m = 1; m <= 12; m++) {
          const mk = formatMonthKey(year, m);
          const idx = nextBudgets.findIndex(
            (mb) => mb.monthKey === mk && mb.categoryId === cat.id
          );
          if (idx >= 0) {
            nextBudgets[idx] = { ...nextBudgets[idx], budget: budgetToCopy };
          } else {
            nextBudgets.push({
              monthKey: mk,
              categoryId: cat.id,
              budget: budgetToCopy,
              directActual: null,
            });
          }
        }
      }
      return { ...prev, monthlyBudgets: nextBudgets };
    });
    showNotification(
      `Copied ${monthKey} planned budgets across all 12 months of ${state.settings.activeYear}.`
    );
  };

  const handleCopyMonthValues = (opts: {
    sourceMonthKey: string;
    targetMonthKey: string;
    scope: MonthCopyScope;
    overwriteExisting: boolean;
    navigateToTarget?: boolean;
    disableFutureConfirm?: boolean;
  }) => {
    let copiedCount = 0;

    setState((prev) => {
      const sourceSummary = computeMonthSummary(
        prev,
        opts.sourceMonthKey,
        'combined'
      );
      const sourceRowMap = new Map<
        string,
        { budget: number; actual: number | null }
      >();
      for (const gs of sourceSummary.groups) {
        for (const r of gs.rows) {
          sourceRowMap.set(r.category.id, {
            budget: r.budget,
            // Auto-filled fixed costs are recomputed per month, not copied
            actual: r.autoActual ? null : r.actual,
          });
        }
      }

      const nextBudgets = [...prev.monthlyBudgets];

      for (const cat of prev.categories) {
        const srcVals = sourceRowMap.get(cat.id);
        if (!srcVals) continue;

        const targetIdx = nextBudgets.findIndex(
          (mb) =>
            mb.monthKey === opts.targetMonthKey && mb.categoryId === cat.id
        );

        const nextBudgetVal = srcVals.budget;
        const nextActualVal =
          opts.scope === 'budgets_and_actuals' ? srcVals.actual : null;

        if (targetIdx >= 0) {
          const existing = nextBudgets[targetIdx];
          const hasExistingNonZero =
            existing.budget !== 0 || (existing.directActual ?? 0) !== 0;
          if (!opts.overwriteExisting && hasExistingNonZero) {
            continue;
          }
          nextBudgets[targetIdx] = {
            ...existing,
            budget: nextBudgetVal,
            directActual: nextActualVal,
          };
        } else {
          nextBudgets.push({
            monthKey: opts.targetMonthKey,
            categoryId: cat.id,
            budget: nextBudgetVal,
            directActual: nextActualVal,
          });
        }
        copiedCount++;
      }

      const nextSettings = { ...prev.settings };
      if (opts.disableFutureConfirm) {
        nextSettings.confirmBeforeMonthCopy = false;
      }
      if (opts.navigateToTarget) {
        const parts = opts.targetMonthKey.split('-');
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (y && m) {
          nextSettings.activeYear = y;
          nextSettings.activeMonth = m;
        }
      }

      return {
        ...prev,
        settings: nextSettings,
        monthlyBudgets: nextBudgets,
      };
    });

    showNotification(
      `Copied ${
        opts.scope === 'budgets_and_actuals'
          ? 'budgets & actuals'
          : 'planned budgets'
      } (${copiedCount} categories) from ${opts.sourceMonthKey} → ${opts.targetMonthKey}.`
    );
  };

  const handleAddGroup = (
    mode: LedgerMode,
    name: string,
    kind: CategoryKind,
    column: 0 | 1,
    color?: string
  ) => {
    const newGrp: CategoryGroup = {
      id: `grp-${Date.now()}`,
      mode,
      name,
      kind,
      color:
        color ||
        (kind === 'income'
          ? '#3f704d'
          : ZEN_PALETTE[state.groups.length % ZEN_PALETTE.length]),
      column,
      order: state.groups.filter((g) => g.mode === mode).length,
    };
    setState((prev) => ({
      ...prev,
      groups: [...prev.groups, newGrp],
    }));
    showNotification(`Created group "${name}".`);
  };

  const handleUpdateGroup = (
    groupId: string,
    patch: Partial<Pick<CategoryGroup, 'name' | 'color' | 'column' | 'kind'>>
  ) => {
    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)),
    }));
  };

  const handleDeleteGroup = async (groupId: string) => {
    const grp = state.groups.find((g) => g.id === groupId);
    if (
      grp &&
      !(await confirmDelete(
        tf('worksheet.deleteGrpAlertTitle', { name: tGroupName(grp) }),
        t('worksheet.deleteGrpAlertMsg')
      ))
    ) {
      return;
    }
    setState((prev) => {
      const catIds = new Set(
        prev.categories.filter((c) => c.groupId === groupId).map((c) => c.id)
      );
      return {
        ...prev,
        groups: prev.groups.filter((g) => g.id !== groupId),
        categories: prev.categories.filter((c) => c.groupId !== groupId),
        monthlyBudgets: prev.monthlyBudgets.filter(
          (mb) => !catIds.has(mb.categoryId)
        ),
        transactions: prev.transactions.filter(
          (tx) => !catIds.has(tx.categoryId)
        ),
      };
    });
  };

  const handleAddCategory = (
    groupId: string,
    mode: LedgerMode,
    kind: CategoryKind,
    name: string,
    defaultBudget: number,
    taxRate = 0,
    deductiblePct = 100
  ) => {
    const newCat: CategoryItem = {
      id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      groupId,
      mode,
      name,
      kind,
      defaultBudget,
      taxRate,
      deductiblePct,
      order: state.categories.filter((c) => c.groupId === groupId).length,
    };
    setState((prev) => ({
      ...prev,
      categories: [...prev.categories, newCat],
      monthlyBudgets: [
        ...prev.monthlyBudgets,
        {
          monthKey,
          categoryId: newCat.id,
          budget: defaultBudget,
          directActual: null,
        },
      ],
    }));
  };

  const handleUpdateCategory = (
    categoryId: string,
    patch: Partial<
      Pick<
        CategoryItem,
        'name' | 'defaultBudget' | 'taxRate' | 'deductiblePct' | 'targetAccountId'
      >
    >
  ) => {
    setState((prev) => ({
      ...prev,
      categories: prev.categories.map((c) =>
        c.id === categoryId ? { ...c, ...patch } : c
      ),
    }));
  };

  const handleDeleteCategory = async (categoryId: string) => {
    const cat = state.categories.find((c) => c.id === categoryId);
    if (
      cat &&
      !(await confirmDelete(
        tf('worksheet.deleteCatAlertTitle', { name: tCategoryName(cat) }),
        t('worksheet.deleteCatAlertMsg')
      ))
    ) {
      return;
    }
    setState((prev) => ({
      ...prev,
      categories: prev.categories.filter((c) => c.id !== categoryId),
      monthlyBudgets: prev.monthlyBudgets.filter(
        (mb) => mb.categoryId !== categoryId
      ),
      transactions: prev.transactions.filter(
        (tx) => tx.categoryId !== categoryId
      ),
    }));
  };

  const handleAddTransaction = (txData: Omit<TransactionItem, 'id'>) => {
    const newTx: TransactionItem = {
      ...txData,
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    };
    setState((prev) => {
      const nextBudgets = prev.monthlyBudgets.map((mb) =>
        mb.monthKey === newTx.monthKey && mb.categoryId === newTx.categoryId
          ? { ...mb, directActual: null }
          : mb
      );
      return {
        ...prev,
        monthlyBudgets: nextBudgets,
        transactions: [newTx, ...prev.transactions],
      };
    });
    showNotification(
      `Logged ${newTx.description} (${state.settings.currency} ${newTx.amount.toFixed(2)}).`
    );
  };

  const handleDeleteTransaction = async (id: string) => {
    const tx = state.transactions.find((t) => t.id === id);
    if (
      tx &&
      !(await confirmDelete(
        tf('tx.deleteTitle', { name: tx.description }),
        isAccountTransfer(tx)
          ? t('tx.deleteTransferMsg')
          : tf('tx.deleteMsg', {
              date: tx.date,
              amount: `${state.settings.currency} ${tx.amount.toFixed(2)}`,
            })
      ))
    ) {
      return;
    }
    setState((prev) => {
      // Deleting either leg of an account-to-account transfer removes the whole transfer
      const tx = prev.transactions.find((t) => t.id === id);
      const peerId = tx && isAccountTransfer(tx) ? tx.transferPeerId : undefined;
      return {
        ...prev,
        transactions: prev.transactions.filter((t) => t.id !== id && t.id !== peerId),
      };
    });
  };

  // ================= RECURRING & GOALS =================

  const handleToggleCategoryRecurring = (categoryId: string) => {
    const cat = state.categories.find((c) => c.id === categoryId);
    if (!cat) return;
    const nextIsRecurring = !cat.isRecurring;

    setState((prev) => {
      const nextCategories = prev.categories.map((c) =>
        c.id === categoryId ? { ...c, isRecurring: nextIsRecurring } : c
      );

      const currentMb = prev.monthlyBudgets.find(
        (mb) => mb.monthKey === monthKey && mb.categoryId === categoryId
      );
      const effectiveBudget = currentMb?.budget || cat.defaultBudget || 0;

      let nextRecurringRules = [...prev.recurringRules];
      if (nextIsRecurring) {
        const existingIdx = nextRecurringRules.findIndex(
          (r) => r.categoryId === categoryId
        );
        if (existingIdx >= 0) {
          nextRecurringRules[existingIdx] = {
            ...nextRecurringRules[existingIdx],
            active: true,
            amount:
              nextRecurringRules[existingIdx].amount || effectiveBudget,
          };
        } else {
          nextRecurringRules.push({
            id: `rec-cat-${categoryId}`,
            mode: cat.mode,
            type: cat.kind === 'income' ? 'income' : 'expense',
            categoryId: cat.id,
            description: cat.name,
            amount: effectiveBudget,
            frequency: 'monthly',
            dayOfMonth: cat.kind === 'income' ? 25 : 1,
            taxRate: cat.taxRate ?? 0,
            deductiblePct: cat.deductiblePct ?? 100,
            active: true,
          });
        }
      } else {
        nextRecurringRules = nextRecurringRules.filter(
          (r) => r.categoryId !== categoryId
        );
      }

      return {
        ...prev,
        categories: nextCategories,
        recurringRules: nextRecurringRules,
      };
    });

    showNotification(
      nextIsRecurring
        ? `Marked "${cat.name}" as a recurring monthly item.`
        : `Removed "${cat.name}" from recurring items.`
    );
  };

  const handleToggleCategoryFixed = (categoryId: string) => {
    setState((prev) => ({
      ...prev,
      categories: prev.categories.map((c) =>
        c.id === categoryId ? { ...c, isFixedCost: !c.isFixedCost } : c
      ),
    }));
  };

  const handleAddRecurringRule = (ruleData: Omit<RecurringRule, 'id'>) => {
    setState((prev) => ({
      ...prev,
      categories: prev.categories.map((c) =>
        c.id === ruleData.categoryId ? { ...c, isRecurring: true } : c
      ),
      recurringRules: [
        ...prev.recurringRules,
        { ...ruleData, id: `rec-${Date.now()}` },
      ],
    }));
    showNotification(`Added recurring rule "${ruleData.description}".`);
  };

  const handleUpdateRecurringRule = (
    id: string,
    patch: Partial<RecurringRule>
  ) => {
    setState((prev) => {
      const targetRule = prev.recurringRules.find((r) => r.id === id);
      const nextRules = prev.recurringRules.map((r) =>
        r.id === id ? { ...r, ...patch } : r
      );

      let nextCategories = prev.categories;
      let nextBudgets = prev.monthlyBudgets;

      const updatedRule = nextRules.find((r) => r.id === id);
      if (
        targetRule &&
        updatedRule &&
        !isScheduledRule(updatedRule) &&
        patch.amount !== undefined &&
        patch.amount > 0
      ) {
        const effectiveFreq = patch.frequency ?? targetRule.frequency;
        const monthlyEq =
          Math.round(recurringMonthlyEquivalent(patch.amount, effectiveFreq) * 100) /
          100;
        const cat = prev.categories.find((c) => c.id === targetRule.categoryId);
        if (cat && cat.defaultBudget === 0) {
          nextCategories = prev.categories.map((c) =>
            c.id === cat.id ? { ...c, defaultBudget: monthlyEq } : c
          );
        }
        const mbIdx = prev.monthlyBudgets.findIndex(
          (mb) =>
            mb.monthKey === monthKey && mb.categoryId === targetRule.categoryId
        );
        if (mbIdx >= 0 && prev.monthlyBudgets[mbIdx].budget === 0) {
          nextBudgets = [...prev.monthlyBudgets];
          nextBudgets[mbIdx] = {
            ...nextBudgets[mbIdx],
            budget: monthlyEq,
          };
        }
      }

      return {
        ...prev,
        categories: nextCategories,
        monthlyBudgets: nextBudgets,
        recurringRules: nextRules,
      };
    });
  };

  const handleToggleRecurringRule = (id: string) => {
    setState((prev) => ({
      ...prev,
      recurringRules: prev.recurringRules.map((r) =>
        r.id === id ? { ...r, active: !r.active } : r
      ),
    }));
  };

  const handleDeleteRecurringRule = async (id: string) => {
    const rule = state.recurringRules.find((r) => r.id === id);
    if (
      rule &&
      !(await confirmDelete(
        tf('recurring.deleteTitle', { name: rule.description }),
        t('recurring.deleteMsg')
      ))
    ) {
      return;
    }
    setState((prev) => {
      const removed = prev.recurringRules.find((r) => r.id === id);
      const remaining = prev.recurringRules.filter((r) => r.id !== id);
      const stillHasRule =
        removed &&
        remaining.some((r) => r.categoryId === removed.categoryId);
      return {
        ...prev,
        categories:
          removed && !stillHasRule
            ? prev.categories.map((c) =>
                c.id === removed.categoryId ? { ...c, isRecurring: false } : c
              )
            : prev.categories,
        recurringRules: remaining,
      };
    });
  };

  const handleApplyRecurringToMonth = () => {
    const { activeCount, newTransactions } = buildRecurringTransactionsForMonth(
      state.recurringRules,
      state.transactions,
      monthKey,
      state.settings.activeWorkspace
    );
    if (activeCount === 0) {
      showNotification(
        'Set a non-zero amount on your active recurring rules (or Monthly Budget) before posting.'
      );
      return;
    }

    if (newTransactions.length > 0) {
      setState((prev) => ({
        ...prev,
        transactions: [...newTransactions, ...prev.transactions],
      }));
      showNotification(
        `Posted ${newTransactions.length} recurring item(s) to ${monthKey}.`
      );
    } else {
      showNotification(
        `All active recurring items are already posted for ${monthKey}.`
      );
    }
  };

  const handleAddGoal = (goalData: Omit<SavingsGoal, 'id'>) => {
    setState((prev) => ({
      ...prev,
      savingsGoals: [
        ...prev.savingsGoals,
        { ...goalData, id: `goal-${Date.now()}` },
      ],
    }));
  };

  const handleUpdateGoalAmount = (id: string, currentAmount: number) => {
    setState((prev) => ({
      ...prev,
      savingsGoals: prev.savingsGoals.map((g) =>
        g.id === id ? { ...g, currentAmount } : g
      ),
    }));
  };

  const handleDeleteGoal = async (id: string) => {
    const goal = state.savingsGoals.find((g) => g.id === id);
    if (
      goal &&
      !(await confirmDelete(tf('goals.deleteTitle', { name: tGoalName(goal) })))
    ) {
      return;
    }
    setState((prev) => ({
      ...prev,
      savingsGoals: prev.savingsGoals.filter((g) => g.id !== id),
    }));
  };

  // ================= ACCOUNTS & NET WORTH =================

  const handleAddAccount = (
    accData: Omit<FinancialAccount, 'id' | 'updatedAt'>
  ) => {
    const today = new Date().toISOString().slice(0, 10);
    const newAcc: FinancialAccount = {
      ...accData,
      id: `acc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      updatedAt: today,
    };
    setState((prev) => ({
      ...prev,
      accounts: [...(prev.accounts ?? []), newAcc],
    }));
    showNotification(`Created account "${newAcc.name}".`);
  };

  const handleUpdateAccount = (
    accountId: string,
    patch: Partial<FinancialAccount>
  ) => {
    setState((prev) => ({
      ...prev,
      accounts: (prev.accounts ?? []).map((a) =>
        a.id === accountId ? { ...a, ...patch } : a
      ),
    }));
  };

  const handleDeleteAccount = async (accountId: string) => {
    const acc = (state.accounts ?? []).find((a) => a.id === accountId);
    if (
      acc &&
      !(await confirmDelete(
        tf('accounts.deleteTitle', { name: tAccountName(acc) }),
        t('accounts.deleteMsg')
      ))
    ) {
      return;
    }
    setState((prev) => ({
      ...prev,
      accounts: (prev.accounts ?? []).filter((a) => a.id !== accountId),
      transactions: prev.transactions.map((t) =>
        t.accountId === accountId ? { ...t, accountId: undefined } : t
      ),
    }));
    showNotification('Removed account.');
  };

  /**
   * Records a transfer as a linked pair of transactions (out of one account, into the other)
   * instead of editing balances, so it keeps a history and can be undone by deleting it.
   * The pair uses TRANSFER_CATEGORY_ID, so it never counts as income or spending.
   */
  const handleTransferBetweenAccounts = (
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    date: string,
    note: string
  ) => {
    const from = (state.accounts ?? []).find((a) => a.id === fromAccountId);
    const to = (state.accounts ?? []).find((a) => a.id === toAccountId);
    if (!from || !to || fromAccountId === toAccountId || !(amount > 0)) return;
    const txDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? date
      : new Date().toISOString().slice(0, 10);
    const pairId = `tx-xfer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const description = note.trim() || `${from.name} → ${to.name}`;
    const base = {
      date: txDate,
      monthKey: txDate.slice(0, 7),
      categoryId: TRANSFER_CATEGORY_ID,
      description,
      amount,
      paymentMethod: 'Transfer',
      status: 'cleared' as const,
    };
    const outTx: TransactionItem = {
      ...base,
      id: `${pairId}-out`,
      mode: from.mode,
      type: 'expense',
      accountId: from.id,
      transferPeerId: `${pairId}-in`,
    };
    const inTx: TransactionItem = {
      ...base,
      id: `${pairId}-in`,
      mode: to.mode,
      type: 'income',
      accountId: to.id,
      transferPeerId: `${pairId}-out`,
    };
    setState((prev) => ({
      ...prev,
      transactions: [outTx, inTx, ...prev.transactions],
    }));
    showNotification(
      `Transferred ${state.settings.currency} ${amount.toFixed(2)} from ${from.name} → ${to.name} (${description}).`
    );
  };

  const handleSaveNetWorthSnapshot = (note?: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const snap: NetWorthSnapshot = {
      id: `nw-snap-${monthKey}`,
      monthKey,
      recordedAt: today,
      liquidAssets: netWorthMetrics.liquidAssets,
      retirementAssets: netWorthMetrics.retirementAssets,
      investmentAssets: netWorthMetrics.investmentAssets,
      fixedAssets: netWorthMetrics.fixedAssets,
      totalAssets: netWorthMetrics.totalAssets,
      totalLiabilities: netWorthMetrics.totalLiabilities,
      netWorth: netWorthMetrics.netWorth,
      note,
    };
    setState((prev) => {
      const filtered = (prev.netWorthSnapshots ?? []).filter(
        (s) => s.monthKey !== monthKey
      );
      return {
        ...prev,
        netWorthSnapshots: [snap, ...filtered],
      };
    });
    showNotification(`Recorded Net Worth snapshot for ${monthKey}.`);
  };

  const handleDeleteNetWorthSnapshot = (id: string) => {
    setState((prev) => ({
      ...prev,
      netWorthSnapshots: (prev.netWorthSnapshots ?? []).filter(
        (s) => s.id !== id
      ),
    }));
  };

  // ================= YEARLY BUDGET PLANNER =================

  const handleUpsertYearlyPlanItem = (item: YearlyPlanItem) => {
    setState((prev) => {
      const existing = prev.yearlyPlanItems ?? [];
      const idx = existing.findIndex(
        (p) =>
          p.id === item.id ||
          (item.categoryId &&
            p.year === item.year &&
            p.categoryId === item.categoryId)
      );
      if (idx >= 0) {
        const next = [...existing];
        next[idx] = { ...next[idx], ...item };
        return { ...prev, yearlyPlanItems: next };
      }
      return { ...prev, yearlyPlanItems: [...existing, item] };
    });
  };

  const handleDeleteYearlyPlanItem = (id: string) => {
    setState((prev) => ({
      ...prev,
      yearlyPlanItems: (prev.yearlyPlanItems ?? []).filter((p) => p.id !== id),
    }));
    showNotification('Removed item from yearly plan.');
  };

  const handleBulkSetYearlyPlanForYear = (
    year: number,
    items: YearlyPlanItem[]
  ) => {
    setState((prev) => {
      const otherYears = (prev.yearlyPlanItems ?? []).filter(
        (p) => p.year !== year
      );
      return {
        ...prev,
        yearlyPlanItems: [...otherYears, ...items],
      };
    });
    showNotification(`Seeded ${items.length} categories into ${year} plan.`);
  };

  const handleUpdateAccountReturnRate = (
    accountId: string,
    returnPct: number
  ) => {
    setState((prev) => ({
      ...prev,
      accounts: (prev.accounts ?? []).map((acc) =>
        acc.id === accountId
          ? { ...acc, expectedAnnualReturnPct: returnPct }
          : acc
      ),
    }));
  };

  const handleApplyYearlyPlanToMonthlyBudgets = (
    year: number,
    items: YearlyPlanItem[]
  ) => {
    setState((prev) => {
      const nextBudgets = [...prev.monthlyBudgets];
      for (const item of items) {
        if (!item.categoryId || item.annualAmount <= 0) continue;
        const monthlyAmt = Math.round((item.annualAmount / 12) * 100) / 100;
        for (let m = 1; m <= 12; m++) {
          const mk = formatMonthKey(year, m);
          const idx = nextBudgets.findIndex(
            (b) => b.monthKey === mk && b.categoryId === item.categoryId
          );
          if (idx >= 0) {
            nextBudgets[idx] = { ...nextBudgets[idx], budget: monthlyAmt };
          } else {
            nextBudgets.push({
              monthKey: mk,
              categoryId: item.categoryId,
              budget: monthlyAmt,
            });
          }
        }
      }
      return {
        ...prev,
        monthlyBudgets: nextBudgets,
      };
    });
    showNotification(
      `Applied ${year} yearly plan across all 12 monthly budget worksheets.`
    );
  };

  const handleAddCategoryAndPlanItem = (opts: {
    year: number;
    groupId: string;
    mode: LedgerMode;
    kind: CategoryKind;
    label: string;
    annualAmount: number;
    schedule: YearlyPlanSchedule;
    accountId?: string;
    destinationAccountId?: string;
  }) => {
    const newCatId = `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const monthlyDefault =
      opts.schedule === 'monthly'
        ? Math.round((opts.annualAmount / 12) * 100) / 100
        : Math.round((opts.annualAmount / 12) * 100) / 100;

    const newCat: CategoryItem = {
      id: newCatId,
      groupId: opts.groupId,
      mode: opts.mode,
      kind: opts.kind,
      name: opts.label,
      defaultBudget: monthlyDefault,
      order: state.categories.length + 1,
      ...(opts.kind === 'savings' && opts.destinationAccountId
        ? { targetAccountId: opts.destinationAccountId }
        : {}),
    };

    const newPlanItem: YearlyPlanItem = {
      id: `yp-${opts.year}-${newCatId}`,
      year: opts.year,
      mode: opts.mode,
      kind: opts.kind,
      categoryId: newCatId,
      label: opts.label,
      annualAmount: opts.annualAmount,
      schedule: opts.schedule,
      accountId: opts.accountId,
      destinationAccountId: opts.destinationAccountId,
    };

    setState((prev) => ({
      ...prev,
      categories: [...prev.categories, newCat],
      yearlyPlanItems: [...(prev.yearlyPlanItems ?? []), newPlanItem],
    }));

    showNotification(
      `Added "${opts.label}" (${state.settings.currency} ${opts.annualAmount.toLocaleString()}) to ${opts.year} Yearly Planner.`
    );
  };

  // ================= BACKUPS, EXPORTS & DATA IMPORT =================

  const handleManualBackup = async () => {
    let targetDir = state.settings.backupDir;
    if (!targetDir && isTauriEnv()) {
      const picked = await pickFolderDialog(
        'Choose Folder for Automatic Encrypted SQLite Database Backups'
      );
      if (!picked) return;
      targetDir = picked;
      updateSettings({ backupDir: picked, autoBackup: true });
    }

    setIsSaving(true);
    try {
      const res = await runManualBackup(targetDir || 'Downloads', state);
      updateSettings({
        lastBackupAt: res.timestamp,
        lastBackupPath: res.backup_path ?? undefined,
      });
      showNotification(
        'Encrypted database backup saved successfully.',
        res.backup_path ?? undefined
      );
    } catch (err) {
      console.error(err);
      showNotification(`Backup error: ${String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReloadLedgerState = async () => {
    try {
      const ok = await withSavesSuspended(reloadLedgerFromDb);
      if (ok) {
        showNotification('Ledger state reloaded from synchronized database.');
      }
    } catch (err) {
      console.error('Failed to reload ledger state:', err);
    }
  };

  const handleRestoreFromPath = async (
    path: string,
    passphrase?: string,
    keyfilePath?: string
  ) => {
    try {
      const shouldPreview =
        state.settings.confirmAndPreviewBeforeImport ?? true;
      if (shouldPreview) {
        const restored = await restoreFromBackupFile(
          path,
          passphrase,
          true,
          keyfilePath
        );
        const fileName = path.split(/[\\/]/).pop() || path;
        const count =
          (restored.categories?.length ?? 0) +
          (restored.transactions?.length ?? 0) +
          (restored.accounts?.length ?? 0);
        setPendingImportPreview({
          kind: 'database_backup',
          targetMode:
            state.settings.activeWorkspace === 'freelancer'
              ? 'freelancer'
              : 'home',
          fileName,
          proposedState: restored,
          importedCount: count,
          backupPath: path,
        });
        setShowImportModal(true);
        return;
      }
      const restored = await restoreFromBackupFile(
        path,
        passphrase,
        false,
        keyfilePath
      );
      // The local DB was replaced: it no longer matches the last WebDAV sync.
      webdavSync.resetLink();
      setState(keepDeviceSettings(restored, latestStateRef.current));
      showNotification('Encrypted database restored from backup snapshot.', path);
    } catch (err) {
      showNotification(`Restore failed: ${String(err)}`);
    }
  };

  const handleExportExcel = async () => {
    const savedPath = await exportExcelWorkbook(
      state,
      monthKey,
      state.settings.activeWorkspace
    );
    if (savedPath) {
      showNotification(
        'Exported multi-sheet Excel workbook (.xlsx).',
        savedPath
      );
    }
  };

  const handleExportBudgetCsv = async () => {
    const savedPath = await exportMonthlyBudgetCsv(
      state,
      monthKey,
      state.settings.activeWorkspace
    );
    if (savedPath) {
      showNotification('Exported Monthly Budget CSV (.csv).', savedPath);
    }
  };

  const handleExportTransactionsCsv = async () => {
    const savedPath = await exportTransactionsCsv(
      state,
      state.settings.activeWorkspace
    );
    if (savedPath) {
      showNotification('Exported Transactions & Tax CSV (.csv).', savedPath);
    }
  };

  const handleExportSqliteCopy = async (targetPath: string) => {
    await exportSqliteDatabaseCopy(targetPath, state);
    showNotification('Exported encrypted SQLite database (.db).', targetPath);
  };

  const handlePrepareImport = async (opts: {
    kind: ImportKind;
    targetMode: LedgerMode;
    accountId?: string;
    selectedProfileId?: string;
    passphrase?: string;
    keyfilePath?: string;
    filePath?: string;
    browserFile?: File;
  }): Promise<ImportPreviewData | null> => {
    try {
      if (opts.kind === 'database_backup') {
        if (isTauriEnv()) {
          const picked = await pickOpenFileDialog(
            'Koban Encrypted Backup (*.db, *.sqlite, *.json)',
            ['db', 'sqlite', 'json']
          );
          if (!picked) return null;
          const fileName = picked.split(/[\\/]/).pop() || picked;
          const restored = await restoreFromBackupFile(
            picked,
            opts.passphrase,
            true,
            opts.keyfilePath
          );
          const count =
            (restored.categories?.length ?? 0) +
            (restored.transactions?.length ?? 0) +
            (restored.accounts?.length ?? 0);
          return {
            kind: 'database_backup',
            targetMode: opts.targetMode,
            fileName,
            proposedState: restored,
            importedCount: count,
            backupPath: picked,
          };
        } else if (opts.browserFile) {
          const text = await opts.browserFile.text();
          const parsed = JSON.parse(text) as LedgerState;
          if (parsed && parsed.settings && parsed.groups) {
            const count =
              (parsed.categories?.length ?? 0) +
              (parsed.transactions?.length ?? 0) +
              (parsed.accounts?.length ?? 0);
            return {
              kind: 'database_backup',
              targetMode: opts.targetMode,
              fileName: opts.browserFile.name,
              proposedState: parsed,
              importedCount: count,
            };
          }
        }
        return null;
      }

      if (opts.kind === 'transactions') {
        let buffer: ArrayBuffer | null = null;
        let fileName = 'Bank Statement';
        let watchedPath: string | undefined = undefined;
        if (isTauriEnv()) {
          const picked =
            opts.filePath ||
            (await pickOpenFileDialog(
              'Bank Statement (*.xml, *.ofx, *.qfx, *.csv, *.xlsx, *.xls)',
              ['xml', 'ofx', 'qfx', 'csv', 'xlsx', 'xls']
            ));
          if (!picked) return null;
          if (opts.filePath) watchedPath = opts.filePath;
          fileName = picked.split(/[\\/]/).pop() || picked;
          const b64 = await invoke<string>('read_binary_file', { path: picked });
          const bytes = base64ToUint8(b64);
          buffer = bytes.buffer as ArrayBuffer;
        } else if (opts.browserFile) {
          fileName = opts.browserFile.name;
          buffer = await opts.browserFile.arrayBuffer();
        }

        if (!buffer) return null;

        const parsed = parseBankStatementBuffer(buffer, fileName, {
          savedProfiles: state.importProfiles ?? [],
          accountId: opts.accountId,
          fallbackCurrency: state.settings.currency,
          selectedProfileId: opts.selectedProfileId,
        });
        return {
          kind: 'transactions',
          targetMode: opts.targetMode,
          fileName,
          sheetName: parsed.sheetName,
          proposedState: state,
          importedCount: parsed.rawTransactions.length,
          accountId: opts.accountId,
          watchedFilePath: watchedPath,
          bankParseResult: parsed,
        };
      }

      // budget_sheet from .xlsx / .xls / .csv
      let buffer: ArrayBuffer | null = null;
      let fileName = 'Imported File';
      if (isTauriEnv()) {
        const picked = await pickOpenFileDialog(
          'Excel or CSV Data File (*.xlsx, *.xls, *.csv)',
          ['xlsx', 'xls', 'csv']
        );
        if (!picked) return null;
        fileName = picked.split(/[\\/]/).pop() || picked;
        const b64 = await invoke<string>('read_binary_file', { path: picked });
        const bytes = base64ToUint8(b64);
        buffer = bytes.buffer as ArrayBuffer;
      } else if (opts.browserFile) {
        fileName = opts.browserFile.name;
        buffer = await opts.browserFile.arrayBuffer();
      }

      if (!buffer) return null;

      const res = importBudgetSheetFromBuffer(
        buffer,
        state,
        opts.targetMode,
        monthKey
      );
      return {
        kind: 'budget_sheet',
        targetMode: opts.targetMode,
        fileName,
        sheetName: res.sheetName,
        proposedState: {
          ...res.state,
          settings: { ...res.state.settings, setupCompleted: true },
        },
        importedCount: res.importedCategories,
        budgetRows: res.previewRows,
      };
    } catch (err) {
      showNotification(`Import error: ${String(err)}`);
      return null;
    }
  };

  const handleCommitImport = async (preview: ImportPreviewData) => {
    if (preview.kind === 'database_backup') {
      // Importing a .db over the local vault: forget the per-device WebDAV sync state.
      await forgetWebDavSyncState().catch(() => undefined);
      webdavSync.resetLink();
    }
    setState(keepDeviceSettings(preview.proposedState, latestStateRef.current));
    setShowImportModal(false);
    if (!vaultStatus?.unlocked) {
      setShowSetupModal(true);
    } else {
      setSaveBlocked(false);
      setShowSetupModal(false);
    }

    if (preview.kind === 'database_backup') {
      showNotification(
        `Restored backup snapshot "${preview.fileName}" (${preview.importedCount} records).`,
        preview.backupPath
      );
    } else if (preview.kind === 'budget_sheet') {
      showNotification(
        `Imported ${preview.importedCount} categories & budget rows from "${preview.fileName}" into ${monthKey}.`
      );
    } else if (preview.kind === 'transactions') {
      setActiveTab('transactions');
      showNotification(
        `Imported ${preview.importedCount} transaction(s) from "${preview.fileName}" into ${preview.targetMode} ledger.`
      );
    }
  };

  const handleCommitBankImport = async ({
    preview,
    stagedRows,
    savedProfile,
    savedRules,
    archiveWatchedFile,
  }: {
    preview: ImportPreviewData;
    stagedRows: StagedBankTransaction[];
    savedProfile?: BankImportProfile;
    savedRules: ImportRule[];
    archiveWatchedFile: boolean;
  }) => {
    const next = applyStagedTransactionsToLedger({
      stagedRows,
      currentState: latestStateRef.current,
      savedProfile,
      savedRules,
    });
    setState(keepDeviceSettings(next, latestStateRef.current));
    setShowImportModal(false);
    setPendingImportPreview(null);
    setInitialPendingFilePath(null);
    if (!vaultStatus?.unlocked) {
      setShowSetupModal(true);
    } else {
      setSaveBlocked(false);
      setShowSetupModal(false);
    }
    setActiveTab('transactions');

    if (archiveWatchedFile && preview.watchedFilePath && isTauriEnv()) {
      await archiveImportedFile(preview.watchedFilePath).catch(() => undefined);
      await refreshImportWatchFolder();
    }

    const importedCount = stagedRows.filter((r) => r.included).length;
    showNotification(
      `Imported ${importedCount} bank transaction(s) from "${preview.fileName}" into ${preview.targetMode} ledger.`
    );
  };

  const handleSaveRulesAndProfiles = (
    nextRules: ImportRule[],
    nextProfiles: BankImportProfile[]
  ) => {
    setState((prev) => ({
      ...prev,
      importRules: nextRules,
      importProfiles: nextProfiles,
    }));
    showNotification('Saved import rules & bank profiles.');
  };

  /** New device: download the cloud vault into the local DB path and open it (§6). */
  const handleOpenVaultFromWebDav = async (req: WebDavOpenVaultRequest) => {
    const entered: WebDavConfig = {
      enabled: true,
      mode: 'primary',
      url: req.url.trim(),
      username: req.username.trim(),
      password: req.password,
      remoteFileName: req.remoteFileName.trim() || 'koban-vault.db',
    };
    await withSavesSuspended(async () => {
      await downloadVaultFromWebDav(
        entered.url,
        entered.username,
        entered.password!,
        entered.remoteFileName
      );
      webdavSync.resetLink();
      pendingWebDavRef.current = entered;
      const st = await getVaultStatus().catch(() => null);
      setVaultStatus(st);
      if (st?.unlocked) {
        const loaded = await loadLedgerFromDb();
        if (loaded && loaded.settings) {
          applyLoadedLedger(loaded);
          setSaveBlocked(false);
          setShowWebDavOpenModal(false);
          setShowSetupModal(!loaded.settings.setupCompleted);
          showNotification('Opened the vault from WebDAV. This device now uses it as primary storage.');
          return;
        }
      }
      if (st?.exists) {
        setSaveBlocked(true);
        setShowWebDavOpenModal(false);
        setShowSetupModal(false);
        setIsLocked(true);
        return;
      }
      pendingWebDavRef.current = null;
      throw new Error('The downloaded vault could not be opened on this device.');
    });
  };

  const monthTxCount = state.transactions.filter(
    (t) =>
      t.monthKey === monthKey &&
      (state.settings.activeWorkspace === 'combined' ||
        t.mode === state.settings.activeWorkspace)
  ).length;

  if (isLoaded && isLocked && vaultStatus) {
    return (
      <>
        <AuthLockScreen
          vaultStatus={vaultStatus}
          onUnlocked={handleVaultUnlocked}
          onMigrated={handleVaultMigrated}
          onOpenWebDavVault={() => setShowWebDavOpenModal(true)}
          onVaultFileSwitched={refreshInitialVaultState}
        />
        <WebDavOpenVaultModal
          isOpen={showWebDavOpenModal}
          onClose={() => setShowWebDavOpenModal(false)}
          onDownloadAndOpen={handleOpenVaultFromWebDav}
        />
        {pendingRecoveryKey && (
          <RecoveryKeyModal
            recoveryKey={pendingRecoveryKey}
            onConfirm={() => setPendingRecoveryKey(null)}
          />
        )}
      </>
    );
  }

  return (
    <WebDavSyncContext.Provider value={webdavSync}>
    <div className="h-screen w-screen flex flex-col bg-app text-ink overflow-hidden">
      {/* Top Navigation & Action Bar */}
      <TopBar
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen((v) => !v)}
        settings={state.settings}
        onChangeWorkspace={(ws) => updateSettings({ activeWorkspace: ws })}
        onChangeMonth={(year, month) =>
          updateSettings({ activeYear: year, activeMonth: month })
        }
        onChangeTheme={(theme) => updateSettings({ theme })}
        onChangeLanguage={(lang) => updateSettings({ language: lang })}
        onOpenQuickAddTx={() => setActiveTab('transactions')}
        onOpenSetupWizard={() => setShowSetupModal(true)}
        onOpenImportModal={() => setShowImportModal(true)}
        onOpenSettings={() => setActiveTab('settings')}
        onLockVault={() => void lockVaultNow()}
        onShowShortcuts={() => setShowShortcuts(true)}
        onExportExcel={handleExportExcel}
        onExportBudgetCsv={handleExportBudgetCsv}
        onExportTransactionsCsv={handleExportTransactionsCsv}
        onManualBackup={handleManualBackup}
        isSaving={isSaving}
      />

      {updateInfo?.update_available && !updateBannerDismissed && (
        <div className="px-4 py-2 bg-positive/12 border-b border-positive/30 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-ink">
            <Download className="w-3.5 h-3.5 text-positive shrink-0" />
            <span className="font-medium">
              {t('settings.updates.available')
                .replace('{latest}', updateInfo.latest_version)
                .replace('{current}', updateInfo.current_version)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void openExternalUrl(
                  updateInfo.download_url || updateInfo.release_url
                )
              }
              className="h-7 px-3 inline-flex items-center gap-1.5 rounded-md bg-positive text-white text-[11px] font-medium hover:opacity-90 cursor-pointer"
            >
              <Download className="w-3 h-3" />
              <span>
                {t('settings.updates.download').replace(
                  '{version}',
                  updateInfo.latest_version
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setUpdateBannerDismissed(true)}
              className="p-1 rounded text-ink-3 hover:text-ink hover:bg-raised cursor-pointer"
              title={t('common.close')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {!importBannerDismissed && pendingImportFiles.length > 0 && (
        <div className="px-4 py-2 bg-indigo/10 border-b border-indigo/25 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-ink">
            <FolderSearch className="w-3.5 h-3.5 text-indigo shrink-0" />
            <span className="font-medium">
              {t('bankImport.bannerReady').replace(
                '{count}',
                String(pendingImportFiles.length)
              )}
            </span>
            <span className="text-ink-3 truncate max-w-[260px]">
              {pendingImportFiles[0].name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setInitialPendingFilePath(pendingImportFiles[0].path);
                setShowImportModal(true);
              }}
              className="h-7 px-3 inline-flex items-center gap-1.5 rounded-md bg-indigo text-white text-[11px] font-medium hover:opacity-90 cursor-pointer"
            >
              <span>{t('bankImport.reviewNowBtn')}</span>
            </button>
            <button
              type="button"
              onClick={() => setImportBannerDismissed(true)}
              className="p-1 rounded text-ink-3 hover:text-ink hover:bg-raised cursor-pointer"
              title={t('common.close')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <Sidebar
          isOpen={isSidebarOpen}
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          summary={summary}
          netWorth={netWorthMetrics}
          settings={state.settings}
          txCount={monthTxCount}
          recurringCount={state.recurringRules.filter((r) => r.active).length}
          goalsCount={state.savingsGoals.length}
          onRevealBackupDir={() =>
            revealPathInExplorer(state.settings.backupDir)
          }
        />

        <main className="flex-1 overflow-y-auto bg-app">
          {activeTab === 'worksheet' && (
            <MonthlyWorksheetView
              summary={summary}
              currency={state.settings.currency}
              workspace={state.settings.activeWorkspace}
              settings={state.settings}
              previousMonthHasData={previousMonthHasData}
              onUpdateBudget={handleUpdateBudget}
              onUpdateDirectActual={handleUpdateDirectActual}
              onResetScheduledBudget={handleResetScheduledBudget}
              onToggleCategoryFixed={handleToggleCategoryFixed}
              accounts={state.accounts ?? []}
              onRenameCategory={(catId, name) =>
                handleUpdateCategory(catId, { name })
              }
              onToggleCategoryRecurring={handleToggleCategoryRecurring}
              onDeleteCategory={handleDeleteCategory}
              onAddCategory={(grpId, mode, kind, name, budget) =>
                handleAddCategory(grpId, mode, kind, name, budget)
              }
              onAddGroup={handleAddGroup}
              onDeleteGroup={handleDeleteGroup}
              onQuickLogForCategory={(catId) => {
                setPreselectedCategoryId(catId);
                setActiveTab('transactions');
              }}
              onApplyBudgetsToAllMonths={handleApplyBudgetsToAllMonths}
              onCopyMonthValues={handleCopyMonthValues}
            />
          )}

          {activeTab === 'yearly_planner' && (
            <YearlyBudgetPlannerView
              state={state}
              netWorth={netWorthMetrics}
              workspace={state.settings.activeWorkspace}
              currency={state.settings.currency}
              onUpsertYearlyPlanItem={handleUpsertYearlyPlanItem}
              onDeleteYearlyPlanItem={handleDeleteYearlyPlanItem}
              onBulkSetYearlyPlanForYear={handleBulkSetYearlyPlanForYear}
              onUpdateAccountReturnRate={handleUpdateAccountReturnRate}
              onApplyYearlyPlanToMonthlyBudgets={
                handleApplyYearlyPlanToMonthlyBudgets
              }
              onAddCategoryAndPlanItem={handleAddCategoryAndPlanItem}
            />
          )}

          {activeTab === 'transactions' && (
            <TransactionsView
              focusRequest={txFocusRequest}
              transactions={state.transactions}
              groups={state.groups}
              categories={state.categories}
              accounts={state.accounts ?? []}
              workspace={state.settings.activeWorkspace}
              monthKey={monthKey}
              currency={state.settings.currency}
              defaultVatRate={state.settings.defaultVatRate}
              preselectedCategoryId={preselectedCategoryId}
              onClearPreselectedCategory={() => setPreselectedCategoryId(null)}
              preselectedAccountId={preselectedAccountId}
              onClearPreselectedAccount={() => setPreselectedAccountId(null)}
              onAddTransaction={handleAddTransaction}
              onDeleteTransaction={handleDeleteTransaction}
              onOpenImportModal={() => setShowImportModal(true)}
              onOpenImportRulesModal={() => setShowImportRulesModal(true)}
              onExportCsv={handleExportTransactionsCsv}
            />
          )}

          {activeTab === 'accounts' && (
            <AccountsNetWorthView
              netWorth={netWorthMetrics}
              snapshots={state.netWorthSnapshots ?? []}
              workspace={state.settings.activeWorkspace}
              monthKey={monthKey}
              currency={state.settings.currency}
              onAddAccount={handleAddAccount}
              onUpdateAccount={handleUpdateAccount}
              onDeleteAccount={handleDeleteAccount}
              onTransferBetweenAccounts={handleTransferBetweenAccounts}
              onSaveSnapshot={handleSaveNetWorthSnapshot}
              onDeleteSnapshot={handleDeleteNetWorthSnapshot}
              onInspectAccountTransactions={(accId) => {
                setPreselectedAccountId(accId);
                setActiveTab('transactions');
              }}
            />
          )}

          {activeTab === 'reports' && (
            <ReportsChartsView
              state={state}
              summary={summary}
              annualSeries={annualSeries}
              workspace={state.settings.activeWorkspace}
              currency={state.settings.currency}
            />
          )}

          {activeTab === 'categories' && (
            <CategoriesStudioView
              groups={state.groups}
              categories={state.categories}
              accounts={state.accounts ?? []}
              currency={state.settings.currency}
              initialMode={
                state.settings.activeWorkspace === 'freelancer'
                  ? 'freelancer'
                  : 'home'
              }
              onAddGroup={handleAddGroup}
              onUpdateGroup={handleUpdateGroup}
              onDeleteGroup={handleDeleteGroup}
              onAddCategory={handleAddCategory}
              onUpdateCategory={handleUpdateCategory}
              onToggleCategoryRecurring={handleToggleCategoryRecurring}
              onDeleteCategory={handleDeleteCategory}
              onOpenSetupWizard={() => setShowSetupModal(true)}
              onImportExcelOrCsv={() => setShowImportModal(true)}
            />
          )}

          {activeTab === 'recurring' && (
            <RecurringView
              rules={state.recurringRules}
              groups={state.groups}
              categories={state.categories}
              workspace={state.settings.activeWorkspace}
              monthKey={monthKey}
              currency={state.settings.currency}
              onAddRule={handleAddRecurringRule}
              onUpdateRule={handleUpdateRecurringRule}
              onToggleRule={handleToggleRecurringRule}
              onDeleteRule={handleDeleteRecurringRule}
              onApplyRecurringToMonth={handleApplyRecurringToMonth}
            />
          )}

          {activeTab === 'goals' && (
            <SavingsGoalsView
              goals={state.savingsGoals}
              workspace={state.settings.activeWorkspace}
              currency={state.settings.currency}
              onAddGoal={handleAddGoal}
              onUpdateGoalAmount={handleUpdateGoalAmount}
              onDeleteGoal={handleDeleteGoal}
            />
          )}

          {activeTab === 'backups' && (
            <BackupsExportView
              settings={state.settings}
              vaultStatus={vaultStatus}
              onUpdateBackupSettings={updateSettings}
              onOpenSecuritySettings={() => setActiveTab('settings')}
              onManualBackup={handleManualBackup}
              onRestoreFromPath={handleRestoreFromPath}
              onExportExcel={handleExportExcel}
              onExportBudgetCsv={handleExportBudgetCsv}
              onExportTransactionsCsv={handleExportTransactionsCsv}
              onExportSqliteCopy={handleExportSqliteCopy}
              onOpenImportModal={() => setShowImportModal(true)}
              onReloadLedgerState={handleReloadLedgerState}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              settings={state.settings}
              ledgerState={state}
              vaultStatus={vaultStatus}
              onUpdateSettings={updateSettings}
              onVaultStatusUpdated={(next) => setVaultStatus(next)}
              onShowRecoveryKey={(key) => setPendingRecoveryKey(key)}
              onLockVaultNow={() => void lockVaultNow()}
              onOpenSetupWizard={() => setShowSetupModal(true)}
              onOpenBackupsTab={() => setActiveTab('backups')}
              onReloadLedgerState={handleReloadLedgerState}
              updateInfo={updateInfo}
              isCheckingUpdate={isCheckingUpdate}
              updateCheckError={updateCheckError}
              onCheckForUpdates={() => void handleCheckForUpdates(false)}
            />
          )}
        </main>
      </div>

      {/* Onboarding / Profile & Category Setup Modal */}
      <OnboardingModal
        isOpen={showSetupModal}
        currentSettings={state.settings}
        existingAccounts={state.accounts ?? []}
        vaultStatus={vaultStatus}
        onUpdateLanguage={(code) => updateSettings({ language: code })}
        onCompleteSetup={handleCompleteSetup}
        onOpenImportModal={() => setShowImportModal(true)}
        onOpenWebDavVault={() => setShowWebDavOpenModal(true)}
        onClose={() => setShowSetupModal(false)}
      />

      {pendingRecoveryKey && (
        <RecoveryKeyModal
          recoveryKey={pendingRecoveryKey}
          onConfirm={() => setPendingRecoveryKey(null)}
        />
      )}

      {/* New device: open an existing vault from WebDAV */}
      <WebDavOpenVaultModal
        isOpen={showWebDavOpenModal}
        onClose={() => setShowWebDavOpenModal(false)}
        onDownloadAndOpen={handleOpenVaultFromWebDav}
      />

      {/* WebDAV primary storage: conflict resolution */}
      {webdavSync.conflict && (
        <WebDavConflictDialog
          info={webdavSync.conflict}
          isResolving={webdavSync.isResolving}
          errorMessage={
            webdavSync.status.phase === 'error' || webdavSync.status.phase === 'offline'
              ? webdavSync.status.message
              : undefined
          }
          onChoose={(choice) => void webdavSync.resolveConflict(choice)}
        />
      )}

      {/* Dedicated Import Data Modal */}
      <ImportDataModal
        isOpen={showImportModal}
        ledgerState={state}
        defaultMode={
          state.settings.activeWorkspace === 'freelancer'
            ? 'freelancer'
            : 'home'
        }
        monthKey={monthKey}
        currency={state.settings.currency}
        confirmAndPreviewBeforeImport={
          state.settings.confirmAndPreviewBeforeImport ?? true
        }
        onToggleConfirmAndPreview={(enabled) =>
          updateSettings({ confirmAndPreviewBeforeImport: enabled })
        }
        initialPreviewData={pendingImportPreview}
        onClearInitialPreview={() => setPendingImportPreview(null)}
        importWatchDir={importWatchDir}
        pendingImportFiles={pendingImportFiles}
        initialPendingFilePath={initialPendingFilePath}
        onClearInitialPendingFilePath={() => setInitialPendingFilePath(null)}
        onPickImportWatchDir={handlePickImportWatchDir}
        onClearImportWatchDir={handleClearImportWatchDir}
        onOpenRulesModal={() => setShowImportRulesModal(true)}
        onClose={() => {
          setPendingImportPreview(null);
          setInitialPendingFilePath(null);
          setShowImportModal(false);
        }}
        onPrepareImport={handlePrepareImport}
        onCommitImport={handleCommitImport}
        onCommitBankImport={handleCommitBankImport}
        isTauri={isTauriEnv()}
      />

      <ImportRulesModal
        isOpen={showImportRulesModal}
        rules={state.importRules ?? []}
        profiles={state.importProfiles ?? []}
        categories={state.categories}
        accounts={state.accounts ?? []}
        onSaveRulesAndProfiles={handleSaveRulesAndProfiles}
        onClose={() => setShowImportRulesModal(false)}
      />

      {confirmRequest && (
        <ConfirmDialog
          {...confirmRequest}
          onResolve={(ok, dontAskAgain) => {
            const { resolve } = confirmRequest;
            setConfirmRequest(null);
            if (ok && dontAskAgain) updateSettings({ confirmBeforeDelete: false });
            resolve(ok);
          }}
        />
      )}

      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}

      {/* Minimalist Bottom-Right Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-surface border border-line shadow-lg text-xs text-ink">
          <CheckCircle2 className="w-4 h-4 text-positive shrink-0" />
          <span>{toast.message}</span>
          {toast.filePath && isTauriEnv() && (
            <button
              onClick={() => revealPathInExplorer(toast.filePath!)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-raised text-ink-2 hover:text-ink cursor-pointer"
              title={toast.filePath}
            >
              <span>Reveal</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={() => setToast(null)}
            className="text-ink-3 hover:text-ink cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
    </WebDavSyncContext.Provider>
  );
}

export default App;
