// Cross-platform golden test: computes the month summaries, recurring schedules, account
// balances and net-worth history of fixtures/golden/basic-ledger.json and compares them with
// fixtures/golden/basic-expected.json. The Mac app runs the same comparison on the same files
// (KobanKit/Tests/KobanCoreTests/GoldenLedgerTests.swift), so both apps must agree.
//
//   npm test                      — compare
//   npm test -- --update-golden   — rewrite basic-expected.json after an intended change
//                                   (then copy both files to koban-mac/fixtures/golden/)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ActiveWorkspace, LedgerState } from '../src/types';
import {
  computeAccountLiveBalance,
  computeMonthSummary,
  computeNetWorthMetrics,
  getRecurringOccurrenceDates,
  savingsTargetMap,
} from '../src/utils/calculations';

const dir = join(process.cwd(), 'fixtures', 'golden');
const ledger = JSON.parse(readFileSync(join(dir, 'basic-ledger.json'), 'utf8')) as LedgerState;

/** "Today" for the fixture: every month of 2025 is history. */
const NOW = new Date(2026, 0, 15);
const r2 = (v: number) => Math.round(v * 100) / 100;

const summaryCases: [string, ActiveWorkspace][] = [
  ['2025-01', 'home'],
  ['2025-02', 'home'],
  ['2025-03', 'home'],
  ['2025-04', 'home'],
  ['2025-01', 'combined'],
  ['2025-02', 'freelancer'],
];

const actual = {
  monthSummaries: summaryCases.map(([monthKey, workspace]) => {
    const s = computeMonthSummary(ledger, monthKey, workspace);
    return {
      monthKey,
      workspace,
      incomeBudget: r2(s.incomeBudget),
      incomeActual: r2(s.incomeActual),
      expenseBudget: r2(s.expenseBudget),
      expenseActual: r2(s.expenseActual),
      savingsBudget: r2(s.savingsBudget),
      savingsActual: r2(s.savingsActual),
      netBudget: r2(s.netBudget),
      netActual: r2(s.netActual),
      vatCollected: r2(s.vatCollected),
      vatPaidOnExpenses: r2(s.vatPaidOnExpenses),
      rows: s.groups.flatMap((g) =>
        g.rows.map((r) => ({
          id: r.category.id,
          budget: r2(r.budget),
          actual: r2(r.actual),
          difference: r2(r.difference),
          txCount: r.txCount,
          autoActual: r.autoActual,
          budgetFromSchedule: r.budgetFromSchedule,
          isFixedCost: r.isFixedCost,
        }))
      ),
    };
  }),
  recurringOccurrences: ledger.recurringRules.map((rule) => ({
    id: rule.id,
    months: ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06'].map((mk) => ({
      monthKey: mk,
      dates: getRecurringOccurrenceDates(rule, mk),
    })),
  })),
  accountBalances: (() => {
    const targets = savingsTargetMap(ledger.categories);
    return ledger.accounts.map((acc) => ({
      id: acc.id,
      liveBalance: r2(computeAccountLiveBalance(acc, ledger.transactions, targets).liveBalance),
    }));
  })(),
  netWorth: (() => {
    const m = computeNetWorthMetrics(ledger, 'home', 0, NOW);
    return {
      liquidAssets: r2(m.liquidAssets),
      investmentAssets: r2(m.investmentAssets),
      fixedAssets: r2(m.fixedAssets),
      totalLiabilities: r2(m.totalLiabilities),
      netWorth: r2(m.netWorth),
      history: m.historySeries.map((p) => ({
        monthKey: p.monthKey,
        netWorth: r2(p.netWorth),
        liquidAssets: r2(p.liquidAssets),
        totalLiabilities: r2(p.totalLiabilities),
        hasExplicitSnapshot: p.hasExplicitSnapshot,
      })),
    };
  })(),
};

const expectedPath = join(dir, 'basic-expected.json');
const text = JSON.stringify(actual, null, 2) + '\n';
if (process.argv.includes('--update-golden')) {
  writeFileSync(expectedPath, text);
  console.log(`wrote ${expectedPath}`);
} else {
  const expected = readFileSync(expectedPath, 'utf8').replace(/\r\n/g, '\n');
  if (expected !== text) {
    const a = text.split('\n');
    const e = expected.split('\n');
    const i = a.findIndex((line, idx) => line !== e[idx]);
    console.error(`GOLDEN MISMATCH at line ${i + 1}:\n  expected: ${e[i]}\n  actual:   ${a[i]}`);
    process.exit(1);
  }
  console.log('GOLDEN LEDGER MATCHES fixtures/golden/basic-expected.json');
}
