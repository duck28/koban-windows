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
          : `All 12 Months (${settings.activeYear})`;

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

    return (
      <div
        key={row.category.id}
        className="group grid grid-cols-[1fr_84px_84px_84px_48px] items-center gap-1.5 px-3 py-1.5 border-b border-line/60 last:border-b-0 hover:bg-raised/60 transition-colors text-[12px]"
      >
        {/* Category Name + Recurring Toggle + Optional Freelancer / Tx Badges */}
        <div className="flex items-center gap-1.5 min-w-0 pr-1">
          <input
            type="text"
            value={row.category.name}
            onChange={(e) => onRenameCategory(row.category.id, e.target.value)}
            className="w-full bg-transparent text-ink truncate focus:outline-none focus:bg-surface focus:px-1.5 rounded"
            title={row.category.name}
          />
          <button
            type="button"
            onClick={() => onToggleCategoryRecurring(row.category.id)}
            className={`p-1 rounded transition-all shrink-0 cursor-pointer ${
              row.category.isRecurring
                ? 'bg-indigo/15 text-indigo hover:bg-indigo/25'
                : 'opacity-0 group-hover:opacity-100 text-ink-3 hover:text-indigo hover:bg-indigo/10'
            }`}
            title={
              row.category.isRecurring
                ? 'Recurring monthly item (click to disable recurring)'
                : 'Mark as recurring monthly item'
            }
          >
            <Repeat className="w-3 h-3" />
          </button>
          {row.txCount > 0 && row.directActual === null && (
            <span
              className="px-1.5 py-0.2 rounded text-[10px] bg-raised text-ink-3 tabular-nums shrink-0"
              title={`${row.txCount} logged transaction(s)`}
            >
              {row.txCount}tx
            </span>
          )}
          {row.directActual !== null && (
            <button
              onClick={() => onUpdateDirectActual(row.category.id, null)}
              className="text-ink-3 hover:text-ink shrink-0 cursor-pointer"
              title="Manual actual override active — click to revert to transaction sum"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
          {row.category.mode === 'freelancer' &&
            (row.category.taxRate ||
              (row.category.deductiblePct !== undefined &&
                row.category.deductiblePct < 100)) && (
              <span className="hidden xl:inline-block px-1 py-0.2 rounded text-[9px] bg-indigo/10 text-indigo shrink-0 tabular-nums">
                {row.category.taxRate ? `${row.category.taxRate}% VAT` : ''}
                {row.category.deductiblePct && row.category.deductiblePct < 100
                  ? ` · ${row.category.deductiblePct}% Ded.`
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

        {/* Quick Actions on Hover */}
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onQuickLogForCategory(row.category.id)}
            className="p-1 rounded text-ink-3 hover:text-ink hover:bg-surface cursor-pointer"
            title="Log transaction in this category"
          >
            <Receipt className="w-3 h-3" />
          </button>
          <button
            onClick={() => onDeleteCategory(row.category.id)}
            className="p-1 rounded text-ink-3 hover:text-accent hover:bg-surface cursor-pointer"
            title="Delete category"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  };

  const renderGroupBlock = (gs: GroupComputedSummary) => {
    const isPositiveDiff = gs.totalDifference > 0.004;
    const isNegativeDiff = gs.totalDifference < -0.004;
    const isAdding = addingToGroupId === gs.group.id;

    return (
      <section
        key={gs.group.id}
        className="bg-surface border border-line rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
      >
        {/* Group Header */}
        <div className="grid grid-cols-[1fr_84px_84px_84px_48px] items-center gap-1.5 px-3 py-2.5 bg-raised/70 border-b border-line text-[11px] font-semibold tracking-wide">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: gs.group.color }}
            />
            <span className="text-ink truncate uppercase tracking-[0.08em]">
              {gs.group.name}
            </span>
            {workspace === 'combined' && (
              <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-surface text-ink-3 font-normal">
                {gs.group.mode}
              </span>
            )}
          </div>
          <span className="text-right text-ink-2 font-normal">Budget</span>
          <span className="text-right text-ink-2 font-normal">Actual</span>
          <span className="text-right text-ink-2 font-normal pr-1">Diff.</span>
          <div className="flex items-center justify-end gap-0.5">
            <button
              onClick={() =>
                setAddingToGroupId(isAdding ? null : gs.group.id)
              }
              className="p-1 rounded text-ink-2 hover:text-ink hover:bg-surface cursor-pointer"
              title="Add category to this group"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onDeleteGroup(gs.group.id)}
              className="p-1 rounded text-ink-3 hover:text-accent hover:bg-surface cursor-pointer"
              title="Delete entire group"
            >
              <Trash2 className="w-3 h-3" />
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
              placeholder="New category name…"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              autoFocus
              className="flex-1 h-7 px-2 rounded bg-surface border border-line text-xs text-ink focus:outline-none"
            />
            <input
              type="number"
              step="0.05"
              placeholder="Budget (0)"
              value={newCatBudget}
              onChange={(e) => setNewCatBudget(e.target.value)}
              className="w-24 h-7 px-2 rounded bg-surface border border-line text-xs text-ink tabular-nums text-right focus:outline-none"
            />
            <button
              type="submit"
              className="h-7 px-2.5 rounded bg-ink text-on-ink text-xs cursor-pointer"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setAddingToGroupId(null)}
              className="h-7 px-2 rounded text-xs text-ink-2 hover:bg-raised cursor-pointer"
            >
              Cancel
            </button>
          </form>
        )}

        {/* Group Total Footer (Matches Excel "Total HOME EXPENSES", etc.) */}
        <div className="grid grid-cols-[1fr_84px_84px_84px_48px] items-center gap-1.5 px-3 py-2 bg-app/80 border-t border-line text-[12px] font-semibold">
          <span className="text-ink truncate">Total {gs.group.name}</span>
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
              ? 'Personal Monthly Budget'
              : workspace === 'freelancer'
                ? 'Freelancer Business Budget & P&L'
                : 'Combined Home & Freelancer Worksheet'}
          </h1>
          <p className="text-xs text-ink-2 mt-0.5">
            Click any Budget or Actual figure to edit directly inline, or log itemized transactions.
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
            title="Hide or show categories with 0.00 Budget and 0.00 Actual"
          >
            {hideZeroRows ? (
              <Eye className="w-3.5 h-3.5 text-accent" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )}
            <span>{hideZeroRows ? 'Showing Active Only' : 'Hide Zero Rows'}</span>
          </button>

          <button
            onClick={() => triggerMonthCopyAction('prev_to_current')}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer"
            title={`Copy values from previous month (${prevMonthKey}) into this month (${summary.monthKey})`}
          >
            <CopyCheck className="w-3.5 h-3.5 text-indigo" />
            <span>Copy {prevMonthKey} → Here</span>
          </button>

          <button
            onClick={() => triggerMonthCopyAction('current_to_next')}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer"
            title={`Copy this month's values (${summary.monthKey}) into next month (${nextMonthKey})`}
          >
            <ArrowRight className="w-3.5 h-3.5 text-positive" />
            <span>Copy into Next Month ({nextMonthKey})</span>
          </button>

          <button
            onClick={() => triggerMonthCopyAction('all_months')}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer"
            title="Copy this month's planned Budget amounts across all 12 months of the year"
          >
            <CopyCheck className="w-3.5 h-3.5 text-positive" />
            <span>Apply to All 12 Months</span>
          </button>

          <button
            onClick={() => setShowNewGroupForm((v) => !v)}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-ink text-on-ink text-xs hover:opacity-90 transition-opacity cursor-pointer"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>New Category Group</span>
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
                <strong>{summary.monthKey}</strong> has no budget or actual values yet, while previous month{' '}
                <strong>{prevMonthKey}</strong> has configured values. Would you like to copy last month&apos;s values into{' '}
                <strong>{summary.monthKey}</strong>?
              </span>
            </div>
            <button
              onClick={() => triggerMonthCopyAction('prev_to_current')}
              className="h-8 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 cursor-pointer shrink-0"
            >
              <CopyCheck className="w-3.5 h-3.5" />
              <span>Copy {prevMonthKey} Values…</span>
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
                  Confirm Copying Monthly Values
                </h3>
              </div>
              <button
                onClick={() => setCopyModalState(null)}
                className="p-1 rounded-lg text-ink-3 hover:text-ink hover:bg-raised cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <p className="text-ink leading-relaxed">
                Are you sure you want to copy values from{' '}
                <strong className="font-semibold">
                  {copyModalState.sourceMonthKey}
                </strong>{' '}
                into{' '}
                <strong className="font-semibold">
                  {copyModalState.targetMonthKey}
                </strong>
                ?
              </p>

              {copyModalState.mode !== 'all_months' && (
                <div className="space-y-3 p-3.5 rounded-xl bg-app border border-line">
                  <div>
                    <label className="block text-[11px] text-ink-2 mb-1.5 font-medium">
                      Values to Copy
                    </label>
                    <select
                      value={copyModalState.scope}
                      onChange={(e) =>
                        setCopyModalState({
                          ...copyModalState,
                          scope: e.target.value as MonthCopyScope,
                        })
                      }
                      className="w-full h-8 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none"
                    >
                      <option value="budgets_and_actuals">
                        Both Planned Budgets & Direct Actuals
                      </option>
                      <option value="budgets_only">
                        Planned Budgets Only (Leave Actuals at 0)
                      </option>
                    </select>
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
                      Overwrite existing non-zero entries in{' '}
                      {copyModalState.targetMonthKey}
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
                        Switch active month to {copyModalState.targetMonthKey}{' '}
                        after copying
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
                  Don&apos;t ask for confirmation again (can be changed in Settings)
                </span>
              </label>
            </div>

            <div className="px-5 py-3.5 border-t border-line bg-app/50 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setCopyModalState(null)}
                className="h-8 px-3.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmAndExecuteCopy}
                className="h-8 px-4 inline-flex items-center gap-1.5 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 cursor-pointer"
              >
                <CopyCheck className="w-3.5 h-3.5" />
                <span>Yes, Copy Values</span>
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
              Group Name
            </label>
            <input
              type="text"
              placeholder="e.g. REAL ESTATE, SIDE PROJECT, PETS"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              autoFocus
              className="w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink focus:outline-none"
            />
          </div>

          {workspace === 'combined' && (
            <div>
              <label className="block text-[11px] text-ink-2 mb-1">
                Ledger Mode
              </label>
              <select
                value={newGroupMode}
                onChange={(e) => setNewGroupMode(e.target.value as LedgerMode)}
                className="h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink"
              >
                <option value="home">Home Budget</option>
                <option value="freelancer">Freelancer</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-[11px] text-ink-2 mb-1">Type</label>
            <select
              value={newGroupKind}
              onChange={(e) => setNewGroupKind(e.target.value as CategoryKind)}
              className="h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink"
            >
              <option value="expense">Expense Group</option>
              <option value="income">Income Group</option>
              <option value="savings">Savings / Reserve</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-ink-2 mb-1">
              Worksheet Column
            </label>
            <select
              value={newGroupCol}
              onChange={(e) => setNewGroupCol(Number(e.target.value) as 0 | 1)}
              className="h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink"
            >
              <option value={0}>Left Column</option>
              <option value={1}>Right Column</option>
            </select>
          </div>

          <button
            type="submit"
            className="h-8 px-4 rounded-lg bg-ink text-on-ink text-xs font-medium cursor-pointer"
          >
            Create Group
          </button>
          <button
            type="button"
            onClick={() => setShowNewGroupForm(false)}
            className="h-8 px-3 rounded-lg text-xs text-ink-2 hover:bg-raised cursor-pointer"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Freelancer Tax & Deductible Strip (shown in Freelancer or Combined mode) */}
      {workspace !== 'home' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-surface border border-line">
            <span className="text-[10px] uppercase tracking-[0.1em] text-ink-3">
              Gross Revenue
            </span>
            <div className="text-base font-semibold text-positive tabular-nums mt-0.5">
              {formatCurrency(summary.incomeActual, currency)}
            </div>
            <span className="text-[11px] text-ink-3">
              VAT Collected: {formatCurrency(summary.vatCollected, currency)}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-surface border border-line">
            <span className="text-[10px] uppercase tracking-[0.1em] text-ink-3">
              Deductible Business Expenses
            </span>
            <div className="text-base font-semibold text-indigo tabular-nums mt-0.5">
              {formatCurrency(summary.deductibleExpensesActual, currency)}
            </div>
            <span className="text-[11px] text-ink-3">
              Input VAT Paid: {formatCurrency(summary.vatPaidOnExpenses, currency)}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-surface border border-line">
            <span className="text-[10px] uppercase tracking-[0.1em] text-ink-3">
              Net VAT / MWST Payable
            </span>
            <div className="text-base font-semibold text-ink tabular-nums mt-0.5">
              {formatCurrency(summary.netVatPayable, currency)}
            </div>
            <span className="text-[11px] text-ink-3">
              Output VAT − Input Tax Credit
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-surface border border-line">
            <span className="text-[10px] uppercase tracking-[0.1em] text-ink-3">
              Est. Income Tax Set-Aside
            </span>
            <div className="text-base font-semibold text-warning tabular-nums mt-0.5">
              {formatCurrency(summary.estimatedTaxReserve, currency)}
            </div>
            <span className="text-[11px] text-ink-3">
              Based on net operating profit
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
              <span>BUDGET SUMMARY</span>
              <span className="text-right font-normal opacity-80">Budget</span>
              <span className="text-right font-normal opacity-80">Actual</span>
              <span className="text-right font-normal opacity-80">
                Difference
              </span>
            </div>

            <div className="divide-y divide-line text-[13px]">
              {/* Total Income */}
              <div className="grid grid-cols-[1fr_92px_92px_92px] items-center gap-1.5 px-4 py-2.5">
                <span className="text-ink font-medium">Total Income</span>
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
                <span className="text-ink font-medium">Total Expenses</span>
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
                  <span className="text-ink">NET</span>
                  <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-surface border border-line text-ink-2 tabular-nums">
                    {summary.savingsRatePct.toFixed(1)}% retained
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
