import React, { useMemo, useState } from 'react';
import {
  TrendingUp,
  Landmark,
  ArrowRight,
  Sparkles,
  AlertTriangle,
  Plus,
  Trash2,
  CopyCheck,
  GraduationCap,
  Shield,
} from 'lucide-react';
import {
  ActiveWorkspace,
  CategoryItem,
  CategoryKind,
  LedgerMode,
  LedgerState,
  YearlyPlanItem,
} from '../types';
import {
  formatCurrency,
  formatNumber,
  NetWorthSummaryMetrics,
} from '../utils/calculations';
import {
  ACCOUNT_TYPE_META,
  getDefaultReturnRateForAccount,
} from '../data/templates';

interface YearlyBudgetPlannerViewProps {
  state: LedgerState;
  netWorth: NetWorthSummaryMetrics;
  workspace: ActiveWorkspace;
  currency: string;
  onUpsertYearlyPlanItem: (item: YearlyPlanItem) => void;
  onDeleteYearlyPlanItem: (id: string) => void;
  onBulkSetYearlyPlanForYear: (year: number, items: YearlyPlanItem[]) => void;
  onUpdateAccountReturnRate: (accountId: string, returnPct: number) => void;
  onApplyYearlyPlanToMonthlyBudgets: (
    year: number,
    items: YearlyPlanItem[]
  ) => void;
  onAddCategoryAndPlanItem: (opts: {
    year: number;
    groupId: string;
    mode: LedgerMode;
    kind: CategoryKind;
    label: string;
    annualAmount: number;
    schedule: 'monthly' | 'annual_lump';
    accountId?: string;
    destinationAccountId?: string;
  }) => void;
}

