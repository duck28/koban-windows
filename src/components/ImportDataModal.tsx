import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  FileSpreadsheet,
  ReceiptText,
  Database,
  Lock,
  Check,
  X,
  Eye,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  FolderSearch,
  Tag,
  Landmark,
  Building2,
} from 'lucide-react';
import {
  BankImportProfile,
  ImportRule,
  LedgerMode,
  LedgerState,
  PendingImportFile,
} from '../types';
import {
  BudgetImportPreviewRow,
  TransactionImportPreviewRow,
} from '../utils/exportImport';
import {
  BankStatementParseResult,
  BUILTIN_BANK_PROFILES,
  StagedBankTransaction,
} from '../utils/bankImport';
import { formatCurrency, formatNumber } from '../utils/calculations';
import { useI18n } from '../i18n';
import { KeyFileSelector } from './KeyFileSelector';
import { BankImportReview } from './BankImportReview';
import { KobanSelect, KobanSelectOption } from './KobanSelect';

export type ImportKind = 'budget_sheet' | 'transactions' | 'database_backup';

export interface ImportPreviewData {
  kind: ImportKind;
  targetMode: LedgerMode;
  fileName: string;
  sheetName?: string;
  proposedState: LedgerState;
  importedCount: number;
  budgetRows?: BudgetImportPreviewRow[];
  transactionRows?: TransactionImportPreviewRow[];
  backupPath?: string;
  accountId?: string;
  watchedFilePath?: string;
  bankParseResult?: BankStatementParseResult;
}

interface ImportDataModalProps {
  isOpen: boolean;
  ledgerState: LedgerState;
  defaultMode: LedgerMode;
  monthKey: string;
  currency: string;
  confirmAndPreviewBeforeImport: boolean;
  onToggleConfirmAndPreview: (enabled: boolean) => void;
  initialPreviewData?: ImportPreviewData | null;
  onClearInitialPreview?: () => void;
  importWatchDir?: string;
  pendingImportFiles?: PendingImportFile[];
  initialPendingFilePath?: string | null;
  onClearInitialPendingFilePath?: () => void;
  onPickImportWatchDir?: () => Promise<void>;
  onClearImportWatchDir?: () => void;
  onOpenRulesModal?: () => void;
  onClose: () => void;
  onPrepareImport: (options: {
    kind: ImportKind;
    targetMode: LedgerMode;
    accountId?: string;
    selectedProfileId?: string;
    passphrase?: string;
    keyfilePath?: string;
    filePath?: string;
    browserFile?: File;
  }) => Promise<ImportPreviewData | null>;
  onCommitImport: (preview: ImportPreviewData) => Promise<void>;
  onCommitBankImport?: (params: {
    preview: ImportPreviewData;
    stagedRows: StagedBankTransaction[];
    savedProfile?: BankImportProfile;
    savedRules: ImportRule[];
    archiveWatchedFile: boolean;
  }) => Promise<void>;
  isTauri: boolean;
}

