import React, { useState } from 'react';
import {
  Landmark,
  Wallet,
  Shield,
  TrendingUp,
  Home,
  CreditCard,
  Plus,
  ArrowLeftRight,
  Camera,
  Trash2,
  Check,
  Sparkles,
  ReceiptText,
  Building2,
  RefreshCw,
} from 'lucide-react';
import {
  AccountLiquidityClass,
  AccountType,
  ActiveWorkspace,
  FinancialAccount,
  LedgerMode,
  NetWorthSnapshot,
} from '../types';
import {
  ACCOUNT_CLASS_META,
  ACCOUNT_TYPE_META,
  ZEN_PALETTE,
} from '../data/templates';
import {
  AccountComputedItem,
  formatCurrency,
  formatNumber,
  NetWorthSummaryMetrics,
} from '../utils/calculations';

interface AccountsNetWorthViewProps {
  netWorth: NetWorthSummaryMetrics;
  snapshots: NetWorthSnapshot[];
  workspace: ActiveWorkspace;
  monthKey: string;
  currency: string;
  onAddAccount: (account: Omit<FinancialAccount, 'id' | 'updatedAt'>) => void;
  onUpdateAccount: (
    accountId: string,
    patch: Partial<FinancialAccount>
  ) => void;
  onDeleteAccount: (accountId: string) => void;
  onTransferBetweenAccounts: (
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    date: string,
    note: string
  ) => void;
  onSaveSnapshot: (note?: string) => void;
  onDeleteSnapshot: (id: string) => void;
  onInspectAccountTransactions: (accountId: string) => void;
}

type FilterBucket = 'all' | AccountLiquidityClass;

