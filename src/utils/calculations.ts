import {
  ActiveWorkspace,
  CategoryGroup,
  CategoryItem,
  FinancialAccount,
  LedgerMode,
  LedgerState,
  TransactionItem,
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

  const monthBudgetsMap = new Map<string, { budget: number; directActual: number | null }>();
  for (const mb of state.monthlyBudgets) {
    if (mb.monthKey === monthKey) {
      monthBudgetsMap.set(mb.categoryId, {
        budget: mb.budget,
        directActual: mb.directActual ?? null,
      });
    }
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
      const budget = mb !== undefined ? mb.budget : cat.defaultBudget;
      const txStats = txByCat.get(cat.id) ?? { sum: 0, count: 0, deductible: 0, vat: 0 };
      const directActual = mb?.directActual ?? null;
      const actual = directActual !== null ? directActual : txStats.sum;
      const difference =
        group.kind === 'income' ? actual - budget : budget - actual;

      const catTaxRate = cat.taxRate ?? 0;
      const catDedPct = cat.deductiblePct ?? (cat.mode === 'freelancer' ? 100 : 0);

      const deductibleActual =
        directActual !== null
          ? group.kind !== 'income'
            ? actual * (catDedPct / 100)
            : 0
          : txStats.deductible;

      const vatAmount =
        directActual !== null
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

export function computeAccountLiveBalance(
  account: FinancialAccount,
  transactions: TransactionItem[]
): AccountComputedItem {
  let txIncomeSum = 0;
  let txExpenseSum = 0;
  let txCount = 0;

  for (const tx of transactions) {
    if (tx.accountId === account.id) {
      txCount++;
      if (tx.type === 'income') {
        txIncomeSum += tx.amount;
      } else {
        txExpenseSum += tx.amount;
      }
    }
  }

  const txNetDelta =
    account.classification === 'liability'
      ? txExpenseSum - txIncomeSum
      : txIncomeSum - txExpenseSum;

  const liveBalance = account.autoTrackTransactions
    ? account.startingBalance + txNetDelta
    : account.currentBalance;

  return {
    account,
    liveBalance,
    txIncomeSum,
    txExpenseSum,
    txNetDelta,
    txCount,
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
  const accounts = rawAccounts.map((acc) =>
    computeAccountLiveBalance(acc, state.transactions ?? [])
  );

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
    const projectedLiquid = Math.max(0, liquidAssets + cumulativeCashflow);
    const projectedTotalAssets =
      projectedLiquid + retirementAssets + investmentAssets + fixedAssets;
    const projectedNetWorth = projectedTotalAssets - totalLiabilities;

    return {
      month,
      monthLabel: label,
      monthKey: mk,
      liquidAssets: projectedLiquid,
      retirementAssets,
      investmentAssets,
      fixedAssets,
      totalAssets: projectedTotalAssets,
      totalLiabilities,
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
