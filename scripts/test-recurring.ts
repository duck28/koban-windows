import assert from 'node:assert/strict';
import { CategoryItem, FinancialAccount, RecurringRule, TransactionItem } from '../src/types';
import {
  computeAccountLiveBalance,
  planPeriodsPerYear,
  planScheduleForFrequency,
  savingsTargetMap,
  buildRecurringTransactionsForMonth,
  dateInIsoWeek,
  getRecurringOccurrenceDates,
  isoWeekdayOfDate,
  isoWeekOfDate,
  isScheduledRule,
  recurringAmountForMonth,
  getRecurringDaysInMonth,
  recurringAnnualEquivalent,
  recurringMonthInterval,
  recurringMonthlyEquivalent,
} from '../src/utils/calculations';

// 1. Monthly & annual equivalents for all 5 frequencies
assert.ok(Math.abs(recurringMonthlyEquivalent(1200, 'biweekly') - 2600) < 1e-6);
assert.equal(recurringMonthlyEquivalent(1200, 'monthly'), 1200);
assert.equal(recurringMonthlyEquivalent(1200, 'bimonthly'), 600);
assert.equal(recurringMonthlyEquivalent(1200, 'quarterly'), 400);
assert.equal(recurringMonthlyEquivalent(1200, 'yearly'), 100);

assert.equal(recurringAnnualEquivalent(100, 'biweekly'), 2600);
assert.equal(recurringAnnualEquivalent(100, 'monthly'), 1200);
assert.equal(recurringAnnualEquivalent(100, 'bimonthly'), 600);
assert.equal(recurringAnnualEquivalent(100, 'quarterly'), 400);
assert.equal(recurringAnnualEquivalent(100, 'yearly'), 100);

assert.equal(recurringMonthInterval('biweekly'), 1);
assert.equal(recurringMonthInterval('monthly'), 1);
assert.equal(recurringMonthInterval('bimonthly'), 2);
assert.equal(recurringMonthInterval('quarterly'), 3);
assert.equal(recurringMonthInterval('yearly'), 12);

// 2. Posting days per month
assert.deepEqual(getRecurringDaysInMonth('biweekly', 1), [1, 15]);
assert.deepEqual(getRecurringDaysInMonth('biweekly', 14), [14, 28]);
assert.deepEqual(getRecurringDaysInMonth('biweekly', 15), [1, 15]);
assert.deepEqual(getRecurringDaysInMonth('biweekly', 25), [11, 25]);
assert.deepEqual(getRecurringDaysInMonth('monthly', 15), [15]);
assert.deepEqual(getRecurringDaysInMonth('bimonthly', 31), [28]);

function makeRule(partial: Partial<RecurringRule>): RecurringRule {
  return {
    id: 'rec-default',
    mode: 'home',
    type: 'expense',
    categoryId: 'cat-1',
    description: 'Test Rule',
    amount: 100,
    frequency: 'monthly',
    dayOfMonth: 5,
    active: true,
    ...partial,
  };
}

// 3. Bi-weekly posting: 2 transactions 14 days apart + idempotent re-run
const biweeklyRule = makeRule({
  id: 'rec-bw',
  type: 'income',
  description: 'Paycheck',
  amount: 2000,
  frequency: 'biweekly',
  dayOfMonth: 5,
});

const bwFirst = buildRecurringTransactionsForMonth(
  [biweeklyRule],
  [],
  '2026-11',
  'home'
);
assert.equal(bwFirst.activeCount, 1);
assert.equal(bwFirst.newTransactions.length, 2);
assert.deepEqual(
  bwFirst.newTransactions.map((t) => t.date),
  ['2026-11-05', '2026-11-19']
);
assert.deepEqual(
  bwFirst.newTransactions.map((t) => t.id),
  ['tx-rec-rec-bw-2026-11-05', 'tx-rec-rec-bw-2026-11-19']
);

const bwSecond = buildRecurringTransactionsForMonth(
  [biweeklyRule],
  bwFirst.newTransactions,
  '2026-11',
  'home'
);
assert.equal(bwSecond.newTransactions.length, 0);

// Next month still posts 2 more occurrences for biweekly
const bwNextMonth = buildRecurringTransactionsForMonth(
  [biweeklyRule],
  bwFirst.newTransactions,
  '2026-12',
  'home'
);
assert.equal(bwNextMonth.newTransactions.length, 2);

// 4. Bi-monthly posting: posts 2026-11, skips 2026-12, posts 2027-01
const bimonthlyRule = makeRule({
  id: 'rec-bm',
  description: 'Water Utility',
  amount: 120,
  frequency: 'bimonthly',
  dayOfMonth: 10,
});
const bmNov = buildRecurringTransactionsForMonth([bimonthlyRule], [], '2026-11', 'home');
assert.equal(bmNov.newTransactions.length, 1);
assert.equal(bmNov.newTransactions[0].id, 'tx-rec-rec-bm-2026-11');
assert.equal(bmNov.newTransactions[0].date, '2026-11-10');