export const YearlyBudgetPlannerView: React.FC<YearlyBudgetPlannerViewProps> = ({
  state,
  netWorth,
  workspace,
  currency,
  onUpsertYearlyPlanItem,
  onDeleteYearlyPlanItem,
  onBulkSetYearlyPlanForYear,
  onUpdateAccountReturnRate,
  onApplyYearlyPlanToMonthlyBudgets,
  onAddCategoryAndPlanItem,
}) => {
  const defaultNextYear = state.settings.activeYear + 1;
  const [planningYear, setPlanningYear] = useState<number>(defaultNextYear);
  const [filterKind, setFilterKind] = useState<'all' | CategoryKind>('all');
  const [hideUnplannedRows, setHideUnplannedRows] = useState(false);

  const modeFilter = (m: LedgerMode) =>
    workspace === 'combined' ? true : m === workspace;

  const visibleGroups = useMemo(
    () =>
      state.groups
        .filter((g) => modeFilter(g.mode))
        .filter((g) => (filterKind === 'all' ? true : g.kind === filterKind))
        .sort((a, b) => a.order - b.order),
    [state.groups, workspace, filterKind]
  );

  const visibleCategories = useMemo(
    () => state.categories.filter((c) => modeFilter(c.mode)),
    [state.categories, workspace]
  );

  const visibleAccounts = useMemo(
    () =>
      netWorth.accounts.filter((ar) =>
        workspace === 'combined' ? true : ar.account.mode === workspace
      ),
    [netWorth.accounts, workspace]
  );

  // Default account helpers for quick linking
  const defaultLiquidAccountId = useMemo(() => {
    const checking = visibleAccounts.find(
      (a) =>
        a.account.type === 'checking' || a.account.type === 'business_bank'
    );
    return (
      checking?.account.id ??
      visibleAccounts.find((a) => a.account.classification === 'liquid')
        ?.account.id ??
      ''
    );
  }, [visibleAccounts]);

  const defaultInvestmentAccountId = useMemo(() => {
    const inv = visibleAccounts.find(
      (a) =>
        a.account.classification === 'investment' ||
        a.account.classification === 'retirement'
    );
    return inv?.account.id ?? '';
  }, [visibleAccounts]);

  // Quick-Add Planned Commitment Form State (e.g. $11,000 Tuition Fees)
  const [quickLabel, setQuickLabel] = useState('');
  const [quickGroupId, setQuickGroupId] = useState<string>(
    () =>
      state.groups.find((g) => g.id === 'home-grp-obligations')?.id ??
      state.groups.find((g) => g.kind === 'expense')?.id ??
      state.groups[0]?.id ??
      ''
  );
  const [quickAmount, setQuickAmount] = useState('');
  const [quickSchedule, setQuickSchedule] = useState<'annual_lump' | 'monthly'>(
    'annual_lump'
  );
  const [quickAccountId, setQuickAccountId] = useState<string>(
    defaultLiquidAccountId
  );
  const [quickDestAccountId, setQuickDestAccountId] = useState<string>(
    defaultInvestmentAccountId
  );

  const yearPlanItems = useMemo(
    () =>
      (state.yearlyPlanItems ?? []).filter(
        (item) => item.year === planningYear && modeFilter(item.mode)
      ),
    [state.yearlyPlanItems, planningYear, workspace]
  );

  const planByCategoryId = useMemo(() => {
    const map = new Map<string, YearlyPlanItem>();
    for (const item of yearPlanItems) {
      map.set(item.categoryId, item);
    }
    return map;
  }, [yearPlanItems]);

  const activeMonthKey = `${state.settings.activeYear}-${String(
    state.settings.activeMonth
  ).padStart(2, '0')}`;

  // Seed yearly plan from current month's budgets & recurring rules
  const handleSeedFromCurrentBudget = () => {
    const mbMap = new Map<string, number>();
    for (const mb of state.monthlyBudgets) {
      if (mb.monthKey === activeMonthKey && mb.budget > 0) {
        mbMap.set(mb.categoryId, mb.budget);
      }
    }
    const recMap = new Map<string, number>();
    for (const r of state.recurringRules) {
      if (r.active && r.amount > 0) {
        const annualEq =
          r.frequency === 'monthly'
            ? r.amount * 12
            : r.frequency === 'quarterly'
              ? r.amount * 4
              : r.amount;
        recMap.set(r.categoryId, annualEq);
      }
    }

    const homeChecking =
      state.accounts.find(
        (a) => a.mode === 'home' && a.type === 'checking'
      )?.id ??
      state.accounts.find((a) => a.classification === 'liquid')?.id;
    const bizChecking =
      state.accounts.find(
        (a) => a.mode === 'freelancer' && a.type === 'business_bank'
      )?.id ?? homeChecking;
    const savingsAcc = state.accounts.find((a) => a.type === 'savings')?.id;
    const retirementAcc = state.accounts.find(
      (a) => a.classification === 'retirement'
    )?.id;
    const brokerageAcc = state.accounts.find(
      (a) => a.classification === 'investment'
    )?.id;
    const taxReserveAcc = state.accounts.find(
      (a) => a.type === 'tax_reserve'
    )?.id;

    const seeded: YearlyPlanItem[] = [];
    for (const cat of state.categories) {
      const existing = (state.yearlyPlanItems ?? []).find(
        (p) => p.year === planningYear && p.categoryId === cat.id
      );
      if (existing && existing.annualAmount > 0) {
        seeded.push(existing);
        continue;
      }

      const monthlyVal = mbMap.get(cat.id) ?? cat.defaultBudget ?? 0;
      const annualVal =
        recMap.get(cat.id) ?? (monthlyVal > 0 ? monthlyVal * 12 : 0);

      if (annualVal <= 0) continue;

      const primaryAcc =
        cat.mode === 'freelancer' ? bizChecking : homeChecking;
      let destAcc: string | undefined;
      if (cat.kind === 'savings') {
        const lower = cat.name.toLowerCase();
        if (
          lower.includes('retirement') ||
          lower.includes('3a') ||
          lower.includes('pension')
        ) {
          destAcc = retirementAcc ?? brokerageAcc ?? savingsAcc;
        } else if (
          lower.includes('invest') ||
          lower.includes('etf') ||
          lower.includes('portfolio')
        ) {
          destAcc = brokerageAcc ?? retirementAcc ?? savingsAcc;
        } else if (lower.includes('tax') || lower.includes('vat')) {
          destAcc = taxReserveAcc ?? savingsAcc;
        } else {
          destAcc = savingsAcc ?? brokerageAcc;
        }
      }

      seeded.push({
        id: existing?.id ?? `yp-${planningYear}-${cat.id}`,
        year: planningYear,
        mode: cat.mode,
        categoryId: cat.id,
        label: cat.name,
        kind: cat.kind,
        annualAmount: annualVal,
        schedule: 'monthly',
        accountId: primaryAcc,
        destinationAccountId: destAcc,
      });
    }

    onBulkSetYearlyPlanForYear(planningYear, seeded);
  };

  // Compute Account-by-Account Standing & End-of-Year Projections
  const accountProjections = useMemo(() => {
    return visibleAccounts.map((ar) => {
      const acc = ar.account;
      const currentStanding = ar.liveBalance;
      const returnRatePct = getDefaultReturnRateForAccount(acc);

      let plannedInflows = 0;
      let plannedOutflows = 0;
      const linkedItems: {
        label: string;
        amount: number;
        direction: 'in' | 'out';
      }[] = [];

      for (const item of yearPlanItems) {
        if (item.annualAmount <= 0) continue;

        if (item.kind === 'income' && item.accountId === acc.id) {
          plannedInflows += item.annualAmount;
          linkedItems.push({
            label: item.label,
            amount: item.annualAmount,
            direction: 'in',
          });
        } else if (item.kind === 'expense' && item.accountId === acc.id) {
          plannedOutflows += item.annualAmount;
          linkedItems.push({
            label: item.label,
            amount: item.annualAmount,
            direction: 'out',
          });
        } else if (item.kind === 'savings') {
          // Savings/Investments can deduct from source accountId and add to destinationAccountId
          if (
            item.accountId === acc.id &&
            item.destinationAccountId !== acc.id
          ) {
            plannedOutflows += item.annualAmount;
            linkedItems.push({
              label: `Transfer → ${item.label}`,
              amount: item.annualAmount,
              direction: 'out',
            });
          }
          if (
            item.destinationAccountId === acc.id ||
            (!item.destinationAccountId && item.accountId === acc.id)
          ) {
            plannedInflows += item.annualAmount;
            linkedItems.push({
              label: item.label,
              amount: item.annualAmount,
              direction: 'in',
            });
          }
        }
      }

      const netPlannedFlow = plannedInflows - plannedOutflows;
      // Estimate investment / interest return over the planned year:
      // Existing standing compounds for full year; net positive inflows compound for ~half year on average
      const baseForReturn = Math.max(
        0,
        currentStanding + (netPlannedFlow > 0 ? netPlannedFlow * 0.5 : netPlannedFlow)
      );
      const estimatedReturn =
        acc.classification === 'liability'
          ? 0
          : baseForReturn * (returnRatePct / 100);

      const projectedEndBalance =
        acc.classification === 'liability'
          ? Math.max(0, currentStanding - plannedInflows + plannedOutflows)
          : currentStanding + netPlannedFlow + estimatedReturn;

      // 5-Year Compounded Estimate if annual contribution continues at this rate
      let fiveYearEstimate = projectedEndBalance;
      if (acc.classification !== 'liability' && returnRatePct > 0) {
        const r = returnRatePct / 100;
        let bal = currentStanding;
        const annualAdd = Math.max(0, netPlannedFlow);
        for (let y = 0; y < 5; y++) {
          bal = (bal + annualAdd * 0.5) * (1 + r) + annualAdd * 0.5;
        }
        fiveYearEstimate = bal;
      } else if (acc.classification !== 'liability') {
        fiveYearEstimate = currentStanding + Math.max(0, netPlannedFlow) * 5;
      }

      return {
        account: acc,
        currentStanding,
        plannedInflows,
        plannedOutflows,
        netPlannedFlow,
        returnRatePct,
        estimatedReturn,
        projectedEndBalance,
        fiveYearEstimate,
        linkedItems,
      };
    });
  }, [visibleAccounts, yearPlanItems]);

  // Overall Yearly Totals
  const totalPlannedIncome = yearPlanItems
    .filter((i) => i.kind === 'income')
    .reduce((s, i) => s + i.annualAmount, 0);
  const totalPlannedExpenses = yearPlanItems
    .filter((i) => i.kind === 'expense')
    .reduce((s, i) => s + i.annualAmount, 0);
  const totalPlannedSavingsAndInvestments = yearPlanItems
    .filter((i) => i.kind === 'savings')
    .reduce((s, i) => s + i.annualAmount, 0);
  const unallocatedCashflow =
    totalPlannedIncome -
    totalPlannedExpenses -
    totalPlannedSavingsAndInvestments;

  const totalEstimatedInvestmentGrowth = accountProjections.reduce(
    (s, p) => s + p.estimatedReturn,
    0
  );

  const currentNetWorthStanding = accountProjections.reduce(
    (s, p) =>
      s +
      (p.account.classification === 'liability'
        ? -p.currentStanding
        : p.currentStanding),
    0
  );

  const projectedYearEndNetWorth = accountProjections.reduce(
    (s, p) =>
      s +
      (p.account.classification === 'liability'
        ? -p.projectedEndBalance
        : p.projectedEndBalance),
    0
  );

  const projectedFiveYearNetWorth = accountProjections.reduce(
    (s, p) =>
      s +
      (p.account.classification === 'liability'
        ? -p.projectedEndBalance
        : p.fiveYearEstimate),
    0
  );

  const selectedQuickGroup = state.groups.find((g) => g.id === quickGroupId);

  const handleQuickAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const rawAmt = parseFloat(quickAmount);
    if (!quickLabel.trim() || Number.isNaN(rawAmt) || rawAmt <= 0) return;
    const grp =
      selectedQuickGroup ??
      state.groups.find((g) => modeFilter(g.mode)) ??
      state.groups[0];
    if (!grp) return;

    const annualAmount =
      quickSchedule === 'monthly' ? rawAmt * 12 : rawAmt;

    onAddCategoryAndPlanItem({
      year: planningYear,
      groupId: grp.id,
      mode: grp.mode,
      kind: grp.kind,
      label: quickLabel.trim(),
      annualAmount,
      schedule: quickSchedule,
      accountId: quickAccountId || undefined,
      destinationAccountId:
        grp.kind === 'savings' ? quickDestAccountId || undefined : undefined,
    });

    setQuickLabel('');
    setQuickAmount('');
  };

  const applyPresetExample = (preset: 'tuition' | 'etf' | 'retirement') => {
    if (preset === 'tuition') {
      const oblGrp =
        state.groups.find((g) => g.id === 'home-grp-obligations') ??
        state.groups.find((g) => g.kind === 'expense');
      if (oblGrp) setQuickGroupId(oblGrp.id);
      setQuickLabel('Tuition Fees');
      setQuickSchedule('annual_lump');
      setQuickAmount('11000');
      setQuickAccountId(defaultLiquidAccountId);
    } else if (preset === 'etf') {
      const savGrp =
        state.groups.find((g) => g.id === 'home-grp-savings') ??
        state.groups.find((g) => g.kind === 'savings');
      if (savGrp) setQuickGroupId(savGrp.id);
      setQuickLabel('Global ETF Portfolio Allocation');
      setQuickSchedule('monthly');
      setQuickAmount('1000');
      setQuickAccountId(defaultLiquidAccountId);
      setQuickDestAccountId(defaultInvestmentAccountId);
    } else if (preset === 'retirement') {
      const savGrp =
        state.groups.find((g) => g.id === 'home-grp-savings') ??
        state.groups.find((g) => g.kind === 'savings');
      if (savGrp) setQuickGroupId(savGrp.id);
      setQuickLabel('Pillar 3a / IRA Retirement Contribution');
      setQuickSchedule('annual_lump');
      setQuickAmount('7056');
      setQuickAccountId(defaultLiquidAccountId);
      const retAcc = visibleAccounts.find(
        (a) => a.account.classification === 'retirement'
      );
      if (retAcc) setQuickDestAccountId(retAcc.account.id);
    }
  };

  const updateCategoryPlan = (
    cat: CategoryItem,
    patch: Partial<YearlyPlanItem>
  ) => {
    const existing = planByCategoryId.get(cat.id);
    const base: YearlyPlanItem = existing ?? {
      id: `yp-${planningYear}-${cat.id}`,
      year: planningYear,
      mode: cat.mode,
      categoryId: cat.id,
      label: cat.name,
      kind: cat.kind,
      annualAmount: 0,
      schedule: cat.isRecurring ? 'monthly' : 'annual_lump',
      accountId: defaultLiquidAccountId || undefined,
      destinationAccountId:
        cat.kind === 'savings'
          ? defaultInvestmentAccountId || undefined
          : undefined,
    };
    onUpsertYearlyPlanItem({
      ...base,
      ...patch,
    });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header & Target Year Picker */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-normal text-ink tracking-tight">
              Yearly Budget &amp; Account Forecast Planner
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-indigo/15 text-indigo text-xs font-semibold tabular-nums">
              Planning {planningYear}
            </span>
          </div>
          <p className="text-xs text-ink-2 mt-0.5">
            Pre-plan next year&apos;s income, major expenses (e.g. tuition fees), and investment allocations mapped directly to your accounts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Year Selector */}
          <div className="flex items-center bg-surface border border-line rounded-xl p-1 gap-1 text-xs">
            {[
              state.settings.activeYear,
              state.settings.activeYear + 1,
              state.settings.activeYear + 2,
              state.settings.activeYear + 3,
            ].map((yr) => (
              <button
                key={yr}
                type="button"
                onClick={() => setPlanningYear(yr)}
                className={`px-3 py-1 rounded-lg tabular-nums transition-colors cursor-pointer ${
                  planningYear === yr
                    ? 'bg-ink text-on-ink font-medium'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                {yr}
                {yr === state.settings.activeYear + 1 ? ' (Next Yr)' : ''}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleSeedFromCurrentBudget}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer"
            title="Pre-fill yearly amounts from your current monthly budget × 12 and active recurring items"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo" />
            <span>Seed from Current Monthly × 12</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onApplyYearlyPlanToMonthlyBudgets(planningYear, yearPlanItems)
            }
            className="h-8 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer"
            title={`Write planned monthly amounts into all 12 monthly worksheets of ${planningYear}`}
          >
            <CopyCheck className="w-3.5 h-3.5" />
            <span>Apply Plan to {planningYear} Monthly Worksheets</span>
          </button>
        </div>
      </div>

      {/* Top KPI Summary Strip: Standing Today vs Projected Year-End */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="p-4 rounded-xl bg-surface border border-line">
          <div className="text-[11px] uppercase tracking-wider text-ink-3">
            Current Account Standing
          </div>
          <div className="text-lg font-semibold text-ink tabular-nums mt-1">
            {formatCurrency(currentNetWorthStanding, currency)}
          </div>
          <div className="text-[11px] text-ink-2 mt-0.5">
            Across {visibleAccounts.length} active account(s)
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface border border-line">
          <div className="text-[11px] uppercase tracking-wider text-ink-3">
            {planningYear} Planned Income
          </div>
          <div className="text-lg font-semibold text-positive tabular-nums mt-1">
            +{formatCurrency(totalPlannedIncome, currency)}
          </div>
          <div className="text-[11px] text-ink-2 mt-0.5 tabular-nums">
            {formatCurrency(totalPlannedIncome / 12, currency)} / month avg
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface border border-line">
          <div className="text-[11px] uppercase tracking-wider text-ink-3">
            {planningYear} Planned Outflows
          </div>
          <div className="text-lg font-semibold text-accent tabular-nums mt-1">
            -{formatCurrency(totalPlannedExpenses, currency)}
          </div>
          <div className="text-[11px] text-ink-2 mt-0.5 tabular-nums">
            {formatCurrency(totalPlannedExpenses / 12, currency)} / month avg
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface border border-line">
          <div className="text-[11px] uppercase tracking-wider text-ink-3">
            Planned Investments &amp; Est. Yield
          </div>
          <div className="text-lg font-semibold text-indigo tabular-nums mt-1">
            +{formatCurrency(totalPlannedSavingsAndInvestments, currency)}
          </div>
          <div className="text-[11px] text-positive mt-0.5 tabular-nums">
            +{formatCurrency(totalEstimatedInvestmentGrowth, currency)} est. return in {planningYear}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface border border-line">
          <div className="text-[11px] uppercase tracking-wider text-ink-3">
            Est. End of {planningYear} Standing
          </div>
          <div
            className={`text-lg font-semibold tabular-nums mt-1 ${
              projectedYearEndNetWorth >= currentNetWorthStanding
                ? 'text-positive'
                : 'text-accent'
            }`}
          >
            {formatCurrency(projectedYearEndNetWorth, currency)}
          </div>
          <div className="text-[11px] text-ink-2 mt-0.5 tabular-nums">
            5-Yr Est.: {formatCurrency(projectedFiveYearNetWorth, currency)}
          </div>
        </div>
      </div>

      {/* Section 1: Current Standing of All Accounts & Projected End-of-Year Standing */}
      <section className="bg-surface border border-line rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
              <Landmark className="w-4 h-4 text-indigo" />
              <span>
                Current Standing of All Accounts &amp; {planningYear} End-of-Year Estimates
              </span>
            </h2>
            <p className="text-xs text-ink-2 mt-0.5">
              Shows each account&apos;s current balance, planned inflows/outflows assigned to it, expected annual return %, and projected end-of-{planningYear} standing.
            </p>
          </div>

          {unallocatedCashflow !== 0 && (
            <div className="px-3 py-1 rounded-lg bg-raised border border-line text-xs tabular-nums">
              <span className="text-ink-3 mr-1.5">
                Unallocated Annual Cashflow:
              </span>
              <span
                className={`font-semibold ${
                  unallocatedCashflow >= 0 ? 'text-positive' : 'text-accent'
                }`}
              >
                {unallocatedCashflow >= 0 ? '+' : ''}
                {formatCurrency(unallocatedCashflow, currency)}
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {accountProjections.map((proj) => {
            const acc = proj.account;
            const meta = ACCOUNT_TYPE_META[acc.type] ?? ACCOUNT_TYPE_META.custom;
            const isShortfall =
              acc.classification !== 'liability' &&
              proj.projectedEndBalance < 0;
            const isInvestmentOrRetirement =
              acc.classification === 'investment' ||
              acc.classification === 'retirement' ||
              acc.type === 'savings';

            return (
              <div
                key={acc.id}
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                  isShortfall
                    ? 'bg-accent/5 border-accent/60'
                    : 'bg-app/70 border-line'
                }`}
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: acc.color }}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-ink truncate">
                          {acc.name}
                        </div>
                        <div className="text-[10px] text-ink-3 truncate">
                          {acc.customTypeLabel || meta.shortLabel}
                          {acc.institution ? ` · ${acc.institution}` : ''}
                        </div>
                      </div>
                    </div>

                    {/* Expected Annual Return / Yield % Input */}
                    {acc.classification !== 'liability' && (
                      <div
                        className="flex items-center gap-1 bg-surface border border-line rounded-md px-1.5 py-0.5 shrink-0"
                        title="Expected annual investment return or interest yield %"
                      >
                        <TrendingUp className="w-3 h-3 text-positive" />
                        <input
                          type="number"
                          step="0.5"
                          value={proj.returnRatePct}
                          onChange={(e) =>
                            onUpdateAccountReturnRate(
                              acc.id,
                              parseFloat(e.target.value) || 0
                            )
                          }
                          className="no-spinner w-9 bg-transparent text-[11px] text-ink font-medium tabular-nums text-right focus:outline-none"
                        />
                        <span className="text-[10px] text-ink-3">% p.a.</span>
                      </div>
                    )}
                  </div>

                  {/* Standing & Flows Breakdown */}
                  <div className="space-y-1 text-xs pt-1 border-t border-line/60">
                    <div className="flex items-center justify-between">
                      <span className="text-ink-2">Current Standing:</span>
                      <span className="font-medium text-ink tabular-nums">
                        {formatCurrency(proj.currentStanding, currency)}
                      </span>
                    </div>

                    {proj.plannedInflows > 0 && (
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-ink-3">
                          Planned Inflows / Contributions:
                        </span>
                        <span className="text-positive font-medium tabular-nums">
                          +{formatCurrency(proj.plannedInflows, currency)}
                        </span>
                      </div>
                    )}

                    {proj.plannedOutflows > 0 && (
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-ink-3">
                          Planned Outflows / Expenses:
                        </span>
                        <span className="text-accent font-medium tabular-nums">
                          -{formatCurrency(proj.plannedOutflows, currency)}
                        </span>
                      </div>
                    )}

                    {proj.estimatedReturn > 0 && (
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-ink-3">
                          Est. {planningYear} Growth ({proj.returnRatePct}%):
                        </span>
                        <span className="text-indigo font-medium tabular-nums">
                          +{formatCurrency(proj.estimatedReturn, currency)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Linked Planned Items Pills */}
                  {proj.linkedItems.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {proj.linkedItems.slice(0, 4).map((li, i) => (
                        <span
                          key={i}
                          className={`px-1.5 py-0.5 rounded text-[10px] tabular-nums truncate max-w-full ${
                            li.direction === 'in'
                              ? 'bg-positive/10 text-positive'
                              : 'bg-accent/10 text-accent'
                          }`}
                        >
                          {li.label}: {li.direction === 'in' ? '+' : '-'}
                          {formatNumber(li.amount)}
                        </span>
                      ))}
                      {proj.linkedItems.length > 4 && (
                        <span className="px-1.5 py-0.5 rounded bg-raised text-[10px] text-ink-3">
                          +{proj.linkedItems.length - 4} more
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Projected Year-End Balance Footer */}
                <div className="pt-2 border-t border-line/70 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-3">
                      Est. Dec 31, {planningYear}
                    </div>
                    <div
                      className={`text-sm font-semibold tabular-nums ${
                        isShortfall
                          ? 'text-accent'
                          : proj.projectedEndBalance > proj.currentStanding
                            ? 'text-positive'
                            : 'text-ink'
                      }`}
                    >
                      {formatCurrency(proj.projectedEndBalance, currency)}
                    </div>
                  </div>

                  {isShortfall ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-accent/15 text-accent text-[10px] font-medium">
                      <AlertTriangle className="w-3 h-3" />
                      <span>Shortfall</span>
                    </span>
                  ) : isInvestmentOrRetirement &&
                    proj.fiveYearEstimate > proj.projectedEndBalance ? (
                    <div className="text-right">
                      <div className="text-[10px] text-ink-3">5-Yr Compounded</div>
                      <div className="text-xs font-medium text-indigo tabular-nums">
                        {formatCurrency(proj.fiveYearEstimate, currency)}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Section 2: Quick Add Planned Yearly Expense / Tuition / Investment Item */}
      <section className="p-4 rounded-xl bg-surface border border-line space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">
              Plan a Specific {planningYear} Expense, Tuition Fee, or Investment Allocation
            </h3>
            <p className="text-[11px] text-ink-2">
              Add a planned yearly item (like $11,000 in tuition fees) and pick which account it corresponds to.
            </p>
          </div>

          {/* Quick Example Presets */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-ink-3">Quick Fill:</span>
            <button
              type="button"
              onClick={() => applyPresetExample('tuition')}
              className="h-6 px-2 rounded-md bg-raised border border-line text-ink-2 hover:text-ink inline-flex items-center gap-1 cursor-pointer"
            >
              <GraduationCap className="w-3 h-3 text-accent" />
              <span>Tuition Fees (11,000)</span>
            </button>
            <button
              type="button"
              onClick={() => applyPresetExample('etf')}
              className="h-6 px-2 rounded-md bg-raised border border-line text-ink-2 hover:text-ink inline-flex items-center gap-1 cursor-pointer"
            >
              <TrendingUp className="w-3 h-3 text-indigo" />
              <span>ETF Investment (1,000/mo)</span>
            </button>
            <button
              type="button"
              onClick={() => applyPresetExample('retirement')}
              className="h-6 px-2 rounded-md bg-raised border border-line text-ink-2 hover:text-ink inline-flex items-center gap-1 cursor-pointer"
            >
              <Shield className="w-3 h-3 text-positive" />
              <span>Retirement 3a / IRA (7,056)</span>
            </button>
          </div>
        </div>

        <form
          onSubmit={handleQuickAddSubmit}
          className="flex flex-wrap items-end gap-3 pt-1"
        >
          <div className="flex-[2_1_190px] min-w-[170px]">
            <label className="block text-[11px] text-ink-2 mb-1 truncate">
              Planned Item / Category Name
            </label>
            <input
              type="text"
              placeholder="e.g. Tuition Fees, ETF Allocation, Roof Repair"
              value={quickLabel}
              onChange={(e) => setQuickLabel(e.target.value)}
              required
              className="w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink focus:outline-none"
            />
          </div>

          <div className="flex-[1_1_160px] min-w-[150px]">
            <label className="block text-[11px] text-ink-2 mb-1 truncate">
              Budget Group
            </label>
            <select
              value={quickGroupId}
              onChange={(e) => setQuickGroupId(e.target.value)}
              className="w-full h-8 px-2 rounded-lg bg-raised border border-line text-xs text-ink focus:outline-none"
            >
              {state.groups
                .filter((g) => modeFilter(g.mode))
                .map((grp) => (
                  <option key={grp.id} value={grp.id}>
                    {grp.name} ({grp.kind})
                  </option>
                ))}
            </select>
          </div>

          <div className="flex-[1_1_125px] min-w-[115px]">
            <label className="block text-[11px] text-ink-2 mb-1 truncate">
              Schedule
            </label>
            <select
              value={quickSchedule}
              onChange={(e) =>
                setQuickSchedule(e.target.value as 'annual_lump' | 'monthly')
              }
              className="w-full h-8 px-2 rounded-lg bg-raised border border-line text-xs text-ink focus:outline-none"
            >
              <option value="annual_lump">Annual Total ({planningYear})</option>
              <option value="monthly">Monthly × 12</option>
            </select>
          </div>

          <div className="flex-[1_1_115px] min-w-[105px]">
            <label className="block text-[11px] text-ink-2 mb-1 truncate">
              {quickSchedule === 'monthly'
                ? `Monthly (${currency})`
                : `Annual (${currency})`}
            </label>
            <input
              type="number"
              step="10"
              placeholder="11000"
              value={quickAmount}
              onChange={(e) => setQuickAmount(e.target.value)}
              required
              className="w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink tabular-nums text-right focus:outline-none"
            />
          </div>

          <div className="flex-[2_1_200px] min-w-[180px]">
            <label className="block text-[11px] text-ink-2 mb-1 truncate">
              {selectedQuickGroup?.kind === 'income'
                ? 'Deposit Into Account'
                : selectedQuickGroup?.kind === 'savings'
                  ? 'Source Bank Account (From)'
                  : 'Corresponds to Account (Paid From)'}
            </label>
            <select
              value={quickAccountId}
              onChange={(e) => setQuickAccountId(e.target.value)}
              className="w-full h-8 px-2 rounded-lg bg-raised border border-line text-xs text-ink focus:outline-none"
            >
              <option value="">Unassigned Account</option>
              {visibleAccounts.map((ar) => (
                <option key={ar.account.id} value={ar.account.id}>
                  {ar.account.name} ({formatCurrency(ar.liveBalance, currency)})
                </option>
              ))}
            </select>
          </div>

          {selectedQuickGroup?.kind === 'savings' && (
            <div className="flex-[2_1_200px] min-w-[180px]">
              <label className="block text-[11px] text-indigo mb-1 truncate font-medium">
                Destination Investment / Savings Account (To)
              </label>
              <select
                value={quickDestAccountId}
                onChange={(e) => setQuickDestAccountId(e.target.value)}
                className="w-full h-8 px-2 rounded-lg bg-raised border border-indigo/40 text-xs text-ink focus:outline-none"
              >
                <option value="">Select destination account…</option>
                {visibleAccounts.map((ar) => (
                  <option key={ar.account.id} value={ar.account.id}>
                    {ar.account.name} (
                    {getDefaultReturnRateForAccount(ar.account)}% p.a.)
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="submit"
            className="h-8 px-4 rounded-lg bg-ink text-on-ink text-xs font-medium inline-flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add to {planningYear} Plan</span>
          </button>
        </form>
      </section>

      {/* Section 3: Full Category-by-Category Yearly Budget & Account Mapping Table */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {(
              [
                ['all', 'All Categories'],
                ['income', 'Income'],
                ['expense', 'Expenses & Obligations'],
                ['savings', 'Savings & Investments'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilterKind(k)}
                className={`h-7 px-3 rounded-lg text-xs transition-colors cursor-pointer ${
                  filterKind === k
                    ? 'bg-ink text-on-ink font-medium'
                    : 'bg-surface border border-line text-ink-2 hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer">
            <input
              type="checkbox"
              checked={hideUnplannedRows}
              onChange={(e) => setHideUnplannedRows(e.target.checked)}
              className="rounded border-line"
            />
            <span>Show only categories with planned {planningYear} amounts</span>
          </label>
        </div>

        <div className="space-y-4">
          {visibleGroups.map((grp) => {
            const grpCategories = visibleCategories
              .filter((c) => c.groupId === grp.id)
              .sort((a, b) => a.order - b.order);

            const filteredRows = hideUnplannedRows
              ? grpCategories.filter(
                  (c) => (planByCategoryId.get(c.id)?.annualAmount ?? 0) > 0
                )
              : grpCategories;

            if (filteredRows.length === 0) return null;

            const groupAnnualTotal = filteredRows.reduce(
              (s, c) => s + (planByCategoryId.get(c.id)?.annualAmount ?? 0),
              0
            );

            return (
              <section
                key={grp.id}
                className="bg-surface border border-line rounded-xl overflow-hidden"
              >
                {/* Group Header */}
                <div className="px-4 py-2.5 bg-raised/70 border-b border-line flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: grp.color }}
                    />
                    <span className="font-semibold uppercase tracking-wider text-ink">
                      {grp.name}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-line text-ink-3 uppercase">
                      {grp.kind}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 tabular-nums">
                    <span className="text-ink-2">
                      Monthly Avg:{' '}
                      <strong className="text-ink">
                        {formatCurrency(groupAnnualTotal / 12, currency)}
                      </strong>
                    </span>
                    <span className="text-ink-2">
                      {planningYear} Total:{' '}
                      <strong className="text-ink">
                        {formatCurrency(groupAnnualTotal, currency)}
                      </strong>
                    </span>
                  </div>
                </div>

                {/* Category Rows */}
                <div className="divide-y divide-line/60">
                  {filteredRows.map((cat) => {
                    const plan = planByCategoryId.get(cat.id);
                    const annualAmt = plan?.annualAmount ?? 0;
                    const monthlyAmt = annualAmt / 12;
                    const schedule =
                      plan?.schedule ??
                      (cat.isRecurring ? 'monthly' : 'annual_lump');
                    const linkedAccId = plan?.accountId ?? '';
                    const destAccId = plan?.destinationAccountId ?? '';

                    const destAccObj = visibleAccounts.find(
                      (a) => a.account.id === (destAccId || linkedAccId)
                    )?.account;
                    const destReturnRate = destAccObj
                      ? getDefaultReturnRateForAccount(destAccObj)
                      : 0;
                    // Compounded estimate for this specific planned allocation over 1 yr and 5 yrs
                    const yr1Gain =
                      cat.kind === 'savings' && annualAmt > 0 && destReturnRate > 0
                        ? annualAmt * (destReturnRate / 100) * 0.5
                        : 0;
                    const yr5Value =
                      cat.kind === 'savings' && annualAmt > 0 && destReturnRate > 0
                        ? (() => {
                            const r = destReturnRate / 100;
                            let v = 0;
                            for (let y = 0; y < 5; y++) {
                              v = (v + annualAmt * 0.5) * (1 + r) + annualAmt * 0.5;
                            }
                            return v;
                          })()
                        : annualAmt * 5;

                    return (
                      <div
                        key={cat.id}
                        className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 hover:bg-raised/40 text-xs"
                      >
                        {/* Left: Category Name & Investment Growth Estimate */}
                        <div className="min-w-[180px] flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-ink">
                              {cat.name}
                            </span>
                            {cat.isRecurring && (
                              <span className="px-1.5 py-0.2 rounded bg-indigo/10 text-indigo text-[10px]">
                                Recurring
                              </span>
                            )}
                            {cat.kind === 'savings' &&
                              annualAmt > 0 &&
                              destAccObj && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-positive/10 text-positive text-[10px] font-medium tabular-nums">
                                  <TrendingUp className="w-3 h-3" />
                                  <span>
                                    Est. +{formatCurrency(yr1Gain, currency)} yield in {planningYear} · 5-Yr Value: {formatCurrency(yr5Value, currency)} ({destReturnRate}% p.a.)
                                  </span>
                                </span>
                              )}
                          </div>
                        </div>

                        {/* Right Controls: Schedule, Monthly Input, Annual Input, Account Picker */}
                        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                          {/* Schedule Toggle */}
                          <select
                            value={schedule}
                            onChange={(e) =>
                              updateCategoryPlan(cat, {
                                schedule: e.target.value as
                                  | 'monthly'
                                  | 'annual_lump',
                              })
                            }
                            className="h-7 px-2 rounded bg-raised border border-line text-[11px] text-ink-2 focus:text-ink focus:outline-none"
                            title="Planning schedule"
                          >
                            <option value="monthly">Monthly × 12</option>
                            <option value="annual_lump">Annual Total</option>
                          </select>

                          {/* Monthly Amount Input */}
                          <div className="inline-flex items-center gap-1">
                            <span className="text-[10px] text-ink-3">Mo:</span>
                            <input
                              type="number"
                              step="10"
                              value={
                                monthlyAmt === 0
                                  ? ''
                                  : Number(monthlyAmt.toFixed(2))
                              }
                              placeholder="0"
                              onChange={(e) => {
                                const m = parseFloat(e.target.value) || 0;
                                updateCategoryPlan(cat, {
                                  annualAmount: m * 12,
                                  schedule: 'monthly',
                                });
                              }}
                              className="no-spinner w-20 h-7 px-2 rounded bg-raised border border-line text-right tabular-nums text-ink-2 focus:text-ink focus:outline-none"
                              title="Planned monthly equivalent"
                            />
                          </div>

                          {/* Annual Amount Input */}
                          <div className="inline-flex items-center gap-1">
                            <span className="text-[10px] text-ink-3 font-medium">
                              Year ({currency}):
                            </span>
                            <input
                              type="number"
                              step="50"
                              value={
                                annualAmt === 0
                                  ? ''
                                  : Number(annualAmt.toFixed(2))
                              }
                              placeholder="0"
                              onChange={(e) => {
                                const yrVal = parseFloat(e.target.value) || 0;
                                updateCategoryPlan(cat, {
                                  annualAmount: yrVal,
                                });
                              }}
                              className="no-spinner w-24 h-7 px-2 rounded bg-surface border border-line text-right tabular-nums font-semibold text-ink focus:border-ink focus:outline-none"
                              title={`Total planned amount for ${planningYear}`}
                            />
                          </div>

                          {/* Corresponds to Account Picker */}
                          <select
                            value={linkedAccId}
                            onChange={(e) =>
                              updateCategoryPlan(cat, {
                                accountId: e.target.value || undefined,
                              })
                            }
                            className="h-7 px-2 rounded bg-raised border border-line text-[11px] text-ink max-w-[190px] focus:outline-none"
                            title={
                              cat.kind === 'income'
                                ? 'Account where this planned income is deposited'
                                : cat.kind === 'savings'
                                  ? 'Source bank account funding this contribution'
                                  : 'Account this planned expense corresponds to'
                            }
                          >
                            <option value="">
                              {cat.kind === 'income'
                                ? 'Deposit Account…'
                                : cat.kind === 'savings'
                                  ? 'From Account…'
                                  : 'Corresponds to Account…'}
                            </option>
                            {visibleAccounts.map((ar) => (
                              <option key={ar.account.id} value={ar.account.id}>
                                {ar.account.name} (
                                {formatNumber(ar.liveBalance)})
                              </option>
                            ))}
                          </select>

                          {/* Destination Account Picker for Savings / Investments */}
                          {cat.kind === 'savings' && (
                            <div className="inline-flex items-center gap-1">
                              <ArrowRight className="w-3 h-3 text-indigo shrink-0" />
                              <select
                                value={destAccId}
                                onChange={(e) =>
                                  updateCategoryPlan(cat, {
                                    destinationAccountId:
                                      e.target.value || undefined,
                                  })
                                }
                                className="h-7 px-2 rounded bg-indigo/10 border border-indigo/30 text-[11px] text-ink max-w-[190px] focus:outline-none"
                                title="Destination investment, retirement, or savings account where the money goes"
                              >
                                <option value="">
                                  Into Investment / Savings…
                                </option>
                                {visibleAccounts.map((ar) => (
                                  <option
                                    key={ar.account.id}
                                    value={ar.account.id}
                                  >
                                    {ar.account.name} (
                                    {getDefaultReturnRateForAccount(ar.account)}
                                    % p.a.)
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          {annualAmt > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                onDeleteYearlyPlanItem(
                                  plan?.id ?? `yp-${planningYear}-${cat.id}`
                                )
                              }
                              className="p-1 text-ink-3 hover:text-accent cursor-pointer"
                              title="Clear planned amount"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};
