import React, { useState } from 'react';
import {
  Home,
  Briefcase,
  Layers,
  FolderOpen,
  Check,
  Plus,
  Sparkles,
  ShieldCheck,
  RotateCcw,
  Repeat,
  Upload,
  Lock,
  Landmark,
  Shield,
  Trash2,
  FastForward,
  ArrowRight,
  ArrowLeft,
  SlidersHorizontal,
  Fingerprint,
  CheckCircle2,
  Cloud,
  X,
} from 'lucide-react';
import {
  AccountLiquidityClass,
  AccountType,
  AppSettings,
  AuthConfig,
  FinancialAccount,
  LedgerMode,
  MonthCopyScope,
  ProfileSetupMode,
} from '../types';
import {
  hashPassphraseVerifier,
  registerPasskeyOrWindowsHello,
} from '../utils/auth';
import {
  ACCOUNT_TYPE_META,
  CatalogGroupDef,
  createDefaultOnboardingAccounts,
  FREELANCER_CATEGORY_CATALOG,
  getDefaultCheckedCategoryIds,
  getDefaultRecurringCategoryIds,
  HOME_CATEGORY_CATALOG,
} from '../data/templates';
import { formatCurrency } from '../utils/calculations';
import { Logo } from './Logo';
import { useI18n } from '../i18n';
import { LanguageSelect } from './LanguageSelect';
import { pickFolderDialog } from '../utils/storage';

interface OnboardingModalProps {
  isOpen: boolean;
  currentSettings: AppSettings;
  existingAccounts: FinancialAccount[];
  authConfig: AuthConfig;
  onUpdateAuthConfig: (next: AuthConfig) => void;
  onUpdateLanguage?: (code: string) => void;
  onCompleteSetup: (options: {
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
  }) => void;
  onOpenImportModal: () => void;
  /** New device: open an existing vault from WebDAV. */
  onOpenWebDavVault?: () => void;
  onClose?: () => void;
}

