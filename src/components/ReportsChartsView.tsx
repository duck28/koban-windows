import React, { useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  PieChart as PieChartIcon,
  BarChart3,
  Briefcase,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { ActiveWorkspace, LedgerState } from '../types';
import {
  AnnualMonthPoint,
  CategoryComputedRow,
  formatCurrency,
  formatNumber,
  MonthSummaryMetrics,
} from '../utils/calculations';

interface ReportsChartsViewProps {
  state: LedgerState;
  summary: MonthSummaryMetrics;
  annualSeries: AnnualMonthPoint[];
  workspace: ActiveWorkspace;
  currency: string;
}

export const ReportsChartsView: React.FC<ReportsChartsViewProps> = ({
  state,
  summary,
  annualSeries,
  workspace,
  currency,
}) => {
  const [hoveredSlice, setHoveredSlice] = useState<string | null>(null);

  const outflowGroups = summary.groups.filter(
    (g) => g.group.kind !== 'income' && (g.totalActual > 0 || g.totalBudget > 0)
  );

  const activeSpendingGroups = outflowGroups
    .filter((g) => g.totalActual > 0)
    .sort((a, b) => b.totalActual - a.totalActual);

  const totalOutflowActual = Math.max(1, summary.totalOutflowActual);

  // Top individual expense categories
  const allExpenseRows: CategoryComputedRow[] = [];
  for (const gs of summary.groups) {
    if (gs.group.kind !== 'income') {
      allExpenseRows.push(...gs.rows);
    }
  }
  const topExpenseCategories = [...allExpenseRows]
    .filter((r) => r.actual > 0 || r.budget > 0)
    .sort((a, b) => b.actual - a.actual)
    .slice(0, 10);

  // Donut Chart SVG geometry
  const radius = 72;
  const circumference = 2 * Math.PI * radius;
  let cumulativeAngle = 0;

  const maxGroupBarVal = Math.max(
    1,
    ...outflowGroups.map((g) => Math.max(g.totalBudget, g.totalActual))
  );

  const maxAnnualVal = Math.max(
    1000,
    ...annualSeries.map((pt) =>
      Math.max(pt.incomeActual, pt.outflowActual, pt.incomeBudget)
    )
  );

  // Client revenue breakdown for Freelancers
  const clientRevenueMap = new Map<string, number>();
  for (const tx of state.transactions) {
    if (
      tx.type === 'income' &&
      (workspace === 'combined' || tx.mode === workspace) &&
      tx.monthKey === summary.monthKey
    ) {
      const clientName = tx.client || tx.description || 'General Revenue';
      clientRevenueMap.set(
        clientName,
        (clientRevenueMap.get(clientName) ?? 0) + tx.amount
      );
    }
  }
  const clientRevenueList = Array.from(clientRevenueMap.entries()).sort(
    (a, b) => b[1] - a[1]
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-normal text-ink tracking-tight">
          Financial Reports, Breakdowns & Charts
        </h1>
        <p className="text-xs text-ink-2 mt-0.5">
          Visual analysis of monthly budgets vs. actuals, category allocations, 12-month cashflow, and tax reserves ({summary.monthKey}).
        </p>
      </div>

      {/* 1. Top Executive KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-surface border border-line space-y-1">
          <div className="flex items-center justify-between text-xs text-ink-3">
            <span className="uppercase tracking-[0.08em]">Monthly Income</span>
            <TrendingUp className="w-4 h-4 text-positive" />
          </div>
          <div className="text-xl font-semibold text-positive tabular-nums">
            {formatCurrency(summary.incomeActual, currency)}
          </div>
          <div className="text-[11px] text-ink-2 tabular-nums">
            Planned Budget: {formatCurrency(summary.incomeBudget, currency)}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface border border-line space-y-1">
          <div className="flex items-center justify-between text-xs text-ink-3">
            <span className="uppercase tracking-[0.08em]">Total Outflow</span>
            <TrendingDown className="w-4 h-4 text-accent" />
          </div>
          <div className="text-xl font-semibold text-ink tabular-nums">
            {formatCurrency(summary.totalOutflowActual, currency)}
          </div>
          <div className="text-[11px] text-ink-2 tabular-nums">
            Budget: {formatCurrency(summary.totalOutflowBudget, currency)} (
            <span
              className={
                summary.totalOutflowDifference >= 0
                  ? 'text-positive'
                  : 'text-accent'
              }
            >
              {summary.totalOutflowDifference >= 0 ? '+' : ''}
              {formatNumber(summary.totalOutflowDifference)} diff
            </span>
            )
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface border border-line space-y-1">
          <div className="flex items-center justify-between text-xs text-ink-3">
            <span className="uppercase tracking-[0.08em]">Net Surplus / Cashflow</span>
            {summary.netActual >= 0 ? (
              <CheckCircle2 className="w-4 h-4 text-positive" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-accent" />
            )}
          </div>
          <div
            className={`text-xl font-semibold tabular-nums ${
              summary.netActual >= 0 ? 'text-positive' : 'text-accent'
            }`}
          >
            {formatCurrency(summary.netActual, currency)}
          </div>
          <div className="text-[11px] text-ink-2 tabular-nums">
            Planned Net: {formatCurrency(summary.netBudget, currency)}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface border border-line space-y-1">
          <div className="flex items-center justify-between text-xs text-ink-3">
            <span className="uppercase tracking-[0.08em]">Savings & Retention Rate</span>
            <PieChartIcon className="w-4 h-4 text-indigo" />
          </div>
          <div className="text-xl font-semibold text-indigo tabular-nums">
            {summary.savingsRatePct.toFixed(1)}%
          </div>
          <div className="text-[11px] text-ink-2">
            Of total income retained or saved
          </div>
        </div>
      </div>

      {/* 2. Donut Breakdown + Budget vs Actual Horizontal Bar Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Donut Chart Card (5 cols) */}
        <section className="lg:col-span-5 p-5 rounded-xl bg-surface border border-line flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-medium text-ink">
              Outflow Breakdown by Group
            </h2>
            <p className="text-[11px] text-ink-3 mt-0.5">
              Share of total monthly expenses & savings ({formatCurrency(summary.totalOutflowActual, currency)})
            </p>
          </div>

          <div className="my-6 flex items-center justify-center">
            <div className="relative w-48 h-48 flex items-center justify-center">
              <svg className="w-48 h-48 -rotate-90" viewBox="0 0 180 180">
                <circle
                  cx="90"
                  cy="90"
                  r={radius}
                  fill="none"
                  stroke="var(--line)"
                  strokeWidth="20"
                />
                {activeSpendingGroups.map((gs) => {
                  const pct = gs.totalActual / totalOutflowActual;
                  const dashLen = pct * circumference;
                  const dashOffset = -cumulativeAngle * circumference;
                  cumulativeAngle += pct;
                  const isHovered = hoveredSlice === gs.group.id;

                  return (
                    <circle
                      key={gs.group.id}
                      cx="90"
                      cy="90"
                      r={radius}
                      fill="none"
                      stroke={gs.group.color}
                      strokeWidth={isHovered ? 24 : 20}
                      strokeDasharray={`${dashLen} ${circumference}`}
                      strokeDashoffset={dashOffset}
                      className="transition-all duration-200 cursor-pointer"
                      onMouseEnter={() => setHoveredSlice(gs.group.id)}
                      onMouseLeave={() => setHoveredSlice(null)}
                    />
                  );
                })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 pointer-events-none">
                <span className="text-[10px] uppercase tracking-wider text-ink-3">
                  Total Outflow
                </span>
                <span className="text-sm font-semibold text-ink tabular-nums mt-0.5">
                  {formatCurrency(summary.totalOutflowActual, currency)}
                </span>
                <span className="text-[11px] text-positive tabular-nums">
                  {summary.incomeActual > 0
                    ? `${Math.round((summary.totalOutflowActual / summary.incomeActual) * 100)}% of income`
                    : ''}
                </span>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="space-y-1.5">
            {activeSpendingGroups.map((gs) => {
              const pct = ((gs.totalActual / totalOutflowActual) * 100).toFixed(1);
              return (
                <div
                  key={gs.group.id}
                  onMouseEnter={() => setHoveredSlice(gs.group.id)}
                  onMouseLeave={() => setHoveredSlice(null)}
                  className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-raised transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: gs.group.color }}
                    />
                    <span className="text-ink truncate">{gs.group.name}</span>
                  </div>
                  <div className="flex items-center gap-3 tabular-nums">
                    <span className="text-ink-3 text-[11px]">{pct}%</span>
                    <span className="text-ink font-medium w-20 text-right">
                      {formatNumber(gs.totalActual)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Budget vs Actual Horizontal Comparison Bars (7 cols) */}
        <section className="lg:col-span-7 p-5 rounded-xl bg-surface border border-line flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-medium text-ink">
                Budget vs. Actual by Category Group
              </h2>
              <p className="text-[11px] text-ink-3 mt-0.5">
                Planned budget (top bar) compared against actual spending (bottom bar)
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-ink-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-ink-3/40" />
                Budget
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-indigo" />
                Actual
              </span>
            </div>
          </div>

          <div className="space-y-3.5 flex-1">
            {outflowGroups.map((gs) => {
              const budgetPct = Math.min(
                100,
                (gs.totalBudget / maxGroupBarVal) * 100
              );
              const actualPct = Math.min(
                100,
                (gs.totalActual / maxGroupBarVal) * 100
              );
              const overBudget = gs.totalActual > gs.totalBudget && gs.totalBudget > 0;

              return (
                <div key={gs.group.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-ink">{gs.group.name}</span>
                    <div className="flex items-center gap-3 tabular-nums text-[11px]">
                      <span className="text-ink-3">
                        Budget: {formatNumber(gs.totalBudget)}
                      </span>
                      <span className="text-ink font-medium">
                        Actual: {formatNumber(gs.totalActual)}
                      </span>
                      <span
                        className={`w-16 text-right font-medium ${
                          gs.totalDifference >= 0
                            ? 'text-positive'
                            : 'text-accent'
                        }`}
                      >
                        {gs.totalDifference >= 0 ? '+' : ''}
                        {formatNumber(gs.totalDifference)}
                      </span>
                    </div>
                  </div>

                  {/* Dual horizontal bars */}
                  <div className="space-y-1">
                    <div className="h-2 bg-raised rounded-full overflow-hidden">
                      <div
                        className="h-full bg-ink-3/45 rounded-full transition-all"
                        style={{ width: `${budgetPct}%` }}
                      />
                    </div>
                    <div className="h-2.5 bg-raised rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${actualPct}%`,
                          backgroundColor: overBudget
                            ? 'var(--accent)'
                            : gs.group.color,
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* 3. 12-Month Annual Cashflow Chart (Jan - Dec) */}
      <section className="p-5 rounded-xl bg-surface border border-line space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo" />
            <div>
              <h2 className="text-sm font-medium text-ink">
                12-Month Cashflow & Net Trajectory ({state.settings.activeYear})
              </h2>
              <p className="text-[11px] text-ink-3">
                Monthly Income vs. Total Outflow across all 12 months of the year
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-[11px] text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-positive" />
              Income
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-accent/80" />
              Expenses
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-ink-3/30" />
              Planned Budget
            </span>
          </div>
        </div>

        {/* SVG Bar Chart */}
        <div className="h-56 pt-4">
          <div className="h-full grid grid-cols-12 gap-2 items-end border-b border-line pb-2">
            {annualSeries.map((pt) => {
              const incVal = pt.incomeActual || pt.incomeBudget;
              const outVal = pt.outflowActual || pt.outflowBudget;
              const incH = Math.max(4, Math.round((incVal / maxAnnualVal) * 160));
              const outH = Math.max(4, Math.round((outVal / maxAnnualVal) * 160));
              const isCurrentMonth = pt.monthKey === summary.monthKey;

              return (
                <div
                  key={pt.monthKey}
                  className={`flex flex-col items-center gap-1.5 p-1 rounded-lg transition-colors ${
                    isCurrentMonth ? 'bg-raised/80 ring-1 ring-line' : 'hover:bg-raised/40'
                  }`}
                  title={`${pt.monthLabel}: Income ${formatCurrency(incVal, currency)} | Outflow ${formatCurrency(outVal, currency)} | NET ${formatCurrency(incVal - outVal, currency)}`}
                >
                  <div className="w-full flex items-end justify-center gap-1 h-40">
                    <div
                      className="w-3 rounded-t-xs transition-all"
                      style={{
                        height: `${incH}px`,
                        backgroundColor:
                          pt.incomeActual > 0
                            ? 'var(--positive)'
                            : 'color-mix(in srgb, var(--positive) 35%, transparent)',
                      }}
                    />
                    <div
                      className="w-3 rounded-t-xs transition-all"
                      style={{
                        height: `${outH}px`,
                        backgroundColor:
                          pt.outflowActual > 0
                            ? 'var(--accent)'
                            : 'color-mix(in srgb, var(--accent) 35%, transparent)',
                      }}
                    />
                  </div>
                  <span
                    className={`text-[11px] tabular-nums ${
                      isCurrentMonth ? 'text-ink font-semibold' : 'text-ink-2'
                    }`}
                  >
                    {pt.monthLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 4. Top Individual Categories Breakdown + Freelancer Tax & Client Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top 10 Categories Table */}
        <section className="p-5 rounded-xl bg-surface border border-line space-y-3">
          <div>
            <h2 className="text-sm font-medium text-ink">
              Top Individual Expense Categories
            </h2>
            <p className="text-[11px] text-ink-3">
              Largest cost drivers in {summary.monthKey} ranked by actual spend
            </p>
          </div>

          <div className="divide-y divide-line/60 text-xs">
            {topExpenseCategories.map((row) => {
              const sharePct =
                summary.totalOutflowActual > 0
                  ? ((row.actual / summary.totalOutflowActual) * 100).toFixed(1)
                  : '0.0';
              return (
                <div
                  key={row.category.id}
                  className="py-2 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: row.group.color }}
                    />
                    <div className="truncate">
                      <span className="text-ink font-medium">
                        {row.category.name}
                      </span>
                      <span className="text-[10px] text-ink-3 ml-2 uppercase">
                        {row.group.name}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 tabular-nums shrink-0">
                    <span className="text-[11px] text-ink-3">{sharePct}%</span>
                    <span className="text-ink-2 w-16 text-right">
                      B: {formatNumber(row.budget)}
                    </span>
                    <span className="text-ink font-semibold w-20 text-right">
                      {formatCurrency(row.actual, currency)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Freelancer Tax & Client Breakdown OR Variance Insights */}
        <section className="p-5 rounded-xl bg-surface border border-line space-y-4">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-indigo" />
            <div>
              <h2 className="text-sm font-medium text-ink">
                Freelancer Tax, VAT & Client Breakdown
              </h2>
              <p className="text-[11px] text-ink-3">
                Tax-deductible business expenses, VAT settlement & client revenue
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-app border border-line">
              <span className="text-[10px] uppercase text-ink-3">
                Deductible Expenses
              </span>
              <div className="text-sm font-semibold text-indigo tabular-nums mt-0.5">
                {formatCurrency(summary.deductibleExpensesActual, currency)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-app border border-line">
              <span className="text-[10px] uppercase text-ink-3">
                Net VAT Payable
              </span>
              <div className="text-sm font-semibold text-ink tabular-nums mt-0.5">
                {formatCurrency(summary.netVatPayable, currency)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-app border border-line">
              <span className="text-[10px] uppercase text-ink-3">
                VAT Collected (Output)
              </span>
              <div className="text-sm font-medium text-ink-2 tabular-nums mt-0.5">
                {formatCurrency(summary.vatCollected, currency)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-app border border-line">
              <span className="text-[10px] uppercase text-ink-3">
                Input VAT Credit
              </span>
              <div className="text-sm font-medium text-positive tabular-nums mt-0.5">
                {formatCurrency(summary.vatPaidOnExpenses, currency)}
              </div>
            </div>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-line">
            <span className="text-[11px] uppercase tracking-wider text-ink-3 font-medium">
              Income Sources / Clients ({summary.monthKey})
            </span>
            {clientRevenueList.length === 0 ? (
              <p className="text-xs text-ink-3 py-2">
                No income entries logged for this month yet.
              </p>
            ) : (
              clientRevenueList.map(([clientName, amt]) => (
                <div
                  key={clientName}
                  className="flex items-center justify-between text-xs py-1"
                >
                  <span className="text-ink">{clientName}</span>
                  <span className="tabular-nums font-medium text-positive">
                    {formatCurrency(amt, currency)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
