import React, { useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Play,
  Repeat,
  CheckCircle2,
  CalendarClock,
} from 'lucide-react';
import {
  ActiveWorkspace,
  CategoryGroup,
  CategoryItem,
  LedgerMode,
  RecurringFrequency,
  RecurringRule,
} from '../types';
import {
  dateInIsoWeek,
  formatCurrency,
  getRecurringOccurrenceDates,
  isoWeekdayOfDate,
  isoWeekOfDate,
  recurringMonthInterval,
  recurringMonthlyEquivalent,
  todayIso,
} from '../utils/calculations';
import { useI18n } from '../i18n';
import { KobanSelect, KobanSelectOption } from './KobanSelect';
import { InlineNumberInput } from './InlineNumberInput';

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

const needsStartMonth = (f: RecurringFrequency) => recurringMonthInterval(f) > 1;

/**
 * Fields a rule needs when switching frequency: bi-weekly needs a start week
 * (first occurrence date), bi-monthly / quarterly / yearly a start month.
 * Missing ones are pre-filled so the picker shows up with a sensible value.
 */
export function scheduleDefaultsFor(
  frequency: RecurringFrequency,
  rule: Pick<RecurringRule, 'startDate' | 'startMonth' | 'dayOfMonth'>,
  monthKey: string
): Partial<RecurringRule> {
  if (frequency === 'biweekly' && !rule.startDate) {
    const today = todayIso();
    const day = String(Math.min(28, Math.max(1, rule.dayOfMonth || 1))).padStart(2, '0');
    const candidate = `${monthKey}-${day}`;
    return { startDate: monthKey === today.slice(0, 7) ? today : candidate };
  }
  if (needsStartMonth(frequency) && !rule.startMonth) {
    return { startMonth: monthKey };
  }
  return {};
}