type OnboardingStep = 1 | 2 | 3 | 4;

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  currentSettings,
  existingAccounts,
  authConfig,
  onUpdateAuthConfig,
  onUpdateLanguage,
  onCompleteSetup,
  onOpenImportModal,
  onOpenWebDavVault,
  onClose,
}) => {
  const { t } = useI18n();
  const [step, setStep] = useState<OnboardingStep>(1);

  // Step 1 state: Profile & Currency
  const [setupMode, setSetupMode] = useState<ProfileSetupMode>(
    currentSettings.setupMode || 'both'
  );
  const [currency, setCurrency] = useState(currentSettings.currency || 'CHF');
  const [defaultVatRate, setDefaultVatRate] = useState(
    currentSettings.defaultVatRate ?? 8.1
  );
  const [taxReserveRate, setTaxReserveRate] = useState(
    currentSettings.taxReserveRate ?? 25
  );

  // Step 2 state: Categories & Recurring Flags
  const [categoryTab, setCategoryTab] = useState<LedgerMode>(
    currentSettings.setupMode === 'freelancer' ? 'freelancer' : 'home'
  );
  const [selectedHomeIds, setSelectedHomeIds] = useState<Set<string>>(() =>
    getDefaultCheckedCategoryIds(HOME_CATEGORY_CATALOG)
  );
  const [selectedFreelancerIds, setSelectedFreelancerIds] = useState<Set<string>>(
    () => getDefaultCheckedCategoryIds(FREELANCER_CATEGORY_CATALOG)
  );
  const [recurringCategoryIds, setRecurringCategoryIds] = useState<Set<string>>(
    () => getDefaultRecurringCategoryIds()
  );
  const [customItemsByGroup, setCustomItemsByGroup] = useState<
    Record<string, string[]>
  >({});
  const [customInputByGroup, setCustomInputByGroup] = useState<
    Record<string, string>
  >({});
  const [applyCategorySelection, setApplyCategorySelection] = useState(
    !currentSettings.setupCompleted
  );

  // Step 3 state: Liquid Assets, Bank Accounts & Retirement
  const [skipAccountsSetup, setSkipAccountsSetup] = useState(false);
  const [draftAccounts, setDraftAccounts] = useState<FinancialAccount[]>(() =>
    existingAccounts.length > 0
      ? existingAccounts
      : createDefaultOnboardingAccounts(currentSettings.setupMode || 'both')
  );

  // Step 4 state: Encrypted Backup, Login / Passkeys & Behavioral Preferences
  const [backupDir, setBackupDir] = useState(currentSettings.backupDir || '');
  const [autoBackup, setAutoBackup] = useState(
    currentSettings.backupDir ? currentSettings.autoBackup : true
  );
  const [vaultPassphrase, setVaultPassphrase] = useState('');
  const [userDisplayName, setUserDisplayName] = useState(
    authConfig.userDisplayName || 'Koban Owner'
  );
  const [requireLoginOnStartup, setRequireLoginOnStartup] = useState(
    authConfig.enabled ?? true
  );
  const [passkeyStatusMsg, setPasskeyStatusMsg] = useState<string | null>(null);
  const [isEnrollingPasskey, setIsEnrollingPasskey] = useState(false);
  const [confirmBeforeMonthCopy, setConfirmBeforeMonthCopy] = useState(
    currentSettings.confirmBeforeMonthCopy ?? true
  );
  const [monthCopyScope, setMonthCopyScope] = useState<MonthCopyScope>(
    currentSettings.monthCopyScope ?? 'budgets_and_actuals'
  );
  const [autoPromptCopyOnEmptyMonth, setAutoPromptCopyOnEmptyMonth] = useState(
    currentSettings.autoPromptCopyOnEmptyMonth ?? true
  );

  if (!isOpen) return null;

  const handleModeChange = (mode: ProfileSetupMode) => {
    setSetupMode(mode);
    if (mode === 'freelancer') setCategoryTab('freelancer');
    if (mode === 'home') setCategoryTab('home');
    const hasAnyNonZero = draftAccounts.some((a) => a.startingBalance !== 0);
    if (!hasAnyNonZero) {
      setDraftAccounts(createDefaultOnboardingAccounts(mode));
    }
  };

  const toggleCategory = (mode: LedgerMode, id: string) => {
    const updater = (prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    };
    if (mode === 'home') {
      setSelectedHomeIds(updater);
    } else {
      setSelectedFreelancerIds(updater);
    }
  };

  const toggleRecurringCategory = (mode: LedgerMode, id: string) => {
    setRecurringCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    // If toggling recurring ON for an unselected standard category, also select the category
    if (!id.startsWith('custom:') && !recurringCategoryIds.has(id)) {
      if (mode === 'home' && !selectedHomeIds.has(id)) {
        setSelectedHomeIds((prev) => new Set(prev).add(id));
      } else if (mode === 'freelancer' && !selectedFreelancerIds.has(id)) {
        setSelectedFreelancerIds((prev) => new Set(prev).add(id));
      }
    }
  };

  const setGroupSelection = (
    grp: CatalogGroupDef,
    action: 'all' | 'default' | 'none'
  ) => {
    const updater = (prev: Set<string>) => {
      const next = new Set(prev);
      for (const item of grp.items) {
        if (action === 'all') {
          next.add(item.id);
        } else if (action === 'none') {
          next.delete(item.id);
        } else {
          if (item.defaultChecked) next.add(item.id);
          else next.delete(item.id);
        }
      }
      return next;
    };
    if (grp.mode === 'home') {
      setSelectedHomeIds(updater);
    } else {
      setSelectedFreelancerIds(updater);
    }
  };

  const handleAddCustomCategory = (groupId: string) => {
    const val = (customInputByGroup[groupId] ?? '').trim();
    if (!val) return;
    setCustomItemsByGroup((prev) => ({
      ...prev,
      [groupId]: [...(prev[groupId] ?? []), val],
    }));
    setCustomInputByGroup((prev) => ({ ...prev, [groupId]: '' }));
  };

  const handleRemoveCustomCategory = (groupId: string, idx: number) => {
    setCustomItemsByGroup((prev) => ({
      ...prev,
      [groupId]: (prev[groupId] ?? []).filter((_, i) => i !== idx),
    }));
  };

  // Account Draft Helpers
  const updateDraftAccount = (
    id: string,
    patch: Partial<FinancialAccount>
  ) => {
    setDraftAccounts((prev) =>
      prev.map((acc) => {
        if (acc.id !== id) return acc;
        const updated = { ...acc, ...patch };
        if (patch.type && patch.type !== acc.type) {
          const meta = ACCOUNT_TYPE_META[patch.type];
          if (meta) {
            updated.classification = meta.defaultClass;
            updated.autoTrackTransactions = meta.autoTrackDefault;
            updated.color = meta.defaultColor;
          }
        }
        return updated;
      })
    );
  };

  const addDraftAccount = (presetClass: 'liquid' | 'retirement' | 'custom') => {
    const today = new Date().toISOString().slice(0, 10);
    const defaultType: AccountType =
      presetClass === 'liquid'
        ? 'checking'
        : presetClass === 'retirement'
          ? 'retirement'
          : 'custom';
    const meta = ACCOUNT_TYPE_META[defaultType];
    const newAcc: FinancialAccount = {
      id: `acc-onb-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name:
        presetClass === 'liquid'
          ? 'Secondary Bank Account'
          : presetClass === 'retirement'
            ? 'Retirement / Investment Account'
            : 'Custom Asset Account',
      institution: '',
      mode: setupMode === 'freelancer' ? 'freelancer' : 'home',
      type: defaultType,
      customTypeLabel: presetClass === 'custom' ? 'Custom Account' : undefined,
      classification: meta.defaultClass,
      startingBalance: 0,
      currentBalance: 0,
      autoTrackTransactions: meta.autoTrackDefault,
      includeInNetWorth: true,
      color: meta.defaultColor,
      updatedAt: today,
    };
    setDraftAccounts((prev) => [...prev, newAcc]);
  };

  const removeDraftAccount = (id: string) => {
    setDraftAccounts((prev) => prev.filter((a) => a.id !== id));
  };

  const handleChooseBackupFolder = async () => {
    const picked = await pickFolderDialog('Select Automatic Database Backup Folder');
    if (picked) {
      setBackupDir(picked);
      setAutoBackup(true);
    }
  };

  const handleEnrollPasskeyInOnboarding = async () => {
    setIsEnrollingPasskey(true);
    setPasskeyStatusMsg(null);
    try {
      const cleanName = userDisplayName.trim() || 'Koban Owner';
      const cred = await registerPasskeyOrWindowsHello({
        userDisplayName: cleanName,
        credentialLabel: 'Windows Hello / Passkey',
        preferMode: 'auto',
      });
      const nextAuth: AuthConfig = {
        ...authConfig,
        enabled: true,
        userDisplayName: cleanName,
        passkeys: [...authConfig.passkeys, cred],
      };
      setRequireLoginOnStartup(true);
      onUpdateAuthConfig(nextAuth);
      setPasskeyStatusMsg(`Enrolled "${cred.name}" successfully.`);
    } catch (err) {
      setPasskeyStatusMsg(
        err instanceof Error
          ? `Passkey prompt: ${err.message}`
          : 'Passkey registration canceled.'
      );
    } finally {
      setIsEnrollingPasskey(false);
    }
  };

  const handleFinish = async () => {
    let nextAuth: AuthConfig = {
      ...authConfig,
      enabled:
        requireLoginOnStartup ||
        authConfig.passkeys.length > 0 ||
        Boolean(vaultPassphrase.trim()),
      userDisplayName: userDisplayName.trim() || 'Koban Owner',
    };
    if (vaultPassphrase.trim()) {
      const { saltB64, hashB64 } = await hashPassphraseVerifier(
        vaultPassphrase.trim()
      );
      nextAuth = {
        ...nextAuth,
        hasMasterPassphrase: true,
        passphraseSaltB64: saltB64,
        passphraseVerifierHashB64: hashB64,
      };
    }
    onUpdateAuthConfig(nextAuth);

    onCompleteSetup({
      setupMode,
      currency,
      backupDir,
      autoBackup,
      defaultVatRate,
      taxReserveRate,
      applyCategorySelection,
      selectedHomeIds,
      selectedFreelancerIds,
      recurringCategoryIds,
      customItemsByGroup,
      accounts: skipAccountsSetup ? undefined : draftAccounts,
      skipAccountsSetup,
      vaultPassphrase: vaultPassphrase.trim() || undefined,
      confirmBeforeMonthCopy,
      monthCopyScope,
      autoPromptCopyOnEmptyMonth,
    });
  };

  // Compute live preview totals for Step 3
  const liquidTotal = draftAccounts
    .filter((a) => a.classification === 'liquid')
    .reduce((s, a) => s + (a.startingBalance || 0), 0);
  const retirementTotal = draftAccounts
    .filter((a) => a.classification === 'retirement')
    .reduce((s, a) => s + (a.startingBalance || 0), 0);
  const investmentFixedTotal = draftAccounts
    .filter(
      (a) =>
        a.classification === 'investment' || a.classification === 'fixed_asset'
    )
    .reduce((s, a) => s + (a.startingBalance || 0), 0);
  const liabilityTotal = draftAccounts
    .filter((a) => a.classification === 'liability')
    .reduce((s, a) => s + Math.abs(a.startingBalance || 0), 0);
  const previewNetWorth =
    liquidTotal + retirementTotal + investmentFixedTotal - liabilityTotal;

  const liquidDrafts = draftAccounts.filter(
    (a) => a.classification === 'liquid'
  );
  const wealthAndOtherDrafts = draftAccounts.filter(
    (a) => a.classification !== 'liquid'
  );

  const stepsMeta: { num: OnboardingStep; title: string; subtitle: string }[] = [
    {
      num: 1,
      title: t('onboarding.step1'),
      subtitle: t('onboarding.step1.sub'),
    },
    {
      num: 2,
      title: t('onboarding.step2'),
      subtitle: t('onboarding.step2.sub'),
    },
    {
      num: 3,
      title: t('onboarding.step3'),
      subtitle: t('onboarding.step3.sub'),
    },
    {
      num: 4,
      title: t('onboarding.step4'),
      subtitle: t('onboarding.step4.sub'),
    },
  ];

  const modeCards: {
    id: ProfileSetupMode;
    title: string;
    subtitle: string;
    icon: React.ElementType;
    accentColor: string;
  }[] = [
    {
      id: 'home',
      title: t('onboarding.home'),
      subtitle:
        'Personal & household monthly budget, daily living, subscriptions, obligations, and savings.',
      icon: Home,
      accentColor: 'text-accent',
    },
    {
      id: 'freelancer',
      title: t('onboarding.freelancer'),
      subtitle:
        'Client revenue, tax-deductible business expenses, VAT reconciliation, and tax reserves.',
      icon: Briefcase,
      accentColor: 'text-indigo',
    },
    {
      id: 'both',
      title: t('onboarding.both'),
      subtitle:
        'Dedicated Home and Freelancer workspaces with instant top-bar switching and combined cashflow.',
      icon: Layers,
      accentColor: 'text-positive',
    },
  ];

  const activeCatalog =
    categoryTab === 'home' ? HOME_CATEGORY_CATALOG : FREELANCER_CATEGORY_CATALOG;
  const activeSelectedSet =
    categoryTab === 'home' ? selectedHomeIds : selectedFreelancerIds;

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-4xl bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden my-auto flex flex-col">
        {/* Top Modal Header */}
        <div className="px-6 py-4 border-b border-line flex items-center justify-between bg-app/60">
          <div className="flex items-center gap-3.5">
            <Logo variant="full" size={22} />
            <span className="w-px h-5 bg-line shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-medium text-ink tracking-tight">
                  {t('onboarding.title')}
                </h1>
                <span className="px-2 py-0.5 rounded-full bg-raised border border-line text-[10px] font-medium text-ink-2">
                  Step {step} of 4
                </span>
              </div>
              <p className="text-xs text-ink-2">
                {stepsMeta[step - 1].subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <LanguageSelect className="w-44" onChanged={(code) => onUpdateLanguage?.(code)} />
            <button
              type="button"
              onClick={onOpenImportModal}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-raised border border-line text-xs text-ink hover:bg-line/70 transition-colors cursor-pointer"
              title="Import existing data or restore a backup"
            >
              <Upload className="w-3.5 h-3.5 text-indigo" />
              <span>{t('onboarding.importExisting')}</span>
            </button>
            {onOpenWebDavVault && !currentSettings.setupCompleted && (
              <button
                type="button"
                onClick={onOpenWebDavVault}
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-raised border border-line text-xs text-ink hover:bg-line/70 transition-colors cursor-pointer"
                title="Download an existing Koban vault from your WebDAV server"
              >
                <Cloud className="w-3.5 h-3.5 text-indigo" />
                <span>Open Vault from WebDAV…</span>
              </button>
            )}

            {currentSettings.setupCompleted && onClose && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-raised cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* 4-Step Progress Bar */}
        <div className="grid grid-cols-4 border-b border-line bg-app/30">
          {stepsMeta.map((s) => {
            const isActive = step === s.num;
            const isCompleted = step > s.num;
            return (
              <button
                type="button"
                key={s.num}
                onClick={() => setStep(s.num)}
                className={`px-4 py-2.5 text-left border-r last:border-r-0 border-line transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-surface border-b-2 border-b-ink'
                    : isCompleted
                      ? 'bg-raised/40 hover:bg-raised/70'
                      : 'opacity-65 hover:opacity-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[11px] font-medium ${
                      isActive ? 'text-ink' : 'text-ink-2'
                    }`}
                  >
                    {s.title}
                  </span>
                  {isCompleted && (
                    <Check className="w-3.5 h-3.5 text-positive shrink-0" />
                  )}
                </div>
                <div className="text-[10px] text-ink-3 truncate mt-0.5">
                  {s.subtitle}
                </div>
              </button>
            );
          })}
        </div>

        {/* Distinct Modal Body for Current Step */}
        <div className="p-6 min-h-[380px] max-h-[68vh] overflow-y-auto flex flex-col justify-between">
          {/* ================= MODAL 1 OF 4: PROFILE & CURRENCY ================= */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h2 className="text-base font-medium text-ink">
                  Choose Your Ledger Profile
                </h2>
                <p className="text-xs text-ink-2">
                  Select how you intend to use Koban. You can switch workspaces or enable both at any time.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-2">
                  {modeCards.map((card) => {
                    const Icon = card.icon;
                    const selected = setupMode === card.id;
                    return (
                      <button
                        type="button"
                        key={card.id}
                        onClick={() => handleModeChange(card.id)}
                        className={`text-left p-4 rounded-xl border transition-all flex flex-col justify-between gap-3 cursor-pointer ${
                          selected
                            ? 'bg-raised border-ink ring-1 ring-ink shadow-xs'
                            : 'bg-app/60 border-line hover:bg-raised/60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <Icon className={`w-5 h-5 ${card.accentColor}`} />
                          {selected && (
                            <span className="w-5 h-5 rounded-full bg-ink text-on-ink flex items-center justify-center">
                              <Check className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-ink">
                            {card.title}
                          </div>
                          <p className="text-xs text-ink-2 mt-1 leading-relaxed">
                            {card.subtitle}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-app border border-line space-y-3">
                <div className="text-xs font-medium text-ink">
                  Currency & Tax Defaults
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[11px] text-ink-2 mb-1">
                      Primary Currency
                    </label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none"
                    >
                      <option value="CHF">CHF — Swiss Franc</option>
                      <option value="EUR">EUR (€) — Euro</option>
                      <option value="USD">USD ($) — US Dollar</option>
                      <option value="GBP">GBP (£) — British Pound</option>
                      <option value="JPY">JPY (¥) — Japanese Yen</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-ink-2 mb-1">
                      Default Freelancer VAT %
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={defaultVatRate}
                      onChange={(e) =>
                        setDefaultVatRate(parseFloat(e.target.value) || 0)
                      }
                      className="w-full h-9 px-3 rounded-lg bg-surface border border-line text-xs text-ink tabular-nums focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-ink-2 mb-1">
                      Tax Reserve Set-Aside %
                    </label>
                    <input
                      type="number"
                      step="1"
                      value={taxReserveRate}
                      onChange={(e) =>
                        setTaxReserveRate(parseFloat(e.target.value) || 0)
                      }
                      className="w-full h-9 px-3 rounded-lg bg-surface border border-line text-xs text-ink tabular-nums focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================= MODAL 2 OF 4: CATEGORIES ================= */}
          {step === 2 && (
            <div className="space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-medium text-ink">
                    Select & Customize Your Categories
                  </h2>
                  <p className="text-xs text-ink-2 mt-0.5">
                    Core categories are pre-checked. Uncheck any you don&apos;t need, check additional categories, or add custom ones.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {setupMode === 'both' && (
                    <div className="flex items-center bg-raised p-0.5 rounded-lg border border-line text-xs">
                      <button
                        type="button"
                        onClick={() => setCategoryTab('home')}
                        className={`px-3 py-1 rounded-md cursor-pointer ${
                          categoryTab === 'home'
                            ? 'bg-surface text-ink font-medium shadow-2xs'
                            : 'text-ink-2 hover:text-ink'
                        }`}
                      >
                        Home ({selectedHomeIds.size})
                      </button>
                      <button
                        type="button"
                        onClick={() => setCategoryTab('freelancer')}
                        className={`px-3 py-1 rounded-md cursor-pointer ${
                          categoryTab === 'freelancer'
                            ? 'bg-surface text-ink font-medium shadow-2xs'
                            : 'text-ink-2 hover:text-ink'
                        }`}
                      >
                        Freelancer ({selectedFreelancerIds.size})
                      </button>
                    </div>
                  )}

                  {currentSettings.setupCompleted && (
                    <label className="flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={applyCategorySelection}
                        onChange={(e) =>
                          setApplyCategorySelection(e.target.checked)
                        }
                        className="rounded border-line"
                      />
                      <span>Apply category changes</span>
                    </label>
                  )}
                </div>
              </div>

              {/* Recurring Auto-Detection Legend Bar */}
              <div className="px-3.5 py-2 rounded-xl bg-indigo/10 border border-indigo/25 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-ink">
                  <span className="w-5 h-5 rounded-md bg-indigo text-white inline-flex items-center justify-center shrink-0">
                    <Repeat className="w-3 h-3" />
                  </span>
                  <span>
                    Fixed items like <strong>Wages</strong>, <strong>Mortgage/Rent</strong>, <strong>Health Insurance</strong> &amp; <strong>Subscriptions</strong> are set as <strong>Recurring</strong> automatically. Click the{' '}
                    <span className="inline-flex items-center px-1 py-0.5 rounded bg-indigo/15 text-indigo font-medium text-[10px]">
                      <Repeat className="w-2.5 h-2.5 mr-0.5" /> recurring icon
                    </span>{' '}
                    on any category to toggle it on or off.
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setRecurringCategoryIds(getDefaultRecurringCategoryIds())
                  }
                  className="text-[11px] text-indigo hover:underline font-medium shrink-0 cursor-pointer"
                  title="Restore default recurring flags"
                >
                  Reset Recurring Defaults
                </button>
              </div>

              <div className="max-h-[43vh] overflow-y-auto pr-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                {activeCatalog.map((grp) => {
                  const customList = customItemsByGroup[grp.id] ?? [];
                  const checkedCount =
                    grp.items.filter((i) => activeSelectedSet.has(i.id)).length +
                    customList.length;

                  return (
                    <div
                      key={grp.id}
                      className="p-3 rounded-xl bg-app border border-line flex flex-col justify-between gap-2.5"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-line/70">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: grp.color }}
                            />
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink truncate">
                              {grp.name}
                            </span>
                            <span className="text-[10px] text-ink-3 tabular-nums">
                              ({checkedCount})
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-ink-3 shrink-0">
                            <button
                              type="button"
                              onClick={() => setGroupSelection(grp, 'all')}
                              className="hover:text-ink cursor-pointer"
                            >
                              All
                            </button>
                            <span>·</span>
                            <button
                              type="button"
                              onClick={() => setGroupSelection(grp, 'default')}
                              className="hover:text-ink cursor-pointer"
                              title="Reset to default selection"
                            >
                              <RotateCcw className="w-2.5 h-2.5 inline" />
                            </button>
                            <span>·</span>
                            <button
                              type="button"
                              onClick={() => setGroupSelection(grp, 'none')}
                              className="hover:text-ink cursor-pointer"
                            >
                              None
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          {grp.items.map((item) => {
                            const isChecked = activeSelectedSet.has(item.id);
                            const isRecurring = recurringCategoryIds.has(item.id);
                            return (
                              <div
                                key={item.id}
                                className={`h-6 inline-flex items-center rounded-md text-[11px] border transition-all overflow-hidden ${
                                  isChecked
                                    ? 'bg-surface border-ink/70 text-ink font-medium shadow-2xs'
                                    : 'bg-transparent border-line text-ink-3 hover:text-ink-2 hover:border-ink-3'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleCategory(grp.mode, item.id)
                                  }
                                  className="h-full pl-2 pr-1.5 inline-flex items-center gap-1 cursor-pointer"
                                >
                                  {isChecked ? (
                                    <Check className="w-3 h-3 text-positive shrink-0" />
                                  ) : (
                                    <Plus className="w-3 h-3 text-ink-3 shrink-0" />
                                  )}
                                  <span>{item.name}</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleRecurringCategory(grp.mode, item.id);
                                  }}
                                  title={
                                    isRecurring
                                      ? `${item.name}: Set as recurring monthly item (click to disable recurring)`
                                      : `${item.name}: One-off / variable item (click to set as recurring monthly)`
                                  }
                                  className={`h-full px-1.5 inline-flex items-center justify-center border-l transition-colors cursor-pointer ${
                                    isRecurring
                                      ? 'bg-indigo/15 text-indigo border-indigo/30 hover:bg-indigo/25'
                                      : 'border-line/60 text-ink-3/50 hover:text-indigo hover:bg-indigo/10'
                                  }`}
                                >
                                  <Repeat className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            );
                          })}

                          {customList.map((cName, idx) => {
                            const customKey = `custom:${grp.id}:${cName}`;
                            const isRecurring =
                              recurringCategoryIds.has(customKey);
                            return (
                              <div
                                key={`${grp.id}-cust-${idx}`}
                                className="h-6 inline-flex items-center rounded-md text-[11px] bg-surface border border-accent/70 text-ink font-medium overflow-hidden"
                              >
                                <span className="pl-2 pr-1.5 inline-flex items-center gap-1">
                                  <Check className="w-3 h-3 text-accent shrink-0" />
                                  <span>{cName}</span>
                                </span>

                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleRecurringCategory(grp.mode, customKey)
                                  }
                                  title={
                                    isRecurring
                                      ? `${cName}: Recurring monthly item (click to disable)`
                                      : `${cName}: Click to mark as recurring monthly item`
                                  }
                                  className={`h-full px-1.5 inline-flex items-center justify-center border-l transition-colors cursor-pointer ${
                                    isRecurring
                                      ? 'bg-indigo/15 text-indigo border-indigo/30 hover:bg-indigo/25'
                                      : 'border-line/60 text-ink-3/50 hover:text-indigo hover:bg-indigo/10'
                                  }`}
                                >
                                  <Repeat className="w-2.5 h-2.5" />
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    handleRemoveCustomCategory(grp.id, idx)
                                  }
                                  className="h-full px-1.5 inline-flex items-center justify-center border-l border-line/60 text-ink-3 hover:text-accent cursor-pointer"
                                  title="Remove custom category"
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 pt-1">
                        <input
                          type="text"
                          placeholder={`+ Add custom to ${grp.name.toLowerCase()}…`}
                          value={customInputByGroup[grp.id] ?? ''}
                          onChange={(e) =>
                            setCustomInputByGroup((prev) => ({
                              ...prev,
                              [grp.id]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddCustomCategory(grp.id);
                            }
                          }}
                          className="flex-1 h-6 px-2 rounded bg-surface border border-line text-[11px] text-ink placeholder:text-ink-3 focus:outline-none"
                        />
                        {(customInputByGroup[grp.id] ?? '').trim() && (
                          <button
                            type="button"
                            onClick={() => handleAddCustomCategory(grp.id)}
                            className="h-6 px-2 rounded bg-ink text-on-ink text-[10px] cursor-pointer"
                          >
                            Add
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ================= MODAL 3 OF 4: LIQUID ASSETS, RETIREMENT & ACCOUNTS ================= */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-medium text-ink">
                      Liquid Assets, Retirement & Custom Accounts
                    </h2>
                    <span className="px-2 py-0.5 rounded bg-raised border border-line text-[10px] text-ink-2">
                      Optional
                    </span>
                  </div>
                  <p className="text-xs text-ink-2 mt-0.5">
                    Configure your bank accounts, retirement funds (Pillar 2 / 3a / IRA), or custom accounts — or skip this step for setup later.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="px-3 py-1 rounded-lg bg-app border border-line text-xs tabular-nums">
                    <span className="text-ink-3 mr-1.5">Est. Net Worth:</span>
                    <span
                      className={`font-semibold ${
                        previewNetWorth >= 0 ? 'text-positive' : 'text-accent'
                      }`}
                    >
                      {formatCurrency(previewNetWorth, currency)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Left Column: Liquid Assets & Multiple Bank Accounts */}
                <div className="p-3.5 rounded-xl bg-app border border-line space-y-3">
                  <div className="flex items-center justify-between pb-1.5 border-b border-line/70">
                    <div className="flex items-center gap-1.5">
                      <Landmark className="w-4 h-4 text-positive" />
                      <span className="text-xs font-medium text-ink">
                        Liquid Assets & Bank Accounts
                      </span>
                    </div>
                    <span className="text-xs font-medium text-positive tabular-nums">
                      {formatCurrency(liquidTotal, currency)}
                    </span>
                  </div>

                  <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
                    {liquidDrafts.map((acc) => (
                      <div
                        key={acc.id}
                        className="p-2.5 rounded-lg bg-surface border border-line space-y-1.5"
                      >
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={acc.name}
                            onChange={(e) =>
                              updateDraftAccount(acc.id, {
                                name: e.target.value,
                              })
                            }
                            placeholder="Account name (e.g. Main Checking)"
                            className="flex-1 h-7 px-2 rounded bg-app border border-line text-xs text-ink focus:outline-none"
                          />
                          <select
                            value={acc.type}
                            onChange={(e) =>
                              updateDraftAccount(acc.id, {
                                type: e.target.value as AccountType,
                              })
                            }
                            className="h-7 px-1.5 rounded bg-app border border-line text-[11px] text-ink-2 focus:outline-none"
                          >
                            <option value="checking">Checking</option>
                            <option value="savings">Savings</option>
                            <option value="business_bank">Business Bank</option>
                            <option value="tax_reserve">Tax Reserve</option>
                            <option value="cash">Cash / Wallet</option>
                            <option value="custom">Custom</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => removeDraftAccount(acc.id)}
                            className="p-1 text-ink-3 hover:text-accent cursor-pointer"
                            title="Remove account"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={acc.institution ?? ''}
                            onChange={(e) =>
                              updateDraftAccount(acc.id, {
                                institution: e.target.value,
                              })
                            }
                            placeholder="Bank / Institution (optional)"
                            className="flex-1 h-7 px-2 rounded bg-app border border-line text-[11px] text-ink-2 placeholder:text-ink-3 focus:outline-none"
                          />
                          <div className="relative w-32">
                            <input
                              type="number"
                              step="0.01"
                              value={acc.startingBalance || ''}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                updateDraftAccount(acc.id, {
                                  startingBalance: val,
                                  currentBalance: val,
                                });
                              }}
                              placeholder={`0.00 ${currency}`}
                              className="w-full h-7 px-2 rounded bg-app border border-line text-xs text-ink tabular-nums text-right focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => addDraftAccount('liquid')}
                    className="w-full h-8 inline-flex items-center justify-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Another Bank / Liquid Account</span>
                  </button>
                </div>

                {/* Right Column: Retirement, Investment, Liability & Custom Accounts */}
                <div className="p-3.5 rounded-xl bg-app border border-line space-y-3">
                  <div className="flex items-center justify-between pb-1.5 border-b border-line/70">
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-4 h-4 text-[#8a6fb0]" />
                      <span className="text-xs font-medium text-ink">
                        Retirement, Investments & Custom
                      </span>
                    </div>
                    <span className="text-xs font-medium text-ink tabular-nums">
                      {formatCurrency(
                        retirementTotal + investmentFixedTotal - liabilityTotal,
                        currency
                      )}
                    </span>
                  </div>

                  <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
                    {wealthAndOtherDrafts.map((acc) => (
                      <div
                        key={acc.id}
                        className="p-2.5 rounded-lg bg-surface border border-line space-y-1.5"
                      >
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={acc.name}
                            onChange={(e) =>
                              updateDraftAccount(acc.id, {
                                name: e.target.value,
                              })
                            }
                            placeholder="e.g. Pillar 3a, Pension, ETFs"
                            className="flex-1 h-7 px-2 rounded bg-app border border-line text-xs text-ink focus:outline-none"
                          />
                          <select
                            value={acc.type}
                            onChange={(e) =>
                              updateDraftAccount(acc.id, {
                                type: e.target.value as AccountType,
                              })
                            }
                            className="h-7 px-1.5 rounded bg-app border border-line text-[11px] text-ink-2 focus:outline-none"
                          >
                            <option value="retirement">Retirement / Pension</option>
                            <option value="brokerage">Brokerage / ETFs</option>
                            <option value="crypto">Crypto</option>
                            <option value="real_estate">Real Estate</option>
                            <option value="credit_card">Credit Card (Debt)</option>
                            <option value="loan">Loan / Mortgage (Debt)</option>
                            <option value="custom">Custom Type…</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => removeDraftAccount(acc.id)}
                            className="p-1 text-ink-3 hover:text-accent cursor-pointer"
                            title="Remove account"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {acc.type === 'custom' ? (
                            <>
                              <input
                                type="text"
                                value={acc.customTypeLabel ?? ''}
                                onChange={(e) =>
                                  updateDraftAccount(acc.id, {
                                    customTypeLabel: e.target.value,
                                  })
                                }
                                placeholder="Custom type label…"
                                className="flex-1 h-7 px-2 rounded bg-app border border-line text-[11px] text-ink placeholder:text-ink-3 focus:outline-none"
                              />
                              <select
                                value={acc.classification}
                                onChange={(e) =>
                                  updateDraftAccount(acc.id, {
                                    classification: e.target
                                      .value as AccountLiquidityClass,
                                  })
                                }
                                className="h-7 px-1.5 rounded bg-app border border-line text-[10px] text-ink-2"
                              >
                                <option value="retirement">Retirement</option>
                                <option value="investment">Investment</option>
                                <option value="fixed_asset">Fixed Asset</option>
                                <option value="liquid">Liquid</option>
                                <option value="liability">Liability</option>
                              </select>
                            </>
                          ) : (
                            <input
                              type="text"
                              value={acc.institution ?? ''}
                              onChange={(e) =>
                                updateDraftAccount(acc.id, {
                                  institution: e.target.value,
                                })
                              }
                              placeholder="Provider / Foundation (optional)"
                              className="flex-1 h-7 px-2 rounded bg-app border border-line text-[11px] text-ink-2 placeholder:text-ink-3 focus:outline-none"
                            />
                          )}

                          <div className="relative w-32">
                            <input
                              type="number"
                              step="0.01"
                              value={acc.startingBalance || ''}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                updateDraftAccount(acc.id, {
                                  startingBalance: val,
                                  currentBalance: val,
                                });
                              }}
                              placeholder={`0.00 ${currency}`}
                              className="w-full h-7 px-2 rounded bg-app border border-line text-xs text-ink tabular-nums text-right focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => addDraftAccount('retirement')}
                      className="h-8 inline-flex items-center justify-center gap-1 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Retirement / ETF</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => addDraftAccount('custom')}
                      className="h-8 inline-flex items-center justify-center gap-1 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Custom Account</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================= MODAL 4 OF 4: ENCRYPTED VAULT, LOGIN/PASSKEYS & BEHAVIOR ================= */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-medium text-ink">
                  Passkey / Windows Hello Login, Encrypted Vault & Preferences
                </h2>
                <p className="text-xs text-ink-2 mt-0.5">
                  Configure Passkey / Windows Hello login protection, automatic encrypted SQLite backups, and month-to-month workflow preferences.
                </p>
              </div>

              {/* Login & Passkey / Windows Hello Protection */}
              <div className="p-4 rounded-xl bg-app border border-line space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Fingerprint className="w-4 h-4 text-indigo" />
                    <span className="text-xs font-medium text-ink">
                      Passkey & Windows Hello Login Protection
                    </span>
                    {authConfig.passkeys.length > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-positive/12 border border-positive/30 text-positive text-[10px] font-medium inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{authConfig.passkeys.length} Passkey Enrolled</span>
                      </span>
                    )}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={requireLoginOnStartup}
                      onChange={(e) =>
                        setRequireLoginOnStartup(e.target.checked)
                      }
                      className="rounded border-line"
                    />
                    <span>Require Login on Startup</span>
                  </label>
                </div>

                <div className="flex flex-wrap items-end gap-2.5">
                  <div className="flex-[1_1_180px] min-w-[160px]">
                    <label className="block text-[11px] text-ink-2 mb-1">
                      Account Owner Name
                    </label>
                    <input
                      type="text"
                      value={userDisplayName}
                      onChange={(e) => setUserDisplayName(e.target.value)}
                      placeholder="e.g. Roland"
                      className="w-full h-9 px-3 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={isEnrollingPasskey}
                    onClick={handleEnrollPasskeyInOnboarding}
                    className="h-9 px-4 rounded-lg bg-ink text-on-ink text-xs font-medium inline-flex items-center gap-2 hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                  >
                    <Fingerprint className="w-3.5 h-3.5" />
                    <span>
                      {authConfig.passkeys.length > 0
                        ? 'Add Another Passkey / Windows Hello'
                        : 'Enroll Passkey / Windows Hello'}
                    </span>
                  </button>
                </div>

                {passkeyStatusMsg && (
                  <p className="text-[11px] text-indigo">{passkeyStatusMsg}</p>
                )}
              </div>

              {/* Encrypted Vault & Backup Path */}
              <div className="p-4 rounded-xl bg-app border border-line space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-positive" />
                    <span className="text-xs font-medium text-ink">
                      AES-256-GCM Encrypted Database & Automatic Backups
                    </span>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoBackup}
                      onChange={(e) => setAutoBackup(e.target.checked)}
                      className="rounded border-line"
                    />
                    <span>Auto-backup on changes</span>
                  </label>
                </div>

                <p className="text-[11px] text-ink-2 leading-relaxed">
                  All records inside <code className="text-ink">koban.db</code> and your backup snapshots (<code className="text-ink">koban-latest.db</code>) are encrypted at rest with authenticated <strong>AES-256-GCM</strong>.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
                  <div className="md:col-span-8 flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Backup Folder: e.g. D:\Backups\Koban"
                      value={backupDir}
                      onChange={(e) => setBackupDir(e.target.value)}
                      className="flex-1 h-9 px-3 rounded-lg bg-surface border border-line text-xs text-ink placeholder:text-ink-3 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleChooseBackupFolder}
                      className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-raised border border-line text-xs text-ink hover:bg-line/60 transition-colors shrink-0 cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Browse…</span>
                    </button>
                  </div>

                  <div className="md:col-span-4 relative">
                    <Lock className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
                    <input
                      type="password"
                      placeholder="Optional custom vault passphrase"
                      value={vaultPassphrase}
                      onChange={(e) => setVaultPassphrase(e.target.value)}
                      className="w-full h-9 pl-8 pr-3 rounded-lg bg-surface border border-line text-xs text-ink placeholder:text-ink-3 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Behavioral Options */}
              <div className="p-4 rounded-xl bg-app border border-line space-y-3">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-indigo" />
                  <span className="text-xs font-medium text-ink">
                    Month-to-Month Copy & Behavioral Preferences
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-surface border border-line cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmBeforeMonthCopy}
                      onChange={(e) =>
                        setConfirmBeforeMonthCopy(e.target.checked)
                      }
                      className="mt-0.5 rounded border-line"
                    />
                    <div>
                      <div className="font-medium text-ink">
                        Ask confirmation before copying monthly values
                      </div>
                      <p className="text-[11px] text-ink-3 mt-0.5">
                        Always ask if you are sure before copying last month&apos;s values into the next month.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-surface border border-line cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoPromptCopyOnEmptyMonth}
                      onChange={(e) =>
                        setAutoPromptCopyOnEmptyMonth(e.target.checked)
                      }
                      className="mt-0.5 rounded border-line"
                    />
                    <div>
                      <div className="font-medium text-ink">
                        Offer carry-over when switching to an empty month
                      </div>
                      <p className="text-[11px] text-ink-3 mt-0.5">
                        Show a one-click banner when viewing a new month that has no values yet.
                      </p>
                    </div>
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="text-xs text-ink-2">
                    Default values to copy from previous month:
                  </span>
                  <select
                    value={monthCopyScope}
                    onChange={(e) =>
                      setMonthCopyScope(e.target.value as MonthCopyScope)
                    }
                    className="h-8 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink"
                  >
                    <option value="budgets_and_actuals">
                      Both Planned Budgets & Direct Actuals
                    </option>
                    <option value="budgets_only">
                      Planned Budgets Only (Reset Actuals to 0)
                    </option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Distinct Step Navigation Footer */}
        <div className="px-6 py-4 border-t border-line bg-app/50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s - 1) as OnboardingStep)}
                className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink hover:bg-raised transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            ) : (
              currentSettings.setupCompleted &&
              onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 px-4 rounded-lg text-xs text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              )
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {step === 3 && (
              <button
                type="button"
                onClick={() => {
                  setSkipAccountsSetup(true);
                  setStep(4);
                }}
                className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer"
              >
                <FastForward className="w-3.5 h-3.5" />
                <span>Skip This Step for Setup Later</span>
              </button>
            )}

            {step < 4 ? (
              <button
                type="button"
                onClick={() => {
                  if (step === 3) setSkipAccountsSetup(false);
                  setStep((s) => (s + 1) as OnboardingStep);
                }}
                className="h-9 px-5 inline-flex items-center gap-2 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer"
              >
                <span>
                  {step === 1
                    ? 'Next: Categories'
                    : step === 2
                      ? 'Next: Accounts & Net Worth'
                      : 'Next: Vault & Preferences'}
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinish}
                className="h-9 px-5 inline-flex items-center gap-2 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {currentSettings.setupCompleted
                    ? 'Save Setup & Preferences'
                    : t('onboarding.finish')}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
