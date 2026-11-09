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
} from 'lucide-react';
import { LedgerMode, LedgerState } from '../types';
import {
  BudgetImportPreviewRow,
  TransactionImportPreviewRow,
} from '../utils/exportImport';
import { formatCurrency, formatNumber } from '../utils/calculations';
import { useI18n } from '../i18n';

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
}

interface ImportDataModalProps {
  isOpen: boolean;
  defaultMode: LedgerMode;
  monthKey: string;
  currency: string;
  confirmAndPreviewBeforeImport: boolean;
  onToggleConfirmAndPreview: (enabled: boolean) => void;
  initialPreviewData?: ImportPreviewData | null;
  onClearInitialPreview?: () => void;
  onClose: () => void;
  onPrepareImport: (options: {
    kind: ImportKind;
    targetMode: LedgerMode;
    passphrase?: string;
    browserFile?: File;
  }) => Promise<ImportPreviewData | null>;
  onCommitImport: (preview: ImportPreviewData) => Promise<void>;
  isTauri: boolean;
}

export const ImportDataModal: React.FC<ImportDataModalProps> = ({
  isOpen,
  defaultMode,
  monthKey,
  currency,
  confirmAndPreviewBeforeImport,
  onToggleConfirmAndPreview,
  initialPreviewData,
  onClearInitialPreview,
  onClose,
  onPrepareImport,
  onCommitImport,
  isTauri,
}) => {
  const { t } = useI18n();
  const [importKind, setImportKind] = useState<ImportKind>('budget_sheet');
  const [targetMode, setTargetMode] = useState<LedgerMode>(defaultMode);
  const [passphrase, setPassphrase] = useState('');
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

  const executeFileSelection = async (browserFile?: File) => {
    setIsBusy(true);
    try {
      const prepared = await onPrepareImport({
        kind: importKind,
        targetMode,
        passphrase: passphrase.trim() || undefined,
        browserFile,
      });
      if (!prepared) return;

      if (confirmAndPreviewBeforeImport) {
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
      subtitle:
        'Import category groups, categories, budgeted amounts, and actuals from a 2-column or flat spreadsheet.',
      formats: '.xlsx, .xls, .csv',
      icon: FileSpreadsheet,
      accent: 'text-positive',
    },
    {
      id: 'transactions',
      title: t('import.transactions'),
      subtitle:
        'Import itemized income & expense entries (Date, Description, Amount, Category, Client, Invoice, VAT %).',
      formats: '.csv, .xlsx, .xls',
      icon: ReceiptText,
      accent: 'text-indigo',
    },
    {
      id: 'database_backup',
      title: t('import.backup'),
      subtitle:
        'Restore a full AES-256-GCM encrypted Koban SQLite database (.db) or JSON backup snapshot.',
      formats: '.db, .sqlite, .json',
      icon: Database,
      accent: 'text-accent',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div
        className={`w-full ${
          previewData ? 'max-w-4xl' : 'max-w-xl'
        } bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden my-auto transition-all`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={
            importKind === 'database_backup'
              ? '.db,.sqlite,.json'
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
                  ? `Review the parsed data from "${previewData.fileName}" before applying changes to your ledger`
                  : 'Import spreadsheets, transaction CSVs, or encrypted database backups'}
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
          <div className="p-6 space-y-5">
            {/* 1. Select Import Type */}
            <div className="space-y-2">
              <label className="block text-xs uppercase tracking-[0.12em] text-ink-3 font-medium">
                1. Select What to Import
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

            {/* 2. Target Workspace or Backup Passphrase */}
            {importKind !== 'database_backup' ? (
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-app border border-line">
                <div>
                  <div className="text-xs font-medium text-ink">
                    Target Workspace & Month ({monthKey})
                  </div>
                  <p className="text-[11px] text-ink-3">
                    Choose which ledger workspace receives the imported items
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
                    Home Budget
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
                    Freelancer
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-app border border-line space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-ink">
                  <Lock className="w-3.5 h-3.5 text-positive" />
                  <span>Optional Vault Passphrase</span>
                </div>
                <p className="text-[11px] text-ink-2">
                  Leave empty if the backup uses Koban&apos;s default
                  AES-256-GCM vault key, or enter your custom passphrase if you
                  configured one.
                </p>
                <input
                  type="password"
                  placeholder="Optional custom vault passphrase…"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  className="w-full h-8 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none"
                />
              </div>
            )}

            {/* 3. Preview & Confirmation Behavior Toggle */}
            <label className="flex items-start justify-between gap-3 p-3 rounded-xl bg-app/70 border border-line cursor-pointer">
              <div className="flex items-start gap-2.5">
                <Eye className="w-4 h-4 text-indigo shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-medium text-ink">
                    Preview data and require confirmation before completing
                    import
                  </div>
                  <p className="text-[11px] text-ink-3 mt-0.5">
                    Inspect all parsed rows and totals before committing to the
                    ledger. You can also change this anytime in Settings &
                    Behavior.
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

            {/* Footer */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-line">
              <button
                type="button"
                onClick={handleCloseAll}
                className="h-9 px-4 rounded-lg text-xs text-ink-2 hover:text-ink hover:bg-raised cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={handleActionClick}
                className="h-9 px-5 inline-flex items-center gap-2 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
              >
                {confirmAndPreviewBeforeImport ? (
                  <Eye className="w-3.5 h-3.5" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                <span>
                  {isBusy
                    ? 'Reading File…'
                    : confirmAndPreviewBeforeImport
                      ? 'Select File & Preview Import…'
                      : 'Select File & Import Immediately…'}
                </span>
              </button>
            </div>
          </div>
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
                      • Target:{' '}
                      <strong className="text-ink capitalize">
                        {previewData.targetMode}
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
                    Show non-zero rows only ({budgetMetrics.nonZeroCount} of{' '}
                    {previewData.budgetRows?.length ?? 0})
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
                      Categories Parsed
                    </div>
                    <div className="text-sm font-semibold text-ink mt-0.5 tabular-nums">
                      {previewData.budgetRows?.length ?? 0} rows
                    </div>
                    <div className="text-[11px] text-ink-2 mt-0.5">
                      {budgetMetrics.newCount} new •{' '}
                      {budgetMetrics.nonZeroCount} active
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      Income (Budget / Actual)
                    </div>
                    <div className="text-sm font-semibold text-positive mt-0.5 tabular-nums">
                      {formatCurrency(budgetMetrics.incomeBudget, currency)}
                    </div>
                    <div className="text-[11px] text-ink-2 mt-0.5 tabular-nums">
                      Actual:{' '}
                      {formatCurrency(budgetMetrics.incomeActual, currency)}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      Outflows (Budget / Actual)
                    </div>
                    <div className="text-sm font-semibold text-ink mt-0.5 tabular-nums">
                      {formatCurrency(budgetMetrics.outflowBudget, currency)}
                    </div>
                    <div className="text-[11px] text-ink-2 mt-0.5 tabular-nums">
                      Actual:{' '}
                      {formatCurrency(budgetMetrics.outflowActual, currency)}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      Net Cashflow Preview
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
                      Planned Net:{' '}
                      {formatCurrency(budgetMetrics.netBudget, currency)}
                    </div>
                  </div>
                </div>

                <div className="border border-line rounded-xl overflow-hidden bg-app">
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-raised border-b border-line text-[10px] uppercase tracking-wider text-ink-3">
                        <tr>
                          <th className="py-2 px-2.5 w-8 text-center">✓</th>
                          <th className="py-2 px-3">Group</th>
                          <th className="py-2 px-3">Category</th>
                          <th className="py-2 px-2.5">Action</th>
                          <th className="py-2 px-3 text-right">
                            Budget ({currency})
                          </th>
                          <th className="py-2 px-3 text-right">
                            Actual ({currency})
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
                                {row.groupName}
                              </td>
                              <td className="py-1.5 px-3 font-medium text-ink">
                                {row.categoryName}
                              </td>
                              <td className="py-1.5 px-2.5">
                                {row.isNewCategory ? (
                                  <span className="px-1.5 py-0.5 rounded bg-positive/12 text-positive text-[10px] font-medium">
                                    New
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded bg-raised text-ink-2 text-[10px]">
                                    Update
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
                      Entries to Import
                    </div>
                    <div className="text-sm font-semibold text-ink mt-0.5 tabular-nums">
                      {previewData.transactionRows?.length ?? 0} transactions
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      Income ({txMetrics.incomeCount})
                    </div>
                    <div className="text-sm font-semibold text-positive mt-0.5 tabular-nums">
                      {formatCurrency(txMetrics.incomeTotal, currency)}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      Expenses ({txMetrics.expenseCount})
                    </div>
                    <div className="text-sm font-semibold text-ink mt-0.5 tabular-nums">
                      {formatCurrency(txMetrics.expenseTotal, currency)}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      Net Transaction Total
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
                          <th className="py-2 px-3">Date</th>
                          <th className="py-2 px-2.5">Type</th>
                          <th className="py-2 px-3">Category</th>
                          <th className="py-2 px-3">Description</th>
                          <th className="py-2 px-3 text-right">
                            Amount ({currency})
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
                                {tx.type}
                              </span>
                            </td>
                            <td className="py-1.5 px-3 text-ink-2">
                              {tx.categoryName}
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
                      Confirmation Required:
                    </span>{' '}
                    Restoring this backup snapshot will replace your current
                    active ledger with the contents of{' '}
                    <strong>{previewData.fileName}</strong>.
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      Groups & Categories
                    </div>
                    <div className="text-sm font-semibold text-ink mt-0.5 tabular-nums">
                      {previewData.proposedState.groups?.length ?? 0} groups •{' '}
                      {previewData.proposedState.categories?.length ?? 0} cats
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      Financial Accounts
                    </div>
                    <div className="text-sm font-semibold text-ink mt-0.5 tabular-nums">
                      {previewData.proposedState.accounts?.length ?? 0} accounts
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      Transactions & Rules
                    </div>
                    <div className="text-sm font-semibold text-ink mt-0.5 tabular-nums">
                      {previewData.proposedState.transactions?.length ?? 0} txs
                      • {previewData.proposedState.recurringRules?.length ?? 0}{' '}
                      rules
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-app border border-line">
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      Backup Currency & Period
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
                      Accounts Included in Backup Snapshot
                    </div>
                    <div className="max-h-48 overflow-y-auto divide-y divide-line/60">
                      {(previewData.proposedState.accounts ?? []).map((acc) => (
                        <div
                          key={acc.id}
                          className="px-3 py-2 bg-surface flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-medium text-ink">
                              {acc.name}
                            </span>
                            <span className="text-ink-3 ml-2 text-[11px] capitalize">
                              ({acc.classification})
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
                      ? 'Completing Import…'
                      : `Confirm & Complete Import (${
                          previewData.kind === 'transactions'
                            ? `${txMetrics.selectedCount} transactions`
                            : previewData.kind === 'budget_sheet'
                              ? `${budgetMetrics.selectedCount} categories`
                              : `${previewData.importedCount} records`
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