const pickerClass =
  'h-7 px-1.5 rounded bg-raised border text-[11px] text-ink tabular-nums focus:outline-none';

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
  const { t, tf, tGroupName, tCategoryName, intlLocale } = useI18n();
  const modeFilter = (m: LedgerMode) =>
    workspace === 'combined' ? true : m === workspace;

  const availCats = categories.filter((c) => modeFilter(c.mode));
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const grpMap = new Map(groups.map((g) => [g.id, g]));

  const [categoryId, setCategoryId] = useState(availCats[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [startDate, setStartDate] = useState<string>('');
  const [startMonth, setStartMonth] = useState<string>('');

  const frequencyOptions: KobanSelectOption[] = [
    { value: 'biweekly', label: t('recurring.freqBiweekly') },
    { value: 'monthly', label: t('recurring.freqMonthly') },
    { value: 'bimonthly', label: t('recurring.freqBimonthly') },
    { value: 'quarterly', label: t('recurring.freqQuarterly') },
    { value: 'yearly', label: t('recurring.freqYearly') },
  ];

  const weekdayOptions: KobanSelectOption[] = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(intlLocale, {
      weekday: 'short',
      timeZone: 'UTC',
    });
    // 2024-01-01 was a Monday
    return Array.from({ length: 7 }, (_, i) => ({
      value: String(i),
      label: fmt.format(new Date(Date.UTC(2024, 0, 1 + i))),
    }));
  }, [intlLocale]);

  const formatShortDate = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale, {
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${iso}T00:00:00Z`));

  const categoryOptions: KobanSelectOption[] = groups
    .filter((g) => modeFilter(g.mode))
    .flatMap((grp) =>
      availCats
        .filter((c) => c.groupId === grp.id)
        .map((cat) => ({
          value: cat.id,
          label: tCategoryName(cat),
          group: tGroupName(grp),
        }))
    );

  const handleFormFrequency = (f: RecurringFrequency) => {
    setFrequency(f);
    const defaults = scheduleDefaultsFor(
      f,
      {
        startDate: startDate || undefined,
        startMonth: startMonth || undefined,
        dayOfMonth: parseInt(dayOfMonth, 10) || 1,
      },
      monthKey
    );
    if (defaults.startDate) setStartDate(defaults.startDate);
    if (defaults.startMonth) setStartMonth(defaults.startMonth);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmt = parseFloat(amount);
    if (!categoryId || Number.isNaN(numAmt) || numAmt < 0) return;
    const cat = catMap.get(categoryId);
    if (!cat) return;
    if (frequency === 'biweekly' && !startDate) return;
    if (needsStartMonth(frequency) && !startMonth) return;

    const day = Math.min(28, Math.max(1, parseInt(dayOfMonth, 10) || 1));
    onAddRule({
      mode: cat.mode,
      type: cat.kind === 'income' ? 'income' : 'expense',
      categoryId: cat.id,
      description: description.trim() || cat.name,
      amount: numAmt,
      frequency,
      dayOfMonth:
        frequency === 'biweekly' ? parseInt(startDate.slice(8, 10), 10) : day,
      startDate: frequency === 'biweekly' ? startDate : undefined,
      startMonth: needsStartMonth(frequency) ? startMonth : undefined,
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
      (acc, r) => acc + recurringMonthlyEquivalent(r.amount, r.frequency),
      0
    );
  const monthlyRecurringTotalOutflow = visibleRules
    .filter((r) => r.active && r.type === 'expense')
    .reduce(
      (acc, r) => acc + recurringMonthlyEquivalent(r.amount, r.frequency),
      0
    );
  const dueThisMonthOutflow = visibleRules
    .filter((r) => r.active && r.type === 'expense')
    .reduce(
      (acc, r) =>
        acc + (getRecurringOccurrenceDates(r, monthKey)?.length ?? 0) * r.amount,
      0
    );

  /** Start-week / weekday or start-month pickers for a rule (or the add form). */
  const renderStartPickers = (opts: {
    frequency: RecurringFrequency;
    startDate?: string;
    startMonth?: string;
    onStartDate: (d: string | undefined) => void;
    onStartMonth: (m: string | undefined) => void;
    compact?: boolean;
  }) => {
    const missingClass = 'border-accent/70 bg-accent/5';
    if (opts.frequency === 'biweekly') {
      const week = opts.startDate ? isoWeekOfDate(opts.startDate) ?? '' : '';
      const weekday = opts.startDate ? isoWeekdayOfDate(opts.startDate) ?? 0 : 4;
      return (
        <>
          <label className="inline-flex flex-col gap-1">
            {!opts.compact && (
              <span className="text-[11px] text-ink-2">{t('recurring.startWeekLabel')}</span>
            )}
            <input
              type="week"
              value={week}
              required
              title={t('recurring.startWeekLabel')}
              onChange={(e) =>
                opts.onStartDate(
                  e.target.value
                    ? dateInIsoWeek(e.target.value, weekday) ?? undefined
                    : undefined
                )
              }
              className={`${pickerClass} ${opts.compact ? '' : 'h-8 rounded-lg text-xs'} ${
                week ? 'border-line' : missingClass
              }`}
            />
          </label>
          <label className="inline-flex flex-col gap-1">
            {!opts.compact && (
              <span className="text-[11px] text-ink-2">{t('recurring.weekdayLabel')}</span>
            )}
            <KobanSelect
              value={String(weekday)}
              onChange={(val) => {
                const baseWeek = week || isoWeekOfDate(todayIso());
                if (!baseWeek) return;
                opts.onStartDate(dateInIsoWeek(baseWeek, Number(val)) ?? undefined);
              }}
              options={weekdayOptions}
              searchable={false}
              tone="default"
              size={opts.compact ? 'xs' : 'sm'}
              className={opts.compact ? 'w-[76px]' : 'w-[92px]'}
              title={t('recurring.weekdayLabel')}
            />
          </label>
        </>
      );
    }
    if (needsStartMonth(opts.frequency)) {
      return (
        <label className="inline-flex flex-col gap-1">
          {!opts.compact && (
            <span className="text-[11px] text-ink-2">{t('recurring.startMonthLabel')}</span>
          )}
          <input
            type="month"
            value={opts.startMonth ?? ''}
            required
            title={t('recurring.startMonthLabel')}
            onChange={(e) => opts.onStartMonth(e.target.value || undefined)}
            className={`${pickerClass} ${opts.compact ? '' : 'h-8 rounded-lg text-xs'} ${
              opts.startMonth ? 'border-line' : missingClass
            }`}
          />
        </label>
      );
    }
    return null;
  };

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
          <KobanSelect
            value={categoryId}
            onChange={setCategoryId}
            options={categoryOptions}
            searchable
            tone="default"
            size="sm"
            className="w-full"
          />
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
            className="no-spinner w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink tabular-nums text-right focus:outline-none"
          />
        </div>

        <div className="flex-[1_1_130px] min-w-[130px]">
          <label className="block text-[11px] text-ink-2 mb-1 truncate">
            {t('recurring.freqLabel')}
          </label>
          <KobanSelect
            value={frequency}
            onChange={(val) => handleFormFrequency(val as RecurringFrequency)}
            options={frequencyOptions}
            searchable={false}
            tone="default"
            size="sm"
            className="w-full"
          />
        </div>

        {renderStartPickers({
          frequency,
          startDate: startDate || undefined,
          startMonth: startMonth || undefined,
          onStartDate: (d) => setStartDate(d ?? ''),
          onStartMonth: (m) => setStartMonth(m ?? ''),
        })}

        {frequency !== 'biweekly' && (
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
              title={t('recurring.dayRangeLabel')}
              className="w-full h-8 px-2 rounded-lg bg-raised border border-line text-xs text-ink text-center tabular-nums focus:outline-none"
            />
          </div>
        )}

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
          <div className="flex items-center gap-1.5 text-ink-2">
            <span>·</span>
            <span>
              {tf('recurring.dueInMonth', { month: monthKey })}{' '}
              <strong className="text-ink tabular-nums">
                {formatCurrency(dueThisMonthOutflow, currency)}
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
            const dates = getRecurringOccurrenceDates(rule, monthKey);
            const startMissing =
              (rule.frequency === 'biweekly' && !rule.startDate) ||
              (needsStartMonth(rule.frequency) && !rule.startMonth);
            return (
              <div
                key={rule.id}
                className="p-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-raised/40 text-xs"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => onToggleRule(rule.id)}
                    className={`cursor-pointer shrink-0 transition-colors ${
                      rule.active ? 'text-positive' : 'text-ink-2/65 hover:text-positive'
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
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                          rule.type === 'income'
                            ? 'bg-positive/15 text-positive'
                            : 'bg-indigo/12 text-indigo'
                        }`}
                      >
                        <Repeat className="w-3 h-3" />
                        {rule.type === 'income' ? t('finance.income') : t('recurring.fixedBadge')}
                      </span>
                    </div>
                    <div className="text-[11px] text-ink-3 truncate mt-0.5 flex items-center gap-1.5">
                      <span className="truncate">
                        {grp ? tGroupName(grp) : t('finance.category')} · {cat ? tCategoryName(cat) : ruleTitle}
                      </span>
                      <span>·</span>
                      <span
                        className={`inline-flex items-center gap-1 shrink-0 tabular-nums ${
                          startMissing ? 'text-accent' : ''
                        }`}
                        title={startMissing ? t('recurring.startMissingTip') : undefined}
                      >
                        <CalendarClock className="w-3 h-3" />
                        {startMissing
                          ? t('recurring.setStart')
                          : dates && dates.length > 0
                            ? tf('recurring.thisMonth', {
                                month: monthKey,
                                dates: dates.map(formatShortDate).join(', '),
                                amount: formatCurrency(dates.length * rule.amount, currency),
                              })
                            : tf('recurring.notThisMonth', { month: monthKey })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <KobanSelect
                    value={rule.frequency}
                    onChange={(val) => {
                      const f = val as RecurringFrequency;
                      onUpdateRule(rule.id, {
                        frequency: f,
                        ...scheduleDefaultsFor(f, rule, monthKey),
                      });
                    }}
                    options={frequencyOptions}
                    searchable={false}
                    tone="default"
                    size="xs"
                    className="w-[136px]"
                    title={t('recurring.freqLabel')}
                  />

                  {renderStartPickers({
                    frequency: rule.frequency,
                    startDate: rule.startDate,
                    startMonth: rule.startMonth,
                    compact: true,
                    onStartDate: (d) =>
                      onUpdateRule(rule.id, {
                        startDate: d,
                        ...(d ? { dayOfMonth: parseInt(d.slice(8, 10), 10) } : {}),
                      }),
                    onStartMonth: (m) => onUpdateRule(rule.id, { startMonth: m }),
                  })}

                  {rule.frequency !== 'biweekly' && (
                    <div className="inline-flex items-center gap-1 text-[11px] text-ink-2">
                      <span>{t('recurring.dayLabel')}</span>
                      <InlineNumberInput
                        step="1"
                        decimals={0}
                        align="center"
                        clampMin={1}
                        clampMax={28}
                        value={rule.dayOfMonth}
                        title={t('recurring.dayRangeLabel')}
                        onValueChange={(v) =>
                          onUpdateRule(rule.id, { dayOfMonth: Math.round(v) })
                        }
                        className="w-12 text-[11px]"
                      />
                    </div>
                  )}

                  <div className="inline-flex items-center gap-1">
                    <span className="text-[11px] text-ink-3">{currency}</span>
                    <InlineNumberInput
                      value={rule.amount}
                      onValueChange={(v) => onUpdateRule(rule.id, { amount: v })}
                      textClass={rule.type === 'income' ? 'text-positive' : 'text-ink'}
                      className="w-24 font-semibold"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => onDeleteRule(rule.id)}
                    className="p-1.5 rounded-lg border border-transparent text-ink-2/85 hover:text-accent hover:bg-accent/12 hover:border-accent/30 transition-colors cursor-pointer"
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