export const AccountsNetWorthView: React.FC<AccountsNetWorthViewProps> = ({
  netWorth,
  snapshots,
  workspace,
  monthKey,
  currency,
  onAddAccount,
  onUpdateAccount,
  onDeleteAccount,
  onTransferBetweenAccounts,
  onSaveSnapshot,
  onDeleteSnapshot,
  onInspectAccountTransactions,
}) => {
  const [filterBucket, setFilterBucket] = useState<FilterBucket>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [snapshotNote, setSnapshotNote] = useState('');
  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
  const [editingBalanceValue, setEditingBalanceValue] = useState('');

  // New Account Form State
  const [newName, setNewName] = useState('');
  const [newInstitution, setNewInstitution] = useState('');
  const [newMaskedNumber, setNewMaskedNumber] = useState('');
  const [newMode, setNewMode] = useState<LedgerMode>(
    workspace === 'freelancer' ? 'freelancer' : 'home'
  );
  const [newType, setNewType] = useState<AccountType>('checking');
  const [newCustomTypeLabel, setNewCustomTypeLabel] = useState('');
  const [newClassification, setNewClassification] =
    useState<AccountLiquidityClass>('liquid');
  const [newBalance, setNewBalance] = useState('');
  const [newAutoTrack, setNewAutoTrack] = useState(true);
  const [newIncludeInNw, setNewIncludeInNw] = useState(true);
  const [newColor, setNewColor] = useState('#3f704d');

  // Transfer Form State
  const [fromAccId, setFromAccId] = useState(
    netWorth.accounts[0]?.account.id ?? ''
  );
  const [toAccId, setToAccId] = useState(
    netWorth.accounts[1]?.account.id ?? ''
  );
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDate] = useState(
    `${monthKey}-${String(new Date().getDate()).padStart(2, '0')}`
  );
  const [transferNote, setTransferNote] = useState('');

  const handleTypeSelect = (t: AccountType) => {
    setNewType(t);
    const meta = ACCOUNT_TYPE_META[t];
    if (meta) {
      setNewClassification(meta.defaultClass);
      setNewAutoTrack(meta.autoTrackDefault);
      setNewColor(meta.defaultColor);
      if (t === 'business_bank' || t === 'tax_reserve') {
        setNewMode('freelancer');
      }
    }
  };

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const bal = parseFloat(newBalance) || 0;
    onAddAccount({
      name: newName.trim(),
      institution: newInstitution.trim() || undefined,
      accountNumberMasked: newMaskedNumber.trim() || undefined,
      mode: newMode,
      type: newType,
      customTypeLabel:
        newType === 'custom'
          ? newCustomTypeLabel.trim() || 'Custom Account'
          : undefined,
      classification: newClassification,
      startingBalance: bal,
      currentBalance: bal,
      autoTrackTransactions: newAutoTrack,
      includeInNetWorth: newIncludeInNw,
      color: newColor,
    });
    setNewName('');
    setNewInstitution('');
    setNewMaskedNumber('');
    setNewCustomTypeLabel('');
    setNewBalance('');
    setShowAddForm(false);
  };

  const handleTransferSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(transferAmount);
    if (!fromAccId || !toAccId || fromAccId === toAccId || !amt || amt <= 0) {
      return;
    }
    onTransferBetweenAccounts(
      fromAccId,
      toAccId,
      amt,
      transferDate,
      transferNote.trim() || 'Account Transfer'
    );
    setTransferAmount('');
    setTransferNote('');
    setShowTransferForm(false);
  };

  const startBalanceEdit = (item: AccountComputedItem) => {
    setEditingBalanceId(item.account.id);
    setEditingBalanceValue(String(item.liveBalance));
  };

  const commitBalanceEdit = (item: AccountComputedItem) => {
    const parsed = parseFloat(editingBalanceValue.replace(/[^0-9.-]/g, ''));
    if (!Number.isNaN(parsed)) {
      if (item.account.autoTrackTransactions) {
        // Adjust startingBalance so that startingBalance + txNetDelta = parsed
        const nextStarting = parsed - item.txNetDelta;
        onUpdateAccount(item.account.id, {
          startingBalance: nextStarting,
          currentBalance: parsed,
          updatedAt: new Date().toISOString().slice(0, 10),
        });
      } else {
        onUpdateAccount(item.account.id, {
          currentBalance: parsed,
          startingBalance: parsed,
          updatedAt: new Date().toISOString().slice(0, 10),
        });
      }
    }
    setEditingBalanceId(null);
  };

  const filteredAccounts = netWorth.accounts.filter((item) =>
    filterBucket === 'all'
      ? true
      : item.account.classification === filterBucket
  );

  const maxHistoryAbs = Math.max(
    1,
    ...netWorth.historySeries.map((pt) =>
      Math.max(Math.abs(pt.netWorth), pt.totalAssets)
    )
  );

  const getTypeBadgeLabel = (acc: FinancialAccount): string => {
    if (acc.type === 'custom' && acc.customTypeLabel) {
      return acc.customTypeLabel;
    }
    return ACCOUNT_TYPE_META[acc.type]?.shortLabel ?? acc.type;
  };

  const getClassIcon = (cls: AccountLiquidityClass) => {
    switch (cls) {
      case 'liquid':
        return Landmark;
      case 'retirement':
        return Shield;
      case 'investment':
        return TrendingUp;
      case 'fixed_asset':
        return Home;
      case 'liability':
        return CreditCard;
    }
  };

  return (
    <div className="p-6 max-w-[1440px] mx-auto space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-line">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
              Multi-Account Treasury & Balance Sheet
            </span>
            <span className="text-ink-3">·</span>
            <span className="text-[11px] text-ink-2 font-medium">
              {netWorth.accounts.length} Active Account
              {netWorth.accounts.length === 1 ? '' : 's'}
            </span>
          </div>
          <h1 className="text-xl font-medium text-ink tracking-tight mt-0.5">
            Accounts & Comprehensive Net Worth Tracker
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              onSaveSnapshot(snapshotNote.trim() || undefined);
              setSnapshotNote('');
            }}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer"
            title={`Record Net Worth snapshot for ${monthKey}`}
          >
            <Camera className="w-3.5 h-3.5 text-indigo" />
            <span>Snapshot {monthKey}</span>
          </button>

          {netWorth.accounts.length >= 2 && (
            <button
              onClick={() => {
                setShowTransferForm((v) => !v);
                setShowAddForm(false);
              }}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink hover:bg-raised transition-colors cursor-pointer"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-positive" />
              <span>Transfer Funds</span>
            </button>
          )}

          <button
            onClick={() => {
              setShowAddForm((v) => !v);
              setShowTransferForm(false);
            }}
            className="h-8 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Account</span>
          </button>
        </div>
      </div>

      {/* 5-Card Net Worth Hero Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* 1. Total Net Worth */}
        <div className="p-4 rounded-xl bg-surface border border-ink/40 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-xs text-ink-2">
            <span className="font-medium text-ink">Total Net Worth</span>
            <Sparkles className="w-3.5 h-3.5 text-positive" />
          </div>
          <div
            className={`text-xl font-semibold tabular-nums ${
              netWorth.netWorth >= 0 ? 'text-positive' : 'text-accent'
            }`}
          >
            {formatCurrency(netWorth.netWorth, currency)}
          </div>
          <div className="flex items-center justify-between text-[11px] text-ink-3 tabular-nums">
            <span>Assets: {formatCurrency(netWorth.totalAssets, currency)}</span>
            <span>Debt: {netWorth.debtToAssetRatioPct.toFixed(1)}%</span>
          </div>
        </div>

        {/* 2. Liquid Assets (Multiple Bank Accounts & Cash) */}
        <div className="p-4 rounded-xl bg-surface border border-line space-y-1.5">
          <div className="flex items-center justify-between text-xs text-ink-2">
            <span>Liquid Assets (Bank & Cash)</span>
            <Landmark className="w-3.5 h-3.5 text-positive" />
          </div>
          <div className="text-lg font-semibold text-ink tabular-nums">
            {formatCurrency(netWorth.liquidAssets, currency)}
          </div>
          <div className="flex items-center justify-between text-[11px] text-ink-3 tabular-nums">
            <span>{netWorth.liquidSharePct.toFixed(1)}% of assets</span>
            {netWorth.liquidRunwayMonths > 0 && (
              <span className="text-positive font-medium">
                {netWorth.liquidRunwayMonths.toFixed(1)} mo runway
              </span>
            )}
          </div>
        </div>

        {/* 3. Retirement & Pension Accounts */}
        <div className="p-4 rounded-xl bg-surface border border-line space-y-1.5">
          <div className="flex items-center justify-between text-xs text-ink-2">
            <span>Retirement & Pension</span>
            <Shield className="w-3.5 h-3.5 text-[#8a6fb0]" />
          </div>
          <div className="text-lg font-semibold text-ink tabular-nums">
            {formatCurrency(netWorth.retirementAssets, currency)}
          </div>
          <div className="flex items-center justify-between text-[11px] text-ink-3 tabular-nums">
            <span>Pillar 2 / 3a / Pension</span>
            <span>{netWorth.retirementSharePct.toFixed(1)}% of assets</span>
          </div>
        </div>

        {/* 4. Investments & Fixed Assets */}
        <div className="p-4 rounded-xl bg-surface border border-line space-y-1.5">
          <div className="flex items-center justify-between text-xs text-ink-2">
            <span>Investments & Fixed Assets</span>
            <TrendingUp className="w-3.5 h-3.5 text-indigo" />
          </div>
          <div className="text-lg font-semibold text-ink tabular-nums">
            {formatCurrency(
              netWorth.investmentAssets + netWorth.fixedAssets,
              currency
            )}
          </div>
          <div className="flex items-center justify-between text-[11px] text-ink-3 tabular-nums">
            <span>ETFs, Crypto & Equity</span>
            <span>
              {(
                netWorth.investmentSharePct + netWorth.fixedAssetSharePct
              ).toFixed(1)}
              % of assets
            </span>
          </div>
        </div>

        {/* 5. Liabilities & Debt */}
        <div className="p-4 rounded-xl bg-surface border border-line space-y-1.5">
          <div className="flex items-center justify-between text-xs text-ink-2">
            <span>Liabilities & Debt</span>
            <CreditCard className="w-3.5 h-3.5 text-accent" />
          </div>
          <div className="text-lg font-semibold text-accent tabular-nums">
            {formatCurrency(netWorth.totalLiabilities, currency)}
          </div>
          <div className="flex items-center justify-between text-[11px] text-ink-3 tabular-nums">
            <span>Cards, Loans & Mortgages</span>
            <span>Subtracted</span>
          </div>
        </div>
      </div>

      {/* Collapsible Add Account Drawer */}
      {showAddForm && (
        <form
          onSubmit={handleCreateAccount}
          className="p-5 rounded-xl bg-surface border border-line space-y-4 shadow-sm"
        >
          <div className="flex items-center justify-between pb-2 border-b border-line">
            <div>
              <h3 className="text-sm font-medium text-ink">
                Create Financial Account
              </h3>
              <p className="text-[11px] text-ink-2">
                Add a bank account, retirement fund, investment portfolio, credit card, loan, or define a custom account type.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-xs text-ink-3 hover:text-ink cursor-pointer"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div>
              <label className="block text-[11px] text-ink-2 mb-1">
                Account Type
              </label>
              <select
                value={newType}
                onChange={(e) => handleTypeSelect(e.target.value as AccountType)}
                className="w-full h-9 px-2.5 rounded-lg bg-app border border-line text-xs text-ink focus:outline-none"
              >
                <optgroup label="Liquid Bank & Cash Accounts">
                  <option value="checking">Bank Checking / Everyday Account</option>
                  <option value="savings">Bank Savings / High-Yield Account</option>
                  <option value="business_bank">Freelancer / Business Bank Account</option>
                  <option value="tax_reserve">Tax & VAT Reserve Account</option>
                  <option value="cash">Cash / Digital Wallet</option>
                </optgroup>
                <optgroup label="Retirement & Long-Term Wealth">
                  <option value="retirement">
                    Retirement / Pension (Pillar 2 / 3a / 401k / IRA)
                  </option>
                  <option value="brokerage">Brokerage / ETFs & Stocks</option>
                  <option value="crypto">Crypto & Digital Assets</option>
                  <option value="real_estate">Property / Real Estate Equity</option>
                </optgroup>
                <optgroup label="Liabilities & Debt">
                  <option value="credit_card">Credit Card Balance</option>
                  <option value="loan">Loan / Mortgage / Debt</option>
                </optgroup>
                <optgroup label="Custom">
                  <option value="custom">Custom Account Type…</option>
                </optgroup>
              </select>
            </div>

            {newType === 'custom' && (
              <div>
                <label className="block text-[11px] text-ink-2 mb-1">
                  Custom Type Label
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Precious Metals, Pillar 3a, Co-op Shares"
                  value={newCustomTypeLabel}
                  onChange={(e) => setNewCustomTypeLabel(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-app border border-line text-xs text-ink focus:outline-none"
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] text-ink-2 mb-1">
                Net Worth Classification
              </label>
              <select
                value={newClassification}
                onChange={(e) =>
                  setNewClassification(e.target.value as AccountLiquidityClass)
                }
                className="w-full h-9 px-2.5 rounded-lg bg-app border border-line text-xs text-ink focus:outline-none"
              >
                <option value="liquid">Liquid Asset (Bank / Cash)</option>
                <option value="retirement">Retirement / Pension Asset</option>
                <option value="investment">Investment / Market Asset</option>
                <option value="fixed_asset">Fixed / Real Estate Asset</option>
                <option value="liability">Liability / Debt (Subtracted)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-ink-2 mb-1">
                Account Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. UBS Personal Checking, VIAC Pillar 3a"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-app border border-line text-xs text-ink focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] text-ink-2 mb-1">
                Bank / Institution (optional)
              </label>
              <input
                type="text"
                placeholder="e.g. ZKB, PostFinance, Interactive Brokers"
                value={newInstitution}
                onChange={(e) => setNewInstitution(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-app border border-line text-xs text-ink focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] text-ink-2 mb-1">
                Account / IBAN Ref (optional)
              </label>
              <input
                type="text"
                placeholder="e.g. CH93 •••• 4820"
                value={newMaskedNumber}
                onChange={(e) => setNewMaskedNumber(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-app border border-line text-xs text-ink focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] text-ink-2 mb-1">
                Current / Opening Balance ({currency})
              </label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={newBalance}
                onChange={(e) => setNewBalance(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-app border border-line text-xs text-ink tabular-nums focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] text-ink-2 mb-1">
                Ledger Assignment
              </label>
              <select
                value={newMode}
                onChange={(e) => setNewMode(e.target.value as LedgerMode)}
                className="w-full h-9 px-2.5 rounded-lg bg-app border border-line text-xs text-ink focus:outline-none"
              >
                <option value="home">Home / Personal</option>
                <option value="freelancer">Freelancer / Business</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-line">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newAutoTrack}
                  onChange={(e) => setNewAutoTrack(e.target.checked)}
                  className="rounded border-line"
                />
                <span>
                  Automatically adjust balance from logged transactions
                </span>
              </label>

              <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newIncludeInNw}
                  onChange={(e) => setNewIncludeInNw(e.target.checked)}
                  className="rounded border-line"
                />
                <span>Include in Net Worth total</span>
              </label>

              <div className="flex items-center gap-1">
                {ZEN_PALETTE.slice(0, 7).map((swatch) => (
                  <button
                    type="button"
                    key={swatch}
                    onClick={() => setNewColor(swatch)}
                    className={`w-4 h-4 rounded-full cursor-pointer ${
                      newColor === swatch ? 'ring-2 ring-ink ring-offset-1' : ''
                    }`}
                    style={{ backgroundColor: swatch }}
                  />
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="h-9 px-4 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 cursor-pointer"
            >
              Create Account
            </button>
          </div>
        </form>
      )}

      {/* Collapsible Transfer Between Accounts Form */}
      {showTransferForm && (
        <form
          onSubmit={handleTransferSubmit}
          className="p-5 rounded-xl bg-surface border border-line space-y-4 shadow-sm"
        >
          <div className="flex items-center justify-between pb-2 border-b border-line">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4 text-positive" />
              <h3 className="text-sm font-medium text-ink">
                Transfer Funds Between Accounts
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowTransferForm(false)}
              className="text-xs text-ink-3 hover:text-ink cursor-pointer"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
            <div>
              <label className="block text-[11px] text-ink-2 mb-1">
                From Account
              </label>
              <select
                value={fromAccId}
                onChange={(e) => setFromAccId(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg bg-app border border-line text-xs text-ink"
              >
                {netWorth.accounts.map((a) => (
                  <option key={a.account.id} value={a.account.id}>
                    {a.account.name} ({formatCurrency(a.liveBalance, currency)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-ink-2 mb-1">
                To Account
              </label>
              <select
                value={toAccId}
                onChange={(e) => setToAccId(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg bg-app border border-line text-xs text-ink"
              >
                {netWorth.accounts.map((a) => (
                  <option key={a.account.id} value={a.account.id}>
                    {a.account.name} ({formatCurrency(a.liveBalance, currency)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-ink-2 mb-1">
                Amount ({currency})
              </label>
              <input
                type="number"
                step="0.01"
                required
                placeholder="0.00"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-app border border-line text-xs text-ink tabular-nums"
              />
            </div>

            <div>
              <label className="block text-[11px] text-ink-2 mb-1">
                Note / Reference
              </label>
              <input
                type="text"
                placeholder="e.g. Monthly Savings / Pillar 3a Transfer"
                value={transferNote}
                onChange={(e) => setTransferNote(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-app border border-line text-xs text-ink"
              />
            </div>

            <button
              type="submit"
              className="h-9 px-4 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 cursor-pointer"
            >
              Execute Transfer
            </button>
          </div>
        </form>
      )}

      {/* Accounts Filter Bar & Multi-Account Cards */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: `All Accounts (${netWorth.accounts.length})` },
                {
                  id: 'liquid',
                  label: `Liquid / Bank (${
                    netWorth.accounts.filter(
                      (a) => a.account.classification === 'liquid'
                    ).length
                  })`,
                },
                {
                  id: 'retirement',
                  label: `Retirement (${
                    netWorth.accounts.filter(
                      (a) => a.account.classification === 'retirement'
                    ).length
                  })`,
                },
                {
                  id: 'investment',
                  label: `Investments (${
                    netWorth.accounts.filter(
                      (a) => a.account.classification === 'investment'
                    ).length
                  })`,
                },
                {
                  id: 'fixed_asset',
                  label: `Fixed Assets (${
                    netWorth.accounts.filter(
                      (a) => a.account.classification === 'fixed_asset'
                    ).length
                  })`,
                },
                {
                  id: 'liability',
                  label: `Liabilities (${
                    netWorth.accounts.filter(
                      (a) => a.account.classification === 'liability'
                    ).length
                  })`,
                },
              ] as { id: FilterBucket; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterBucket(tab.id)}
                className={`h-7 px-3 rounded-lg text-xs transition-colors cursor-pointer ${
                  filterBucket === tab.id
                    ? 'bg-ink text-on-ink font-medium'
                    : 'bg-surface border border-line text-ink-2 hover:text-ink'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <span className="text-[11px] text-ink-3">
            Click any balance to update or reconcile directly
          </span>
        </div>

        {filteredAccounts.length === 0 ? (
          <div className="p-8 rounded-xl bg-surface border border-line text-center space-y-2">
            <Wallet className="w-6 h-6 text-ink-3 mx-auto" />
            <div className="text-sm font-medium text-ink">
              No accounts in this category yet
            </div>
            <p className="text-xs text-ink-2 max-w-md mx-auto">
              Add your bank checking & savings accounts, Pillar 2 / 3a retirement accounts, investment portfolios, or custom accounts to track your complete Net Worth.
            </p>
            <button
              onClick={() => setShowAddForm(true)}
              className="mt-2 h-8 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-ink text-on-ink text-xs font-medium cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add First Account</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAccounts.map((item) => {
              const { account, liveBalance, txCount, txNetDelta } = item;
              const ClassIcon = getClassIcon(account.classification);
              const isLiability = account.classification === 'liability';
              const isEditing = editingBalanceId === account.id;

              return (
                <div
                  key={account.id}
                  className="p-4 rounded-xl bg-surface border border-line flex flex-col justify-between gap-3.5 hover:border-ink-3/60 transition-colors"
                >
                  <div className="space-y-2.5">
                    {/* Top Row: Icon, Name, Badges */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-white"
                          style={{ backgroundColor: account.color }}
                        >
                          <ClassIcon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-ink truncate">
                            {account.name}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3 mt-0.5">
                            {account.institution && (
                              <span className="inline-flex items-center gap-1">
                                <Building2 className="w-3 h-3" />
                                {account.institution}
                              </span>
                            )}
                            {account.accountNumberMasked && (
                              <span className="font-mono text-[10px]">
                                · {account.accountNumberMasked}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span className="px-2 py-0.5 rounded bg-raised border border-line text-[10px] text-ink-2 font-medium">
                          {getTypeBadgeLabel(account)}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-medium ${
                            account.mode === 'freelancer'
                              ? 'bg-indigo/15 text-indigo'
                              : 'bg-raised text-ink-3'
                          }`}
                        >
                          {account.mode === 'freelancer' ? 'Biz' : 'Home'}
                        </span>
                      </div>
                    </div>

                    {/* Live Balance (Click to Edit) */}
                    <div className="pt-1">
                      <div className="text-[10px] uppercase tracking-wider text-ink-3">
                        {isLiability
                          ? 'Current Debt Balance'
                          : 'Current Account Balance'}
                      </div>
                      {isEditing ? (
                        <div className="flex items-center gap-1.5 mt-1">
                          <input
                            type="number"
                            step="0.01"
                            autoFocus
                            value={editingBalanceValue}
                            onChange={(e) =>
                              setEditingBalanceValue(e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitBalanceEdit(item);
                              if (e.key === 'Escape') setEditingBalanceId(null);
                            }}
                            onBlur={() => commitBalanceEdit(item)}
                            className="w-40 h-8 px-2.5 rounded-lg bg-app border border-ink text-sm font-semibold text-ink tabular-nums focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => commitBalanceEdit(item)}
                            className="h-8 px-2.5 rounded-lg bg-ink text-on-ink text-xs cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startBalanceEdit(item)}
                          className={`mt-0.5 text-xl font-semibold tabular-nums text-left hover:underline cursor-pointer ${
                            isLiability
                              ? 'text-accent'
                              : liveBalance >= 0
                                ? 'text-ink'
                                : 'text-accent'
                          }`}
                          title="Click to update or reconcile balance"
                        >
                          {isLiability && liveBalance > 0 ? '-' : ''}
                          {formatCurrency(Math.abs(liveBalance), currency)}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Footer Controls */}
                  <div className="pt-2.5 border-t border-line flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateAccount(account.id, {
                            autoTrackTransactions:
                              !account.autoTrackTransactions,
                          })
                        }
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border cursor-pointer transition-colors ${
                          account.autoTrackTransactions
                            ? 'bg-positive/10 border-positive/30 text-positive'
                            : 'bg-app border-line text-ink-3 hover:text-ink-2'
                        }`}
                        title={
                          account.autoTrackTransactions
                            ? 'Balance auto-updates from linked transactions (click to switch to manual valuation)'
                            : 'Manual valuation mode (click to auto-track from transactions)'
                        }
                      >
                        <RefreshCw className="w-2.5 h-2.5" />
                        <span>
                          {account.autoTrackTransactions ? 'Auto-Tx' : 'Manual'}
                        </span>
                      </button>

                      {txCount > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            onInspectAccountTransactions(account.id)
                          }
                          className="inline-flex items-center gap-1 text-ink-2 hover:text-ink cursor-pointer tabular-nums"
                          title="View transactions for this account"
                        >
                          <ReceiptText className="w-3 h-3 text-ink-3" />
                          <span>
                            {txCount} tx ({txNetDelta >= 0 ? '+' : ''}
                            {formatNumber(txNetDelta)})
                          </span>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <label
                        className="flex items-center gap-1 text-ink-3 hover:text-ink-2 cursor-pointer"
                        title="Include this account in Net Worth calculation"
                      >
                        <input
                          type="checkbox"
                          checked={account.includeInNetWorth}
                          onChange={(e) =>
                            onUpdateAccount(account.id, {
                              includeInNetWorth: e.target.checked,
                            })
                          }
                          className="rounded border-line"
                        />
                        <span>NW</span>
                      </label>

                      <button
                        type="button"
                        onClick={() => onDeleteAccount(account.id)}
                        className="p-1 rounded text-ink-3 hover:text-accent hover:bg-raised transition-colors cursor-pointer"
                        title="Delete Account"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Asset Allocation Bar + 12-Month Net Worth Trajectory */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Asset Allocation & Liquidity Breakdown */}
        <div className="lg:col-span-5 p-5 rounded-xl bg-surface border border-line space-y-4">
          <div>
            <h2 className="text-sm font-medium text-ink">
              Asset Allocation & Wealth Structure
            </h2>
            <p className="text-xs text-ink-2 mt-0.5">
              Distribution across liquid bank reserves, retirement funds, and investments
            </p>
          </div>

          {/* Stacked Horizontal Allocation Bar */}
          <div className="h-4 rounded-full bg-raised overflow-hidden flex border border-line">
            {netWorth.totalAssets > 0 ? (
              <>
                {netWorth.liquidSharePct > 0 && (
                  <div
                    style={{
                      width: `${netWorth.liquidSharePct}%`,
                      backgroundColor: ACCOUNT_CLASS_META.liquid.color,
                    }}
                    title={`Liquid Assets: ${netWorth.liquidSharePct.toFixed(1)}%`}
                  />
                )}
                {netWorth.retirementSharePct > 0 && (
                  <div
                    style={{
                      width: `${netWorth.retirementSharePct}%`,
                      backgroundColor: ACCOUNT_CLASS_META.retirement.color,
                    }}
                    title={`Retirement: ${netWorth.retirementSharePct.toFixed(1)}%`}
                  />
                )}
                {netWorth.investmentSharePct > 0 && (
                  <div
                    style={{
                      width: `${netWorth.investmentSharePct}%`,
                      backgroundColor: ACCOUNT_CLASS_META.investment.color,
                    }}
                    title={`Investments: ${netWorth.investmentSharePct.toFixed(1)}%`}
                  />
                )}
                {netWorth.fixedAssetSharePct > 0 && (
                  <div
                    style={{
                      width: `${netWorth.fixedAssetSharePct}%`,
                      backgroundColor: ACCOUNT_CLASS_META.fixed_asset.color,
                    }}
                    title={`Fixed Assets: ${netWorth.fixedAssetSharePct.toFixed(1)}%`}
                  />
                )}
              </>
            ) : (
              <div className="w-full h-full bg-line/40" />
            )}
          </div>

          <div className="space-y-2.5 pt-1">
            {(
              [
                {
                  cls: 'liquid' as AccountLiquidityClass,
                  amount: netWorth.liquidAssets,
                  pct: netWorth.liquidSharePct,
                },
                {
                  cls: 'retirement' as AccountLiquidityClass,
                  amount: netWorth.retirementAssets,
                  pct: netWorth.retirementSharePct,
                },
                {
                  cls: 'investment' as AccountLiquidityClass,
                  amount: netWorth.investmentAssets,
                  pct: netWorth.investmentSharePct,
                },
                {
                  cls: 'fixed_asset' as AccountLiquidityClass,
                  amount: netWorth.fixedAssets,
                  pct: netWorth.fixedAssetSharePct,
                },
                {
                  cls: 'liability' as AccountLiquidityClass,
                  amount: netWorth.totalLiabilities,
                  pct: netWorth.debtToAssetRatioPct,
                },
              ]
            ).map((row) => {
              const meta = ACCOUNT_CLASS_META[row.cls];
              return (
                <div
                  key={row.cls}
                  className="flex items-center justify-between text-xs py-1.5 border-b border-line/60 last:border-b-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: meta.color }}
                    />
                    <span className="text-ink truncate">{meta.label}</span>
                  </div>
                  <div className="flex items-center gap-3 tabular-nums shrink-0">
                    <span className="text-ink-3 text-[11px]">
                      {row.pct.toFixed(1)}%
                    </span>
                    <span
                      className={`font-medium ${
                        row.cls === 'liability' && row.amount > 0
                          ? 'text-accent'
                          : 'text-ink'
                      }`}
                    >
                      {row.cls === 'liability' && row.amount > 0 ? '-' : ''}
                      {formatCurrency(row.amount, currency)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: 12-Month Net Worth Trajectory & Snapshot Log */}
        <div className="lg:col-span-7 p-5 rounded-xl bg-surface border border-line space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium text-ink">
                12-Month Net Worth Trajectory
              </h2>
              <p className="text-xs text-ink-2 mt-0.5">
                Combines recorded monthly snapshots with cumulative cashflow progression
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-ink-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-positive inline-block" />
                Net Worth
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-indigo inline-block" />
                Recorded Snapshot
              </span>
            </div>
          </div>

          <div className="h-44 flex items-end gap-2 pt-4 pb-1 border-b border-line">
            {netWorth.historySeries.map((pt) => {
              const heightPct = Math.max(
                4,
                Math.round((Math.abs(pt.netWorth) / maxHistoryAbs) * 100)
              );
              const isCurrent = pt.monthKey === monthKey;
              return (
                <div
                  key={pt.monthKey}
                  className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group"
                  title={`${pt.monthLabel} (${pt.monthKey})\nNet Worth: ${formatCurrency(
                    pt.netWorth,
                    currency
                  )}\nLiquid: ${formatCurrency(
                    pt.liquidAssets,
                    currency
                  )}\nRetirement: ${formatCurrency(
                    pt.retirementAssets,
                    currency
                  )}`}
                >
                  <div className="w-full flex items-end justify-center h-32">
                    <div
                      className="w-full max-w-[22px] rounded-t transition-all"
                      style={{
                        height: `${heightPct}%`,
                        backgroundColor: pt.hasExplicitSnapshot
                          ? 'var(--indigo)'
                          : pt.netWorth >= 0
                            ? 'var(--positive)'
                            : 'var(--accent)',
                        opacity: isCurrent ? 1 : 0.78,
                      }}
                    />
                  </div>
                  <span
                    className={`text-[10px] tabular-nums ${
                      isCurrent ? 'text-ink font-semibold' : 'text-ink-3'
                    }`}
                  >
                    {pt.monthLabel}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Saved Net Worth Snapshots List */}
          {snapshots.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="text-[11px] uppercase tracking-wider text-ink-3 font-medium">
                Recorded Monthly Balance Sheet Snapshots ({snapshots.length})
              </div>
              <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                {snapshots
                  .slice()
                  .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
                  .map((snap) => (
                    <div
                      key={snap.id}
                      className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-app border border-line text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-ink">
                          {snap.monthKey}
                        </span>
                        <span className="text-ink-3 text-[11px]">
                          Liquid: {formatCurrency(snap.liquidAssets, currency)} ·
                          Retirement: {formatCurrency(snap.retirementAssets, currency)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5 tabular-nums">
                        <span className="font-semibold text-positive">
                          {formatCurrency(snap.netWorth, currency)}
                        </span>
                        <button
                          onClick={() => onDeleteSnapshot(snap.id)}
                          className="text-ink-3 hover:text-accent cursor-pointer"
                          title="Remove snapshot"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