const bmDec = buildRecurringTransactionsForMonth(
  [bimonthlyRule],
  bmNov.newTransactions,
  '2026-12',
  'home'
);
assert.equal(bmDec.newTransactions.length, 0);

const bmJan = buildRecurringTransactionsForMonth(
  [bimonthlyRule],
  bmNov.newTransactions,
  '2027-01',
  'home'
);
assert.equal(bmJan.newTransactions.length, 1);
assert.equal(bmJan.newTransactions[0].date, '2027-01-10');

// 5. Quarterly posting: posts 2026-11, skips 2026-12 & 2027-01, posts 2027-02
const quarterlyRule = makeRule({
  id: 'rec-q',
  description: 'Serafe TV Fee',
  amount: 84,
  frequency: 'quarterly',
  dayOfMonth: 15,
});
const qNov = buildRecurringTransactionsForMonth([quarterlyRule], [], '2026-11', 'home');
assert.equal(qNov.newTransactions.length, 1);

assert.equal(
  buildRecurringTransactionsForMonth([quarterlyRule], qNov.newTransactions, '2026-12', 'home')
    .newTransactions.length,
  0
);
assert.equal(
  buildRecurringTransactionsForMonth([quarterlyRule], qNov.newTransactions, '2027-01', 'home')
    .newTransactions.length,
  0
);
const qFeb = buildRecurringTransactionsForMonth(
  [quarterlyRule],
  qNov.newTransactions,
  '2027-02',
  'home'
);
assert.equal(qFeb.newTransactions.length, 1);

// 6. Yearly posting: posts 2026-11, skips 2027-05, posts 2027-11
const yearlyRule = makeRule({
  id: 'rec-y',
  description: 'Annual Insurance',
  amount: 950,
  frequency: 'yearly',
  dayOfMonth: 20,
});
const yNov = buildRecurringTransactionsForMonth([yearlyRule], [], '2026-11', 'home');
assert.equal(yNov.newTransactions.length, 1);

assert.equal(
  buildRecurringTransactionsForMonth([yearlyRule], yNov.newTransactions, '2027-05', 'home')
    .newTransactions.length,
  0
);
const yNextNov = buildRecurringTransactionsForMonth(
  [yearlyRule],
  yNov.newTransactions,
  '2027-11',
  'home'
);
assert.equal(yNextNov.newTransactions.length, 1);

// 7. Monthly posting: posts every month and respects duplicate detection (id & legacy fields)
const monthlyRule = makeRule({
  id: 'rec-m',
  categoryId: 'cat-rent',
  description: 'Rent',
  amount: 1800,
  frequency: 'monthly',
  dayOfMonth: 1,
});
const mNov = buildRecurringTransactionsForMonth([monthlyRule], [], '2026-11', 'home');
assert.equal(mNov.newTransactions.length, 1);
assert.equal(mNov.newTransactions[0].id, 'tx-rec-rec-m-2026-11');

const legacyManualTx: TransactionItem = {
  id: 'manual-1',
  date: '2026-12-01',
  monthKey: '2026-12',
  mode: 'home',
  type: 'expense',
  categoryId: 'cat-rent',
  description: 'Rent',
  amount: 1800,
  status: 'cleared',
};
assert.equal(
  buildRecurringTransactionsForMonth([monthlyRule], [legacyManualTx], '2026-12', 'home')
    .newTransactions.length,
  0
);
assert.equal(
  buildRecurringTransactionsForMonth([monthlyRule], [legacyManualTx], '2027-01', 'home')
    .newTransactions.length,
  1
);

// 8. ISO week helpers
assert.equal(isoWeekOfDate('2026-11-20'), '2026-W47');
assert.equal(isoWeekOfDate('2027-01-01'), '2026-W53');
assert.equal(isoWeekOfDate('2024-12-30'), '2025-W01');
assert.equal(isoWeekdayOfDate('2026-11-20'), 4); // Friday
assert.equal(dateInIsoWeek('2026-W47', 4), '2026-11-20');
assert.equal(dateInIsoWeek('2025-W01', 0), '2024-12-30');

// 9. Bi-weekly with a start week: true 14-day cadence, 3-payment months
const bwScheduled = makeRule({
  id: 'rec-bws',
  type: 'income',
  amount: 1000,
  frequency: 'biweekly',
  dayOfMonth: 2,
  startDate: '2026-01-02', // Friday
});
assert.ok(isScheduledRule(bwScheduled));
assert.deepEqual(getRecurringOccurrenceDates(bwScheduled, '2025-12'), []);
assert.deepEqual(getRecurringOccurrenceDates(bwScheduled, '2026-01'), [
  '2026-01-02',
  '2026-01-16',
  '2026-01-30',
]);
assert.deepEqual(getRecurringOccurrenceDates(bwScheduled, '2026-02'), [
  '2026-02-13',
  '2026-02-27',
]);
assert.equal(recurringAmountForMonth(bwScheduled, '2026-01'), 3000);
assert.equal(recurringAmountForMonth(bwScheduled, '2026-02'), 2000);
// Over a full year: 26 payments
let bwYear = 0;
for (let m = 1; m <= 12; m++) {
  bwYear += getRecurringOccurrenceDates(bwScheduled, `2026-${String(m).padStart(2, '0')}`)!.length;
}
assert.equal(bwYear, 26);
const bwsPosted = buildRecurringTransactionsForMonth([bwScheduled], [], '2026-01', 'home');
assert.deepEqual(
  bwsPosted.newTransactions.map((t) => t.date),
  ['2026-01-02', '2026-01-16', '2026-01-30']
);
assert.equal(
  buildRecurringTransactionsForMonth([bwScheduled], bwsPosted.newTransactions, '2026-01', 'home')
    .newTransactions.length,
  0
);