export const ImportDataModal: React.FC<ImportDataModalProps> = ({
  isOpen,
  ledgerState,
  defaultMode,
  monthKey,
  currency,
  confirmAndPreviewBeforeImport,
  onToggleConfirmAndPreview,
  initialPreviewData,
  onClearInitialPreview,
  importWatchDir = '',
  pendingImportFiles = [],
  initialPendingFilePath,
  onClearInitialPendingFilePath,
  onPickImportWatchDir,
  onClearImportWatchDir,
  onOpenRulesModal,
  onClose,
  onPrepareImport,
  onCommitImport,
  onCommitBankImport,
  isTauri,
}) => {
  const { t, tf, tGroupName, tCategoryName, tAccountName, tAccClass } = useI18n();
  const [importKind, setImportKind] = useState<ImportKind>('transactions');
  const [targetMode, setTargetMode] = useState<LedgerMode>(defaultMode);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    () => ledgerState.accounts?.[0]?.id ?? ''
  );
  const [selectedBankId, setSelectedBankId] = useState<string>('auto');
  const [passphrase, setPassphrase] = useState('');
  const [keyfilePath, setKeyfilePath] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [previewData, setPreviewData] = useState<ImportPreviewData | null>(
    null
  );
  const [excludedRowIds, setExcludedRowIds] = useState<Set<string>>(
    () => new Set()
  );
  const [hideZeroPreviewRows, setHideZeroPreviewRows] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialPreviewData) {
      setPreviewData(initialPreviewData);
      setExcludedRowIds(new Set());
    }
  }, [initialPreviewData]);

  useEffect(() => {
    if (!isOpen || !initialPendingFilePath) return;
    let active = true;
    setImportKind('transactions');
    setIsBusy(true);
    void onPrepareImport({
      kind: 'transactions',
      targetMode,
      accountId: selectedAccountId || undefined,
      selectedProfileId: selectedBankId,
      filePath: initialPendingFilePath,
    }).then((prepared) => {
      if (!active) return;
      if (prepared) setPreviewData(prepared);
      onClearInitialPendingFilePath?.();
      setIsBusy(false);
    });
    return () => {
      active = false;
    };
  }, [isOpen, initialPendingFilePath]);

  const handleSelectAccount = (accId: string) => {
    setSelectedAccountId(accId);
    const acc = ledgerState.accounts.find((a) => a.id === accId);
    if (acc) {
      setTargetMode(acc.mode);
    }
    const scopedProfile = (ledgerState.importProfiles ?? []).find(
      (p) => accId && p.accountId === accId
    );
    if (scopedProfile) {
      setSelectedBankId(scopedProfile.id);
    }
  };

  const accountOptions: KobanSelectOption[] = useMemo(
    () => [
      { value: '', label: t('bankImport.noAccountOption') },
      ...ledgerState.accounts.map((acc) => ({
        value: acc.id,
        label: `${tAccountName(acc)} (${acc.mode})`,
      })),
    ],
    [ledgerState.accounts, t, tAccountName]
  );

  const bankFormatOptions: KobanSelectOption[] = useMemo(() => {
    const opts: KobanSelectOption[] = [
      {
        value: 'auto',
        label: t('bankImport.autoDetectBank'),
        subtitle: 'CAMT.053 XML, OFX/QFX, Swiss/EU bank CSVs & Excel',
      },
    ];
    for (const p of ledgerState.importProfiles ?? []) {
      opts.push({
        value: p.id,
        label: p.name,
        group: t('bankImport.savedProfilesGroup'),
        subtitle: `${p.dateColumn} · ${p.amountMode === 'split_debit_credit' ? 'Split Debit/Credit' : 'Signed Amount'}`,
      });
    }
    for (const b of BUILTIN_BANK_PROFILES) {
      opts.push({
        value: b.id,
        label: b.name,
        group: t('bankImport.supportedBanksGroup'),
      });
    }
    opts.push({
      value: 'custom',
      label: t('bankImport.customManualMapping'),
      group: 'Manual',
    });
    return opts;
  }, [ledgerState.importProfiles, t]);

  const toggleRowInclusion = (id: string) => {
    setExcludedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleBudgetRows = useMemo(() => {
    if (!previewData?.budgetRows) return [];
    if (!hideZeroPreviewRows) return previewData.budgetRows;
    return previewData.budgetRows.filter(
      (r) => Math.abs(r.budget) > 0.001 || Math.abs(r.actual) > 0.001
    );
  }, [previewData, hideZeroPreviewRows]);

  const budgetMetrics = useMemo(() => {
    const rows = previewData?.budgetRows ?? [];
    let incomeBudget = 0;
    let incomeActual = 0;
    let outflowBudget = 0;
    let outflowActual = 0;
    let newCount = 0;
    let nonZeroCount = 0;
    let selectedCount = 0;

    for (const r of rows) {
      if (Math.abs(r.budget) > 0.001 || Math.abs(r.actual) > 0.001) {
        nonZeroCount++;
      }
      if (excludedRowIds.has(r.categoryId)) continue;
      selectedCount++;
      if (r.isNewCategory) newCount++;
      if (r.kind === 'income') {
        incomeBudget += r.budget;
        incomeActual += r.actual;
      } else {
        outflowBudget += r.budget;
        outflowActual += r.actual;
      }
    }
    return {
      incomeBudget,
      incomeActual,
      outflowBudget,
      outflowActual,
      netBudget: incomeBudget - outflowBudget,
      netActual: incomeActual - outflowActual,
      newCount,
      nonZeroCount,
      selectedCount,
    };
  }, [previewData, excludedRowIds]);

  const txMetrics = useMemo(() => {
    const rows = previewData?.transactionRows ?? [];
    let incomeTotal = 0;
    let expenseTotal = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    let selectedCount = 0;
    for (const r of rows) {
      if (excludedRowIds.has(r.id)) continue;
      selectedCount++;
      if (r.type === 'income') {
        incomeTotal += r.amount;
        incomeCount++;
      } else {
        expenseTotal += r.amount;
        expenseCount++;
      }
    }
    return {
      incomeTotal,
      expenseTotal,
      incomeCount,
      expenseCount,
      netTotal: incomeTotal - expenseTotal,
      selectedCount,
    };
  }, [previewData, excludedRowIds]);

  if (!isOpen) return null;

  const handleCloseAll = () => {
    setPreviewData(null);
    setExcludedRowIds(new Set());
    onClearInitialPreview?.();
    onClose();
  };

  const executeFileSelection = async (
    browserFile?: File,
    directFilePath?: string
  ) => {
    setIsBusy(true);
    try {
      const prepared = await onPrepareImport({
        kind: importKind,
        targetMode,
        accountId: selectedAccountId || undefined,
        selectedProfileId: selectedBankId,
        passphrase: passphrase || undefined,
        keyfilePath: keyfilePath || undefined,
        filePath: directFilePath,
        browserFile,
      });
      if (!prepared) return;

      if (confirmAndPreviewBeforeImport || prepared.bankParseResult) {
        // Show Preview & Confirmation Step
        setPreviewData(prepared);
      } else {
        // Immediate Import (when user disabled preview in Settings)
        await onCommitImport(prepared);
        setPreviewData(null);
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleActionClick = async () => {
    if (isTauri) {
      await executeFileSelection();
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleBrowserFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await executeFileSelection(file);
    e.target.value = '';
  };

  const handleConfirmPreview = async () => {
    if (!previewData) return;
    setIsBusy(true);
    try {
      let filteredPreview = previewData;
      if (excludedRowIds.size > 0) {
        if (previewData.kind === 'transactions') {
          filteredPreview = {
            ...previewData,
            importedCount: txMetrics.selectedCount,
            proposedState: {
              ...previewData.proposedState,
              transactions: previewData.proposedState.transactions.filter(
                (t) => !excludedRowIds.has(t.id)
              ),
            },
          };
        } else if (previewData.kind === 'budget_sheet') {
          const newCatIdsToExclude = new Set(
            (previewData.budgetRows ?? [])
              .filter(
                (r) => r.isNewCategory && excludedRowIds.has(r.categoryId)
              )
              .map((r) => r.categoryId)
          );
          filteredPreview = {
            ...previewData,
            importedCount: budgetMetrics.selectedCount,
            proposedState: {
              ...previewData.proposedState,
              categories: previewData.proposedState.categories.filter(
                (c) => !newCatIdsToExclude.has(c.id)
              ),
              monthlyBudgets: previewData.proposedState.monthlyBudgets.map(
                (mb) => {
                  if (
                    mb.monthKey === monthKey &&
                    excludedRowIds.has(mb.categoryId)
                  ) {
                    const row = previewData.budgetRows?.find(
                      (r) => r.categoryId === mb.categoryId
                    );
                    if (row) {
                      return {
                        ...mb,
                        budget: row.previousBudget,
                        directActual: row.previousActual,
                      };
                    }
                  }
                  return mb;
                }
              ),
            },
          };
        }
      }
      await onCommitImport(filteredPreview);
      setPreviewData(null);
      setExcludedRowIds(new Set());
      onClearInitialPreview?.();
    } finally {
      setIsBusy(false);
    }
  };

  const cards: {
    id: ImportKind;
    title: string;
    subtitle: string;
    formats: string;
    icon: React.ElementType;
    accent: string;
  }[] = [
    {
      id: 'budget_sheet',
      title: t('import.budgetSheet'),
      subtitle: t('import.budgetSheetDesc'),
      formats: '.xlsx, .xls, .csv',
      icon: FileSpreadsheet,
      accent: 'text-positive',
    },
    {
      id: 'transactions',
      title: t('import.transactions'),
      subtitle: t('import.transactionsDesc'),
      formats: '.xml, .ofx, .csv, .xlsx',
      icon: ReceiptText,
      accent: 'text-indigo',
    },
    {
      id: 'database_backup',
      title: t('import.backup'),
      subtitle: t('import.backupDesc'),
      formats: '.db, .sqlite, .json',
      icon: Database,
      accent: 'text-accent',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div
        className={`w-full ${
          previewData ? 'max-w-5xl' : 'max-w-xl'
        } bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden my-auto transition-all`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={
            importKind === 'database_backup'
              ? '.db,.sqlite,.json'
              : importKind === 'transactions'
                ? '.xml,.ofx,.qfx,.csv,.xlsx,.xls'
                : '.xlsx,.xls,.csv'
          }
          onChange={handleBrowserFileChange}
          className="hidden"
        />

        {/* Header */}
        <div className="px-6 py-4 border-b border-line flex items-center justify-between bg-app/60">
          <div className="flex items-center gap-2.5">
            {previewData ? (
              <Eye className="w-4 h-4 text-indigo" />
            ) : (
              <Upload className="w-4 h-4 text-accent" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-medium text-ink">
                  {previewData
                    ? t('import.preview.title')
                    : t('import.title')}
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-raised border border-line text-[10px] font-medium text-ink-2">
                  {previewData ? t('import.step2') : t('import.step1')}
                </span>
              </div>
              <p className="text-xs text-ink-2">
                {previewData
                  ? tf('import.subReview', { file: previewData.fileName })
                  : t('import.subSelect')}
              </p>
            </div>
          </div>
          <button
            onClick={handleCloseAll}
            className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-raised cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        {!previewData ? (
          /* ================= STEP 1: CHOOSE SOURCE & FILE ================= */
          <div className="p-6 space-y-4">
            {/* 1. Select Import Type */}
            <div className="space-y-2">
              <label className="block text-xs uppercase tracking-[0.12em] text-ink-3 font-medium">
                {t('import.step1Heading')}
              </label>
              <div className="space-y-2">
                {cards.map((c) => {
                  const Icon = c.icon;
                  const selected = importKind === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setImportKind(c.id)}
                      className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-start gap-3 cursor-pointer ${
                        selected
                          ? 'bg-raised border-ink ring-1 ring-ink'
                          : 'bg-app/60 border-line hover:bg-raised/60'
                      }`}
                    >
                      <Icon
                        className={`w-4 h-4 mt-0.5 shrink-0 ${c.accent}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-[13px] font-medium text-ink">
                            {c.title}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-line text-ink-3 tabular-nums">
                            {c.formats}
                          </span>
                        </div>
                        <p className="text-[11px] text-ink-2 mt-0.5 leading-relaxed">
                          {c.subtitle}
                        </p>
                      </div>
                      {selected && (
                        <span className="w-4 h-4 rounded-full bg-ink text-on-ink flex items-center justify-center mt-0.5 shrink-0">
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Target Workspace / Account / Watched Folder / Backup Passphrase */}
            {importKind !== 'database_backup' ? (
              <div className="space-y-2.5">
                {importKind === 'transactions' && (
                  <>
                    <div className="p-3.5 rounded-xl bg-app border border-line flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Landmark className="w-4 h-4 text-indigo shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-ink">
                            {t('bankImport.targetAccountLabel')}
                          </div>
                          <p className="text-[11px] text-ink-3 truncate">
                            Used for balance tracking, deduplication, and saved CSV profiles.
                          </p>
                        </div>
                      </div>
                      <KobanSelect
                        value={selectedAccountId}
                        onChange={handleSelectAccount}
                        options={accountOptions}
                        tone="surface"
                        size="sm"
                        className="w-56 shrink-0"
                      />
                    </div>

                    <div className="p-3.5 rounded-xl bg-app border border-line flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2 className="w-4 h-4 text-positive shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-ink">
                            {t('bankImport.bankFormatLabel')}
                          </div>
                          <p className="text-[11px] text-ink-3 truncate">
                            {t('bankImport.bankFormatDesc')}
                          </p>
                        </div>
                      </div>
                      <KobanSelect
                        value={selectedBankId}
                        onChange={setSelectedBankId}
                        options={bankFormatOptions}
                        tone="surface"
                        size="sm"
                        searchable
                        searchPlaceholder="Search bank (UBS, PostFinance, ZKB, Revolut…)"
                        className="w-56 shrink-0"
                      />
                    </div>
                  </>
                )}

                <div className="flex items-center justify-between p-3.5 rounded-xl bg-app border border-line">
                  <div>
                    <div className="text-xs font-medium text-ink">
                      {tf('import.targetWorkspace', { month: monthKey })}
                    </div>
                    <p className="text-[11px] text-ink-3">
                      {t('import.targetWorkspaceDesc')}
                    </p>
                  </div>
                  <div className="flex items-center bg-raised p-0.5 rounded-lg border border-line text-xs">
                    <button
                      type="button"
                      onClick={() => setTargetMode('home')}
                      className={`px-3 py-1 rounded-md cursor-pointer ${
                        targetMode === 'home'
                          ? 'bg-surface text-ink font-medium shadow-2xs'
                          : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      {t('onboarding.home')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setTargetMode('freelancer')}
                      className={`px-3 py-1 rounded-md cursor-pointer ${
                        targetMode === 'freelancer'
                          ? 'bg-surface text-ink font-medium shadow-2xs'
                          : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      {t('workspace.freelancer')}
                    </button>
                  </div>
                </div>

                {importKind === 'transactions' && isTauri && (
                  <div className="p-3.5 rounded-xl bg-app border border-line space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FolderSearch className="w-4 h-4 text-positive shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-ink">
                            {t('bankImport.watchFolderTitle')}
                          </div>
                          <p className="text-[11px] text-ink-3 truncate">
                            {importWatchDir || t('bankImport.watchFolderDesc')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {importWatchDir && onClearImportWatchDir && (
                          <button
                            type="button"
                            onClick={onClearImportWatchDir}
                            className="h-7 px-2 rounded border border-line text-[11px] text-ink-2 hover:text-ink cursor-pointer"
                          >
                            {t('common.clear')}
                          </button>
                        )}
                        {onPickImportWatchDir && (
                          <button
                            type="button"
                            onClick={() => void onPickImportWatchDir()}
                            className="h-7 px-2.5 rounded bg-surface border border-line text-[11px] text-ink hover:bg-raised cursor-pointer"
                          >
                            {t('bankImport.chooseWatchFolder')}
                          </button>
                        )}
                      </div>
                    </div>

                    {pendingImportFiles.length > 0 && (
                      <div className="space-y-1.5 pt-1 border-t border-line/70">
                        <div className="text-[10px] uppercase tracking-wider text-ink-3 font-medium">
                          {t('bankImport.pendingFilesTitle').replace(
                            '{count}',
                            String(pendingImportFiles.length)
                          )}
                        </div>
                        <div className="max-h-28 overflow-y-auto space-y-1">
                          {pendingImportFiles.map((f) => (
                            <div
                              key={f.path}
                              className="px-2.5 py-1.5 rounded-lg bg-surface border border-line flex items-center justify-between gap-2 text-xs"
                            >
                              <span className="truncate font-medium text-ink">
                                {f.name}
                              </span>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  void executeFileSelection(undefined, f.path)
                                }
                                className="h-6 px-2.5 rounded bg-ink text-on-ink text-[11px] font-medium cursor-pointer shrink-0"
                              >
                                {t('bankImport.reviewNowBtn')}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-app border border-line space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-ink">
                  <Lock className="w-3.5 h-3.5 text-positive" />
                  <span>{t('import.optionalPassphrase')}</span>
                </div>
                <p className="text-[11px] text-ink-2">
                  {t('import.optionalPassphraseDesc')}
                </p>
                <input
                  type="password"
                  placeholder={t('import.optionalPassphrasePlaceholder')}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  className="w-full h-8 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none"
                />
                {isTauri && (
                  <KeyFileSelector
                    keyfilePath={keyfilePath}
                    onChange={setKeyfilePath}
                    allowGenerate={false}
                    compact
                  />
                )}
              </div>
            )}

            {/* 3. Preview & Confirmation Behavior Toggle */}
            {importKind !== 'transactions' && (
              <label className="flex items-start justify-between gap-3 p-3 rounded-xl bg-app/70 border border-line cursor-pointer">
                <div className="flex items-start gap-2.5">
                  <Eye className="w-4 h-4 text-indigo shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-medium text-ink">
                      {t('import.previewToggleTitle')}
                    </div>
                    <p className="text-[11px] text-ink-3 mt-0.5">
                      {t('import.previewToggleDesc')}
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={confirmAndPreviewBeforeImport}
                  onChange={(e) => onToggleConfirmAndPreview(e.target.checked)}
                  className="mt-0.5 rounded border-line"
                />
              </label>
            )}

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-line">
              <div>
                {importKind === 'transactions' && onOpenRulesModal && (
                  <button
                    type="button"
                    onClick={onOpenRulesModal}
                    className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised cursor-pointer"
                  >
                    <Tag className="w-3.5 h-3.5" />
                    <span>{t('bankImport.manageRulesBtn')}</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleCloseAll}
                  className="h-9 px-4 rounded-lg text-xs text-ink-2 hover:text-ink hover:bg-raised cursor-pointer"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleActionClick}
                  className="h-9 px-5 inline-flex items-center gap-2 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                >
                  {confirmAndPreviewBeforeImport || importKind === 'transactions' ? (
                    <Eye className="w-3.5 h-3.5" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isBusy
                      ? t('import.readingFile')
                      : confirmAndPreviewBeforeImport || importKind === 'transactions'
                        ? t('import.selectFile')
                        : t('import.selectImmediate')}
                  </span>
                </button>
              </div>
            </div>
          </div>
        ) : previewData.kind === 'transactions' &&
          previewData.bankParseResult &&
          onCommitBankImport ? (
          <BankImportReview
            parseResult={previewData.bankParseResult}
            state={ledgerState}
            targetMode={previewData.targetMode}
            accountId={previewData.accountId}
            currency={currency}
            watchedFilePath={previewData.watchedFilePath}
            isBusy={isBusy}
            onBack={() => {
              setPreviewData(null);
              setExcludedRowIds(new Set());
              onClearInitialPreview?.();
            }}
            onCancel={handleCloseAll}
            onConfirmCommit={async ({
              stagedRows,
              savedProfile,
              savedRules,
              archiveWatchedFile,
            }) => {
              setIsBusy(true);
              try {
                await onCommitBankImport({
                  preview: previewData,
                  stagedRows,
                  savedProfile,
                  savedRules,
                  archiveWatchedFile,
                });
                setPreviewData(null);
                setExcludedRowIds(new Set());
                onClearInitialPreview?.();
              } finally {
                setIsBusy(false);
              }
            }}
          />
        ) : (
          /* ================= STEP 2: DATA PREVIEW & CONFIRMATION ================= */
          <div className="p-6 space-y-4">
            {/* Top Context Banner */}
            <div className="p-3.5 rounded-xl bg-indigo/8 border border-indigo/25 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-indigo shrink-0" />
                <div className="text-xs">
                  <span className="font-semibold text-ink">
                    {previewData.fileName}
                  </span>
                  {previewData.sheetName && (
                    <span className="text-ink-2">
                      {' '}
                      • Sheet:{' '}
                      <strong className="text-ink">
                        {previewData.sheetName}
                      </strong>
                    </span>
                  )}
                  {previewData.kind !== 'database_backup' && (
                    <span className="text-ink-2">
                      {' '}
                      •{' '}
                      <strong className="text-ink">
                        {previewData.targetMode === 'home'
                          ? t('workspace.home')
                          : t('workspace.freelancer')}
                      </strong>{' '}
                      ({monthKey})
                    </span>
                  )}
                </div>
              </div>

              {previewData.kind === 'budget_sheet' && (
                <label className="inline-flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hideZeroPreviewRows}
                    onChange={(e) => setHideZeroPreviewRows(e.target.checked)}
                    className="rounded border-line"
                  />
                  <span>
                    {tf('import.showNonZeroOnly', {
                      active: budgetMetrics.nonZeroCount,
                      total: previewData.budgetRows?.length ?? 0,
                    })}
                  </span>
                </label>
              )}
            </div>

            {/* ================= PREVIEW FOR MONTHLY BUDGET SHEET ================= */}
            {previewData.kind === 'budget_sheet' && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      {t('import.categoriesParsed')}
                    </div>
                    <div className="text-sm font-semibold text-ink mt-0.5 tabular-nums">
                      {tf('import.rowsCount', {
                        count: previewData.budgetRows?.length ?? 0,
                      })}
                    </div>
                    <div className="text-[11px] text-ink-2 mt-0.5">
                      {tf('import.newActiveCounts', {
                        new: budgetMetrics.newCount,
                        active: budgetMetrics.nonZeroCount,
                      })}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      {t('import.incomeBudgetActual')}
                    </div>
                    <div className="text-sm font-semibold text-positive mt-0.5 tabular-nums">
                      {formatCurrency(budgetMetrics.incomeBudget, currency)}
                    </div>
                    <div className="text-[11px] text-ink-2 mt-0.5 tabular-nums">
                      {t('finance.actual')}:{' '}
                      {formatCurrency(budgetMetrics.incomeActual, currency)}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      {t('import.outflowsBudgetActual')}
                    </div>
                    <div className="text-sm font-semibold text-ink mt-0.5 tabular-nums">
                      {formatCurrency(budgetMetrics.outflowBudget, currency)}
                    </div>
                    <div className="text-[11px] text-ink-2 mt-0.5 tabular-nums">
                      {t('finance.actual')}:{' '}
                      {formatCurrency(budgetMetrics.outflowActual, currency)}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      {t('import.netCashflowPreview')}
                    </div>
                    <div
                      className={`text-sm font-semibold mt-0.5 tabular-nums ${
                        budgetMetrics.netActual >= 0
                          ? 'text-positive'
                          : 'text-negative'
                      }`}
                    >
                      {formatCurrency(budgetMetrics.netActual, currency)}
                    </div>
                    <div className="text-[11px] text-ink-2 mt-0.5 tabular-nums">
                      {tf('reports.plannedNet', {
                        amount: formatCurrency(budgetMetrics.netBudget, currency),
                      })}
                    </div>
                  </div>
                </div>

                <div className="border border-line rounded-xl overflow-hidden bg-app">
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-raised border-b border-line text-[10px] uppercase tracking-wider text-ink-3">
                        <tr>
                          <th className="py-2 px-2.5 w-8 text-center">✓</th>
                          <th className="py-2 px-3">{t('import.colGroup')}</th>
                          <th className="py-2 px-3">{t('finance.category')}</th>
                          <th className="py-2 px-2.5">{t('import.colAction')}</th>
                          <th className="py-2 px-3 text-right">
                            {t('finance.budget')} ({currency})
                          </th>
                          <th className="py-2 px-3 text-right">
                            {t('finance.actual')} ({currency})
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/60">
                        {visibleBudgetRows.map((row) => {
                          const hasValue =
                            Math.abs(row.budget) > 0.001 ||
                            Math.abs(row.actual) > 0.001;
                          const isIncluded = !excludedRowIds.has(
                            row.categoryId
                          );
                          return (
                            <tr
                              key={row.categoryId}
                              onClick={() => toggleRowInclusion(row.categoryId)}
                              className={`cursor-pointer ${
                                !isIncluded
                                  ? 'opacity-45 bg-app'
                                  : hasValue
                                    ? 'bg-surface hover:bg-raised/50'
                                    : 'text-ink-3 hover:bg-raised/30'
                              }`}
                            >
                              <td
                                className="py-1.5 px-2.5 text-center"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={isIncluded}
                                  onChange={() =>
                                    toggleRowInclusion(row.categoryId)
                                  }
                                  className="rounded border-line cursor-pointer"
                                />
                              </td>
                              <td className="py-1.5 px-3 text-[11px] text-ink-2 font-medium">
                                {tGroupName(row.groupName)}
                              </td>
                              <td className="py-1.5 px-3 font-medium text-ink">
                                {tCategoryName({ id: row.categoryId, name: row.categoryName })}
                              </td>
                              <td className="py-1.5 px-2.5">
                                {row.isNewCategory ? (
                                  <span className="px-1.5 py-0.5 rounded bg-positive/12 text-positive text-[10px] font-medium">
                                    {t('import.badgeNew')}
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded bg-raised text-ink-2 text-[10px]">
                                    {t('import.badgeUpdate')}
                                  </span>
                                )}
                              </td>
                              <td className="py-1.5 px-3 text-right tabular-nums">
                                {row.previousBudget !== row.budget &&
                                row.previousBudget > 0 ? (
                                  <span className="text-ink-3 line-through mr-1.5 text-[10px]">
                                    {formatNumber(row.previousBudget)}
                                  </span>
                                ) : null}
                                <span
                                  className={
                                    row.budget > 0
                                      ? 'font-semibold text-ink'
                                      : 'text-ink-3'
                                  }
                                >
                                  {formatNumber(row.budget)}
                                </span>
                              </td>
                              <td className="py-1.5 px-3 text-right tabular-nums">
                                {row.previousActual !== row.actual &&
                                row.previousActual > 0 ? (
                                  <span className="text-ink-3 line-through mr-1.5 text-[10px]">
                                    {formatNumber(row.previousActual)}
                                  </span>
                                ) : null}
                                <span
                                  className={
                                    row.actual > 0
                                      ? 'font-semibold text-positive'
                                      : 'text-ink-3'
                                  }
                                >
                                  {formatNumber(row.actual)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* ================= PREVIEW FOR TRANSACTIONS ================= */}
            {previewData.kind === 'transactions' && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      {t('import.entriesToImport')}
                    </div>
                    <div className="text-sm font-semibold text-ink mt-0.5 tabular-nums">
                      {tf('import.txCountLabel', {
                        count: previewData.transactionRows?.length ?? 0,
                      })}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      {t('finance.income')} ({txMetrics.incomeCount})
                    </div>
                    <div className="text-sm font-semibold text-positive mt-0.5 tabular-nums">
                      {formatCurrency(txMetrics.incomeTotal, currency)}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      {t('finance.expenses')} ({txMetrics.expenseCount})
                    </div>
                    <div className="text-sm font-semibold text-ink mt-0.5 tabular-nums">
                      {formatCurrency(txMetrics.expenseTotal, currency)}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      {t('import.netTxTotal')}
                    </div>
                    <div
                      className={`text-sm font-semibold mt-0.5 tabular-nums ${
                        txMetrics.netTotal >= 0
                          ? 'text-positive'
                          : 'text-negative'
                      }`}
                    >
                      {formatCurrency(txMetrics.netTotal, currency)}
                    </div>
                  </div>
                </div>

                <div className="border border-line rounded-xl overflow-hidden bg-app">
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-raised border-b border-line text-[10px] uppercase tracking-wider text-ink-3">
                        <tr>
                          <th className="py-2 px-2.5 w-8 text-center">✓</th>
                          <th className="py-2 px-3">{t('finance.date')}</th>
                          <th className="py-2 px-2.5">{t('import.colType')}</th>
                          <th className="py-2 px-3">{t('finance.category')}</th>
                          <th className="py-2 px-3">{t('finance.description')}</th>
                          <th className="py-2 px-3 text-right">
                            {t('finance.amount')} ({currency})
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/60">
                        {(previewData.transactionRows ?? []).map((tx) => {
                          const isIncluded = !excludedRowIds.has(tx.id);
                          return (
                            <tr
                              key={tx.id}
                              onClick={() => toggleRowInclusion(tx.id)}
                              className={`cursor-pointer ${
                                isIncluded
                                  ? 'bg-surface hover:bg-raised/50'
                                  : 'opacity-45 bg-app'
                              }`}
                            >
                              <td
                                className="py-1.5 px-2.5 text-center"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={isIncluded}
                                  onChange={() => toggleRowInclusion(tx.id)}
                                  className="rounded border-line cursor-pointer"
                                />
                              </td>
                              <td className="py-1.5 px-3 tabular-nums text-ink-2">
                                {tx.date}
                              </td>
                            <td className="py-1.5 px-2.5">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${
                                  tx.type === 'income'
                                    ? 'bg-positive/12 text-positive'
                                    : 'bg-raised text-ink-2'
                                }`}
                              >
                                {tx.type === 'income'
                                  ? t('tx.filterIncome')
                                  : t('tx.filterExpense')}
                              </span>
                            </td>
                            <td className="py-1.5 px-3 text-ink-2">
                              {tCategoryName(tx.categoryName)}
                            </td>
                            <td className="py-1.5 px-3 font-medium text-ink">
                              {tx.description}
                              {tx.client ? (
                                <span className="text-ink-3 ml-1.5 text-[11px]">
                                  ({tx.client})
                                </span>
                              ) : null}
                            </td>
                            <td
                              className={`py-1.5 px-3 text-right font-semibold tabular-nums ${
                                tx.type === 'income'
                                  ? 'text-positive'
                                  : 'text-ink'
                              }`}
                            >
                              {tx.type === 'income' ? '+' : '-'}
                              {formatNumber(tx.amount)}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* ================= PREVIEW FOR ENCRYPTED DATABASE BACKUP ================= */}
            {previewData.kind === 'database_backup' && (
              <>
                <div className="p-3 rounded-xl bg-accent/10 border border-accent/30 flex items-start gap-2.5 text-xs text-ink">
                  <AlertTriangle className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">
                      {t('import.backupConfirmTitle')}
                    </span>{' '}
                    {tf('import.backupConfirmBody', {
                      file: previewData.fileName,
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      {t('import.groupsCategories')}
                    </div>
                    <div className="text-sm font-semibold text-ink mt-0.5 tabular-nums">
                      {previewData.proposedState.groups?.length ?? 0} •{' '}
                      {previewData.proposedState.categories?.length ?? 0}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      {t('import.financialAccounts')}
                    </div>
                    <div className="text-sm font-semibold text-ink mt-0.5 tabular-nums">
                      {previewData.proposedState.accounts?.length ?? 0}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      {t('import.transactionsRules')}
                    </div>
                    <div className="text-sm font-semibold text-ink mt-0.5 tabular-nums">
                      {previewData.proposedState.transactions?.length ?? 0} •{' '}
                      {previewData.proposedState.recurringRules?.length ?? 0}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      {t('import.backupCurrencyPeriod')}
                    </div>
                    <div className="text-sm font-semibold text-positive mt-0.5">
                      {previewData.proposedState.settings?.currency ?? 'CHF'} •{' '}
                      {previewData.proposedState.settings?.activeYear ?? 2026}-
                      {String(
                        previewData.proposedState.settings?.activeMonth ?? 1
                      ).padStart(2, '0')}
                    </div>
                  </div>
                </div>

                {(previewData.proposedState.accounts?.length ?? 0) > 0 && (
                  <div className="border border-line rounded-xl overflow-hidden bg-app">
                    <div className="px-3 py-2 bg-raised border-b border-line text-[10px] uppercase tracking-wider text-ink-3 font-medium">
                      {t('import.accountsIncluded')}
                    </div>
                    <div className="max-h-48 overflow-y-auto divide-y divide-line/60">
                      {(previewData.proposedState.accounts ?? []).map((acc) => (
                        <div
                          key={acc.id}
                          className="px-3 py-2 bg-surface flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-medium text-ink">
                              {tAccountName(acc)}
                            </span>
                            <span className="text-ink-3 ml-2 text-[11px]">
                              ({tAccClass(acc.classification)})
                            </span>
                          </div>
                          <span className="font-semibold tabular-nums text-ink">
                            {formatCurrency(
                              acc.currentBalance || acc.startingBalance || 0,
                              previewData.proposedState.settings?.currency ||
                                currency
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Confirmation Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-line">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  setPreviewData(null);
                  setExcludedRowIds(new Set());
                  onClearInitialPreview?.();
                }}
                className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink hover:bg-raised cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{t('import.chooseOther')}</span>
              </button>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleCloseAll}
                  className="h-9 px-4 rounded-lg text-xs text-ink-2 hover:text-ink hover:bg-raised cursor-pointer"
                >
                  {t('import.cancel')}
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleConfirmPreview}
                  className="h-9 px-5 inline-flex items-center gap-2 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {isBusy
                      ? t('import.completing')
                      : `${t('import.confirm')} (${
                          previewData.kind === 'transactions'
                            ? txMetrics.selectedCount
                            : previewData.kind === 'budget_sheet'
                              ? budgetMetrics.selectedCount
                              : previewData.importedCount
                        })`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
