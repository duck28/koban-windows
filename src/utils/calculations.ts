import {
  ActiveWorkspace,
  CategoryGroup,
  CategoryItem,
  FinancialAccount,
  LedgerMode,
  LedgerState,
  RecurringFrequency,
  RecurringRule,
  TransactionItem,
  YearlyPlanSchedule,
} from '../types';
import { formatMonthKey } from '../data/templates';

export interface CategoryComputedRow {
  category: CategoryItem;
  group: CategoryGroup;
  budget: number;
  txActual: number;
  directActual: number | null;
  actual: number;
  /**
   * Vertex42 convention:
   * - Income: Actual - Budget (positive = earned more than planned)
   * - Expense / Savings: Budget - Actual (positive = spent less than planned / under budget)
   */
  difference: number;
  txCount: number;
  deductibleActual: number;
  vatAmount: number;
  /** Budget comes from a scheduled recurring rule (bi-weekly / bi-monthly / quarterly / yearly) */
  budgetFromSchedule: boolean;
  /** Budget typed by hand this month although a recurring schedule exists */
  budgetOverridesSchedule: boolean;
  /** Category is marked as a fixed cost (anchor toggle) */
  isFixedCost: boolean;
  /** Actual is the Budget filled in automatically (fixed cost, no transactions, no typed Actual) */
  autoActual: boolean;
}

export interface GroupComputedSummary {
  group: CategoryGroup;
  rows: CategoryComputedRow[];
  totalBudget: number;
  totalActual: number;
  totalDifference: number;
  totalDeductible: number;
  totalVat: number;
}

export interface MonthSummaryMetrics {
  monthKey: string;
  incomeBudget: number;
  incomeActual: number;
  incomeDifference: number;
  expenseBudget: number;
  expenseActual: number;
  expenseDifference: number;
  savingsBudget: number;
  savingsActual: number;
  savingsDifference: number;
  /** Vertex42 Total Expenses includes all non-income groups (expenses + savings allocations) */
  totalOutflowBudget: number;
  totalOutflowActual: number;
  totalOutflowDifference: number;
  netBudget: number;
  netActual: number;
  netDifference: number;
  savingsRatePct: number;
  /** Freelancer / Business specific */
  deductibleExpensesActual: number;
  vatCollected: number;
  vatPaidOnExpenses: number;
  netVatPayable: number;
  estimatedTaxReserve: number;
  groups: GroupComputedSummary[];
}

