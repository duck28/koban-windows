import assert from 'node:assert/strict';
import { RecurringRule, TransactionItem } from '../src/types';
import {
  buildRecurringTransactionsForMonth,
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

console.log('ALL RECURRING FREQUENCY ASSERTIONS PASSED');
