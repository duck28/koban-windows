import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  Check,
  CheckCircle2,
  Columns,
  Filter,
  Search,
  Sparkles,
  Tag,
} from 'lucide-react';
import {
  BankAmountMode,
  BankDateFormat,
  BankDecimalSeparator,
  BankImportProfile,
  CategoryItem,
  ImportRule,
  ImportRuleMatchField,
  ImportRuleMatchType,
  LedgerMode,
  LedgerState,
} from '../types';
import {
  BankStatementParseResult,
  BUILTIN_BANK_PROFILES,
  extractRawTransactionsFromMatrix,
  RawBankTransaction,
  reparseBankStatementWithProfile,
  stageBankTransactions,
  StagedBankTransaction,
  suggestRulePattern,
} from '../utils/bankImport';
import { formatCurrency, formatNumber } from '../utils/calculations';
import { useI18n } from '../i18n';
import { KobanSelect, KobanSelectOption } from './KobanSelect';

interface BankImportReviewProps {
  parseResult: BankStatementParseResult;
  state: LedgerState;
  targetMode: LedgerMode;
  accountId?: string;
  currency: string;
  watchedFilePath?: string;
  isBusy: boolean;
  onBack: () => void;
  onCancel: () => void;
  onConfirmCommit: (params: {
    stagedRows: StagedBankTransaction[];
    savedProfile?: BankImportProfile;
    savedRules: ImportRule[];
    archiveWatchedFile: boolean;
  }) => Promise<void>;
}

type ReviewFilterTab =
  | 'all'
  | 'needs_review'
  | 'auto'
  | 'duplicates'
  | 'transfers';

