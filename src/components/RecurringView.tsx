import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  Play,
  Repeat,
  CheckCircle2,
} from 'lucide-react';
import {
  ActiveWorkspace,
  CategoryGroup,
  CategoryItem,
  LedgerMode,
  RecurringRule,
} from '../types';
import { formatCurrency } from '../utils/calculations';
import { useI18n } from '../i18n';

interface RecurringViewProps {
  rules: RecurringRule[];
  groups: CategoryGroup[];
  categories: CategoryItem[];
  workspace: ActiveWorkspace;
  monthKey: string;
  currency: string;
  onAddRule: (rule: Omit<RecurringRule, 'id'>) => void;
  onUpdateRule: (id: string, patch: Partial<RecurringRule>) => void;
  onToggleRule: (id: string) => void;
  onDeleteRule: (id: string) => void;
  onApplyRecurringToMonth: () => void;
}

export const RecurringView: React.FC<RecurringViewProps> = ({
  rules,
  groups,
  categories,
  workspace,
  monthKey,
  currency,
  onAddRule,
  onUpdateRule,
  onToggleRule,
  onDeleteRule,
  onApplyRecurringToMonth,
}) => {
  const { t, tf, tGroupName, tCategoryName } = useI18n();
  const modeFilter = (m: LedgerMode) =>
    workspace === 'combined' ? true : m === workspace;

  const availCats = categories.filter((c) => modeFilter(c.mode));
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const grpMap = new Map(groups.map((g) => [g.id, g]));

  const [categoryId, setCategoryId] = useState(availCats[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<'monthly' | 'quarterly' | 'yearly'>(
    'monthly'
  );
  const [dayOfMonth, setDayOfMonth] = useState('1');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmt = parseFloat(amount);
    if (!categoryId || Number.isNaN(numAmt) || numAmt < 0) return;
    const cat = catMap.get(categoryId);
    if (!cat) return;

    onAddRule({
      mode: cat.mode,
      type: cat.kind === 'income' ? 'income' : 'expense',
      categoryId: cat.id,
      description: description.trim() || cat.name,
      amount: numAmt,
      frequency,
      dayOfMonth: Math.min(28, Math.max(1, parseInt(dayOfMonth, 10) || 1)),
      taxRate: cat.taxRate ?? 0,
      deductiblePct: cat.deductiblePct ?? 100,
      active: true,
    });
    setDescription('');
    setAmount('');
  };

  const visibleRules = rules.filter((r) => modeFilter(r.mode));
  const monthlyRecurringTotalIncome = visibleRules
    .filter((r) => r.active && r.type === 'income')
    .reduce(
      (acc, r) =>
        acc +
        (r.frequency === 'monthly'
          ? r.amount
          : r.frequency === 'quarterly'
            ? r.amount / 3
            : r.amount / 12),
      0
    );
  const monthlyRecurringTotalOutflow = visibleRules
    .filter((r) => r.active && r.type === 'expense')
    .reduce(
      (acc, r) =>
        acc +
        (r.frequency === 'monthly'
          ? r.amount
          : r.frequency === 'quarterly'
            ? r.amount / 3
            : r.amount / 12),
      0
    );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-normal text-ink tracking-tight">
            {t('recurring.title')}
          </h1>
          <p className="text-xs text-ink-2 mt-0.5">
            {t('recurring.subtitle')}
          </p>
        </div>

        <button
          onClick={onApplyRecurringToMonth}
          className="h-9 px-4 inline-flex items-center gap-2 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer shrink-0"
        >
          <Play className="w-3.5 h-3.5" />
          <span>{tf('recurring.postBtn', { month: monthKey })}</span>
        </button>
      </div>

      {/* Add Recurring Rule Form — Flex-wrap layout so no input or button ever overflows */}
      <form
        onSubmit={handleSubmit}
        className="p-4 rounded-xl bg-surface border border-line flex flex-wrap items-end gap-3"
      >
        <div className="flex-[2_1_190px] min-w-[170px]">
          <label className="block text-[11px] text-ink-2 mb-1 truncate">
            {t('finance.category')}
          </label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink focus:outline-none"
          >
            {groups
              .filter((g) => modeFilter(g.mode))
              .map((grp) => (
                <optgroup key={grp.id} label={tGroupName(grp)}>
                  {availCats
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

        <div className="flex-[2_1_190px] min-w-[170px]">
          <label className="block text-[11px] text-ink-2 mb-1 truncate">
            {t('recurring.descLabel')}
          </label>
          <input
            type="text"
            placeholder={t('recurring.descPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink focus:outline-none"
          />
        </div>

        <div className="flex-[1_1_115px] min-w-[105px]">
          <label className="block text-[11px] text-ink-2 mb-1 truncate">
            {tf('tx.amountCurrency', { currency })}
          </label>
          <input
            type="number"
            step="0.05"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className="w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink tabular-nums text-right focus:outline-none"
          />
        </div>

        <div className="flex-[1_1_115px] min-w-[105px]">
          <label className="block text-[11px] text-ink-2 mb-1 truncate">
            {t('recurring.freqLabel')}
          </label>
          <select
            value={frequency}
            onChange={(e) =>
              setFrequency(
                e.target.value as 'monthly' | 'quarterly' | 'yearly'
              )
            }
            className="w-full h-8 px-2 rounded-lg bg-raised border border-line text-xs text-ink focus:outline-none"
          >
            <option value="monthly">{t('recurring.freqMonthly')}</option>
            <option value="quarterly">{t('recurring.freqQuarterly')}</option>
            <option value="yearly">{t('recurring.freqYearly')}</option>
          </select>
        </div>

        <div className="w-20 shrink-0">
          <label className="block text-[11px] text-ink-2 mb-1 truncate">
            {t('recurring.dayRangeLabel')}
          </label>
          <input
            type="number"
            min="1"
            max="28"
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(e.target.value)}
            className="w-full h-8 px-2 rounded-lg bg-raised border border-line text-xs text-ink text-center tabular-nums focus:outline-none"
          />
        </div>

        <button
          type="submit"
          className="h-8 px-4 rounded-lg bg-ink text-on-ink text-xs font-medium inline-flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t('recurring.addRuleBtn')}</span>
        </button>
      </form>

      {/* Summary Banner */}
      <div className="p-4 rounded-xl bg-surface border border-line flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-4 text-ink-2">
          <div className="flex items-center gap-2">
            <Repeat className="w-4 h-4 text-indigo shrink-0" />
            <span>
              {t('recurring.fixedOutflow')}{' '}
              <strong className="text-ink tabular-nums">
                {formatCurrency(monthlyRecurringTotalOutflow, currency)}{t('recurring.perMonthSuffix')}
              </strong>
            </span>
          </div>
          {monthlyRecurringTotalIncome > 0 && (
            <div className="flex items-center gap-1.5 text-ink-2">
              <span>·</span>
              <span>
                {t('recurring.recurringIncome')}{' '}
                <strong className="text-positive tabular-nums">
                  +{formatCurrency(monthlyRecurringTotalIncome, currency)}{t('recurring.perMonthSuffix')}
                </strong>
              </span>
            </div>
          )}
        </div>
        <span className="text-ink-3 tabular-nums">
          {tf('recurring.activeOfTotal', {
            active: visibleRules.filter((r) => r.active).length,
            total: visibleRules.length,
          })}
        </span>
      </div>

      {/* Rules List */}
      <div className="bg-surface border border-line rounded-xl overflow-hidden divide-y divide-line/60">
        {visibleRules.length === 0 ? (
          <p className="p-8 text-center text-xs text-ink-3">
            {t('recurring.emptyRules')}
          </p>
        ) : (
          visibleRules.map((rule) => {
            const cat = catMap.get(rule.categoryId);
            const grp = cat ? grpMap.get(cat.groupId) : undefined;
            const ruleTitle = cat
              ? tCategoryName({ id: cat.id, name: rule.description })
              : tCategoryName(rule.description);
            return (
              <div
                key={rule.id}
                className="p-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-raised/40 text-xs"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <button
                    onClick={() => onToggleRule(rule.id)}
                    className={`cursor-pointer shrink-0 ${
                      rule.active ? 'text-positive' : 'text-ink-3'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-ink font-medium truncate">
                        {ruleTitle}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                          rule.type === 'income'
                            ? 'bg-positive/15 text-positive'
                            : 'bg-raised text-ink-2'
                        }`}
                      >
                        {rule.type === 'income' ? t('finance.income') : t('recurring.fixedBadge')}
                      </span>
                    </div>
                    <div className="text-[11px] text-ink-3 truncate mt-0.5">
                      {grp ? tGroupName(grp) : t('finance.category')} · {cat ? tCategoryName(cat) : ruleTitle}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <select
                    value={rule.frequency}
                    onChange={(e) =>
                      onUpdateRule(rule.id, {
                        frequency: e.target.value as
                          | 'monthly'
                          | 'quarterly'
                          | 'yearly',
                      })
                    }
                    className="h-7 px-2 rounded bg-raised border border-line text-[11px] text-ink-2 focus:text-ink focus:outline-none"
                    title={t('recurring.freqLabel')}
                  >
                    <option value="monthly">{t('recurring.freqMonthly')}</option>
                    <option value="quarterly">{t('recurring.freqQuarterly')}</option>
                    <option value="yearly">{t('recurring.freqYearly')}</option>
                  </select>

                  <div className="inline-flex items-center gap-1 text-[11px] text-ink-3">
                    <span>{t('recurring.dayLabel')}</span>
                    <input
                      type="number"
                      min="1"
                      max="28"
                      value={rule.dayOfMonth}
                      onChange={(e) =>
                        onUpdateRule(rule.id, {
                          dayOfMonth: Math.min(
                            28,
                            Math.max(1, parseInt(e.target.value, 10) || 1)
                          ),
                        })
                      }
                      className="w-12 h-7 px-1.5 rounded bg-raised border border-line text-[11px] text-ink text-center tabular-nums focus:outline-none"
                    />
                  </div>

                  <div className="inline-flex items-center gap-1">
                    <span className="text-[11px] text-ink-3">{currency}</span>
                    <input
                      type="number"
                      step="1"
                      value={rule.amount}
                      onChange={(e) =>
                        onUpdateRule(rule.id, {
                          amount: parseFloat(e.target.value) || 0,
                        })
                      }
                      placeholder="0.00"
                      className={`w-24 h-7 px-2 rounded bg-raised border border-line text-xs tabular-nums text-right font-semibold focus:outline-none ${
                        rule.type === 'income' ? 'text-positive' : 'text-ink'
                      }`}
                    />
                  </div>

                  <button
                    onClick={() => onDeleteRule(rule.id)}
                    className="p-1.5 rounded-lg text-ink-3 hover:text-accent hover:bg-raised transition-colors cursor-pointer"
                    title={t('common.delete')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
