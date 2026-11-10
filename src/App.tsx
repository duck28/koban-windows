import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  ActiveWorkspace,
  AppSettings,
  AuthConfig,
  CategoryGroup,
  CategoryItem,
  CategoryKind,
  FinancialAccount,
  LedgerMode,
  LedgerState,
  MonthCopyScope,
  NetWorthSnapshot,
  ProfileSetupMode,
  RecurringRule,
  SavingsGoal,
  TransactionItem,
  ViewTab,
  WebDavConfig,
  YearlyPlanItem,
} from './types';
import {
  createDefaultOnboardingAccounts,
  createInitialLedgerState,
  formatMonthKey,
  ZEN_PALETTE,
} from './data/templates';
import {
  computeAnnualSeries,
  computeMonthSummary,
  computeNetWorthMetrics,
} from './utils/calculations';
import {
  base64ToUint8,
  downloadVaultFromWebDav,
  exportSqliteDatabaseCopy,
  forgetWebDavSyncState,
  getDatabaseInfo,
  isTauriEnv,
  loadLedgerFromDb,
  pickFolderDialog,
  pickOpenFileDialog,
  restoreFromBackupFile,
  revealPathInExplorer,
  runManualBackup,
  saveLedgerToDb,
  applyDeviceBackupDir,
  rememberDeviceBackupDir,
  updateVaultPassphrase,
} from './utils/storage';
import {
  DEFAULT_AUTH_CONFIG,
  loadAuthConfig,
  saveAuthConfig,
} from './utils/auth';
import {
  exportExcelWorkbook,
  exportMonthlyBudgetCsv,
  exportTransactionsCsv,
  importBudgetSheetFromBuffer,
  importTransactionsFromBuffer,
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
import { MonthlyWorksheetView } from './components/MonthlyWorksheetView';
import { YearlyBudgetPlannerView } from './components/YearlyBudgetPlannerView';
import { TransactionsView } from './components/TransactionsView';
import { AccountsNetWorthView } from './components/AccountsNetWorthView';
import { ReportsChartsView } from './components/ReportsChartsView';
import { CategoriesStudioView } from './components/CategoriesStudioView';
import { RecurringView } from './components/RecurringView';
import { SavingsGoalsView } from './components/SavingsGoalsView';
import { BackupsExportView } from './components/BackupsExportView';
import { SettingsView } from './components/SettingsView';
import { WebDavConflictDialog } from './components/WebDavConflictDialog';
import {
  WebDavOpenVaultModal,
  WebDavOpenVaultRequest,
} from './components/WebDavOpenVaultModal';
import { useWebDavSync, WebDavSyncContext } from './hooks/useWebDavSync';
import { CheckCircle2, ExternalLink, X } from 'lucide-react';
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

export function App() {
  const [state, setState] = useState<LedgerState>(() =>
    createInitialLedgerState('both', 'CHF', '', false)
  );
  const [isLoaded, setIsLoaded] = useState(false);
  const { setLanguage } = useI18n();
  const [isSaving, setIsSaving] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<ViewTab>('worksheet');
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [pendingImportPreview, setPendingImportPreview] =
    useState<ImportPreviewData | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig>(DEFAULT_AUTH_CONFIG);
  const [hasCustomDbPassphrase, setHasCustomDbPassphrase] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
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
        await saveLedgerToDb(snapshot);
        lastSavedJsonRef.current = json;
        notifySavedRef.current();
        return true;
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

  /** Reloads the ledger from the local DB (after a WebDAV pull), keeping this device's WebDAV settings. */
  const reloadLedgerFromDb = async (): Promise<boolean> => {
    const loaded = await loadLedgerFromDb();
    if (!loaded || !loaded.settings) {
      const info = await getDatabaseInfo().catch(() => null);
      if (info?.has_custom_passphrase) {
        // The downloaded vault uses a passphrase this session does not know: block saves
        // (never overwrite it with the in-memory ledger) and ask for the passphrase.
        pendingWebDavRef.current = latestStateRef.current.settings.webdav ?? null;
        setSaveBlocked(true);
        setHasCustomDbPassphrase(true);
        setAuthConfig((prev) => ({ ...prev, enabled: true }));
        setIsLocked(true);
      }
      return false;
    }
    applyLoadedLedger(loaded, latestStateRef.current.settings.webdav);
    return true;
  };

  const webdavSync = useWebDavSync({
    config: state.settings.webdav,
    ready: isLoaded && !saveBlocked,
    flushSave: persistLatest,
    withSavesSuspended,
    reloadFromDb: reloadLedgerFromDb,
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

  // Load initial encrypted database & auth config on mount
  useEffect(() => {
    (async () => {
      const [loadedAuth, dbInfo, loaded] = await Promise.all([
        loadAuthConfig(),
        getDatabaseInfo().catch(() => null),
        loadLedgerFromDb(),
      ]);

      const customDbPass = Boolean(dbInfo?.has_custom_passphrase);
      setHasCustomDbPassphrase(customDbPass);

      if (loaded && loaded.settings) {
        applyLoadedLedger(loaded);
        if (!loaded.settings.setupCompleted) {
          setShowSetupModal(true);
          setAuthConfig(loadedAuth);
        } else {
          // Require login on existing setup or when credentials are configured
          const nextAuth: AuthConfig = {
            ...loadedAuth,
            enabled:
              loadedAuth.enabled ||
              loadedAuth.passkeys.length > 0 ||
              loadedAuth.hasMasterPassphrase ||
              true,
          };
          setAuthConfig(nextAuth);
          setIsLocked(true);
        }
      } else if (customDbPass) {
        // The vault cannot be decrypted before unlock: never overwrite it with the blank state.
        setSaveBlocked(true);
        setAuthConfig({ ...loadedAuth, enabled: true });
        setIsLocked(true);
      } else {
        setAuthConfig(loadedAuth);
        if (
          loadedAuth.enabled &&
          (loadedAuth.passkeys.length > 0 || loadedAuth.hasMasterPassphrase)
        ) {
          setIsLocked(true);
        }
        setShowSetupModal(true);
      }
      setIsLoaded(true);
    })();
  }, []);

  const handleUpdateAuthConfig = async (next: AuthConfig) => {
    setAuthConfig(next);
    await saveAuthConfig(next);
  };

  /** Returns false (and stays locked) when the vault could not be decrypted with what was provided. */
  const handleUnlockSuccess = async (opts: {
    unlockedVaultSecret?: string;
    updatedConfig?: AuthConfig;
  }): Promise<boolean> => {
    if (opts.updatedConfig) {
      setAuthConfig(opts.updatedConfig);
      await saveAuthConfig(opts.updatedConfig);
    }
    if (opts.unlockedVaultSecret) {
      const reloaded = await loadLedgerFromDb(opts.unlockedVaultSecret);
      if (reloaded && reloaded.settings) {
        applyLoadedLedger(reloaded);
        setSaveBlocked(false);
        if (!reloaded.settings.setupCompleted) {
          setShowSetupModal(true);
        }
      }
    }
    if (saveBlockedRef.current) {
      // The vault is still encrypted with a passphrase this session does not have (e.g. a passkey
      // without a stored secret, or a wrong passphrase). Opening the app would show an empty ledger.
      return false;
    }
    setIsLocked(false);
    showNotification(
      `Signed in as ${
        opts.updatedConfig?.userDisplayName ||
        authConfig.userDisplayName ||
        'Koban Owner'
      }.`
    );
    return true;
  };

  // Inactivity Auto-Lock Timer
  useEffect(() => {
    if (!isLoaded || isLocked || !authConfig.autoLockMinutes) return;
    const timeoutMs = authConfig.autoLockMinutes * 60 * 1000;
    let timer = window.setTimeout(() => setIsLocked(true), timeoutMs);

    const resetTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIsLocked(true), timeoutMs);
    };

    window.addEventListener('pointerdown', resetTimer);
    window.addEventListener('keydown', resetTimer);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', resetTimer);
      window.removeEventListener('keydown', resetTimer);
    };
  }, [isLoaded, isLocked, authConfig.autoLockMinutes]);

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
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT');

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
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setShowImportModal(true);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setIsLocked(true);
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
  }, [state]);

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
    vaultPassphrase?: string;
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
      nextState = fresh;
      setState(fresh);
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
          confirmBeforeMonthCopy: opts.confirmBeforeMonthCopy,
          monthCopyScope: opts.monthCopyScope,
          autoPromptCopyOnEmptyMonth: opts.autoPromptCopyOnEmptyMonth,
        },
      };
      setState(nextState);
    }

    if (opts.vaultPassphrase !== undefined) {
      await updateVaultPassphrase(opts.vaultPassphrase || null, nextState);
    }

    setShowSetupModal(false);
    showNotification(
      opts.skipAccountsSetup
        ? 'Koban setup complete (Account setup skipped for later).'
        : 'Koban setup, accounts, and encrypted vault configured.'
    );
  };

  const handleUpdateVaultPassphrase = async (passphrase: string | null) => {
    await updateVaultPassphrase(passphrase, state);
    showNotification(
      passphrase
        ? 'Updated AES-256-GCM vault to use your custom passphrase.'
        : 'Reverted AES-256-GCM vault to default key.'
    );
  };

  const handleUpdateBudget = (categoryId: string, newBudget: number) => {
    setState((prev) => {
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
      const sourceRowMap = new Map<string, { budget: number; actual: number }>();
      for (const gs of sourceSummary.groups) {
        for (const r of gs.rows) {
          sourceRowMap.set(r.category.id, {
            budget: r.budget,
            actual: r.actual,
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

  const handleDeleteGroup = (groupId: string) => {
    const grp = state.groups.find((g) => g.id === groupId);
    if (
      state.settings.confirmBeforeDelete !== false &&
      grp &&
      !window.confirm(
        `Are you sure you want to delete the "${grp.name}" group and all categories inside it?`
      )
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
        'name' | 'defaultBudget' | 'taxRate' | 'deductiblePct'
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

  const handleDeleteCategory = (categoryId: string) => {
    const cat = state.categories.find((c) => c.id === categoryId);
    if (
      state.settings.confirmBeforeDelete !== false &&
      cat &&
      !window.confirm(
        `Are you sure you want to delete category "${cat.name}"?`
      )
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

  const handleDeleteTransaction = (id: string) => {
    setState((prev) => ({
      ...prev,
      transactions: prev.transactions.filter((t) => t.id !== id),
    }));
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

      if (targetRule && patch.amount !== undefined && patch.amount > 0) {
        const cat = prev.categories.find((c) => c.id === targetRule.categoryId);
        if (cat && cat.defaultBudget === 0) {
          nextCategories = prev.categories.map((c) =>
            c.id === cat.id ? { ...c, defaultBudget: patch.amount! } : c
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
            budget: patch.amount,
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

  const handleDeleteRecurringRule = (id: string) => {
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
    const activeRules = state.recurringRules.filter(
      (r) =>
        r.active &&
        r.amount > 0 &&
        (state.settings.activeWorkspace === 'combined' ||
          r.mode === state.settings.activeWorkspace)
    );
    if (activeRules.length === 0) {
      showNotification(
        'Set a non-zero amount on your active recurring rules (or Monthly Budget) before posting.'
      );
      return;
    }

    let added = 0;
    const newTxs: TransactionItem[] = [];
    for (const r of activeRules) {
      const alreadyExists = state.transactions.some(
        (tx) =>
          tx.monthKey === monthKey &&
          (tx.recurringId === r.id ||
            (tx.categoryId === r.categoryId &&
              tx.description === r.description &&
              Math.abs(tx.amount - r.amount) < 0.01))
      );
      if (!alreadyExists) {
        const dayStr = String(r.dayOfMonth).padStart(2, '0');
        newTxs.push({
          id: `tx-rec-${r.id}-${monthKey}`,
          date: `${monthKey}-${dayStr}`,
          monthKey,
          mode: r.mode,
          type: r.type,
          categoryId: r.categoryId,
          description: r.description,
          amount: r.amount,
          client: r.client,
          taxRate: r.taxRate,
          deductiblePct: r.deductiblePct,
          paymentMethod: 'Recurring Auto',
          status: 'cleared',
          recurringId: r.id,
        });
        added++;
      }
    }

    if (added > 0) {
      setState((prev) => ({
        ...prev,
        transactions: [...newTxs, ...prev.transactions],
      }));
      showNotification(`Posted ${added} recurring item(s) to ${monthKey}.`);
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

  const handleDeleteGoal = (id: string) => {
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

  const handleDeleteAccount = (accountId: string) => {
    const acc = (state.accounts ?? []).find((a) => a.id === accountId);
    if (
      state.settings.confirmBeforeDelete !== false &&
      acc &&
      !window.confirm(
        `Are you sure you want to remove account "${acc.name}"? Linked transactions will be kept as unassigned.`
      )
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

  const handleTransferBetweenAccounts = (
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    _date: string,
    note: string
  ) => {
    const today = new Date().toISOString().slice(0, 10);
    setState((prev) => {
      const nextAccounts = (prev.accounts ?? []).map((acc) => {
        if (acc.id === fromAccountId) {
          const delta = acc.classification === 'liability' ? amount : -amount;
          return {
            ...acc,
            startingBalance: acc.startingBalance + delta,
            currentBalance: acc.currentBalance + delta,
            updatedAt: today,
          };
        }
        if (acc.id === toAccountId) {
          const delta = acc.classification === 'liability' ? -amount : amount;
          return {
            ...acc,
            startingBalance: acc.startingBalance + delta,
            currentBalance: acc.currentBalance + delta,
            updatedAt: today,
          };
        }
        return acc;
      });
      return {
        ...prev,
        accounts: nextAccounts,
      };
    });
    const fromName =
      state.accounts.find((a) => a.id === fromAccountId)?.name ?? 'Source';
    const toName =
      state.accounts.find((a) => a.id === toAccountId)?.name ?? 'Destination';
    showNotification(
      `Transferred ${state.settings.currency} ${amount.toFixed(2)} from ${fromName} → ${toName} (${note}).`
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
    schedule: 'monthly' | 'annual_lump';
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

  const handleRestoreFromPath = async (path: string, passphrase?: string) => {
    try {
      const shouldPreview =
        state.settings.confirmAndPreviewBeforeImport ?? true;
      if (shouldPreview) {
        const restored = await restoreFromBackupFile(path, passphrase, true);
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
      const restored = await restoreFromBackupFile(path, passphrase, false);
      // The local DB was replaced: it no longer matches the last WebDAV sync.
      webdavSync.resetLink();
      setState(restored);
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
    passphrase?: string;
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
            true
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

      // Otherwise importing budget_sheet or transactions from .xlsx / .xls / .csv
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

      if (opts.kind === 'budget_sheet') {
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
      } else {
        const res = importTransactionsFromBuffer(
          buffer,
          state,
          opts.targetMode,
          monthKey
        );
        return {
          kind: 'transactions',
          targetMode: opts.targetMode,
          fileName,
          sheetName: res.sheetName,
          proposedState: {
            ...res.state,
            settings: { ...res.state.settings, setupCompleted: true },
          },
          importedCount: res.importedTransactions,
          transactionRows: res.previewRows,
        };
      }
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
    setState(preview.proposedState);
    setShowImportModal(false);
    setShowSetupModal(false);

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
      const dbInfo = await getDatabaseInfo().catch(() => null);
      const customPass = Boolean(dbInfo?.has_custom_passphrase);
      const loaded = customPass ? null : await loadLedgerFromDb();

      if (loaded && loaded.settings) {
        applyLoadedLedger(loaded);
        setSaveBlocked(false);
        setHasCustomDbPassphrase(false);
        setShowWebDavOpenModal(false);
        setShowSetupModal(!loaded.settings.setupCompleted);
        showNotification('Opened the vault from WebDAV. This device now uses it as primary storage.');
        return;
      }
      if (customPass) {
        // Passphrase-protected vault: unlock via the normal lock screen; the WebDAV settings
        // are applied right after the ledger is decrypted (handleUnlockSuccess).
        setSaveBlocked(true);
        setHasCustomDbPassphrase(true);
        setAuthConfig((prev) => ({ ...prev, enabled: true }));
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

  if (isLoaded && isLocked) {
    return (
      <AuthLockScreen
        authConfig={authConfig}
        hasCustomDbPassphrase={hasCustomDbPassphrase}
        onUnlockSuccess={handleUnlockSuccess}
      />
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
        onLockVault={() => setIsLocked(true)}
        onExportExcel={handleExportExcel}
        onExportBudgetCsv={handleExportBudgetCsv}
        onExportTransactionsCsv={handleExportTransactionsCsv}
        onManualBackup={handleManualBackup}
        isSaving={isSaving}
      />

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
          onOpenSetupWizard={() => setShowSetupModal(true)}
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
              onUpdateBackupSettings={updateSettings}
              onUpdateVaultPassphrase={handleUpdateVaultPassphrase}
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
              authConfig={authConfig}
              onUpdateSettings={updateSettings}
              onUpdateAuthConfig={handleUpdateAuthConfig}
              onLockVaultNow={() => setIsLocked(true)}
              onOpenSetupWizard={() => setShowSetupModal(true)}
              onOpenBackupsTab={() => setActiveTab('backups')}
              onReloadLedgerState={handleReloadLedgerState}
            />
          )}
        </main>
      </div>

      {/* Onboarding / Profile & Category Setup Modal */}
      <OnboardingModal
        isOpen={showSetupModal}
        currentSettings={state.settings}
        existingAccounts={state.accounts ?? []}
        authConfig={authConfig}
        onUpdateAuthConfig={handleUpdateAuthConfig}
        onUpdateLanguage={(code) => updateSettings({ language: code })}
        onCompleteSetup={handleCompleteSetup}
        onOpenImportModal={() => setShowImportModal(true)}
        onOpenWebDavVault={() => setShowWebDavOpenModal(true)}
        onClose={() => setShowSetupModal(false)}
      />

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
        onClose={() => {
          setPendingImportPreview(null);
          setShowImportModal(false);
        }}
        onPrepareImport={handlePrepareImport}
        onCommitImport={handleCommitImport}
        isTauri={isTauriEnv()}
      />

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