export const BankImportReview: React.FC<BankImportReviewProps> = ({
  parseResult,
  state,
  targetMode,
  accountId,
  currency,
  watchedFilePath,
  isBusy,
  onBack,
  onCancel,
  onConfirmCommit,
}) => {
  const { t, tCategoryName } = useI18n();

  const [activeParseResult, setActiveParseResult] =
    useState<BankStatementParseResult>(parseResult);
  const [selectedBankId, setSelectedBankId] = useState<string>(
    parseResult.selectedProfileId ?? 'auto'
  );

  const hasTabularMapping = Boolean(
    activeParseResult.rawRows &&
      activeParseResult.rawRows.length > 0 &&
      (activeParseResult.format === 'csv' ||
        activeParseResult.format === 'spreadsheet')
  );

  const [headerRowIndex, setHeaderRowIndex] = useState<number>(
    activeParseResult.headerRowIndex ?? 0
  );
  const currentHeaders = useMemo(() => {
    if (!activeParseResult.rawRows || !activeParseResult.rawRows[headerRowIndex]) {
      return activeParseResult.headers ?? [];
    }
    const seen = new Map<string, number>();
    return activeParseResult.rawRows[headerRowIndex].map((raw, idx) => {
      const base = raw.trim() || `Column ${idx + 1}`;
      const c = seen.get(base) ?? 0;
      seen.set(base, c + 1);
      return c === 0 ? base : `${base} (${c + 1})`;
    });
  }, [activeParseResult.rawRows, activeParseResult.headers, headerRowIndex]);

  const [mapping, setMapping] = useState<BankImportProfile>(() => {
    return (
      activeParseResult.activeMapping ?? {
        id: `prof-${Date.now()}`,
        name: 'Custom Bank CSV',
        accountId,
        headerFingerprint: (activeParseResult.headers ?? []).slice(0, 8),
        delimiter: activeParseResult.delimiter,
        dateColumn: activeParseResult.headers?.[0] ?? '',
        dateFormat: 'auto',
        amountMode: 'signed',
        amountColumn: activeParseResult.headers?.[1] ?? '',
        invertSign: false,
        decimalSeparator: 'auto',
        descriptionColumns: activeParseResult.headers?.slice(1, 3) ?? [],
        updatedAt: new Date().toISOString().slice(0, 10),
      }
    );
  });

  const [showMapping, setShowMapping] = useState<boolean>(
    Boolean(
      activeParseResult.rawRows &&
        activeParseResult.rawRows.length > 0 &&
        (activeParseResult.format === 'csv' ||
          activeParseResult.format === 'spreadsheet') &&
        activeParseResult.needsMappingReview
    )
  );
  const [saveProfileToggle, setSaveProfileToggle] = useState<boolean>(
    activeParseResult.matchedProfileSource === 'auto'
  );
  const [profileName, setProfileName] = useState<string>(
    activeParseResult.matchedProfileSource === 'auto'
      ? activeParseResult.fileName.replace(/\.[^.]+$/, '')
      : activeParseResult.matchedProfile?.name ?? 'Bank CSV Profile'
  );

  const [rawTransactions, setRawTransactions] = useState<RawBankTransaction[]>(
    activeParseResult.rawTransactions
  );
  const [rules, setRules] = useState<ImportRule[]>(() => [
    ...(state.importRules ?? []),
  ]);
  const [stagedRows, setStagedRows] = useState<StagedBankTransaction[]>(() =>
    stageBankTransactions({
      rawTransactions: activeParseResult.rawTransactions,
      state,
      targetMode,
      accountId,
      rulesOverride: state.importRules ?? [],
    })
  );

  const bankSelectOptions: KobanSelectOption[] = useMemo(() => {
    const opts: KobanSelectOption[] = [
      {
        value: 'auto',
        label: t('bankImport.autoDetectBank'),
      },
    ];
    for (const p of state.importProfiles ?? []) {
      opts.push({
        value: p.id,
        label: p.name,
        group: t('bankImport.savedProfilesGroup'),
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
  }, [state.importProfiles, t]);

  const handleSwitchBank = (bankId: string) => {
    setSelectedBankId(bankId);
    const reparsed = reparseBankStatementWithProfile(activeParseResult, bankId, {
      savedProfiles: state.importProfiles ?? [],
      accountId,
      fallbackCurrency: currency,
    });
    setActiveParseResult(reparsed);
    setHeaderRowIndex(reparsed.headerRowIndex ?? 0);
    if (reparsed.activeMapping) {
      setMapping(reparsed.activeMapping);
    }
    setRawTransactions(reparsed.rawTransactions);
    setStagedRows(
      stageBankTransactions({
        rawTransactions: reparsed.rawTransactions,
        state,
        targetMode,
        accountId,
        rulesOverride: rules,
      })
    );
    setProfileName(
      reparsed.matchedProfileSource === 'auto'
        ? reparsed.fileName.replace(/\.[^.]+$/, '')
        : reparsed.matchedProfile?.name ?? 'Bank CSV Profile'
    );
    if (bankId === 'custom' || reparsed.needsMappingReview) {
      setShowMapping(true);
    }
  };

  const [manualCategoryIds] = useState<Set<string>>(() => new Set());
  const [filterTab, setFilterTab] = useState<ReviewFilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [archiveWatchedFile, setArchiveWatchedFile] = useState(
    Boolean(watchedFilePath)
  );

  // Inline + Rule editor state
  const [ruleDraftRowId, setRuleDraftRowId] = useState<string | null>(null);
  const [rulePattern, setRulePattern] = useState('');
  const [ruleMatchField, setRuleMatchField] =
    useState<ImportRuleMatchField>('any');
  const [ruleMatchType, setRuleMatchType] =
    useState<ImportRuleMatchType>('contains');
  const [rulePayee, setRulePayee] = useState('');
  const [ruleCategoryId, setRuleCategoryId] = useState('');
  const [ruleAccountScope, setRuleAccountScope] = useState(true);
  const [ruleBanner, setRuleBanner] = useState<string | null>(null);

  const availableCategories = useMemo(
    () => state.categories ?? [],
    [state.categories]
  );
  const catMap = useMemo(
    () => new Map<string, CategoryItem>(availableCategories.map((c) => [c.id, c])),
    [availableCategories]
  );

  const categoriesForRow = (row: StagedBankTransaction): CategoryItem[] => {
    const modeCats = availableCategories.filter((c) =>
      row.type === 'income' ? c.kind === 'income' : c.kind !== 'income'
    );
    const sameMode = modeCats.filter((c) => c.mode === row.mode);
    const otherMode = modeCats.filter((c) => c.mode !== row.mode);
    return [...sameMode, ...otherMode];
  };

  const liveMappingExtracted = useMemo(() => {
    if (!hasTabularMapping || !activeParseResult.rawRows) return [];
    const effectiveProfile: BankImportProfile = {
      ...mapping,
      headerFingerprint: currentHeaders.slice(0, 8),
    };
    return extractRawTransactionsFromMatrix(
      activeParseResult.rawRows,
      headerRowIndex,
      effectiveProfile,
      currency
    ).rawTransactions;
  }, [hasTabularMapping, activeParseResult.rawRows, mapping, currentHeaders, headerRowIndex, currency]);

  const applyMappingAndContinue = () => {
    const updatedProfile: BankImportProfile = {
      ...mapping,
      name: profileName.trim() || 'Bank CSV Profile',
      accountId,
      defaultMode: targetMode,
      headerFingerprint: currentHeaders.slice(0, 8),
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    setMapping(updatedProfile);
    const nextRaw = liveMappingExtracted;
    setRawTransactions(nextRaw);
    setActiveParseResult((prev) => ({
      ...prev,
      headerRowIndex,
      headers: currentHeaders,
      matchedProfile: updatedProfile,
      activeMapping: updatedProfile,
      rawTransactions: nextRaw,
      warnings: [],
      needsMappingReview: false,
    }));
    setStagedRows(
      stageBankTransactions({
        rawTransactions: nextRaw,
        state,
        targetMode,
        accountId,
        rulesOverride: rules,
      })
    );
    setShowMapping(false);
  };

  const metrics = useMemo(() => {
    let selected = 0;
    let needsReview = 0;
    let duplicates = 0;
    let transfers = 0;
    let autoCount = 0;
    let incomeTotal = 0;
    let expenseTotal = 0;
    let uncategorizedSelected = 0;

    for (const r of stagedRows) {
      if (r.confidence === 'needs_review' && !r.categoryId) needsReview++;
      else if (r.confidence !== 'needs_review') autoCount++;
      if (r.duplicateStatus !== 'none') duplicates++;
      if (r.isTransferCandidate) transfers++;
      if (r.included) {
        selected++;
        if (!r.categoryId) uncategorizedSelected++;
        if (r.type === 'income') incomeTotal += r.amount;
        else expenseTotal += r.amount;
      }
    }
    return {
      selected,
      needsReview,
      autoCount,
      duplicates,
      transfers,
      incomeTotal,
      expenseTotal,
      netTotal: incomeTotal - expenseTotal,
      uncategorizedSelected,
    };
  }, [stagedRows]);

  const visibleRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return stagedRows.filter((r) => {
      if (filterTab === 'needs_review' && (r.categoryId !== null || r.confidence !== 'needs_review')) {
        return false;
      }
      if (filterTab === 'auto' && r.confidence === 'needs_review') return false;
      if (filterTab === 'duplicates' && r.duplicateStatus === 'none') return false;
      if (filterTab === 'transfers' && !r.isTransferCandidate) return false;
      if (q) {
        const hay = `${r.description} ${r.rawDescription} ${r.date}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [stagedRows, filterTab, searchQuery]);

  const updateRow = (
    id: string,
    patch: Partial<StagedBankTransaction>
  ) => {
    setStagedRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  };

  const assignRowCategory = (row: StagedBankTransaction, catId: string) => {
    manualCategoryIds.add(row.id);
    const cat = catMap.get(catId);
    updateRow(row.id, {
      categoryId: catId || null,
      mode: cat?.mode ?? row.mode,
      taxRate: cat?.taxRate ?? row.taxRate,
      deductiblePct: cat?.deductiblePct ?? row.deductiblePct,
      confidence: cat ? 'rule' : 'needs_review',
      matchReason: cat ? 'Manual selection' : 'Needs manual category review',
    });
  };

  const applyBulkCategory = () => {
    if (!bulkCategoryId) return;
    const cat = catMap.get(bulkCategoryId);
    if (!cat) return;
    const visibleSet = new Set(visibleRows.map((r) => r.id));
    setStagedRows((prev) =>
      prev.map((r) => {
        if (!r.included || !visibleSet.has(r.id)) return r;
        manualCategoryIds.add(r.id);
        return {
          ...r,
          categoryId: cat.id,
          mode: cat.mode,
          taxRate: cat.taxRate ?? r.taxRate,
          deductiblePct: cat.deductiblePct ?? r.deductiblePct,
          confidence: 'rule',
          matchReason: 'Bulk assigned',
        };
      })
    );
    setBulkCategoryId('');
  };

  const openInlineRuleEditor = (row: StagedBankTransaction) => {
    if (ruleDraftRowId === row.id) {
      setRuleDraftRowId(null);
      return;
    }
    const defaultCat =
      row.categoryId ||
      categoriesForRow(row)[0]?.id ||
      availableCategories[0]?.id ||
      '';
    setRuleDraftRowId(row.id);
    setRulePattern(suggestRulePattern(row.raw.rawPayee, row.raw.rawDescription));
    setRuleMatchField('any');
    setRuleMatchType('contains');
    setRulePayee(row.description);
    setRuleCategoryId(defaultCat);
    setRuleAccountScope(Boolean(accountId));
  };

  const saveInlineRule = () => {
    const trimmedPat = rulePattern.trim();
    if (!trimmedPat || !ruleCategoryId) return;
    const cat = catMap.get(ruleCategoryId);
    const nowStr = new Date().toISOString().slice(0, 10);
    const newRule: ImportRule = {
      id: `imprule-${Date.now()}`,
      name: rulePayee.trim() || trimmedPat,
      enabled: true,
      priority: rules.length + 1,
      accountId: ruleAccountScope ? accountId : undefined,
      direction: 'any',
      matchField: ruleMatchField,
      matchType: ruleMatchType,
      pattern: trimmedPat,
      setCategoryId: ruleCategoryId,
      setMode: cat?.mode,
      setPayee: rulePayee.trim() || undefined,
      setTaxRate: cat?.taxRate,
      setDeductiblePct: cat?.deductiblePct,
      createdAt: nowStr,
      updatedAt: nowStr,
    };

    const nextRules = [newRule, ...rules].map((r, idx) => ({
      ...r,
      priority: idx + 1,
    }));
    setRules(nextRules);

    // Immediately re-run staging so all other matching rows update live
    const restaged = stageBankTransactions({
      rawTransactions,
      state,
      targetMode,
      accountId,
      rulesOverride: nextRules,
    });

    let updatedCount = 0;
    setStagedRows((prev) =>
      prev.map((oldRow, idx) => {
        const fresh = restaged[idx];
        if (!fresh) return oldRow;
        if (fresh.matchedRuleId === newRule.id) {
          updatedCount++;
          return {
            ...fresh,
            included: oldRow.included,
          };
        }
        return oldRow;
      })
    );

    setRuleDraftRowId(null);
    setRuleBanner(
      t('bankImport.ruleAppliedCount').replace('{count}', String(updatedCount))
    );
  };

  const confidenceBadge = (row: StagedBankTransaction) => {
    if (row.duplicateStatus === 'exact_duplicate') {
      return (
        <span
          title={row.duplicateOfLabel}
          className="px-1.5 py-0.5 rounded bg-raised text-ink-3 text-[10px] font-medium"
        >
          {t('bankImport.badgeDuplicate')}
        </span>
      );
    }
    if (row.duplicateStatus === 'possible_duplicate') {
      return (
        <span
          title={row.duplicateOfLabel}
          className="px-1.5 py-0.5 rounded bg-accent/12 text-accent text-[10px] font-medium"
        >
          {t('bankImport.badgePossibleDup')}
        </span>
      );
    }
    if (row.isTransferCandidate) {
      return (
        <span
          title={row.transferHint}
          className="px-1.5 py-0.5 rounded bg-indigo/12 text-indigo text-[10px] font-medium"
        >
          {t('bankImport.badgeTransfer')}
        </span>
      );
    }
    switch (row.confidence) {
      case 'rule':
        return (
          <span
            title={row.matchReason}
            className="px-1.5 py-0.5 rounded bg-positive/12 text-positive text-[10px] font-medium"
          >
            {t('bankImport.badgeRule')}
          </span>
        );
      case 'history':
        return (
          <span
            title={row.matchReason}
            className="px-1.5 py-0.5 rounded bg-indigo/12 text-indigo text-[10px] font-medium"
          >
            {t('bankImport.badgeHistory')}
          </span>
        );
      case 'keyword':
        return (
          <span
            title={row.matchReason}
            className="px-1.5 py-0.5 rounded bg-raised text-ink-2 text-[10px] font-medium"
          >
            {t('bankImport.badgeAuto')}
          </span>
        );
      default:
        return (
          <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent text-[10px] font-medium">
            {t('bankImport.badgeReview')}
          </span>
        );
    }
  };

  // ==================== COLUMN MAPPER STEP ====================
  if (showMapping && hasTabularMapping && activeParseResult.rawRows) {
    const sampleRows = activeParseResult.rawRows.slice(
      Math.max(0, headerRowIndex),
      headerRowIndex + 6
    );
    const headerColOptions: KobanSelectOption[] = currentHeaders.map((h) => ({
      value: h,
      label: h,
    }));
    const optionalColOptions: KobanSelectOption[] = [
      { value: '', label: '— None —' },
      ...headerColOptions,
    ];
    return (
      <div className="p-6 space-y-4">
        <div className="p-3.5 rounded-xl bg-indigo/8 border border-indigo/25 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Columns className="w-4 h-4 text-indigo shrink-0" />
            <div>
              <span className="font-semibold text-ink">
                {t('bankImport.mapperTitle')}
              </span>
              <span className="text-ink-2 ml-2">
                {activeParseResult.fileName} ·{' '}
                {liveMappingExtracted.length} {t('bankImport.rowsParsed')}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-ink-2">
                {t('bankImport.switchBankLabel')}:
              </span>
              <KobanSelect
                value={selectedBankId}
                onChange={handleSwitchBank}
                options={bankSelectOptions}
                tone="surface"
                size="xs"
                searchable
                className="w-52"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] text-ink-2">
                {t('bankImport.headerRow')}:
              </label>
              <input
                type="number"
                min={1}
                max={Math.max(1, Math.min(40, activeParseResult.rawRows.length))}
                value={headerRowIndex + 1}
                onChange={(e) =>
                  setHeaderRowIndex(
                    Math.max(
                      0,
                      Math.min(
                        (activeParseResult.rawRows?.length ?? 1) - 1,
                        (Number(e.target.value) || 1) - 1
                      )
                    )
                  )
                }
                className="w-16 h-7 px-2 rounded bg-surface border border-line text-xs text-ink tabular-nums"
              />
            </div>
          </div>
        </div>

        {activeParseResult.warnings.length > 0 && (
          <div className="px-3.5 py-2.5 rounded-xl bg-accent/10 border border-accent/30 flex items-start gap-2 text-xs text-ink">
            <AlertTriangle className="w-4 h-4 text-accent shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              {activeParseResult.warnings.map((w, idx) => (
                <div key={idx}>{w}</div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] text-ink-2 mb-1">
              {t('bankImport.dateCol')}
            </label>
            <KobanSelect
              value={mapping.dateColumn}
              onChange={(v) => setMapping({ ...mapping, dateColumn: v })}
              options={headerColOptions}
              size="sm"
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-[11px] text-ink-2 mb-1">
              {t('bankImport.dateFormat')}
            </label>
            <KobanSelect
              value={mapping.dateFormat}
              onChange={(v) =>
                setMapping({
                  ...mapping,
                  dateFormat: v as BankDateFormat,
                })
              }
              size="sm"
              className="w-full"
              options={[
                { value: 'auto', label: 'Auto-detect' },
                { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
                { value: 'DD.MM.YYYY', label: 'DD.MM.YYYY' },
                { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
                { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
                { value: 'YYYYMMDD', label: 'YYYYMMDD' },
              ]}
            />
          </div>

          <div>
            <label className="block text-[11px] text-ink-2 mb-1">
              {t('bankImport.decimalSep')}
            </label>
            <KobanSelect
              value={mapping.decimalSeparator}
              onChange={(v) =>
                setMapping({
                  ...mapping,
                  decimalSeparator: v as BankDecimalSeparator,
                })
              }
              size="sm"
              className="w-full"
              options={[
                { value: 'auto', label: 'Auto' },
                { value: '.', label: "Dot (1,234.56 / 1'234.56)" },
                { value: ',', label: 'Comma (1.234,56)' },
              ]}
            />
          </div>

          <div>
            <label className="block text-[11px] text-ink-2 mb-1">
              {t('bankImport.amountMode')}
            </label>
            <KobanSelect
              value={mapping.amountMode}
              onChange={(v) =>
                setMapping({
                  ...mapping,
                  amountMode: v as BankAmountMode,
                })
              }
              size="sm"
              className="w-full"
              options={[
                { value: 'signed', label: 'Single Signed Amount' },
                { value: 'split_debit_credit', label: 'Separate Debit & Credit' },
              ]}
            />
          </div>

          {mapping.amountMode === 'signed' ? (
            <div>
              <label className="block text-[11px] text-ink-2 mb-1">
                {t('bankImport.amountCol')}
              </label>
              <KobanSelect
                value={mapping.amountColumn ?? ''}
                onChange={(v) => setMapping({ ...mapping, amountColumn: v })}
                options={optionalColOptions}
                size="sm"
                className="w-full"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[11px] text-ink-2 mb-1">
                  {t('bankImport.debitCol')}
                </label>
                <KobanSelect
                  value={mapping.debitColumn ?? ''}
                  onChange={(v) => setMapping({ ...mapping, debitColumn: v })}
                  options={optionalColOptions}
                  size="sm"
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-[11px] text-ink-2 mb-1">
                  {t('bankImport.creditCol')}
                </label>
                <KobanSelect
                  value={mapping.creditColumn ?? ''}
                  onChange={(v) => setMapping({ ...mapping, creditColumn: v })}
                  options={optionalColOptions}
                  size="sm"
                  className="w-full"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-[11px] text-ink-2 mb-1">
              {t('bankImport.descriptionCol')}
            </label>
            <KobanSelect
              value={mapping.descriptionColumns[0] ?? ''}
              onChange={(v) =>
                setMapping({
                  ...mapping,
                  descriptionColumns: v
                    ? [
                        v,
                        ...mapping.descriptionColumns
                          .slice(1)
                          .filter((c) => c !== v),
                      ]
                    : [],
                })
              }
              options={optionalColOptions}
              size="sm"
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-[11px] text-ink-2 mb-1">
              {t('bankImport.payeeCol')}
            </label>
            <KobanSelect
              value={mapping.payeeColumn ?? ''}
              onChange={(v) =>
                setMapping({
                  ...mapping,
                  payeeColumn: v || undefined,
                })
              }
              options={optionalColOptions}
              size="sm"
              className="w-full"
            />
          </div>

          <div className="flex items-end pb-1">
            <label className="inline-flex items-center gap-2 text-xs text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={mapping.invertSign}
                onChange={(e) =>
                  setMapping({ ...mapping, invertSign: e.target.checked })
                }
                className="rounded border-line"
              />
              <span>{t('bankImport.invertSign')}</span>
            </label>
          </div>
        </div>

        {/* Sample Table */}
        <div className="border border-line rounded-xl overflow-x-auto bg-app max-h-48">
          <table className="w-full text-left border-collapse text-[11px]">
            <tbody>
              {sampleRows.map((row, rIdx) => (
                <tr
                  key={rIdx}
                  className={
                    rIdx === 0
                      ? 'bg-raised font-semibold text-ink border-b border-line'
                      : 'border-b border-line/50 text-ink-2'
                  }
                >
                  {currentHeaders.map((_, cIdx) => (
                    <td
                      key={cIdx}
                      className="px-2.5 py-1.5 whitespace-nowrap max-w-44 truncate"
                    >
                      {row[cIdx] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Save Profile Option */}
        <div className="p-3 rounded-xl bg-app border border-line flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={saveProfileToggle}
              onChange={(e) => setSaveProfileToggle(e.target.checked)}
              className="rounded border-line"
            />
            <span>{t('bankImport.saveProfileLabel')}</span>
          </label>
          {saveProfileToggle && (
            <input
              type="text"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="e.g. UBS Main Checking"
              className="flex-1 min-w-48 h-8 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink"
            />
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-line">
          <button
            type="button"
            onClick={onBack}
            className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink hover:bg-raised cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{t('import.chooseOther')}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="h-9 px-4 rounded-lg text-xs text-ink-2 hover:text-ink hover:bg-raised cursor-pointer"
            >
              {t('import.cancel')}
            </button>
            <button
              type="button"
              disabled={liveMappingExtracted.length === 0}
              onClick={applyMappingAndContinue}
              className="h-9 px-5 inline-flex items-center gap-2 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 disabled:opacity-45 cursor-pointer"
            >
              <span>
                {t('bankImport.reviewTransactions')} ({liveMappingExtracted.length})
              </span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==================== STAGED REVIEW INBOX ====================
  const filterButtons: { id: ReviewFilterTab; label: string; count: number }[] = [
    { id: 'all', label: t('bankImport.filterAll'), count: stagedRows.length },
    {
      id: 'needs_review',
      label: t('bankImport.filterNeedsReview'),
      count: metrics.needsReview,
    },
    {
      id: 'auto',
      label: t('bankImport.filterAuto'),
      count: metrics.autoCount,
    },
    {
      id: 'duplicates',
      label: t('bankImport.filterDuplicates'),
      count: metrics.duplicates,
    },
    {
      id: 'transfers',
      label: t('bankImport.filterTransfers'),
      count: metrics.transfers,
    },
  ];

  return (
    <div className="p-6 space-y-4">
      {/* Top context strip */}
      <div className="p-3 rounded-xl bg-indigo/8 border border-indigo/25 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo shrink-0" />
          <div>
            <span className="font-semibold text-ink">
              {activeParseResult.fileName}
            </span>
            <span className="text-ink-2 ml-2">
              · {activeParseResult.format.toUpperCase()}
              {activeParseResult.matchedProfile?.name
                ? ` · ${activeParseResult.matchedProfile.name}`
                : ''}
              {activeParseResult.detectedAccountIban
                ? ` · ${activeParseResult.detectedAccountIban}`
                : ''}
            </span>
          </div>
        </div>
        {hasTabularMapping && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-ink-2">
                {t('bankImport.switchBankLabel')}:
              </span>
              <KobanSelect
                value={selectedBankId}
                onChange={handleSwitchBank}
                options={bankSelectOptions}
                tone="surface"
                size="xs"
                searchable
                className="w-52"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowMapping(true)}
              className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md bg-surface border border-line text-[11px] text-ink hover:bg-raised cursor-pointer"
            >
              <Columns className="w-3 h-3" />
              <span>{t('bankImport.editMapping')}</span>
            </button>
          </div>
        )}
      </div>

      {activeParseResult.warnings.length > 0 && (
        <div className="px-3.5 py-2.5 rounded-xl bg-accent/10 border border-accent/30 flex items-start gap-2 text-xs text-ink">
          <AlertTriangle className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            {activeParseResult.warnings.map((w, idx) => (
              <div key={idx}>{w}</div>
            ))}
          </div>
        </div>
      )}

      {ruleBanner && (
        <div className="px-3 py-2 rounded-lg bg-positive/12 border border-positive/25 text-xs text-positive flex items-center justify-between">
          <span>{ruleBanner}</span>
          <button
            type="button"
            onClick={() => setRuleBanner(null)}
            className="text-[11px] underline cursor-pointer"
          >
            {t('common.close')}
          </button>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-xl bg-app border border-line">
          <div className="text-[10px] uppercase tracking-wider text-ink-3">
            {t('bankImport.selectedCount')}
          </div>
          <div className="text-sm font-semibold text-ink mt-0.5 tabular-nums">
            {metrics.selected} / {stagedRows.length}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-app border border-line">
          <div className="text-[10px] uppercase tracking-wider text-ink-3">
            {t('bankImport.filterNeedsReview')}
          </div>
          <div
            className={`text-sm font-semibold mt-0.5 tabular-nums ${
              metrics.needsReview > 0 ? 'text-accent' : 'text-positive'
            }`}
          >
            {metrics.needsReview}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-app border border-line">
          <div className="text-[10px] uppercase tracking-wider text-ink-3">
            {t('bankImport.dupsAndTransfers')}
          </div>
          <div className="text-sm font-semibold text-ink mt-0.5 tabular-nums">
            {metrics.duplicates} · {metrics.transfers}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-app border border-line">
          <div className="text-[10px] uppercase tracking-wider text-ink-3">
            {t('import.netTxTotal')}
          </div>
          <div
            className={`text-sm font-semibold mt-0.5 tabular-nums ${
              metrics.netTotal >= 0 ? 'text-positive' : 'text-ink'
            }`}
          >
            {formatCurrency(metrics.netTotal, currency)}
          </div>
        </div>
      </div>

      {/* Filters + search + bulk actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 bg-raised p-1 rounded-lg border border-line">
          {filterButtons.map((fb) => (
            <button
              key={fb.id}
              type="button"
              onClick={() => setFilterTab(fb.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] cursor-pointer transition-colors ${
                filterTab === fb.id
                  ? 'bg-surface text-ink font-medium shadow-2xs'
                  : 'text-ink-2 hover:text-ink'
              }`}
            >
              {fb.label} ({fb.count})
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-ink-3 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('tx.searchPlaceholder')}
              className="h-8 pl-8 pr-2.5 rounded-lg bg-app border border-line text-xs text-ink w-44 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() =>
              setStagedRows((prev) =>
                prev.map((r) => ({
                  ...r,
                  included: r.duplicateStatus === 'none',
                }))
              )
            }
            className="h-8 px-2.5 rounded-lg bg-surface border border-line text-[11px] text-ink-2 hover:text-ink cursor-pointer"
          >
            {t('bankImport.selectNonDuplicates')}
          </button>
        </div>
      </div>

      {/* Bulk assign bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-app border border-line text-xs">
        <div className="flex items-center gap-2 text-ink-2">
          <Filter className="w-3.5 h-3.5 text-ink-3" />
          <span>{t('bankImport.bulkAssignLabel')}:</span>
          <KobanSelect
            value={bulkCategoryId}
            onChange={setBulkCategoryId}
            placeholder={t('bankImport.pickCategory')}
            tone="surface"
            size="xs"
            searchable
            className="w-56"
            options={[
              { value: '', label: t('bankImport.pickCategory') },
              ...availableCategories.map((c): KobanSelectOption => ({
                value: c.id,
                label: tCategoryName(c),
                group: c.mode === 'freelancer' ? 'Freelancer / Biz' : 'Home',
              })),
            ]}
          />
          <button
            type="button"
            disabled={!bulkCategoryId}
            onClick={applyBulkCategory}
            className="h-7 px-2.5 rounded bg-ink text-on-ink text-[11px] font-medium disabled:opacity-40 cursor-pointer"
          >
            {t('common.apply')}
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            const anyChecked = visibleRows.some((r) => r.included);
            const visIds = new Set(visibleRows.map((r) => r.id));
            setStagedRows((prev) =>
              prev.map((r) =>
                visIds.has(r.id) ? { ...r, included: !anyChecked } : r
              )
            );
          }}
          className="text-[11px] text-ink-2 hover:text-ink underline cursor-pointer"
        >
          {visibleRows.some((r) => r.included)
            ? t('bankImport.uncheckVisible')
            : t('bankImport.checkVisible')}
        </button>
      </div>

      {/* Review table */}
      <div className="border border-line rounded-xl overflow-hidden bg-app">
        <div className="max-h-80 overflow-y-auto divide-y divide-line/60">
          {visibleRows.length === 0 ? (
            <div className="py-10 text-center text-xs text-ink-3">
              {t('bankImport.noMatchingRows')}
            </div>
          ) : (
            visibleRows.map((row) => {
              const rowCats = categoriesForRow(row);
              const isDraftOpen = ruleDraftRowId === row.id;
              return (
                <div
                  key={row.id}
                  className={`${
                    row.included ? 'bg-surface' : 'bg-app/70 opacity-60'
                  }`}
                >
                  <div className="px-3 py-2 flex flex-wrap items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={row.included}
                      onChange={(e) =>
                        updateRow(row.id, { included: e.target.checked })
                      }
                      className="rounded border-line cursor-pointer shrink-0"
                    />
                    <span className="tabular-nums text-[11px] text-ink-2 w-20 shrink-0">
                      {row.date}
                    </span>

                    <button
                      type="button"
                      onClick={() =>
                        updateRow(row.id, {
                          type: row.type === 'income' ? 'expense' : 'income',
                        })
                      }
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase w-11 text-center cursor-pointer shrink-0 ${
                        row.type === 'income'
                          ? 'bg-positive/12 text-positive'
                          : 'bg-raised text-ink-2'
                      }`}
                    >
                      {row.type === 'income' ? 'IN' : 'OUT'}
                    </button>

                    <div className="flex-1 min-w-44">
                      <input
                        type="text"
                        value={row.description}
                        onChange={(e) =>
                          updateRow(row.id, { description: e.target.value })
                        }
                        className="w-full h-7 px-2 rounded bg-app border border-line/70 text-xs text-ink font-medium focus:outline-none focus:border-ink"
                      />
                      {row.rawDescription &&
                        row.rawDescription !== row.description && (
                          <div className="text-[10px] text-ink-3 truncate mt-0.5 pl-0.5">
                            {row.rawDescription}
                          </div>
                        )}
                    </div>

                    <KobanSelect
                      value={row.categoryId ?? ''}
                      onChange={(v) => assignRowCategory(row, v)}
                      placeholder={t('bankImport.pickCategory')}
                      size="xs"
                      tone={row.categoryId ? 'default' : 'attention'}
                      searchable
                      className="w-48 shrink-0"
                      options={[
                        { value: '', label: t('bankImport.pickCategory') },
                        ...rowCats.map((c): KobanSelectOption => ({
                          value: c.id,
                          label: tCategoryName(c),
                          group:
                            c.mode === 'freelancer'
                              ? 'Freelancer / Biz'
                              : 'Home',
                        })),
                      ]}
                    />

                    <div className="w-24 text-right font-semibold tabular-nums shrink-0">
                      <span
                        className={
                          row.type === 'income' ? 'text-positive' : 'text-ink'
                        }
                      >
                        {row.type === 'income' ? '+' : '-'}
                        {formatNumber(row.amount)}
                      </span>
                    </div>

                    <div className="w-20 flex justify-center shrink-0">
                      {confidenceBadge(row)}
                    </div>

                    <button
                      type="button"
                      onClick={() => openInlineRuleEditor(row)}
                      title={t('bankImport.createRuleTip')}
                      className={`h-7 px-2 inline-flex items-center gap-1 rounded border text-[11px] cursor-pointer shrink-0 ${
                        isDraftOpen
                          ? 'bg-ink text-on-ink border-ink'
                          : 'bg-surface border-line text-ink-2 hover:text-ink hover:bg-raised'
                      }`}
                    >
                      <Tag className="w-3 h-3" />
                      <span>+ Rule</span>
                    </button>
                  </div>

                  {/* Inline quick-rule builder */}
                  {isDraftOpen && (
                    <div className="mx-3 mb-2.5 p-3 rounded-lg bg-raised/70 border border-line grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
                      <div>
                        <label className="block text-[10px] text-ink-3 mb-0.5">
                          {t('bankImport.rulePattern')}
                        </label>
                        <input
                          type="text"
                          value={rulePattern}
                          onChange={(e) => setRulePattern(e.target.value)}
                          className="w-full h-7 px-2 rounded bg-surface border border-line text-xs text-ink"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-ink-3 mb-0.5">
                          {t('bankImport.ruleMatch')}
                        </label>
                        <div className="flex gap-1">
                          <KobanSelect
                            value={ruleMatchField}
                            onChange={(v) =>
                              setRuleMatchField(v as ImportRuleMatchField)
                            }
                            tone="surface"
                            size="xs"
                            className="flex-1 text-[11px]"
                            options={[
                              { value: 'any', label: 'Any' },
                              { value: 'payee', label: 'Payee' },
                              { value: 'description', label: 'Desc' },
                              { value: 'iban', label: 'IBAN' },
                            ]}
                          />
                          <KobanSelect
                            value={ruleMatchType}
                            onChange={(v) =>
                              setRuleMatchType(v as ImportRuleMatchType)
                            }
                            tone="surface"
                            size="xs"
                            className="flex-1 text-[11px]"
                            options={[
                              { value: 'contains', label: 'Contains' },
                              { value: 'starts_with', label: 'Starts' },
                              { value: 'exact', label: 'Exact' },
                              { value: 'regex', label: 'Regex' },
                            ]}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] text-ink-3 mb-0.5">
                          {t('bankImport.ruleAssignCategory')}
                        </label>
                        <KobanSelect
                          value={ruleCategoryId}
                          onChange={setRuleCategoryId}
                          tone="surface"
                          size="xs"
                          searchable
                          className="w-full"
                          options={availableCategories.map((c): KobanSelectOption => ({
                            value: c.id,
                            label: tCategoryName(c),
                            group:
                              c.mode === 'freelancer'
                                ? 'Freelancer / Biz'
                                : 'Home',
                          }))}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-ink-3 mb-0.5">
                          {t('bankImport.ruleRenamePayee')}
                        </label>
                        <input
                          type="text"
                          value={rulePayee}
                          onChange={(e) => setRulePayee(e.target.value)}
                          placeholder="Optional clean merchant"
                          className="w-full h-7 px-2 rounded bg-surface border border-line text-xs text-ink"
                        />
                      </div>
                      <div className="sm:col-span-4 flex flex-wrap items-center justify-between gap-2 pt-1">
                        {accountId ? (
                          <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={ruleAccountScope}
                              onChange={(e) =>
                                setRuleAccountScope(e.target.checked)
                              }
                              className="rounded border-line"
                            />
                            <span>{t('bankImport.ruleThisAccountOnly')}</span>
                          </label>
                        ) : (
                          <span />
                        )}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setRuleDraftRowId(null)}
                            className="h-7 px-2.5 rounded text-[11px] text-ink-2 hover:text-ink cursor-pointer"
                          >
                            {t('common.cancel')}
                          </button>
                          <button
                            type="button"
                            disabled={!rulePattern.trim() || !ruleCategoryId}
                            onClick={saveInlineRule}
                            className="h-7 px-3 inline-flex items-center gap-1.5 rounded bg-ink text-on-ink text-[11px] font-medium disabled:opacity-45 cursor-pointer"
                          >
                            <BookmarkPlus className="w-3 h-3" />
                            <span>{t('bankImport.saveRuleAndApply')}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {metrics.uncategorizedSelected > 0 && (
        <div className="px-3 py-2 rounded-lg bg-accent/10 border border-accent/25 flex items-center gap-2 text-xs text-ink">
          <AlertTriangle className="w-4 h-4 text-accent shrink-0" />
          <span>
            {t('bankImport.uncategorizedWarning').replace(
              '{count}',
              String(metrics.uncategorizedSelected)
            )}
          </span>
        </div>
      )}

      {watchedFilePath && (
        <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
          <input
            type="checkbox"
            checked={archiveWatchedFile}
            onChange={(e) => setArchiveWatchedFile(e.target.checked)}
            className="rounded border-line"
          />
          <span>{t('bankImport.archiveAfterImport')}</span>
        </label>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-line">
        <button
          type="button"
          disabled={isBusy}
          onClick={onBack}
          className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink hover:bg-raised cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{t('import.chooseOther')}</span>
        </button>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            disabled={isBusy}
            onClick={onCancel}
            className="h-9 px-4 rounded-lg text-xs text-ink-2 hover:text-ink hover:bg-raised cursor-pointer"
          >
            {t('import.cancel')}
          </button>
          <button
            type="button"
            disabled={isBusy || metrics.selected === 0}
            onClick={() =>
              void onConfirmCommit({
                stagedRows,
                savedProfile: saveProfileToggle
                  ? {
                      ...mapping,
                      name: profileName.trim() || 'Bank CSV Profile',
                      accountId,
                      defaultMode: targetMode,
                      headerFingerprint: currentHeaders.slice(0, 8),
                      updatedAt: new Date().toISOString().slice(0, 10),
                    }
                  : undefined,
                savedRules: rules,
                archiveWatchedFile,
              })
            }
            className="h-9 px-5 inline-flex items-center gap-2 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 disabled:opacity-45 cursor-pointer"
          >
            {isBusy ? (
              <Check className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            <span>
              {t('import.confirm')} ({metrics.selected})
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
