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
  WorksheetSortDirection,
  WorksheetSortField,
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
  const scheduledBudgetByCat = getScheduledBudgetByCategory(
    state.recurringRules ?? [],
    monthKey
  );

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
  /** Transfers & worksheet savings dated on or after the account's last manual valuation */
  pendingTransferIn: number;
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

/**
 * Category id of transactions created by "Transfer between accounts". It matches no budget
 * category, so a transfer pair never counts as income or spending in the worksheet or reports —
 * it only moves money between the two accounts.
 */
export const TRANSFER_CATEGORY_ID = '__transfer__';

/** True for one leg of an account-to-account transfer pair. */
export function isAccountTransfer(tx: Pick<TransactionItem, 'categoryId'>): boolean {
  return tx.categoryId === TRANSFER_CATEGORY_ID;
}

/** categoryId → target account id, for savings categories that have one. */
export function savingsTargetMap(categories: CategoryItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of categories) {
    if (c.kind === 'savings' && c.targetAccountId) map.set(c.id, c.targetAccountId);
  }
  return map;
}

export interface WorksheetSavingsTransfer {
  total: number;
  pendingAfter: (updatedAt: string) => number;
  count: number;
}

/**
 * Sums savings amounts assigned directly in the Monthly Budget worksheet
 * (`monthlyBudgets`: `directActual`, fixed-cost `autoActual`, or budget without transactions)
 * that exceed logged transactions for each savings category & month, grouped by `targetAccountId`.
 */
export function computeWorksheetSavingsTransfers(
  state: LedgerState,
  upToMonthKey?: string
): Map<string, WorksheetSavingsTransfer> {
  const catById = new Map((state.categories ?? []).map((c) => [c.id, c]));
  const rules = state.recurringRules ?? [];

  const txStatsByMonthCat = new Map<string, { sum: number; count: number }>();
  for (const tx of state.transactions ?? []) {
    if (upToMonthKey && tx.monthKey > upToMonthKey) continue;
    const key = `${tx.monthKey}::${tx.categoryId}`;
    const cur = txStatsByMonthCat.get(key) ?? { sum: 0, count: 0 };
    cur.sum += tx.amount;
    cur.count += 1;
    txStatsByMonthCat.set(key, cur);
  }

  // Last entry per (monthKey, categoryId) wins, matching computeMonthSummary
  const latestBudgets = new Map<
    string,
    { monthKey: string; categoryId: string; budget: number; directActual: number | null; budgetManual: boolean }
  >();
  for (const mb of state.monthlyBudgets ?? []) {
    if (upToMonthKey && mb.monthKey > upToMonthKey) continue;
    latestBudgets.set(`${mb.monthKey}::${mb.categoryId}`, {
      monthKey: mb.monthKey,
      categoryId: mb.categoryId,
      budget: mb.budget,
      directActual: mb.directActual ?? null,
      budgetManual: mb.budgetManual ?? false,
    });
  }

  const scheduledCache = new Map<string, Map<string, number>>();
  const getScheduledForMonth = (mk: string) => {
    let m = scheduledCache.get(mk);
    if (!m) {
      m = getScheduledBudgetByCategory(rules, mk);
      scheduledCache.set(mk, m);
    }
    return m;
  };

  const accEntries = new Map<
    string,
    { byMonth: Array<{ monthEnd: string; amount: number }>; count: number }
  >();

  for (const [key, mb] of latestBudgets.entries()) {
    const cat = catById.get(mb.categoryId);
    if (!cat || cat.kind !== 'savings' || !cat.targetAccountId) continue;

    const txStats = txStatsByMonthCat.get(key) ?? { sum: 0, count: 0 };
    const scheduledBudget = getScheduledForMonth(mb.monthKey).get(cat.id);
    const effectiveBudget =
      scheduledBudget !== undefined && !mb.budgetManual ? scheduledBudget : mb.budget;

    let worksheetVal: number;
    if (mb.directActual !== null && mb.directActual !== undefined) {
      worksheetVal = mb.directActual;
    } else if (txStats.count === 0) {
      worksheetVal = effectiveBudget;
    } else {
      worksheetVal = txStats.sum;
    }

    const extra = worksheetVal - txStats.sum;
    if (Math.abs(extra) <= 1e-9) continue;

    const bucket = accEntries.get(cat.targetAccountId) ?? { byMonth: [], count: 0 };
    bucket.byMonth.push({ monthEnd: `${mb.monthKey}-31`, amount: extra });
    bucket.count += 1;
    accEntries.set(cat.targetAccountId, bucket);
  }

  const result = new Map<string, WorksheetSavingsTransfer>();
  for (const [accId, data] of accEntries.entries()) {
    const total = data.byMonth.reduce((s, e) => s + e.amount, 0);
    result.set(accId, {
      total,
      count: data.count,
      pendingAfter: (updatedAt: string) =>
        data.byMonth.reduce(
          (s, e) => (e.monthEnd >= updatedAt ? s + e.amount : s),
          0
        ),
    });
  }
  return result;
}