// 10. Bi-monthly / quarterly with a start month
const bmScheduled = makeRule({
  id: 'rec-bms',
  amount: 120,
  frequency: 'bimonthly',
  dayOfMonth: 10,
  startMonth: '2026-12',
});
assert.ok(isScheduledRule(bmScheduled));
assert.equal(recurringAmountForMonth(bmScheduled, '2026-11'), 0);
assert.equal(recurringAmountForMonth(bmScheduled, '2026-12'), 120);
assert.equal(recurringAmountForMonth(bmScheduled, '2027-01'), 0);
assert.equal(recurringAmountForMonth(bmScheduled, '2027-02'), 120);
assert.equal(
  buildRecurringTransactionsForMonth([bmScheduled], [], '2027-01', 'home').newTransactions.length,
  0
);
assert.deepEqual(
  buildRecurringTransactionsForMonth([bmScheduled], [], '2027-02', 'home').newTransactions.map(
    (t) => t.date
  ),
  ['2027-02-10']
);
const qScheduled = makeRule({ id: 'rec-qs', frequency: 'quarterly', startMonth: '2026-02' });
assert.equal(recurringAmountForMonth(qScheduled, '2026-05'), 100);
assert.equal(recurringAmountForMonth(qScheduled, '2026-06'), 0);
// Legacy bi-monthly without a start month: unknown per-month amount
assert.equal(recurringAmountForMonth(bimonthlyRule, '2026-11'), null);
assert.equal(isScheduledRule(bimonthlyRule), false);

// 11. Savings with a target account move money between accounts (net worth unchanged)
const acc = (p: Partial<FinancialAccount>): FinancialAccount => ({
  id: 'a', name: 'A', mode: 'home', type: 'checking', classification: 'liquid',
  startingBalance: 1000, currentBalance: 1000, autoTrackTransactions: true,
  includeInNetWorth: true, color: '#000', updatedAt: '2026-01-01', ...p,
});
const checking = acc({ id: 'chk' });
const etfTracked = acc({ id: 'etf', classification: 'investment', startingBalance: 5000 });
const etfManual = acc({ id: 'etf2', classification: 'investment', autoTrackTransactions: false,
  currentBalance: 5000, updatedAt: '2026-02-01' });
const savingsCat = { id: 'c-etf', groupId: 'g', mode: 'home', name: 'ETF', kind: 'savings',
  defaultBudget: 0, order: 0, targetAccountId: 'etf' } as CategoryItem;
const savingTxs: TransactionItem[] = [
  { id: 't1', date: '2026-01-15', monthKey: '2026-01', mode: 'home', type: 'expense',
    categoryId: 'c-etf', accountId: 'chk', description: 'ETF', amount: 500 },
  { id: 't2', date: '2026-02-15', monthKey: '2026-02', mode: 'home', type: 'expense',
    categoryId: 'c-etf', accountId: 'chk', description: 'ETF', amount: 500 },
];
const targets = savingsTargetMap([savingsCat]);
const chkBal = computeAccountLiveBalance(checking, savingTxs, targets).liveBalance;
const etfBal = computeAccountLiveBalance(etfTracked, savingTxs, targets).liveBalance;
assert.equal(chkBal, 0);
assert.equal(etfBal, 6000);
assert.equal(chkBal + etfBal, 1000 + 5000); // net worth unchanged
// Manually valued target: only transfers after its last valuation (2026-02-01) are added
const manualTargets = savingsTargetMap([{ ...savingsCat, targetAccountId: 'etf2' }]);
assert.equal(computeAccountLiveBalance(etfManual, savingTxs, manualTargets).liveBalance, 5500);
// Without a target the saving only leaves the source account (old behaviour)
assert.equal(computeAccountLiveBalance(etfTracked, savingTxs, new Map()).liveBalance, 5000);

// 12. Yearly planner schedules
assert.equal(planPeriodsPerYear('biweekly'), 26);
assert.equal(planPeriodsPerYear('bimonthly'), 6);
assert.equal(planPeriodsPerYear('quarterly'), 4);
assert.equal(planPeriodsPerYear('annual_lump'), 1);
assert.equal(planScheduleForFrequency('yearly'), 'annual_lump');
assert.equal(planScheduleForFrequency('quarterly'), 'quarterly');

console.log('ALL RECURRING FREQUENCY ASSERTIONS PASSED');