export function formatCurrency(amount: number, currency = 'CHF'): string {
  const isWhole = Math.abs(amount - Math.round(amount)) < 0.005;
  const formatted = new Intl.NumberFormat('de-CH', {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${currency} ${formatted}`;
}

export function formatNumber(amount: number, alwaysDecimals = false): string {
  const isWhole = !alwaysDecimals && Math.abs(amount - Math.round(amount)) < 0.005;
  return new Intl.NumberFormat('de-CH', {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function computeMonthSummary(
  state: LedgerState,
  monthKey: string,
  workspace: ActiveWorkspace
): MonthSummaryMetrics {
  const filterMode = (m: LedgerMode) =>
    workspace === 'combined' ? true : m === workspace;

  const activeGroups = state.groups
    .filter((g) => filterMode(g.mode))
    .sort((a, b) => a.order - b.order);

  const activeCategories = state.categories
    .filter((c) => filterMode(c.mode))
    .sort((a, b) => a.order - b.order);

  const monthBudgetsMap = new Map<
    string,
    { budget: number; directActual: number | null; budgetManual: boolean }
  >();
  for (const mb of state.monthlyBudgets) {
    if (mb.monthKey === monthKey) {
      monthBudgetsMap.set(mb.categoryId, {
        budget: mb.budget,
        directActual: mb.directActual ?? null,
        budgetManual: mb.budgetManual ?? false,
      });
    }
  }

  // Fixed costs: Actual follows Budget (setting, absent ⇒ on)
  const autoFillFixed = state.settings.autoFillFixedActuals ?? true;

  // Recurring rules with a start week / month: the budget varies per month
  const scheduledBudgetByCat = new Map<string, number>();
  for (const r of state.recurringRules ?? []) {
    if (!r.active || !(r.amount > 0) || !isScheduledRule(r)) continue;
    const amt = recurringAmountForMonth(r, monthKey);
    if (amt === null) continue;
    scheduledBudgetByCat.set(
      r.categoryId,
      (scheduledBudgetByCat.get(r.categoryId) ?? 0) + amt
    );
  }

  const monthTxs = state.transactions.filter(
    (t) => t.monthKey === monthKey && filterMode(t.mode)
  );

  const txByCat = new Map<string, { sum: number; count: number; deductible: number; vat: number }>();
  for (const tx of monthTxs) {
    const cur = txByCat.get(tx.categoryId) ?? { sum: 0, count: 0, deductible: 0, vat: 0 };
    cur.sum += tx.amount;
    cur.count += 1;
    const dedPct = tx.deductiblePct ?? 100;
    const taxRate = tx.taxRate ?? 0;
    if (tx.type === 'expense') {
      cur.deductible += tx.amount * (dedPct / 100);
    }
    if (taxRate > 0) {
      const vatPart = tx.amount - tx.amount / (1 + taxRate / 100);
      cur.vat += vatPart;
    }
    txByCat.set(tx.categoryId, cur);
  }

  const groupSummaries: GroupComputedSummary[] = activeGroups.map((group) => {
    const cats = activeCategories.filter((c) => c.groupId === group.id);
    const rows: CategoryComputedRow[] = cats.map((cat) => {
      const mb = monthBudgetsMap.get(cat.id);
      const scheduledBudget = scheduledBudgetByCat.get(cat.id);
      const budgetFromSchedule =
        scheduledBudget !== undefined && !(mb?.budgetManual ?? false);
      const budget = budgetFromSchedule
        ? scheduledBudget
        : mb !== undefined
          ? mb.budget
          : cat.defaultBudget;
      const txStats = txByCat.get(cat.id) ?? { sum: 0, count: 0, deductible: 0, vat: 0 };
      const directActual = mb?.directActual ?? null;
      const isFixedCost = Boolean(cat.isFixedCost);
      const autoActual =
        autoFillFixed && isFixedCost && directActual === null && txStats.count === 0;
      // A typed or auto-filled Actual is not backed by transactions: derive VAT/deductible from it
      const derivedActual = directActual ?? (autoActual ? budget : null);
      const actual = derivedActual !== null ? derivedActual : txStats.sum;
      const difference =
        group.kind === 'income' ? actual - budget : budget - actual;

      const catTaxRate = cat.taxRate ?? 0;
      const catDedPct = cat.deductiblePct ?? (cat.mode === 'freelancer' ? 100 : 0);

      const deductibleActual =
        derivedActual !== null
          ? group.kind !== 'income'
            ? actual * (catDedPct / 100)
            : 0
          : txStats.deductible;

      const vatAmount =
        derivedActual !== null
          ? catTaxRate > 0
            ? actual - actual / (1 + catTaxRate / 100)
            : 0
          : txStats.vat;

      return {
        category: cat,
        group,
        budget,
        txActual: txStats.sum,
        directActual,
        actual,
        difference,
        txCount: txStats.count,
        deductibleActual,
        vatAmount,
        budgetFromSchedule,
        budgetOverridesSchedule:
          scheduledBudget !== undefined && (mb?.budgetManual ?? false),
        isFixedCost,
        autoActual,
      };
    });

    const totalBudget = rows.reduce((acc, r) => acc + r.budget, 0);
    const totalActual = rows.reduce((acc, r) => acc + r.actual, 0);
    const totalDifference =
      group.kind === 'income'
        ? totalActual - totalBudget
        : totalBudget - totalActual;
    const totalDeductible = rows.reduce((acc, r) => acc + r.deductibleActual, 0);
    const totalVat = rows.reduce((acc, r) => acc + r.vatAmount, 0);

    return {
      group,
      rows,
      totalBudget,
      totalActual,
      totalDifference,
      totalDeductible,
      totalVat,
    };
  });

  let incomeBudget = 0;
  let incomeActual = 0;
  let expenseBudget = 0;
  let expenseActual = 0;
  let savingsBudget = 0;
  let savingsActual = 0;
  let deductibleExpensesActual = 0;
  let vatCollected = 0;
  let vatPaidOnExpenses = 0;

  for (const gs of groupSummaries) {
    if (gs.group.kind === 'income') {
      incomeBudget += gs.totalBudget;
      incomeActual += gs.totalActual;
      vatCollected += gs.totalVat;
    } else if (gs.group.kind === 'savings') {
      savingsBudget += gs.totalBudget;
      savingsActual += gs.totalActual;
      deductibleExpensesActual += gs.totalDeductible;
    } else {
      expenseBudget += gs.totalBudget;
      expenseActual += gs.totalActual;
      deductibleExpensesActual += gs.totalDeductible;
      vatPaidOnExpenses += gs.totalVat;
    }
  }

  const totalOutflowBudget = expenseBudget + savingsBudget;
  const totalOutflowActual = expenseActual + savingsActual;
  const totalOutflowDifference = totalOutflowBudget - totalOutflowActual;

  const netBudget = incomeBudget - totalOutflowBudget;
  const netActual = incomeActual - totalOutflowActual;
  const netDifference = netActual - netBudget;

  const retainedOrSaved = netActual + savingsActual;
  const savingsRatePct =
    incomeActual > 0 ? Math.max(0, (retainedOrSaved / incomeActual) * 100) : 0;

  const netVatPayable = Math.max(0, vatCollected - vatPaidOnExpenses);
  const netOperatingProfit = Math.max(0, incomeActual - deductibleExpensesActual);
  const estimatedTaxReserve =
    netOperatingProfit * ((state.settings.taxReserveRate || 25) / 100);

  return {
    monthKey,
    incomeBudget,
    incomeActual,
    incomeDifference: incomeActual - incomeBudget,
    expenseBudget,
    expenseActual,
    expenseDifference: expenseBudget - expenseActual,
    savingsBudget,
    savingsActual,
    savingsDifference: savingsBudget - savingsActual,
    totalOutflowBudget,
    totalOutflowActual,
    totalOutflowDifference,
    netBudget,
    netActual,
    netDifference,
    savingsRatePct,
    deductibleExpensesActual,
    vatCollected,
    vatPaidOnExpenses,
    netVatPayable,
    estimatedTaxReserve,
    groups: groupSummaries,
  };
}

export interface AnnualMonthPoint {
  month: number;
  monthLabel: string;
  monthKey: string;
  incomeBudget: number;
  incomeActual: number;
  outflowBudget: number;
  outflowActual: number;
  netBudget: number;
  netActual: number;
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function computeAnnualSeries(
  state: LedgerState,
  year: number,
  workspace: ActiveWorkspace
): AnnualMonthPoint[] {
  return SHORT_MONTHS.map((label, idx) => {
    const month = idx + 1;
    const mk = formatMonthKey(year, month);
    const summary = computeMonthSummary(state, mk, workspace);
    return {
      month,
      monthLabel: label,
      monthKey: mk,
      incomeBudget: summary.incomeBudget,
      incomeActual: summary.incomeActual,
      outflowBudget: summary.totalOutflowBudget,
      outflowActual: summary.totalOutflowActual,
      netBudget: summary.netBudget,
      netActual: summary.netActual,
    };
  });
}

export interface AccountComputedItem {
  account: FinancialAccount;
  liveBalance: number;
  txIncomeSum: number;
  txExpenseSum: number;
  txNetDelta: number;
  txCount: number;
  /** Savings moved in from other accounts (savings categories whose target is this account) */
  txTransferInSum: number;
}

export interface NetWorthHistoryPoint {
  month: number;
  monthLabel: string;
  monthKey: string;
  liquidAssets: number;
  retirementAssets: number;
  investmentAssets: number;
  fixedAssets: number;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  hasExplicitSnapshot: boolean;
}

export interface NetWorthSummaryMetrics {
  accounts: AccountComputedItem[];
  liquidAssets: number;
  retirementAssets: number;
  investmentAssets: number;
  fixedAssets: number;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  liquidSharePct: number;
  retirementSharePct: number;
  investmentSharePct: number;
  fixedAssetSharePct: number;
  debtToAssetRatioPct: number;
  liquidRunwayMonths: number;
  historySeries: NetWorthHistoryPoint[];
}

/** categoryId → target account id, for savings categories that have one. */
export function savingsTargetMap(categories: CategoryItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of categories) {
    if (c.kind === 'savings' && c.targetAccountId) map.set(c.id, c.targetAccountId);
  }
  return map;
}

export function computeAccountLiveBalance(
  account: FinancialAccount,
  transactions: TransactionItem[],
  savingsTargets: Map<string, string> = new Map()
): AccountComputedItem {
  let txIncomeSum = 0;
  let txExpenseSum = 0;
  let txCount = 0;
  let txTransferInSum = 0;
  // Manually valued accounts: only savings moved in after the last valuation are added
  let pendingTransferIn = 0;

  for (const tx of transactions) {
    if (tx.accountId === account.id) {
      txCount++;
      if (tx.type === 'income') {
        txIncomeSum += tx.amount;
      } else {
        txExpenseSum += tx.amount;
      }
    } else if (
      tx.type === 'expense' &&
      savingsTargets.get(tx.categoryId) === account.id
    ) {
      txCount++;
      txTransferInSum += tx.amount;
      if (tx.date > (account.updatedAt ?? '')) pendingTransferIn += tx.amount;
    }
  }

  // A transfer in raises an asset and pays down a liability
  const inflow = txIncomeSum + txTransferInSum;
  const txNetDelta =
    account.classification === 'liability'
      ? txExpenseSum - inflow
      : inflow - txExpenseSum;

  const liveBalance = account.autoTrackTransactions
    ? account.startingBalance + txNetDelta
    : account.currentBalance +
      (account.classification === 'liability' ? -pendingTransferIn : pendingTransferIn);

  return {
    account,
    liveBalance,
    txIncomeSum,
    txExpenseSum,
    txNetDelta,
    txCount,
    txTransferInSum,
  };
}

export function computeNetWorthMetrics(
  state: LedgerState,
  workspace: ActiveWorkspace,
  monthlyOutflowReference = 0
): NetWorthSummaryMetrics {
  const filterMode = (m: LedgerMode) =>
    workspace === 'combined' ? true : m === workspace;

  const rawAccounts = (state.accounts ?? []).filter((a) => filterMode(a.mode));
  const savingsTargets = savingsTargetMap(state.categories ?? []);
  const accounts = rawAccounts.map((acc) =>
    computeAccountLiveBalance(acc, state.transactions ?? [], savingsTargets)
  );
  const accountById = new Map(rawAccounts.map((a) => [a.id, a]));

  let liquidAssets = 0;
  let retirementAssets = 0;
  let investmentAssets = 0;
  let fixedAssets = 0;
  let totalLiabilities = 0;

  for (const item of accounts) {
    if (!item.account.includeInNetWorth) continue;
    const val = Math.max(0, item.liveBalance);
    switch (item.account.classification) {
      case 'liquid':
        liquidAssets += val;
        break;
      case 'retirement':
        retirementAssets += val;
        break;
      case 'investment':
        investmentAssets += val;
        break;
      case 'fixed_asset':
        fixedAssets += val;
        break;
      case 'liability':
        totalLiabilities += Math.abs(item.liveBalance);
        break;
    }
  }

  const totalAssets =
    liquidAssets + retirementAssets + investmentAssets + fixedAssets;
  const netWorth = totalAssets - totalLiabilities;

  const liquidSharePct = totalAssets > 0 ? (liquidAssets / totalAssets) * 100 : 0;
  const retirementSharePct =
    totalAssets > 0 ? (retirementAssets / totalAssets) * 100 : 0;
  const investmentSharePct =
    totalAssets > 0 ? (investmentAssets / totalAssets) * 100 : 0;
  const fixedAssetSharePct =
    totalAssets > 0 ? (fixedAssets / totalAssets) * 100 : 0;
  const debtToAssetRatioPct =
    totalAssets > 0 ? (totalLiabilities / totalAssets) * 100 : 0;

  const liquidRunwayMonths =
    monthlyOutflowReference > 0 ? liquidAssets / monthlyOutflowReference : 0;

  // Build 12-month Net Worth trajectory for activeYear
  const snapshotsByMonth = new Map(
    (state.netWorthSnapshots ?? []).map((s) => [s.monthKey, s])
  );
  const annualCashflow = computeAnnualSeries(
    state,
    state.settings.activeYear,
    workspace
  );

  let cumulativeCashflow = 0;
  // Savings with a target account move money into that account's class instead of vanishing
  const cumulativeTransfers = { liquid: 0, retirement: 0, investment: 0, fixed_asset: 0, liability: 0 };
  const historySeries: NetWorthHistoryPoint[] = SHORT_MONTHS.map((label, idx) => {
    const month = idx + 1;
    const mk = formatMonthKey(state.settings.activeYear, month);
    const snap = snapshotsByMonth.get(mk);

    if (snap) {
      return {
        month,
        monthLabel: label,
        monthKey: mk,
        liquidAssets: snap.liquidAssets,
        retirementAssets: snap.retirementAssets,
        investmentAssets: snap.investmentAssets,
        fixedAssets: snap.fixedAssets,
        totalAssets: snap.totalAssets,
        totalLiabilities: snap.totalLiabilities,
        netWorth: snap.netWorth,
        hasExplicitSnapshot: true,
      };
    }

    const cf = annualCashflow[idx];
    cumulativeCashflow += cf ? cf.netActual : 0;
    if (savingsTargets.size > 0) {
      for (const gs of computeMonthSummary(state, mk, workspace).groups) {
        if (gs.group.kind !== 'savings') continue;
        for (const row of gs.rows) {
          const target = accountById.get(savingsTargets.get(row.category.id) ?? '');
          if (target && target.includeInNetWorth && row.actual !== 0) {
            cumulativeTransfers[target.classification] += row.actual;
          }
        }
      }
    }
    const projectedLiquid = Math.max(
      0,
      liquidAssets + cumulativeCashflow + cumulativeTransfers.liquid
    );
    const projectedRetirement = retirementAssets + cumulativeTransfers.retirement;
    const projectedInvestment = investmentAssets + cumulativeTransfers.investment;
    const projectedFixed = fixedAssets + cumulativeTransfers.fixed_asset;
    const projectedLiabilities = Math.max(
      0,
      totalLiabilities - cumulativeTransfers.liability
    );
    const projectedTotalAssets =
      projectedLiquid + projectedRetirement + projectedInvestment + projectedFixed;
    const projectedNetWorth = projectedTotalAssets - projectedLiabilities;

    return {
      month,
      monthLabel: label,
      monthKey: mk,
      liquidAssets: projectedLiquid,
      retirementAssets: projectedRetirement,
      investmentAssets: projectedInvestment,
      fixedAssets: projectedFixed,
      totalAssets: projectedTotalAssets,
      totalLiabilities: projectedLiabilities,
      netWorth: projectedNetWorth,
      hasExplicitSnapshot: false,
    };
  });

  return {
    accounts,
    liquidAssets,
    retirementAssets,
    investmentAssets,
    fixedAssets,
    totalAssets,
    totalLiabilities,
    netWorth,
    liquidSharePct,
    retirementSharePct,
    investmentSharePct,
    fixedAssetSharePct,
    debtToAssetRatioPct,
    liquidRunwayMonths,
    historySeries,
  };
}

/** Payments per year for a Yearly Planner schedule. */
export function planPeriodsPerYear(schedule: YearlyPlanSchedule): number {
  switch (schedule) {
    case 'biweekly':
      return 26;
    case 'monthly':
      return 12;
    case 'bimonthly':
      return 6;
    case 'quarterly':
      return 4;
    case 'annual_lump':
      return 1;
    default:
      return 12;
  }
}

/** Yearly Planner schedule matching a recurring rule's frequency. */
export function planScheduleForFrequency(frequency: RecurringFrequency): YearlyPlanSchedule {
  return frequency === 'yearly' ? 'annual_lump' : frequency;
}

export function recurringMonthlyEquivalent(
  amount: number,
  frequency: RecurringFrequency
): number {
  switch (frequency) {
    case 'biweekly':
      return (amount * 26) / 12;
    case 'monthly':
      return amount;
    case 'bimonthly':
      return amount / 2;
    case 'quarterly':
      return amount / 3;
    case 'yearly':
      return amount / 12;
  }
}

export function recurringAnnualEquivalent(
  amount: number,
  frequency: RecurringFrequency
): number {
  switch (frequency) {
    case 'biweekly':
      return amount * 26;
    case 'monthly':
      return amount * 12;
    case 'bimonthly':
      return amount * 6;
    case 'quarterly':
      return amount * 4;
    case 'yearly':
      return amount;
  }
}

export function recurringMonthInterval(frequency: RecurringFrequency): number {
  switch (frequency) {
    case 'biweekly':
    case 'monthly':
      return 1;
    case 'bimonthly':
      return 2;
    case 'quarterly':
      return 3;
    case 'yearly':
      return 12;
  }
}

export function getRecurringDaysInMonth(
  frequency: RecurringFrequency,
  dayOfMonth: number
): number[] {
  const d = Math.min(28, Math.max(1, Math.round(dayOfMonth) || 1));
  if (frequency === 'biweekly') {
    return d <= 14 ? [d, d + 14] : [d - 14, d];
  }
  return [d];
}

function parseMonthIndex(monthKey: string): number | null {
  const parts = monthKey.split('-');
  if (parts.length !== 2) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
    return null;
  }
  return year * 12 + (month - 1);
}

/** Current calendar month as YYYY-MM (local time). */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Parses YYYY-MM-DD as a UTC day number; null when invalid. */
function parseIsoDay(dateStr: string | undefined): number | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map((p) => parseInt(p, 10));
  const ms = Date.UTC(y, m - 1, d);
  const check = new Date(ms);
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return Math.round(ms / 86400000);
}

function dayNumberToIso(dayNum: number): string {
  return new Date(dayNum * 86400000).toISOString().slice(0, 10);
}

/**
 * True when the rule has an explicit start (start week for bi-weekly, start
 * month for bi-monthly / quarterly / yearly), so the amount due varies per month.
 */
export function isScheduledRule(r: RecurringRule): boolean {
  if (r.frequency === 'biweekly') return parseIsoDay(r.startDate) !== null;
  if (recurringMonthInterval(r.frequency) > 1) {
    return r.startMonth !== undefined && parseMonthIndex(r.startMonth) !== null;
  }
  return false;
}

/**
 * Dates (YYYY-MM-DD) on which the rule falls due inside `monthKey`.
 * Returns null when it cannot be known (legacy bi-monthly / quarterly / yearly
 * rule without a start month).
 */
export function getRecurringOccurrenceDates(
  r: RecurringRule,
  monthKey: string
): string[] | null {
  const targetIdx = parseMonthIndex(monthKey);
  if (targetIdx === null) return null;

  if (r.frequency === 'biweekly') {
    const start = parseIsoDay(r.startDate);
    if (start === null) {
      return getRecurringDaysInMonth('biweekly', r.dayOfMonth).map(
        (d) => `${monthKey}-${String(d).padStart(2, '0')}`
      );
    }
    const year = Math.floor(targetIdx / 12);
    const month = targetIdx % 12;
    const first = Math.round(Date.UTC(year, month, 1) / 86400000);
    const last = Math.round(Date.UTC(year, month + 1, 0) / 86400000);
    if (last < start) return [];
    const offset = Math.max(0, first - start);
    const out: string[] = [];
    for (let day = start + Math.ceil(offset / 14) * 14; day <= last; day += 14) {
      out.push(dayNumberToIso(day));
    }
    return out;
  }

  const dayStr = String(
    getRecurringDaysInMonth(r.frequency, r.dayOfMonth)[0]
  ).padStart(2, '0');
  const interval = recurringMonthInterval(r.frequency);
  if (interval === 1) return [`${monthKey}-${dayStr}`];

  const startIdx = r.startMonth ? parseMonthIndex(r.startMonth) : null;
  if (startIdx === null) return null;
  const diff = targetIdx - startIdx;
  return diff >= 0 && diff % interval === 0 ? [`${monthKey}-${dayStr}`] : [];
}

/** Total amount the rule falls due in `monthKey`, or null when unknown. */
export function recurringAmountForMonth(
  r: RecurringRule,
  monthKey: string
): number | null {
  const dates = getRecurringOccurrenceDates(r, monthKey);
  return dates === null ? null : dates.length * r.amount;
}

export function buildRecurringTransactionsForMonth(
  rules: RecurringRule[],
  existingTransactions: TransactionItem[],
  monthKey: string,
  workspace: ActiveWorkspace
): { activeCount: number; newTransactions: TransactionItem[] } {
  const activeRules = rules.filter(
    (r) =>
      r.active &&
      r.amount > 0 &&
      (workspace === 'combined' || r.mode === workspace)
  );
  if (activeRules.length === 0) {
    return { activeCount: 0, newTransactions: [] };
  }

  const targetIdx = parseMonthIndex(monthKey);
  const newTransactions: TransactionItem[] = [];

  for (const r of activeRules) {
    const interval = recurringMonthInterval(r.frequency);
    const scheduled = isScheduledRule(r);
    if (interval > 1 && !scheduled) {
      const blockedByIntervalOrSameMonth = existingTransactions.some((tx) => {
        if (tx.recurringId === r.id && targetIdx !== null) {
          const txIdx = parseMonthIndex(tx.monthKey);
          if (txIdx !== null && Math.abs(targetIdx - txIdx) < interval) {
            return true;
          }
        }
        return (
          tx.monthKey === monthKey &&
          (tx.recurringId === r.id ||
            (tx.categoryId === r.categoryId &&
              tx.description === r.description &&
              Math.abs(tx.amount - r.amount) < 0.01))
        );
      });
      if (blockedByIntervalOrSameMonth) continue;
    }

    const dates = scheduled
      ? getRecurringOccurrenceDates(r, monthKey) ?? []
      : getRecurringDaysInMonth(r.frequency, r.dayOfMonth).map(
          (day) => `${monthKey}-${String(day).padStart(2, '0')}`
        );
    for (const dateStr of dates) {
      const dayStr = dateStr.slice(8, 10);

      const alreadyExists =
        r.frequency === 'biweekly'
          ? existingTransactions.some(
              (tx) =>
                tx.monthKey === monthKey &&
                tx.date === dateStr &&
                (tx.recurringId === r.id ||
                  (tx.categoryId === r.categoryId &&
                    tx.description === r.description &&
                    Math.abs(tx.amount - r.amount) < 0.01))
            )
          : existingTransactions.some(
              (tx) =>
                tx.monthKey === monthKey &&
                (tx.recurringId === r.id ||
                  (tx.categoryId === r.categoryId &&
                    tx.description === r.description &&
                    Math.abs(tx.amount - r.amount) < 0.01))
            );

      if (alreadyExists) continue;

      const id =
        r.frequency === 'biweekly'
          ? `tx-rec-${r.id}-${monthKey}-${dayStr}`
          : `tx-rec-${r.id}-${monthKey}`;

      newTransactions.push({
        id,
        date: dateStr,
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
    }
  }

  return { activeCount: activeRules.length, newTransactions };
}

/** ISO week string (YYYY-Www) containing the given YYYY-MM-DD date. */
export function isoWeekOfDate(dateStr: string): string | null {
  const dayNum = parseIsoDay(dateStr);
  if (dayNum === null) return null;
  const d = new Date(dayNum * 86400000);
  const weekday = (d.getUTCDay() + 6) % 7; // Mon = 0
  // Thursday of this week decides the ISO year
  const thursday = new Date((dayNum - weekday + 3) * 86400000);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = Date.UTC(isoYear, 0, 4);
  const jan4Weekday = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1Monday = Math.round(jan4 / 86400000) - jan4Weekday;
  const week = Math.floor((dayNum - weekday - week1Monday) / 7) + 1;
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** Weekday of a YYYY-MM-DD date, Monday = 0 … Sunday = 6. */
export function isoWeekdayOfDate(dateStr: string): number | null {
  const dayNum = parseIsoDay(dateStr);
  if (dayNum === null) return null;
  return (new Date(dayNum * 86400000).getUTCDay() + 6) % 7;
}

/** Date (YYYY-MM-DD) of `weekday` (Mon = 0) in ISO week `week` (YYYY-Www). */
export function dateInIsoWeek(week: string, weekday: number): string | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const wk = parseInt(m[2], 10);
  if (wk < 1 || wk > 53) return null;
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Weekday = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1Monday = Math.round(jan4 / 86400000) - jan4Weekday;
  const wd = Math.min(6, Math.max(0, Math.round(weekday)));
  return dayNumberToIso(week1Monday + (wk - 1) * 7 + wd);
}

/** Today as YYYY-MM-DD (local time). */
export function todayIso(now: Date = new Date()): string {
  return `${currentMonthKey(now)}-${String(now.getDate()).padStart(2, '0')}`;
}
