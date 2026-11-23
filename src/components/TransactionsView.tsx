import React, { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Search,
  Trash2,
  ArrowUpRight,
  ArrowDownRight,
  FileDown,
  Upload,
  Filter,
  Landmark,
  X,
  Tag,
} from 'lucide-react';
import {
  ActiveWorkspace,
  CategoryGroup,
  CategoryItem,
  FinancialAccount,
  LedgerMode,
  TransactionItem,
} from '../types';
import { formatCurrency, isAccountTransfer } from '../utils/calculations';
import { useI18n } from '../i18n';

interface TransactionsViewProps {
  transactions: TransactionItem[];
  groups: CategoryGroup[];
  categories: CategoryItem[];
  accounts: FinancialAccount[];
  workspace: ActiveWorkspace;
  monthKey: string;
  currency: string;
  defaultVatRate: number;
  preselectedCategoryId: string | null;
  onClearPreselectedCategory: () => void;
  preselectedAccountId?: string | null;
  onClearPreselectedAccount?: () => void;
  onAddTransaction: (tx: Omit<TransactionItem, 'id'>) => void;
  onDeleteTransaction: (id: string) => void;
  onOpenImportModal: () => void;
  onOpenImportRulesModal?: () => void;
  onExportCsv: () => void;
  /** Keyboard shortcut request: focus the new-entry form (Ctrl+N) or the search box (Ctrl+F). */
  focusRequest?: { target: 'new' | 'search'; nonce: number } | null;
}