export function computeAccountLiveBalance(
  account: FinancialAccount,
  transactions: TransactionItem[],
  savingsTargets: Map<string, string> = new Map(),
  worksheetSavings?: { total: number; pending: number; count: number }
): AccountComputedItem {
  let txIncomeSum = 0;
  let txExpenseSum = 0;
  let txCount = worksheetSavings?.count ?? 0;
  let txTransferInSum = worksheetSavings?.total ?? 0;
  // Manually valued accounts: only transfers (savings moved in, or account-to-account transfer
  // pairs) dated on or after the last valuation are added, as money in (+) or out (-) of the asset.
  let pendingTransferIn = worksheetSavings?.pending ?? 0;

  for (const tx of transactions) {
    if (
      tx.type === 'expense' &&
      savingsTargets.get(tx.categoryId) === account.id
    ) {
      txCount++;
      txTransferInSum += tx.amount;
      if (tx.date >= (account.updatedAt ?? '')) pendingTransferIn += tx.amount;
    } else if (tx.accountId === account.id) {
      txCount++;
      if (tx.type === 'income') {
        txIncomeSum += tx.amount;
      } else {
        txExpenseSum += tx.amount;
      }
      if (isAccountTransfer(tx) && tx.date >= (account.updatedAt ?? '')) {
        pendingTransferIn += tx.type === 'income' ? tx.amount : -tx.amount;
      }
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
    pendingTransferIn,
  };
}

interface ClassTotals {
  liquid: number;
  retirement: number;
  investment: number;
  fixed: number;
  liabilities: number;
}

/** Net-worth buckets of a set of account balances (assets floored at 0, like the KPI cards). */
function totalsByClass(items: AccountComputedItem[]): ClassTotals {
  const t: ClassTotals = { liquid: 0, retirement: 0, investment: 0, fixed: 0, liabilities: 0 };
  for (const item of items) {
    if (!item.account.includeInNetWorth) continue;
    const val = Math.max(0, item.liveBalance);
    switch (item.account.classification) {
      case 'liquid':
        t.liquid += val;
        break;
      case 'retirement':
        t.retirement += val;
        break;
      case 'investment':
        t.investment += val;
        break;
      case 'fixed_asset':
        t.fixed += val;
        break;
      case 'liability':
        t.liabilities += Math.abs(item.liveBalance);
        break;
    }
  }
  return t;
}

function historyPoint(
  month: number,
  label: string,
  monthKey: string,
  t: ClassTotals
): NetWorthHistoryPoint {
  const totalAssets = t.liquid + t.retirement + t.investment + t.fixed;
  return {
    month,
    monthLabel: label,
    monthKey,
    liquidAssets: t.liquid,
    retirementAssets: t.retirement,
    investmentAssets: t.investment,
    fixedAssets: t.fixed,
    totalAssets,
    totalLiabilities: t.liabilities,
    netWorth: totalAssets - t.liabilities,
    hasExplicitSnapshot: false,
  };
}

export function computeNetWorthMetrics(
  state: LedgerState,
  workspace: ActiveWorkspace,
  monthlyOutflowReference = 0,
  /** "Today" — decides which months are history and which are forecast (tests pass a fixed date). */
  now: Date = new Date()
): NetWorthSummaryMetrics {
  const filterMode = (m: LedgerMode) =>
    workspace === 'combined' ? true : m === workspace;

  const rawAccounts = (state.accounts ?? []).filter((a) => filterMode(a.mode));
  const savingsTargets = savingsTargetMap(state.categories ?? []);
  const wsTransfers = computeWorksheetSavingsTransfers(state);
  const accounts = rawAccounts.map((acc) => {
    const ws = wsTransfers.get(acc.id);
    return computeAccountLiveBalance(
      acc,
      state.transactions ?? [],
      savingsTargets,
      ws
        ? {
            total: ws.total,
            pending: ws.pendingAfter(acc.updatedAt ?? ''),
            count: ws.count,
          }
        : undefined
    );
  });
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

  // 12-month Net Worth trajectory for activeYear:
  // - an explicit snapshot wins;
  // - past & current months are rebuilt from the transactions dated up to that month's end;
  // - future months start from today's balances and add each month's planned (budget) net,
  //   with savings that have a target account moved into that account's class.
  const snapshotsByMonth = new Map(
    (state.netWorthSnapshots ?? []).map((s) => [s.monthKey, s])
  );
  const todayMonth = currentMonthKey(now);
  const allTxs = state.transactions ?? [];
  const live: ClassTotals = {
    liquid: liquidAssets,
    retirement: retirementAssets,
    investment: investmentAssets,
    fixed: fixedAssets,
    liabilities: totalLiabilities,
  };
  const forecast: ClassTotals = { ...live };
  const classKey: Record<string, keyof ClassTotals> = {
    liquid: 'liquid',
    retirement: 'retirement',
    investment: 'investment',
    fixed_asset: 'fixed',
    liability: 'liabilities',
  };

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

    if (mk <= todayMonth) {
      const monthEnd = `${mk}-31`;
      const upTo = allTxs.filter((t) => t.date <= monthEnd);
      const wsUpTo = computeWorksheetSavingsTransfers(state, mk);
      const items = rawAccounts.map((acc) => {
        const ws = wsUpTo.get(acc.id);
        return computeAccountLiveBalance(
          acc,
          upTo,
          savingsTargets,
          ws
            ? {
                total: ws.total,
                pending: ws.pendingAfter(acc.updatedAt ?? ''),
                count: ws.count,
              }
            : undefined
        );
      });
      return historyPoint(month, label, mk, totalsByClass(items));
    }

    // Forecast: planned net of this month on top of the running forecast
    const summary = computeMonthSummary(state, mk, workspace);
    for (const gs of summary.groups) {
      if (gs.group.kind !== 'savings') continue;
      for (const row of gs.rows) {
        const target = accountById.get(savingsTargets.get(row.category.id) ?? '');
        if (target && target.includeInNetWorth && row.budget !== 0) {
          const key = classKey[target.classification];
          forecast[key] += key === 'liabilities' ? -row.budget : row.budget;
        }
      }
    }
    // netBudget already subtracts the savings; the part moved into tracked accounts is not lost
    forecast.liquid += summary.netBudget;
    const clamped: ClassTotals = {
      ...forecast,
      liquid: Math.max(0, forecast.liquid),
      liabilities: Math.max(0, forecast.liabilities),
    };
    return historyPoint(month, label, mk, clamped);
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
    case 'weekly':
      return 52;
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
    case 'weekly':
      return (amount * 52) / 12;
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
    case 'weekly':
      return amount * 52;
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
    case 'weekly':
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
  if (frequency === 'weekly') {
    const base = ((d - 1) % 7) + 1;
    return [base, base + 7, base + 14, base + 21];
  }
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
 * True when the rule has an explicit start (start date for weekly/bi-weekly/monthly,
 * start month or start date for bi-monthly / quarterly / yearly), so the amount due
 * is computed per month from the schedule.
 */
export function isScheduledRule(r: RecurringRule): boolean {
  if (r.frequency === 'weekly' || r.frequency === 'biweekly') {
    return parseIsoDay(r.startDate) !== null;
  }
  if (r.frequency === 'monthly') {
    return (
      parseIsoDay(r.startDate) !== null ||
      (r.startMonth !== undefined && parseMonthIndex(r.startMonth) !== null)
    );
  }
  if (recurringMonthInterval(r.frequency) > 1) {
    return (
      (r.startMonth !== undefined && parseMonthIndex(r.startMonth) !== null) ||
      parseIsoDay(r.startDate) !== null
    );
  }
  return false;
}

export function getScheduledBudgetByCategory(
  rules: RecurringRule[],
  monthKey: string
): Map<string, number> {
  const scheduledBudgetByCat = new Map<string, number>();
  for (const r of rules) {
    if (!r.active || !(r.amount > 0) || !isScheduledRule(r)) continue;
    const amt = recurringAmountForMonth(r, monthKey);
    if (amt === null) continue;
    scheduledBudgetByCat.set(
      r.categoryId,
      (scheduledBudgetByCat.get(r.categoryId) ?? 0) + amt
    );
  }
  return scheduledBudgetByCat;
}

/**
 * Dates (YYYY-MM-DD) on which the rule falls due inside `monthKey`.
 * Returns null when it cannot be known (legacy bi-monthly / quarterly / yearly
 * rule without a start month or start date).
 */
export function getRecurringOccurrenceDates(
  r: RecurringRule,
  monthKey: string
): string[] | null {
  const targetIdx = parseMonthIndex(monthKey);
  if (targetIdx === null) return null;

  if (r.frequency === 'weekly' || r.frequency === 'biweekly') {
    const step = r.frequency === 'weekly' ? 7 : 14;
    const start = parseIsoDay(r.startDate);
    if (start === null) {
      return getRecurringDaysInMonth(r.frequency, r.dayOfMonth).map(
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
    for (let day = start + Math.ceil(offset / step) * step; day <= last; day += step) {
      out.push(dayNumberToIso(day));
    }
    return out;
  }

  const parsedStart = parseIsoDay(r.startDate);
  const effectiveDay =
    parsedStart !== null
      ? Math.min(28, Math.max(1, parseInt(r.startDate!.slice(8, 10), 10) || 1))
      : getRecurringDaysInMonth(r.frequency, r.dayOfMonth)[0];
  const dayStr = String(effectiveDay).padStart(2, '0');
  const interval = recurringMonthInterval(r.frequency);
  const effectiveStartMonth =
    r.startMonth ?? (parsedStart !== null ? r.startDate!.slice(0, 7) : undefined);
  const startIdx = effectiveStartMonth ? parseMonthIndex(effectiveStartMonth) : null;

  if (interval === 1) {
    if (startIdx !== null) {
      if (targetIdx < startIdx) return [];
      if (targetIdx === startIdx && parsedStart !== null) {
        return [r.startDate!];
      }
    }
    return [`${monthKey}-${dayStr}`];
  }

  if (startIdx === null) return null;
  const diff = targetIdx - startIdx;
  if (diff < 0 || diff % interval !== 0) return [];
  if (diff === 0 && parsedStart !== null) {
    return [r.startDate!];
  }
  return [`${monthKey}-${dayStr}`];
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

      const isMultiPerMonth =
        r.frequency === 'weekly' || r.frequency === 'biweekly';

      const alreadyExists = isMultiPerMonth
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

      const id = isMultiPerMonth
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

export function sortWorksheetRows(
  rows: CategoryComputedRow[],
  sortBy: WorksheetSortField = 'manual',
  sortDir: WorksheetSortDirection = 'asc',
  getDisplayName: (cat: CategoryItem) => string = (c) => c.name
): CategoryComputedRow[] {
  const dir = sortDir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (sortBy === 'manual') {
      return a.category.order - b.category.order;
    }
    let cmp = 0;
    if (sortBy === 'name') {
      cmp = getDisplayName(a.category).localeCompare(
        getDisplayName(b.category),
        undefined,
        { sensitivity: 'base', numeric: true }
      );
    } else if (sortBy === 'budget') {
      cmp = a.budget - b.budget;
    } else if (sortBy === 'actual') {
      cmp = a.actual - b.actual;
    } else if (sortBy === 'diff') {
      cmp = a.difference - b.difference;
    }
    if (cmp !== 0) return cmp * dir;
    return a.category.order - b.category.order;
  });
}

export function reorderCategoriesList(
  categories: CategoryItem[],
  groups: CategoryGroup[],
  opts: {
    draggedCategoryId: string;
    targetGroupId: string;
    targetCategoryId: string | null;
    position: 'before' | 'after';
    /** Current displayed order of category IDs in targetGroupId (e.g. when sorted) */
    baseOrderIds?: string[];
  }
): CategoryItem[] {
  const dragged = categories.find((c) => c.id === opts.draggedCategoryId);
  const targetGroup = groups.find((g) => g.id === opts.targetGroupId);
  if (!dragged || !targetGroup) return categories;
  if (opts.targetCategoryId === opts.draggedCategoryId) return categories;

  const sourceGroupId = dragged.groupId;
  const targetMembers = categories
    .filter((c) => c.groupId === targetGroup.id && c.id !== dragged.id)
    .sort((a, b) => a.order - b.order);

  let orderedTarget: CategoryItem[];
  if (opts.baseOrderIds && opts.baseOrderIds.length > 0) {
    const byId = new Map(targetMembers.map((c) => [c.id, c]));
    orderedTarget = [];
    const seen = new Set<string>();
    for (const id of opts.baseOrderIds) {
      if (id === dragged.id || seen.has(id)) continue;
      const item = byId.get(id);
      if (item) {
        orderedTarget.push(item);
        seen.add(id);
      }
    }
    for (const item of targetMembers) {
      if (!seen.has(item.id)) orderedTarget.push(item);
    }
  } else {
    orderedTarget = [...targetMembers];
  }

  const updatedDragged: CategoryItem = {
    ...dragged,
    groupId: targetGroup.id,
    kind: targetGroup.kind,
    mode: targetGroup.mode,
  };

  let insertIdx = orderedTarget.length;
  if (opts.targetCategoryId) {
    const idx = orderedTarget.findIndex((c) => c.id === opts.targetCategoryId);
    if (idx !== -1) {
      insertIdx = opts.position === 'before' ? idx : idx + 1;
    }
  }
  orderedTarget.splice(insertIdx, 0, updatedDragged);

  const orderById = new Map<string, number>();
  orderedTarget.forEach((c, idx) => orderById.set(c.id, idx));

  if (sourceGroupId !== targetGroup.id) {
    categories
      .filter((c) => c.groupId === sourceGroupId && c.id !== dragged.id)
      .sort((a, b) => a.order - b.order)
      .forEach((c, idx) => orderById.set(c.id, idx));
  }

  return categories.map((c) => {
    if (c.id === dragged.id) {
      return {
        ...updatedDragged,
        order: orderById.get(dragged.id) ?? 0,
      };
    }
    const nextOrder = orderById.get(c.id);
    return nextOrder !== undefined ? { ...c, order: nextOrder } : c;
  });
}
