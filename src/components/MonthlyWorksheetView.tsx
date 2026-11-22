import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  CopyCheck,
  Receipt,
  FolderPlus,
  RotateCcw,
  Repeat,
  ArrowRight,
  AlertTriangle,
  X,
} from 'lucide-react';
import {
  ActiveWorkspace,
  AppSettings,
  CategoryKind,
  LedgerMode,
  MonthCopyScope,
} from '../types';
import {
  CategoryComputedRow,
  formatCurrency,
  formatNumber,
  GroupComputedSummary,
  MonthSummaryMetrics,
} from '../utils/calculations';
import { formatMonthKey } from '../data/templates';
import { useI18n } from '../i18n';
import { KobanSelect } from './KobanSelect';

interface MonthlyWorksheetViewProps {
  summary: MonthSummaryMetrics;
  currency: string;
  workspace: ActiveWorkspace;
  settings: AppSettings;
  previousMonthHasData: boolean;
  onUpdateBudget: (categoryId: string, newBudget: number) => void;
  onUpdateDirectActual: (categoryId: string, newActual: number | null) => void;
  onRenameCategory: (categoryId: string, newName: string) => void;
  onToggleCategoryRecurring: (categoryId: string) => void;
  onDeleteCategory: (categoryId: string) => void;
  onAddCategory: (
    groupId: string,
    mode: LedgerMode,
    kind: CategoryKind,
    name: string,
    budget: number
  ) => void;
  onAddGroup: (
    mode: LedgerMode,
    name: string,
    kind: CategoryKind,
    column: 0 | 1
  ) => void;
  onDeleteGroup: (groupId: string) => void;
  onQuickLogForCategory: (categoryId: string) => void;
  onApplyBudgetsToAllMonths: () => void;
  onCopyMonthValues: (opts: {
    sourceMonthKey: string;
    targetMonthKey: string;
    scope: MonthCopyScope;
    overwriteExisting: boolean;
    navigateToTarget?: boolean;
    disableFutureConfirm?: boolean;
  }) => void;
}