export const TransactionsView: React.FC<TransactionsViewProps> = ({
  focusRequest,
  transactions,
  groups,
  categories,
  accounts,
  workspace,
  monthKey,
  currency,
  defaultVatRate,
  preselectedCategoryId,
  onClearPreselectedCategory,
  preselectedAccountId,
  onClearPreselectedAccount,
  onAddTransaction,
  onDeleteTransaction,
  onOpenImportModal,
  onOpenImportRulesModal,
  onExportCsv,
}) => {
  const { t, tf, tGroupName, tCategoryName, tAccountName } = useI18n();
  const modeFilter = (m: LedgerMode) =>
    workspace === 'combined' ? true : m === workspace;

  const availableCategories = categories.filter((c) => modeFilter(c.mode));
  const availableAccounts = accounts.filter((a) => modeFilter(a.mode));
  const grpMap = new Map(groups.map((g) => [g.id, g]));
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const accMap = new Map(accounts.map((a) => [a.id, a]));

  const [date, setDate] = useState(`${monthKey}-08`);
  const [categoryId, setCategoryId] = useState(
    preselectedCategoryId || availableCategories[0]?.id || ''
  );
  const [accountId, setAccountId] = useState(
    preselectedAccountId || availableAccounts[0]?.id || ''
  );
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [client, setClient] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [taxRate, setTaxRate] = useState(String(defaultVatRate));
  const [deductiblePct, setDeductiblePct] = useState('100');

  const [searchQuery, setSearchQuery] = useState('');
  const descInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focusRequest) return;
    const el = focusRequest.target === 'search' ? searchInputRef.current : descInputRef.current;
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus();
    el.select();
  }, [focusRequest]);
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [accountFilter, setAccountFilter] = useState<string>(
    preselectedAccountId || 'all'
  );
  const [scopeFilter, setScopeFilter] = useState<'month' | 'year'>('month');

  useEffect(() => {
    setDate(`${monthKey}-08`);
  }, [monthKey]);

  useEffect(() => {
    if (preselectedAccountId) {
      setAccountFilter(preselectedAccountId);
      setAccountId(preselectedAccountId);
      setScopeFilter('year');
    }
  }, [preselectedAccountId]);

  useEffect(() => {
    if (preselectedCategoryId) {
      setCategoryId(preselectedCategoryId);
      const cat = catMap.get(preselectedCategoryId);
      if (cat) {
        setDescription(tCategoryName(cat));
        setTaxRate(String(cat.taxRate ?? 0));
        setDeductiblePct(String(cat.deductiblePct ?? 100));
      }
    } else if (
      availableCategories.length > 0 &&
      !availableCategories.some((c) => c.id === categoryId)
    ) {
      setCategoryId(availableCategories[0].id);
    }
  }, [preselectedCategoryId, workspace, categories]);

  const handleCategoryChange = (newCatId: string) => {
    setCategoryId(newCatId);
    const cat = catMap.get(newCatId);
    if (cat) {
      if (!description) setDescription(tCategoryName(cat));
      if (cat.taxRate !== undefined) setTaxRate(String(cat.taxRate));
      if (cat.deductiblePct !== undefined)
        setDeductiblePct(String(cat.deductiblePct));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmt = parseFloat(amount);
    if (!categoryId || Number.isNaN(numAmt) || numAmt <= 0) return;
    const cat = catMap.get(categoryId);
    if (!cat) return;

    const txMonthKey = date.slice(0, 7) || monthKey;
    const txType = cat.kind === 'income' ? 'income' : 'expense';
    const linkedAcc = accountId ? accMap.get(accountId) : undefined;

    onAddTransaction({
      date,
      monthKey: txMonthKey,
      mode: cat.mode,
      type: txType,
      categoryId: cat.id,
      accountId: accountId || undefined,
      description: description.trim() || tCategoryName(cat),
      amount: numAmt,
      client: client.trim() || undefined,
      invoiceRef: invoiceRef.trim() || undefined,
      taxRate: parseFloat(taxRate) || 0,
      deductiblePct: parseFloat(deductiblePct) || 0,
      paymentMethod: linkedAcc ? tAccountName(linkedAcc) : t('tx.general'),
      status: 'cleared',
    });

    setAmount('');
    setDescription('');
    setInvoiceRef('');
    if (preselectedCategoryId) onClearPreselectedCategory();
  };

  const selectedCat = catMap.get(categoryId);
  const showFreelancerFields =
    workspace !== 'home' || selectedCat?.mode === 'freelancer';

  const filteredTxs = transactions
    .filter((tx) => {
      if (!modeFilter(tx.mode)) return false;
      if (scopeFilter === 'month' && tx.monthKey !== monthKey) return false;
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
      if (accountFilter !== 'all' && tx.accountId !== accountFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const catObj = catMap.get(tx.categoryId);
        const grpObj = catObj ? grpMap.get(catObj.groupId) : undefined;
        const accObj = tx.accountId ? accMap.get(tx.accountId) : undefined;
        const catName = catObj?.name.toLowerCase() ?? '';
        const catLoc = catObj ? tCategoryName(catObj).toLowerCase() : '';
        const grpName = grpObj?.name.toLowerCase() ?? '';
        const grpLoc = grpObj ? tGroupName(grpObj).toLowerCase() : '';
        const accName = accObj?.name.toLowerCase() ?? '';
        const accLoc = accObj ? tAccountName(accObj).toLowerCase() : '';
        return (
          tx.description.toLowerCase().includes(q) ||
          catName.includes(q) ||
          catLoc.includes(q) ||
          grpName.includes(q) ||
          grpLoc.includes(q) ||
          accName.includes(q) ||
          accLoc.includes(q) ||
          (tx.client?.toLowerCase().includes(q) ?? false) ||
          (tx.invoiceRef?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  // Account-to-account transfers move money but are neither income nor spending
  const totalShownIncome = filteredTxs
    .filter((tx) => tx.type === 'income' && !isAccountTransfer(tx))
    .reduce((acc, tx) => acc + tx.amount, 0);
  const totalShownExpense = filteredTxs
    .filter((tx) => tx.type === 'expense' && !isAccountTransfer(tx))
    .reduce((acc, tx) => acc + tx.amount, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-normal text-ink tracking-tight">
            {t('tx.title')}
          </h1>
          <p className="text-xs text-ink-2 mt-0.5">
            {t('tx.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-raised p-0.5 rounded-lg border border-line text-xs">
            <button
              onClick={() => setScopeFilter('month')}
              className={`px-2.5 py-1 rounded-md cursor-pointer ${
                scopeFilter === 'month'
                  ? 'bg-surface text-ink font-medium shadow-2xs'
                  : 'text-ink-2 hover:text-ink'
              }`}
            >
              {tf('tx.thisMonth', { month: monthKey })}
            </button>
            <button
              onClick={() => setScopeFilter('year')}
              className={`px-2.5 py-1 rounded-md cursor-pointer ${
                scopeFilter === 'year'
                  ? 'bg-surface text-ink font-medium shadow-2xs'
                  : 'text-ink-2 hover:text-ink'
              }`}
            >
              {t('tx.allMonths')}
            </button>
          </div>

          <button
            onClick={onOpenImportModal}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-indigo" />
            <span>{t('tx.importBtn')}</span>
          </button>

          {onOpenImportRulesModal && (
            <button
              type="button"
              onClick={onOpenImportRulesModal}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer"
            >
              <Tag className="w-3.5 h-3.5 text-ink-3" />
              <span>{t('bankImport.manageRulesBtn')}</span>
            </button>
          )}

          <button
            onClick={onExportCsv}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>{t('tx.exportBtn')}</span>
          </button>
        </div>
      </div>

      {/* Quick Add Transaction Form */}
      <form
        onSubmit={handleSubmit}
        className="p-4 rounded-xl bg-surface border border-line space-y-3 shadow-2xs"
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3 font-semibold">
            {t('tx.logNew')}
          </span>
          {selectedCat && (
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                selectedCat.kind === 'income'
                  ? 'bg-positive/15 text-positive'
                  : 'bg-accent/15 text-accent'
              }`}
            >
              {selectedCat.kind === 'income' ? t('tx.incomeEntry') : t('tx.expenseOutflow')}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-[11px] text-ink-2 mb-1">{t('finance.date')}</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink focus:outline-none"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[11px] text-ink-2 mb-1">
              {t('finance.category')}
            </label>
            <select
              value={categoryId}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink focus:outline-none"
            >
              {groups
                .filter((g) => modeFilter(g.mode))
                .map((grp) => (
                  <optgroup
                    key={grp.id}
                    label={`${tGroupName(grp)} (${t(`workspace.${grp.mode}`).toUpperCase()})`}
                  >
                    {availableCategories
                      .filter((c) => c.groupId === grp.id)
                      .map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {tCategoryName(cat)}
                        </option>
                      ))}
                  </optgroup>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-ink-2 mb-1">
              {t('finance.account')}
            </label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink focus:outline-none"
            >
              <option value="">{t('tx.noSpecificAccount')}</option>
              {availableAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {tAccountName(acc)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-ink-2 mb-1">
              {t('tx.descPayeeLabel')}
            </label>
            <input
              ref={descInputRef}
              type="text"
              placeholder={t('tx.descPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink placeholder:text-ink-3 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] text-ink-2 mb-1">
              {tf('tx.amountCurrency', { currency })}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink tabular-nums text-right focus:outline-none"
              />
              <button
                type="submit"
                className="h-8 px-3.5 inline-flex items-center gap-1 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('common.add')}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Freelancer Optional Row: Client, Invoice #, VAT %, Deductible % */}
        {showFreelancerFields && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-line/60">
            <div>
              <label className="block text-[10px] text-ink-3 mb-1">
                {t('tx.clientProjectLabel')}
              </label>
              <input
                type="text"
                placeholder={t('tx.clientPlaceholder')}
                value={client}
                onChange={(e) => setClient(e.target.value)}
                className="w-full h-7 px-2 rounded bg-raised border border-line text-xs text-ink placeholder:text-ink-3 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] text-ink-3 mb-1">
                {t('tx.invoiceRefLabel')}
              </label>
              <input
                type="text"
                placeholder="e.g. INV-2026-04"
                value={invoiceRef}
                onChange={(e) => setInvoiceRef(e.target.value)}
                className="w-full h-7 px-2 rounded bg-raised border border-line text-xs text-ink placeholder:text-ink-3 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] text-ink-3 mb-1">
                {t('tx.vatRateLabel')}
              </label>
              <input
                type="number"
                step="0.1"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                className="w-full h-7 px-2 rounded bg-raised border border-line text-xs text-ink tabular-nums focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] text-ink-3 mb-1">
                {t('tx.taxDeductibleLabel')}
              </label>
              <select
                value={deductiblePct}
                onChange={(e) => setDeductiblePct(e.target.value)}
                className="w-full h-7 px-2 rounded bg-raised border border-line text-xs text-ink focus:outline-none"
              >
                <option value="100">{t('tx.ded100')}</option>
                <option value="50">{t('tx.ded50')}</option>
                <option value="0">{t('tx.ded0')}</option>
              </select>
            </div>
          </div>
        )}
      </form>

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={t('tx.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-8 pl-8 pr-7 rounded-lg bg-surface border border-line text-xs text-ink placeholder:text-ink-3 focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-surface border border-line rounded-lg p-0.5 text-xs">
            <Filter className="w-3.5 h-3.5 text-ink-3 ml-2 mr-1" />
            {(['all', 'income', 'expense'] as const).map((ft) => (
              <button
                key={ft}
                onClick={() => setTypeFilter(ft)}
                className={`px-2.5 py-1 rounded-md cursor-pointer ${
                  typeFilter === ft
                    ? 'bg-raised text-ink font-medium'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                {ft === 'all'
                  ? t('tx.filterAll')
                  : ft === 'income'
                    ? t('tx.filterIncome')
                    : t('tx.filterExpense')}
              </button>
            ))}
          </div>

          {availableAccounts.length > 0 && (
            <div className="flex items-center gap-1.5">
              <select
                value={accountFilter}
                onChange={(e) => {
                  setAccountFilter(e.target.value);
                  if (e.target.value === 'all' && onClearPreselectedAccount) {
                    onClearPreselectedAccount();
                  }
                }}
                className="h-8 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none"
              >
                <option value="all">{t('tx.allAccounts')}</option>
                {availableAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {tf('tx.accountPrefix', { name: tAccountName(acc) })}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 text-xs tabular-nums">
          <span className="text-ink-2">
            {t('tx.inflow')}{' '}
            <strong className="text-positive">
              {formatCurrency(totalShownIncome, currency)}
            </strong>
          </span>
          <span className="text-ink-2">
            {t('tx.outflow')}{' '}
            <strong className="text-ink">
              {formatCurrency(totalShownExpense, currency)}
            </strong>
          </span>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-raised/70 border-b border-line text-[11px] text-ink-2 font-semibold uppercase tracking-wider">
                <th className="py-2.5 px-3">{t('finance.date')}</th>
                <th className="py-2.5 px-3">{t('tx.colCategoryGroup')}</th>
                <th className="py-2.5 px-3">{t('finance.account')}</th>
                <th className="py-2.5 px-3">{t('finance.description')}</th>
                {showFreelancerFields && (
                  <>
                    <th className="py-2.5 px-3">{t('tx.colClientRef')}</th>
                    <th className="py-2.5 px-3 text-right">{t('tx.colTaxDed')}</th>
                  </>
                )}
                <th className="py-2.5 px-3 text-right">{t('finance.amount')}</th>
                <th className="py-2.5 px-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredTxs.length === 0 ? (
                <tr>
                  <td
                    colSpan={showFreelancerFields ? 8 : 6}
                    className="py-10 text-center text-ink-3"
                  >
                    {t('tx.emptyFilter')}
                  </td>
                </tr>
              ) : (
                filteredTxs.map((tx) => {
                  const cat = catMap.get(tx.categoryId);
                  const grp = cat ? grpMap.get(cat.groupId) : undefined;
                  const acc = tx.accountId ? accMap.get(tx.accountId) : undefined;
                  const isIncome = tx.type === 'income';
                  return (
                    <tr
                      key={tx.id}
                      className="group hover:bg-raised/50 transition-colors"
                    >
                      <td className="py-2.5 px-3 tabular-nums text-ink-2 whitespace-nowrap">
                        {tx.date}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: grp?.color ?? 'var(--ink-3)',
                            }}
                          />
                          <div>
                            <div className="text-ink font-medium">
                              {cat
                                ? tCategoryName(cat)
                                : isAccountTransfer(tx)
                                  ? t('tx.transferLabel')
                                  : t('tx.uncategorized')}
                            </div>
                            <div className="text-[10px] text-ink-3 uppercase tracking-wider">
                              {grp ? tGroupName(grp) : t(`workspace.${tx.mode}`)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        {acc ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-raised border border-line text-[11px] text-ink-2">
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: acc.color }}
                            />
                            <span>{tAccountName(acc)}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
                            <Landmark className="w-3 h-3" />
                            <span>{tx.paymentMethod || t('tx.general')}</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-ink">{tx.description}</td>
                      {showFreelancerFields && (
                        <>
                          <td className="py-2.5 px-3 text-ink-2">
                            {tx.client && (
                              <span className="block text-ink font-medium">
                                {tx.client}
                              </span>
                            )}
                            {tx.invoiceRef && (
                              <span className="text-[11px] text-ink-3 tabular-nums">
                                {tx.invoiceRef}
                              </span>
                            )}
                            {!tx.client && !tx.invoiceRef && (
                              <span className="text-ink-3">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-[11px] text-ink-2">
                            {tx.taxRate ? `${tx.taxRate}% ${t('worksheet.vatShort')}` : `0% ${t('worksheet.vatShort')}`}
                            {tx.type === 'expense' && tx.mode === 'freelancer' && (
                              <span className="block text-indigo">
                                {tx.deductiblePct ?? 100}% {t('worksheet.dedShort')}
                              </span>
                            )}
                          </td>
                        </>
                      )}
                      <td className="py-2.5 px-3 text-right tabular-nums font-semibold whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 ${
                            isIncome ? 'text-positive' : 'text-ink'
                          }`}
                        >
                          {isIncome ? (
                            <ArrowUpRight className="w-3.5 h-3.5 text-positive" />
                          ) : (
                            <ArrowDownRight className="w-3.5 h-3.5 text-ink-3" />
                          )}
                          {isIncome ? '+' : ''}
                          {formatCurrency(tx.amount, currency)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => onDeleteTransaction(tx.id)}
                          className="p-1 rounded border border-transparent text-ink-2/85 hover:text-accent hover:bg-accent/12 hover:border-accent/30 transition-colors cursor-pointer"
                          title={t('tx.deleteTip')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