export const MonthlyWorksheetView: React.FC<MonthlyWorksheetViewProps> = ({
  summary,
  currency,
  workspace,
  settings,
  previousMonthHasData,
  onUpdateBudget,
  onUpdateDirectActual,
  onRenameCategory,
  onToggleCategoryRecurring,
  onDeleteCategory,
  onAddCategory,
  onAddGroup,
  onDeleteGroup,
  onQuickLogForCategory,
  onApplyBudgetsToAllMonths,
  onCopyMonthValues,
}) => {
  const { t, tf, tGroupName, tCategoryName } = useI18n();
  const [hideZeroRows, setHideZeroRows] = useState(
    settings.defaultHideZeroRows ?? false
  );
  const [addingToGroupId, setAddingToGroupId] = useState<string | null>(null);
  const [newCatName, setNewCatName] = useState('');
  const [newCatBudget, setNewCatBudget] = useState('');

  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupKind, setNewGroupKind] = useState<CategoryKind>('expense');
  const [newGroupCol, setNewGroupCol] = useState<0 | 1>(0);
  const [newGroupMode, setNewGroupMode] = useState<LedgerMode>(
    workspace === 'freelancer' ? 'freelancer' : 'home'
  );

  // Month Copy Confirmation Modal State
  const [copyModalState, setCopyModalState] = useState<{
    isOpen: boolean;
    mode: 'prev_to_current' | 'current_to_next' | 'all_months';
    sourceMonthKey: string;
    targetMonthKey: string;
    scope: MonthCopyScope;
    overwriteExisting: boolean;
    navigateToTarget: boolean;
    dontAskAgain: boolean;
  } | null>(null);

  // Compute adjacent month keys
  const prevYear =
    settings.activeMonth === 1
      ? settings.activeYear - 1
      : settings.activeYear;
  const prevMonth =
    settings.activeMonth === 1 ? 12 : settings.activeMonth - 1;
  const prevMonthKey = formatMonthKey(prevYear, prevMonth);

  const nextYear =
    settings.activeMonth === 12
      ? settings.activeYear + 1
      : settings.activeYear;
  const nextMonth =
    settings.activeMonth === 12 ? 1 : settings.activeMonth + 1;
  const nextMonthKey = formatMonthKey(nextYear, nextMonth);

  const isCurrentMonthEmpty =
    summary.incomeBudget === 0 &&
    summary.incomeActual === 0 &&
    summary.totalOutflowBudget === 0 &&
    summary.totalOutflowActual === 0;

  const triggerMonthCopyAction = (
    mode: 'prev_to_current' | 'current_to_next' | 'all_months'
  ) => {
    const defaultScope = settings.monthCopyScope ?? 'budgets_and_actuals';
    const defaultOverwrite = settings.monthCopyOverwriteExisting ?? true;
    const sourceKey =
      mode === 'prev_to_current' ? prevMonthKey : summary.monthKey;
    const targetKey =
      mode === 'prev_to_current'
        ? summary.monthKey
        : mode === 'current_to_next'
          ? nextMonthKey
          : tf('worksheet.copyModalAll12Target', { year: settings.activeYear });

    if (settings.confirmBeforeMonthCopy === false) {
      if (mode === 'all_months') {
        onApplyBudgetsToAllMonths();
      } else {
        onCopyMonthValues({
          sourceMonthKey: sourceKey,
          targetMonthKey: targetKey,
          scope: defaultScope,
          overwriteExisting: defaultOverwrite,
          navigateToTarget: mode === 'current_to_next',
        });
      }
      return;
    }

    setCopyModalState({
      isOpen: true,
      mode,
      sourceMonthKey: sourceKey,
      targetMonthKey: targetKey,
      scope: defaultScope,
      overwriteExisting: defaultOverwrite,
      navigateToTarget: mode === 'current_to_next',
      dontAskAgain: false,
    });
  };

  const confirmAndExecuteCopy = () => {
    if (!copyModalState) return;
    if (copyModalState.mode === 'all_months') {
      onApplyBudgetsToAllMonths();
    } else {
      onCopyMonthValues({
        sourceMonthKey: copyModalState.sourceMonthKey,
        targetMonthKey: copyModalState.targetMonthKey,
        scope: copyModalState.scope,
        overwriteExisting: copyModalState.overwriteExisting,
        navigateToTarget: copyModalState.navigateToTarget,
        disableFutureConfirm: copyModalState.dontAskAgain,
      });
    }
    setCopyModalState(null);
  };

  const leftGroups = summary.groups.filter((g) => g.group.column === 0);
  const rightGroups = summary.groups.filter((g) => g.group.column === 1);

  const handleCreateCategory = (
    e: React.FormEvent,
    groupId: string,
    mode: LedgerMode,
    kind: CategoryKind
  ) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    onAddCategory(
      groupId,
      mode,
      kind,
      newCatName.trim(),
      parseFloat(newCatBudget) || 0
    );
    setNewCatName('');
    setNewCatBudget('');
    setAddingToGroupId(null);
  };

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    const modeToUse: LedgerMode =
      workspace === 'combined'
        ? newGroupMode
        : workspace === 'freelancer'
          ? 'freelancer'
          : 'home';
    onAddGroup(modeToUse, newGroupName.trim().toUpperCase(), newGroupKind, newGroupCol);
    setNewGroupName('');
    setShowNewGroupForm(false);
  };

  const renderCategoryRow = (row: CategoryComputedRow) => {
    if (
      hideZeroRows &&
      row.budget === 0 &&
      row.actual === 0 &&
      row.txCount === 0
    ) {
      return null;
    }

    const isPositiveDiff = row.difference > 0.004;
    const isNegativeDiff = row.difference < -0.004;
    const displayCategoryName = tCategoryName(row.category);

    return (
      <div
        key={row.category.id}
        className="group grid grid-cols-[1fr_84px_84px_84px_54px] items-center gap-1.5 px-3 py-1.5 border-b border-line/60 last:border-b-0 hover:bg-raised/60 transition-colors text-[12px]"
      >
        {/* Category Name + Recurring Toggle + Optional Freelancer / Tx Badges */}
        <div className="flex items-center gap-1.5 min-w-0 pr-1">
          <input
            type="text"
            value={displayCategoryName}
            onChange={(e) => onRenameCategory(row.category.id, e.target.value)}
            className="w-full bg-transparent text-ink truncate focus:outline-none focus:bg-surface focus:px-1.5 rounded"
            title={displayCategoryName}
          />
          <button
            type="button"
            onClick={() => onToggleCategoryRecurring(row.category.id)}
            aria-pressed={Boolean(row.category.isRecurring)}
            className={`p-1 rounded transition-colors shrink-0 cursor-pointer ${
              row.category.isRecurring
                ? 'bg-indigo/18 text-indigo border border-indigo/40 hover:bg-indigo/25'
                : 'text-ink-2/80 border border-transparent hover:text-indigo hover:bg-indigo/12 hover:border-indigo/30'
            }`}
            title={
              row.category.isRecurring
                ? t('worksheet.recurringDisableTip')
                : t('worksheet.recurringEnableTip')
            }
          >
            <Repeat className="w-3.5 h-3.5" />
          </button>
          {row.txCount > 0 && row.directActual === null && (
            <span
              className="px-1.5 py-0.2 rounded text-[10px] bg-raised text-ink-2 border border-line/70 tabular-nums shrink-0"
              title={tf('worksheet.txCountTip', { count: row.txCount })}
            >
              {tf('worksheet.txCountSuffix', { count: row.txCount })}
            </span>
          )}
          {row.directActual !== null && (
            <button
              type="button"
              onClick={() => onUpdateDirectActual(row.category.id, null)}
              className="p-1 rounded border border-transparent text-ink-2/85 hover:text-ink hover:bg-surface hover:border-line transition-colors shrink-0 cursor-pointer"
              title={t('worksheet.manualActualTip')}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          {row.category.mode === 'freelancer' &&
            (row.category.taxRate ||
              (row.category.deductiblePct !== undefined &&
                row.category.deductiblePct < 100)) && (
              <span className="hidden xl:inline-block px-1 py-0.2 rounded text-[9px] bg-indigo/10 text-indigo shrink-0 tabular-nums">
                {row.category.taxRate ? `${row.category.taxRate}% ${t('worksheet.vatShort')}` : ''}
                {row.category.deductiblePct && row.category.deductiblePct < 100
                  ? ` · ${row.category.deductiblePct}% ${t('worksheet.dedShort')}`
                  : ''}
              </span>
            )}
        </div>

        {/* Budget Input */}
        <div className="relative">
          <input
            type="number"
            step="0.05"
            value={row.budget === 0 ? '' : row.budget}
            placeholder="0"
            onChange={(e) => {
              const v = e.target.value === '' ? 0 : parseFloat(e.target.value);
              onUpdateBudget(row.category.id, Number.isNaN(v) ? 0 : v);
            }}
            className="no-spinner w-full h-6 px-1.5 text-right tabular-nums rounded bg-transparent hover:bg-surface focus:bg-surface border border-transparent focus:border-line text-ink-2 focus:text-ink focus:outline-none"
          />
        </div>

        {/* Actual Input (Inline Excel-like editing OR auto-summed from transactions) */}
        <div className="relative">
          <input
            type="number"
            step="0.05"
            value={row.actual === 0 ? '' : Number(row.actual.toFixed(2))}
            placeholder="0"
            onChange={(e) => {
              const v = e.target.value === '' ? 0 : parseFloat(e.target.value);
              onUpdateDirectActual(row.category.id, Number.isNaN(v) ? 0 : v);
            }}
            className="no-spinner w-full h-6 px-1.5 text-right tabular-nums rounded bg-transparent hover:bg-surface focus:bg-surface border border-transparent focus:border-line text-ink font-medium focus:outline-none"
          />
        </div>

        {/* Difference */}
        <div
          className={`text-right tabular-nums pr-1 font-medium ${
            isPositiveDiff
              ? 'text-positive'
              : isNegativeDiff
                ? 'text-accent'
                : 'text-ink-3'
          }`}
        >
          {isPositiveDiff ? '+' : ''}
          {formatNumber(row.difference)}
        </div>

        {/* Row Actions */}
        <div className="flex items-center justify-end gap-0.5">
          <button
            type="button"
            onClick={() => onQuickLogForCategory(row.category.id)}
            className="p-1 rounded border border-transparent text-ink-2/85 hover:text-ink hover:bg-surface hover:border-line transition-colors cursor-pointer"
            title={t('worksheet.logTxTip')}
          >
            <Receipt className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDeleteCategory(row.category.id)}
            className="p-1 rounded border border-transparent text-ink-2/85 hover:text-accent hover:bg-accent/12 hover:border-accent/30 transition-colors cursor-pointer"
            title={t('worksheet.deleteCategoryTip')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  const renderGroupBlock = (gs: GroupComputedSummary) => {
    const isPositiveDiff = gs.totalDifference > 0.004;
    const isNegativeDiff = gs.totalDifference < -0.004;
    const isAdding = addingToGroupId === gs.group.id;
    const displayGroupName = tGroupName(gs.group);

    return (
      <section
        key={gs.group.id}
        className="bg-surface border border-line rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
      >
        {/* Group Header */}
        <div className="grid grid-cols-[1fr_84px_84px_84px_54px] items-center gap-1.5 px-3 py-2.5 bg-raised/70 border-b border-line text-[11px] font-semibold tracking-wide">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: gs.group.color }}
            />
            <span className="text-ink truncate uppercase tracking-[0.08em]">
              {displayGroupName}
            </span>
            {workspace === 'combined' && (
              <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-surface text-ink-2 border border-line/70 font-normal">
                {t(`workspace.${gs.group.mode}`)}
              </span>
            )}
          </div>
          <span className="text-right text-ink-2 font-normal">{t('finance.budget')}</span>
          <span className="text-right text-ink-2 font-normal">{t('finance.actual')}</span>
          <span className="text-right text-ink-2 font-normal pr-1">{t('worksheet.diffShort')}</span>
          <div className="flex items-center justify-end gap-0.5">
            <button
              type="button"
              onClick={() =>
                setAddingToGroupId(isAdding ? null : gs.group.id)
              }
              className="p-1 rounded border border-transparent text-ink-2 hover:text-ink hover:bg-surface hover:border-line transition-colors cursor-pointer"
              title={t('worksheet.addCategoryTip')}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDeleteGroup(gs.group.id)}
              className="p-1 rounded border border-transparent text-ink-2 hover:text-accent hover:bg-accent/12 hover:border-accent/30 transition-colors cursor-pointer"
              title={t('worksheet.deleteGroupTip')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Category Rows */}
        <div className="divide-y divide-line/50">
          {gs.rows.map(renderCategoryRow)}
        </div>

        {/* Inline Add Category Form */}
        {isAdding && (
          <form
            onSubmit={(e) =>
              handleCreateCategory(e, gs.group.id, gs.group.mode, gs.group.kind)
            }
            className="flex items-center gap-2 px-3 py-2 bg-app border-t border-line"
          >
            <input
              type="text"
              placeholder={t('worksheet.newCategoryPlaceholder')}
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              autoFocus
              className="flex-1 h-7 px-2 rounded bg-surface border border-line text-xs text-ink focus:outline-none"
            />
            <input
              type="number"
              step="0.05"
              placeholder={t('worksheet.budgetZeroPlaceholder')}
              value={newCatBudget}
              onChange={(e) => setNewCatBudget(e.target.value)}
              className="w-24 h-7 px-2 rounded bg-surface border border-line text-xs text-ink tabular-nums text-right focus:outline-none"
            />
            <button
              type="submit"
              className="h-7 px-2.5 rounded bg-ink text-on-ink text-xs cursor-pointer"
            >
              {t('common.add')}
            </button>
            <button
              type="button"
              onClick={() => setAddingToGroupId(null)}
              className="h-7 px-2 rounded text-xs text-ink-2 hover:bg-raised cursor-pointer"
            >
              {t('common.cancel')}
            </button>
          </form>
        )}

        {/* Group Total Footer (Matches Excel "Total HOME EXPENSES", etc.) */}
        <div className="grid grid-cols-[1fr_84px_84px_84px_54px] items-center gap-1.5 px-3 py-2 bg-app/80 border-t border-line text-[12px] font-semibold">
          <span className="text-ink truncate">{tf('worksheet.totalGroup', { group: displayGroupName })}</span>
          <span className="text-right tabular-nums text-ink-2 px-1.5">
            {formatNumber(gs.totalBudget)}
          </span>
          <span className="text-right tabular-nums text-ink px-1.5">
            {formatNumber(gs.totalActual)}
          </span>
          <span
            className={`text-right tabular-nums pr-1 ${
              isPositiveDiff
                ? 'text-positive'
                : isNegativeDiff
                  ? 'text-accent'
                  : 'text-ink-3'
            }`}
          >
            {isPositiveDiff ? '+' : ''}
            {formatNumber(gs.totalDifference)}
          </span>
          <span />
        </div>
      </section>
    );
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Toolbar & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-normal text-ink tracking-tight">
            {workspace === 'home'
              ? t('worksheet.titleHome')
              : workspace === 'freelancer'
                ? t('worksheet.titleFreelancer')
                : t('worksheet.titleCombined')}
          </h1>
          <p className="text-xs text-ink-2 mt-0.5">
            {t('worksheet.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setHideZeroRows((v) => !v)}
            className={`h-8 px-3 inline-flex items-center gap-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
              hideZeroRows
                ? 'bg-raised border-ink text-ink font-medium'
                : 'bg-surface border-line text-ink-2 hover:text-ink hover:bg-raised'
            }`}
            title={t('worksheet.hideZeroRowsTip')}
          >
            {hideZeroRows ? (
              <Eye className="w-3.5 h-3.5 text-accent" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )}
            <span>{hideZeroRows ? t('worksheet.showingActive') : t('worksheet.hideZeroRows')}</span>
          </button>

          <button
            onClick={() => triggerMonthCopyAction('prev_to_current')}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer"
            title={tf('worksheet.copyPrevHereTip', { prev: prevMonthKey, curr: summary.monthKey })}
          >
            <CopyCheck className="w-3.5 h-3.5 text-indigo" />
            <span>{tf('worksheet.copyPrevHere', { prev: prevMonthKey })}</span>
          </button>

          <button
            onClick={() => triggerMonthCopyAction('current_to_next')}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer"
            title={tf('worksheet.copyNextMonthTip', { curr: summary.monthKey, next: nextMonthKey })}
          >
            <ArrowRight className="w-3.5 h-3.5 text-positive" />
            <span>{tf('worksheet.copyNextMonth', { next: nextMonthKey })}</span>
          </button>

          <button
            onClick={() => triggerMonthCopyAction('all_months')}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer"
            title={t('worksheet.applyAll12Tip')}
          >
            <CopyCheck className="w-3.5 h-3.5 text-positive" />
            <span>{t('worksheet.applyAll12')}</span>
          </button>

          <button
            onClick={() => setShowNewGroupForm((v) => !v)}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-ink text-on-ink text-xs hover:opacity-90 transition-opacity cursor-pointer"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>{t('worksheet.newGroup')}</span>
          </button>
        </div>
      </div>

      {/* Empty Month Carry-Over Prompt Banner */}
      {isCurrentMonthEmpty &&
        previousMonthHasData &&
        (settings.autoPromptCopyOnEmptyMonth ?? true) && (
          <div className="p-3.5 rounded-xl bg-surface border border-indigo/40 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-2.5 text-xs">
              <CopyCheck className="w-4 h-4 text-indigo shrink-0" />
              <span className="text-ink">
                {tf('worksheet.carryOverBefore', { curr: summary.monthKey, prev: prevMonthKey })}
              </span>
            </div>
            <button
              onClick={() => triggerMonthCopyAction('prev_to_current')}
              className="h-8 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 cursor-pointer shrink-0"
            >
              <CopyCheck className="w-3.5 h-3.5" />
              <span>{tf('worksheet.copyPrevValuesBtn', { prev: prevMonthKey })}</span>
            </button>
          </div>
        )}

      {/* Confirmation Modal for Copying Values Between Months */}
      {copyModalState && copyModalState.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-line flex items-center justify-between bg-app/60">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-medium text-ink">
                  {t('worksheet.copyModalTitle')}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCopyModalState(null)}
                className="p-1 rounded-lg text-ink-2 hover:text-ink hover:bg-raised cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <p className="text-ink leading-relaxed">
                {tf('worksheet.copyModalPrompt', {
                  source: copyModalState.sourceMonthKey,
                  target: copyModalState.targetMonthKey,
                })}
              </p>

              {copyModalState.mode !== 'all_months' && (
                <div className="space-y-3 p-3.5 rounded-xl bg-app border border-line">
                  <div>
                    <label className="block text-[11px] text-ink-2 mb-1.5 font-medium">
                      {t('worksheet.copyModalScopeLabel')}
                    </label>
                    <KobanSelect
                      value={copyModalState.scope}
                      onChange={(val) =>
                        setCopyModalState({
                          ...copyModalState,
                          scope: val as MonthCopyScope,
                        })
                      }
                      tone="surface"
                      size="sm"
                      className="w-full"
                      options={[
                        {
                          value: 'budgets_and_actuals',
                          label: t('onboarding.s4.copyScopeBoth'),
                        },
                        {
                          value: 'budgets_only',
                          label: t('settings.copy.scopeBudgetsOnly'),
                        },
                      ]}
                    />
                  </div>

                  <label className="flex items-center gap-2 text-ink-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={copyModalState.overwriteExisting}
                      onChange={(e) =>
                        setCopyModalState({
                          ...copyModalState,
                          overwriteExisting: e.target.checked,
                        })
                      }
                      className="rounded border-line"
                    />
                    <span>
                      {tf('worksheet.copyModalOverwrite', { target: copyModalState.targetMonthKey })}
                    </span>
                  </label>

                  {copyModalState.mode === 'current_to_next' && (
                    <label className="flex items-center gap-2 text-ink-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={copyModalState.navigateToTarget}
                        onChange={(e) =>
                          setCopyModalState({
                            ...copyModalState,
                            navigateToTarget: e.target.checked,
                          })
                        }
                        className="rounded border-line"
                      />
                      <span>
                        {tf('worksheet.copyModalSwitchMonth', { target: copyModalState.targetMonthKey })}
                      </span>
                    </label>
                  )}
                </div>
              )}

              <label className="flex items-center gap-2 text-[11px] text-ink-3 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={copyModalState.dontAskAgain}
                  onChange={(e) =>
                    setCopyModalState({
                      ...copyModalState,
                      dontAskAgain: e.target.checked,
                    })
                  }
                  className="rounded border-line"
                />
                <span>
                  {t('worksheet.copyModalDontAsk')}
                </span>
              </label>
            </div>

            <div className="px-5 py-3.5 border-t border-line bg-app/50 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setCopyModalState(null)}
                className="h-8 px-3.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={confirmAndExecuteCopy}
                className="h-8 px-4 inline-flex items-center gap-1.5 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 cursor-pointer"
              >
                <CopyCheck className="w-3.5 h-3.5" />
                <span>{t('worksheet.copyModalConfirmBtn')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Optional New Category Group Modal/Banner */}
      {showNewGroupForm && (
        <form
          onSubmit={handleCreateGroup}
          className="p-4 rounded-xl bg-surface border border-line flex flex-wrap items-end gap-3"
        >
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[11px] text-ink-2 mb-1">
              {t('worksheet.groupNameLabel')}
            </label>
            <input
              type="text"
              placeholder={t('worksheet.groupNamePlaceholder')}
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              autoFocus
              className="w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink focus:outline-none"
            />
          </div>

          {workspace === 'combined' && (
            <div>
              <label className="block text-[11px] text-ink-2 mb-1">
                {t('worksheet.ledgerModeLabel')}
              </label>
              <KobanSelect
                value={newGroupMode}
                onChange={(val) => setNewGroupMode(val as LedgerMode)}
                tone="default"
                size="sm"
                className="min-w-[140px]"
                options={[
                  { value: 'home', label: t('onboarding.home') },
                  { value: 'freelancer', label: t('workspace.freelancer') },
                ]}
              />
            </div>
          )}

          <div>
            <label className="block text-[11px] text-ink-2 mb-1">{t('worksheet.typeLabel')}</label>
            <KobanSelect
              value={newGroupKind}
              onChange={(val) => setNewGroupKind(val as CategoryKind)}
              tone="default"
              size="sm"
              className="min-w-[160px]"
              options={[
                { value: 'expense', label: t('worksheet.expenseGroupOpt') },
                { value: 'income', label: t('worksheet.incomeGroupOpt') },
                { value: 'savings', label: t('worksheet.savingsGroupOpt') },
              ]}
            />
          </div>

          <div>
            <label className="block text-[11px] text-ink-2 mb-1">
              {t('worksheet.columnLabel')}
            </label>
            <KobanSelect
              value={String(newGroupCol)}
              onChange={(val) => setNewGroupCol(Number(val) as 0 | 1)}
              tone="default"
              size="sm"
              className="min-w-[140px]"
              options={[
                { value: '0', label: t('worksheet.leftColumnOpt') },
                { value: '1', label: t('worksheet.rightColumnOpt') },
              ]}
            />
          </div>

          <button
            type="submit"
            className="h-8 px-4 rounded-lg bg-ink text-on-ink text-xs font-medium cursor-pointer"
          >
            {t('worksheet.createGroupBtn')}
          </button>
          <button
            type="button"
            onClick={() => setShowNewGroupForm(false)}
            className="h-8 px-3 rounded-lg text-xs text-ink-2 hover:bg-raised cursor-pointer"
          >
            {t('common.cancel')}
          </button>
        </form>
      )}

      {/* Freelancer Tax & Deductible Strip (shown in Freelancer or Combined mode) */}
      {workspace !== 'home' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-surface border border-line">
            <span className="text-[10px] uppercase tracking-[0.1em] text-ink-3">
              {t('worksheet.grossRevenue')}
            </span>
            <div className="text-base font-semibold text-positive tabular-nums mt-0.5">
              {formatCurrency(summary.incomeActual, currency)}
            </div>
            <span className="text-[11px] text-ink-3">
              {tf('worksheet.vatCollected', { amount: formatCurrency(summary.vatCollected, currency) })}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-surface border border-line">
            <span className="text-[10px] uppercase tracking-[0.1em] text-ink-3">
              {t('worksheet.deductibleExp')}
            </span>
            <div className="text-base font-semibold text-indigo tabular-nums mt-0.5">
              {formatCurrency(summary.deductibleExpensesActual, currency)}
            </div>
            <span className="text-[11px] text-ink-3">
              {tf('worksheet.inputVatPaid', { amount: formatCurrency(summary.vatPaidOnExpenses, currency) })}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-surface border border-line">
            <span className="text-[10px] uppercase tracking-[0.1em] text-ink-3">
              {t('worksheet.netVatPayable')}
            </span>
            <div className="text-base font-semibold text-ink tabular-nums mt-0.5">
              {formatCurrency(summary.netVatPayable, currency)}
            </div>
            <span className="text-[11px] text-ink-3">
              {t('worksheet.vatFormula')}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-surface border border-line">
            <span className="text-[10px] uppercase tracking-[0.1em] text-ink-3">
              {t('worksheet.estTaxSetAside')}
            </span>
            <div className="text-base font-semibold text-warning tabular-nums mt-0.5">
              {formatCurrency(summary.estimatedTaxReserve, currency)}
            </div>
            <span className="text-[11px] text-ink-3">
              {t('worksheet.basedOnNetProfit')}
            </span>
          </div>
        </div>
      )}

      {/* Two-Column Vertex42 Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* LEFT COLUMN */}
        <div className="space-y-5">
          {leftGroups.map(renderGroupBlock)}
        </div>

        {/* RIGHT COLUMN: Starts with the iconic BUDGET SUMMARY table just like Vertex42! */}
        <div className="space-y-5">
          {/* BUDGET SUMMARY Box */}
          <section className="bg-surface border-2 border-ink/80 rounded-xl overflow-hidden shadow-xs">
            <div className="grid grid-cols-[1fr_92px_92px_92px] items-center gap-1.5 px-4 py-2.5 bg-ink text-on-ink text-[11px] font-semibold uppercase tracking-[0.08em]">
              <span>{t('worksheet.budgetSummary')}</span>
              <span className="text-right font-normal opacity-80">{t('finance.budget')}</span>
              <span className="text-right font-normal opacity-80">{t('finance.actual')}</span>
              <span className="text-right font-normal opacity-80">
                {t('worksheet.difference')}
              </span>
            </div>

            <div className="divide-y divide-line text-[13px]">
              {/* Total Income */}
              <div className="grid grid-cols-[1fr_92px_92px_92px] items-center gap-1.5 px-4 py-2.5">
                <span className="text-ink font-medium">{t('sidebar.totalIncome')}</span>
                <span className="text-right tabular-nums text-ink-2">
                  {formatNumber(summary.incomeBudget)}
                </span>
                <span className="text-right tabular-nums text-positive font-semibold">
                  {formatNumber(summary.incomeActual)}
                </span>
                <span
                  className={`text-right tabular-nums font-medium ${
                    summary.incomeDifference >= 0
                      ? 'text-positive'
                      : 'text-accent'
                  }`}
                >
                  {summary.incomeDifference > 0 ? '+' : ''}
                  {formatNumber(summary.incomeDifference)}
                </span>
              </div>

              {/* Total Expenses */}
              <div className="grid grid-cols-[1fr_92px_92px_92px] items-center gap-1.5 px-4 py-2.5">
                <span className="text-ink font-medium">{t('sidebar.totalExpenses')}</span>
                <span className="text-right tabular-nums text-ink-2">
                  {formatNumber(summary.totalOutflowBudget)}
                </span>
                <span className="text-right tabular-nums text-ink font-semibold">
                  {formatNumber(summary.totalOutflowActual)}
                </span>
                <span
                  className={`text-right tabular-nums font-medium ${
                    summary.totalOutflowDifference >= 0
                      ? 'text-positive'
                      : 'text-accent'
                  }`}
                >
                  {summary.totalOutflowDifference > 0 ? '+' : ''}
                  {formatNumber(summary.totalOutflowDifference)}
                </span>
              </div>

              {/* NET */}
              <div className="grid grid-cols-[1fr_92px_92px_92px] items-center gap-1.5 px-4 py-3 bg-raised/70 font-semibold">
                <div className="flex items-center gap-2">
                  <span className="text-ink">{t('finance.net')}</span>
                  <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-surface border border-line text-ink-2 tabular-nums">
                    {tf('worksheet.retainedPct', { pct: summary.savingsRatePct.toFixed(1) })}
                  </span>
                </div>
                <span className="text-right tabular-nums text-ink-2">
                  {formatNumber(summary.netBudget)}
                </span>
                <span
                  className={`text-right tabular-nums ${
                    summary.netActual >= 0 ? 'text-positive' : 'text-accent'
                  }`}
                >
                  {formatNumber(summary.netActual)}
                </span>
                <span
                  className={`text-right tabular-nums ${
                    summary.netDifference >= 0 ? 'text-positive' : 'text-accent'
                  }`}
                >
                  {summary.netDifference > 0 ? '+' : ''}
                  {formatNumber(summary.netDifference)}
                </span>
              </div>
            </div>
          </section>

          {/* Right Column Category Groups */}
          {rightGroups.map(renderGroupBlock)}
        </div>
      </div>
    </div>
  );
};
