import React, { useEffect, useRef, useState } from 'react';
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
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  AlertTriangle,
  X,
  Anchor,
  CalendarClock,
  GripVertical,
} from 'lucide-react';
import {
  ActiveWorkspace,
  AppSettings,
  CategoryKind,
  FinancialAccount,
  LedgerMode,
  MonthCopyScope,
  WorksheetColumnWidths,
  WorksheetSortDirection,
  WorksheetSortField,
} from '../types';
import {
  CategoryComputedRow,
  formatCurrency,
  formatNumber,
  GroupComputedSummary,
  MonthSummaryMetrics,
  sortWorksheetRows,
} from '../utils/calculations';
import { formatMonthKey } from '../data/templates';
import { useI18n } from '../i18n';
import { KobanSelect } from './KobanSelect';

const DEFAULT_COL_WIDTHS: Required<WorksheetColumnWidths> = {
  budget: 86,
  actual: 86,
  diff: 78,
  leftPanePct: 50,
};
const ACTIONS_COL_WIDTH = 52;
const MIN_LABEL_COL_WIDTH = 170;
type ResizableColKey = 'budget' | 'actual' | 'diff';

interface MonthlyWorksheetViewProps {
  summary: MonthSummaryMetrics;
  currency: string;
  workspace: ActiveWorkspace;
  settings: AppSettings;
  previousMonthHasData: boolean;
  onUpdateBudget: (categoryId: string, newBudget: number) => void;
  onUpdateDirectActual: (categoryId: string, newActual: number | null) => void;
  onResetScheduledBudget: (categoryId: string) => void;
  onRenameCategory: (categoryId: string, newName: string) => void;
  onToggleCategoryRecurring: (categoryId: string) => void;
  onToggleCategoryFixed: (categoryId: string) => void;
  /** For the savings target-account badge */
  accounts: FinancialAccount[];
  onUpdateCategoryTargetAccount?: (
    categoryId: string,
    targetAccountId: string | undefined
  ) => void;
  onReorderCategory?: (opts: {
    draggedCategoryId: string;
    targetGroupId: string;
    targetCategoryId: string | null;
    position: 'before' | 'after';
    baseOrderIds?: string[];
  }) => void;
  onUpdateSettings?: (patch: Partial<AppSettings>) => void;
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
  onResetScheduledBudget,
  onRenameCategory,
  onToggleCategoryRecurring,
  onToggleCategoryFixed,
  accounts,
  onUpdateCategoryTargetAccount,
  onReorderCategory,
  onUpdateSettings,
  onDeleteCategory,
  onAddCategory,
  onAddGroup,
  onDeleteGroup,
  onQuickLogForCategory,
  onApplyBudgetsToAllMonths,
  onCopyMonthValues,
}) => {
  const { t, tf, tGroupName, tCategoryName, tAccountName } = useI18n();
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

  // Adjustable column widths & desktop split ratio
  const [colWidths, setColWidths] = useState<Required<WorksheetColumnWidths>>(() => ({
    budget: settings.worksheetColumnWidths?.budget ?? DEFAULT_COL_WIDTHS.budget,
    actual: settings.worksheetColumnWidths?.actual ?? DEFAULT_COL_WIDTHS.actual,
    diff: settings.worksheetColumnWidths?.diff ?? DEFAULT_COL_WIDTHS.diff,
    leftPanePct: settings.worksheetColumnWidths?.leftPanePct ?? DEFAULT_COL_WIDTHS.leftPanePct,
  }));
  const colWidthsRef = useRef(colWidths);
  colWidthsRef.current = colWidths;

  useEffect(() => {
    const w = settings.worksheetColumnWidths;
    if (!w) return;
    setColWidths({
      budget: w.budget ?? DEFAULT_COL_WIDTHS.budget,
      actual: w.actual ?? DEFAULT_COL_WIDTHS.actual,
      diff: w.diff ?? DEFAULT_COL_WIDTHS.diff,
      leftPanePct: w.leftPanePct ?? DEFAULT_COL_WIDTHS.leftPanePct,
    });
  }, [settings.worksheetColumnWidths]);

  const [resizingCol, setResizingCol] = useState<ResizableColKey | null>(null);
  const [resizingSplit, setResizingSplit] = useState(false);

  // Responsive container measurement for two-column split vs. single column
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(() =>
    typeof window !== 'undefined' && window.innerWidth >= 1024 ? 1024 : 720
  );

  useEffect(() => {
    const el = splitContainerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sorting state
  const sortBy: WorksheetSortField = settings.worksheetSortBy ?? 'manual';
  const sortDir: WorksheetSortDirection = settings.worksheetSortDir ?? 'asc';

  const cycleColumnSort = (field: 'name' | 'budget' | 'actual' | 'diff') => {
    const defaultDir: WorksheetSortDirection = field === 'name' ? 'asc' : 'desc';
    if (sortBy !== field) {
      onUpdateSettings?.({ worksheetSortBy: field, worksheetSortDir: defaultDir });
    } else if (sortDir === defaultDir) {
      onUpdateSettings?.({
        worksheetSortBy: field,
        worksheetSortDir: defaultDir === 'asc' ? 'desc' : 'asc',
      });
    } else {
      onUpdateSettings?.({ worksheetSortBy: 'manual', worksheetSortDir: 'asc' });
    }
  };

  // Drag-and-drop category reordering
  const [draggedCatId, setDraggedCatId] = useState<string | null>(null);
  const draggedCatIdRef = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    groupId: string;
    categoryId: string | null;
    position: 'before' | 'after';
  } | null>(null);

  const clearDragState = () => {
    draggedCatIdRef.current = null;
    setDraggedCatId(null);
    setDropTarget(null);
  };

  const hasCustomWidths =
    colWidths.budget !== DEFAULT_COL_WIDTHS.budget ||
    colWidths.actual !== DEFAULT_COL_WIDTHS.actual ||
    colWidths.diff !== DEFAULT_COL_WIDTHS.diff ||
    colWidths.leftPanePct !== DEFAULT_COL_WIDTHS.leftPanePct;

  const resetAllWidths = () => {
    const next = { ...DEFAULT_COL_WIDTHS };
    colWidthsRef.current = next;
    setColWidths(next);
    onUpdateSettings?.({ worksheetColumnWidths: next });
  };

  const resetNumericColWidths = () => {
    const next = {
      ...colWidthsRef.current,
      budget: DEFAULT_COL_WIDTHS.budget,
      actual: DEFAULT_COL_WIDTHS.actual,
      diff: DEFAULT_COL_WIDTHS.diff,
    };
    colWidthsRef.current = next;
    setColWidths(next);
    onUpdateSettings?.({ worksheetColumnWidths: next });
  };

  const startColResize = (
    col: ResizableColKey,
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidthsRef.current[col];
    const minW = col === 'diff' ? 60 : 64;
    const maxW = 180;
    setResizingCol(col);

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const nextVal = Math.max(minW, Math.min(maxW, Math.round(startWidth - dx)));
      const next = { ...colWidthsRef.current, [col]: nextVal };
      colWidthsRef.current = next;
      setColWidths(next);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setResizingCol(null);
      onUpdateSettings?.({ worksheetColumnWidths: colWidthsRef.current });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startSplitResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = splitContainerRef.current;
    if (!el) return;
    const totalAvail = Math.max(300, el.clientWidth - 12);
    const startX = e.clientX;
    const startPct = colWidthsRef.current.leftPanePct ?? 50;
    const startLeftPx = (startPct / 100) * totalAvail;
    setResizingSplit(true);

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const nextPct = Math.max(
        34,
        Math.min(66, Math.round(((startLeftPx + dx) / totalAvail) * 100))
      );
      const next = { ...colWidthsRef.current, leftPanePct: nextPct };
      colWidthsRef.current = next;
      setColWidths(next);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setResizingSplit(false);
      onUpdateSettings?.({ worksheetColumnWidths: colWidthsRef.current });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const rowGridStyle: React.CSSProperties = {
    gridTemplateColumns: `minmax(${MIN_LABEL_COL_WIDTH}px, 1fr) ${colWidths.budget}px ${colWidths.actual}px ${colWidths.diff}px ${ACTIONS_COL_WIDTH}px`,
  };
  const summaryGridStyle: React.CSSProperties = {
    gridTemplateColumns: `minmax(${MIN_LABEL_COL_WIDTH}px, 1fr) ${colWidths.budget}px ${colWidths.actual}px ${colWidths.diff}px`,
  };
  const rowMinTableWidth =
    MIN_LABEL_COL_WIDTH +
    colWidths.budget +
    colWidths.actual +
    colWidths.diff +
    ACTIONS_COL_WIDTH +
    36;
  const summaryMinTableWidth =
    MIN_LABEL_COL_WIDTH + colWidths.budget + colWidths.actual + colWidths.diff + 44;
  const isTwoColumn = containerWidth >= 900;

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

  const renderCategoryRow = (
    row: CategoryComputedRow,
    sortedRowIds: string[]
  ) => {
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
    const isDragged = draggedCatId === row.category.id;
    const isDropTarget =
      dropTarget?.groupId === row.group.id &&
      dropTarget.categoryId === row.category.id &&
      draggedCatId !== row.category.id;
    const isDropBefore = isDropTarget && dropTarget?.position === 'before';
    const isDropAfter = isDropTarget && dropTarget?.position === 'after';

    return (
      <div
        key={row.category.id}
        style={rowGridStyle}
        onMouseDown={(e) => {
          const el = e.target as HTMLElement;
          if (el.closest('[data-drag-handle]')) {
            e.currentTarget.draggable = Boolean(onReorderCategory);
            return;
          }
          const isInteractive = Boolean(
            el.closest('input, select, button, option, [data-no-drag]')
          );
          e.currentTarget.draggable = Boolean(onReorderCategory) && !isInteractive;
        }}
        onDragStart={(e) => {
          if (!onReorderCategory) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData('text/plain', row.category.id);
          e.dataTransfer.effectAllowed = 'move';
          draggedCatIdRef.current = row.category.id;
          setDraggedCatId(row.category.id);
        }}
        onDragOver={(e) => {
          const activeId = draggedCatIdRef.current;
          if (!activeId || activeId === row.category.id || !onReorderCategory) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          const rect = e.currentTarget.getBoundingClientRect();
          const position: 'before' | 'after' =
            e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
          setDropTarget((prev) =>
            prev?.groupId === row.group.id &&
            prev.categoryId === row.category.id &&
            prev.position === position
              ? prev
              : { groupId: row.group.id, categoryId: row.category.id, position }
          );
        }}
        onDrop={(e) => {
          const activeId =
            draggedCatIdRef.current || e.dataTransfer.getData('text/plain');
          if (!activeId || activeId === row.category.id || !onReorderCategory) {
            clearDragState();
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const position: 'before' | 'after' =
            e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
          onReorderCategory({
            draggedCategoryId: activeId,
            targetGroupId: row.group.id,
            targetCategoryId: row.category.id,
            position,
            baseOrderIds: sortedRowIds,
          });
          clearDragState();
        }}
        onDragEnd={clearDragState}
        className={`group grid items-center gap-1 px-2.5 py-1.5 border-b border-line/60 last:border-b-0 hover:bg-raised/60 transition-colors text-[12px] ${
          isDragged ? 'opacity-45 bg-raised/70' : ''
        } ${isDropBefore ? '!border-t-2 !border-t-indigo' : ''} ${
          isDropAfter ? '!border-b-2 !border-b-indigo' : ''
        }`}
      >
        {/* Category Name + badges & icons (strictly single-line; truncates cleanly without wrapping or overlapping) */}
        <div className="flex items-center gap-1 min-w-0 overflow-hidden pr-0.5">
          {onReorderCategory && (
            <span
              data-drag-handle
              className="w-4 h-6 inline-flex items-center justify-center text-ink-3/55 group-hover:text-ink-2 cursor-grab active:cursor-grabbing shrink-0 select-none"
              title={t('worksheet.dragRowTip')}
            >
              <GripVertical className="w-3.5 h-3.5" />
            </span>
          )}
          <input
            type="text"
            size={1}
            value={displayCategoryName}
            onChange={(e) => onRenameCategory(row.category.id, e.target.value)}
            className="flex-1 basis-0 min-w-[48px] bg-transparent text-ink truncate focus:outline-none focus:bg-surface focus:px-1.5 rounded"
            title={displayCategoryName}
          />

          {row.group.kind === 'savings' && (() => {
            const target = accounts.find((a) => a.id === row.category.targetAccountId);
            const eligibleAccounts = accounts.filter(
              (a) =>
                a.id === row.category.targetAccountId ||
                (a.mode === row.category.mode && a.classification !== 'liability')
            );
            return (
              <span
                data-no-drag
                className={`relative overflow-hidden inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] shrink min-w-[28px] max-w-[112px] ${
                  target ? 'bg-indigo/10 text-indigo' : 'bg-accent/10 text-accent'
                }`}
                title={
                  target
                    ? tf('worksheet.savingsTargetTip', { account: tAccountName(target) })
                    : t('worksheet.savingsNoTargetTip')
                }
              >
                <ArrowRight className="w-2.5 h-2.5 shrink-0" />
                <span className="truncate">{target ? tAccountName(target) : '?'}</span>
                {onUpdateCategoryTargetAccount && (
                  <select
                    value={row.category.targetAccountId ?? ''}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      onUpdateCategoryTargetAccount(
                        row.category.id,
                        e.target.value || undefined
                      )
                    }
                    aria-label={t('categories.targetAccountPick')}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  >
                    <option value="">?</option>
                    {eligibleAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {tAccountName(a)}
                      </option>
                    ))}
                  </select>
                )}
              </span>
            );
          })()}
          {row.budgetOverridesSchedule ? (
            <button
              type="button"
              onClick={() => onResetScheduledBudget(row.category.id)}
              className="w-5 h-5 inline-flex items-center justify-center rounded border border-transparent text-indigo/80 hover:text-indigo hover:bg-surface hover:border-line transition-colors cursor-pointer shrink-0"
              title={t('worksheet.manualBudgetTip')}
            >
              <CalendarClock className="w-3.5 h-3.5" />
            </button>
          ) : row.budgetFromSchedule ? (
            <span
              className="w-5 h-5 inline-flex items-center justify-center text-indigo/80 shrink-0"
              title={t('worksheet.scheduledBudgetTip')}
            >
              <CalendarClock className="w-3.5 h-3.5" />
            </span>
          ) : null}
          {row.txCount > 0 && row.directActual === null && (
            <span
              className="px-1 py-0.2 rounded text-[10px] bg-raised text-ink-2 border border-line/70 tabular-nums shrink-0"
              title={tf('worksheet.txCountTip', { count: row.txCount })}
            >
              {tf('worksheet.txCountSuffix', { count: row.txCount })}
            </span>
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

          {/* Compact icon slots: recurring · fixed cost · reset Actual (omit spacer when absent) */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => onToggleCategoryRecurring(row.category.id)}
              aria-pressed={Boolean(row.category.isRecurring)}
              className={`w-5 h-5 inline-flex items-center justify-center rounded transition-colors cursor-pointer ${
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
              <Repeat className="w-3 h-3" />
            </button>
            {row.group.kind !== 'income' ? (
              <button
                type="button"
                onClick={() => onToggleCategoryFixed(row.category.id)}
                aria-pressed={row.isFixedCost}
                className={`w-5 h-5 inline-flex items-center justify-center rounded transition-colors cursor-pointer ${
                  row.isFixedCost
                    ? 'bg-indigo/18 text-indigo border border-indigo/40 hover:bg-indigo/25'
                    : 'text-ink-2/80 border border-transparent hover:text-indigo hover:bg-indigo/12 hover:border-indigo/30'
                }`}
                title={
                  row.isFixedCost
                    ? t('worksheet.fixedCostTip')
                    : t('worksheet.fixedCostEnableTip')
                }
              >
                <Anchor className="w-3 h-3" />
              </button>
            ) : (
              <span className="w-5 h-5" aria-hidden="true" />
            )}
            {row.directActual !== null && (
              <button
                type="button"
                onClick={() => onUpdateDirectActual(row.category.id, null)}
                className="w-5 h-5 inline-flex items-center justify-center rounded border border-transparent text-ink-2/85 hover:text-ink hover:bg-surface hover:border-line transition-colors cursor-pointer"
                title={t('worksheet.manualActualTip')}
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Budget Input */}
        <div className="relative min-w-0">
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
        <div className="relative min-w-0">
          <input
            type="number"
            step="0.05"
            value={row.actual === 0 ? '' : Number(row.actual.toFixed(2))}
            placeholder="0"
            onChange={(e) => {
              const v = e.target.value === '' ? 0 : parseFloat(e.target.value);
              onUpdateDirectActual(row.category.id, Number.isNaN(v) ? 0 : v);
            }}
            title={row.autoActual ? t('worksheet.autoActualTip') : undefined}
            className={`no-spinner w-full h-6 px-1.5 text-right tabular-nums rounded bg-transparent hover:bg-surface focus:bg-surface border border-transparent focus:border-line font-medium focus:outline-none ${
              row.autoActual ? 'text-indigo italic focus:not-italic focus:text-ink' : 'text-ink'
            }`}
          />
        </div>

        {/* Difference */}
        <div
          className={`text-right tabular-nums pr-1 font-medium truncate ${
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

  const renderResizableColumnHeader = (
    label: string,
    field: ResizableColKey,
    extraClass = ''
  ) => {
    const isActive = sortBy === field;
    return (
      <div className={`relative flex items-center justify-end min-w-0 select-none ${extraClass}`}>
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={(e) => startColResize(field, e)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            resetNumericColWidths();
          }}
          title={t('worksheet.resizeColTip')}
          className="absolute -left-1.5 top-[-6px] bottom-[-6px] w-2.5 cursor-col-resize z-10 flex items-center justify-center group/resize"
        >
          <span
            className={`w-[2px] h-3.5 rounded-full transition-colors ${
              resizingCol === field
                ? 'bg-indigo'
                : 'bg-line/70 group-hover/resize:bg-indigo'
            }`}
          />
        </div>
        <button
          type="button"
          onClick={() => cycleColumnSort(field)}
          className={`inline-flex items-center justify-end gap-0.5 max-w-full truncate hover:text-ink transition-colors cursor-pointer ${
            isActive ? 'text-ink font-semibold' : 'text-ink-2 font-normal'
          }`}
          title={tf('worksheet.sortLabel') + ': ' + label}
        >
          <span className="truncate">{label}</span>
          {isActive &&
            (sortDir === 'asc' ? (
              <ArrowUp className="w-3 h-3 shrink-0 text-indigo" />
            ) : (
              <ArrowDown className="w-3 h-3 shrink-0 text-indigo" />
            ))}
        </button>
      </div>
    );
  };

  const renderGroupBlock = (gs: GroupComputedSummary) => {
    const isPositiveDiff = gs.totalDifference > 0.004;
    const isNegativeDiff = gs.totalDifference < -0.004;
    const isAdding = addingToGroupId === gs.group.id;
    const displayGroupName = tGroupName(gs.group);
    const sortedRows = sortWorksheetRows(gs.rows, sortBy, sortDir, tCategoryName);
    const sortedRowIds = sortedRows.map((r) => r.category.id);
    const isGroupEndDropHover =
      draggedCatId !== null &&
      dropTarget?.groupId === gs.group.id &&
      dropTarget.categoryId === null;

    return (
      <section
        key={gs.group.id}
        className={`bg-surface border rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors ${
          isGroupEndDropHover ? 'border-indigo ring-1 ring-indigo/50' : 'border-line'
        }`}
      >
        <div className="overflow-x-auto">
          <div className="w-full" style={{ minWidth: `${rowMinTableWidth}px` }}>
            {/* Group Header */}
            <div
              style={rowGridStyle}
              onDragOver={(e) => {
                if (!draggedCatIdRef.current || !onReorderCategory) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const firstId = sortedRowIds[0] ?? null;
                setDropTarget((prev) =>
                  prev?.groupId === gs.group.id &&
                  prev.categoryId === firstId &&
                  prev.position === 'before'
                    ? prev
                    : { groupId: gs.group.id, categoryId: firstId, position: 'before' }
                );
              }}
              onDrop={(e) => {
                const activeId =
                  draggedCatIdRef.current || e.dataTransfer.getData('text/plain');
                if (!activeId || !onReorderCategory) {
                  clearDragState();
                  return;
                }
                e.preventDefault();
                e.stopPropagation();
                onReorderCategory({
                  draggedCategoryId: activeId,
                  targetGroupId: gs.group.id,
                  targetCategoryId: sortedRowIds[0] ?? null,
                  position: 'before',
                  baseOrderIds: sortedRowIds,
                });
                clearDragState();
              }}
              className="grid items-center gap-1 px-2.5 py-2.5 bg-raised/70 border-b border-line text-[11px] font-semibold tracking-wide"
            >
              <div className="flex items-center justify-between gap-1.5 min-w-0 pr-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: gs.group.color }}
                  />
                  <span className="text-ink truncate uppercase tracking-[0.08em]">
                    {displayGroupName}
                  </span>
                  {workspace === 'combined' && (
                    <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-surface text-ink-2 border border-line/70 font-normal shrink-0">
                      {t(`workspace.${gs.group.mode}`)}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => cycleColumnSort('name')}
                  className={`px-1 py-0.5 rounded inline-flex items-center gap-0.5 text-[10px] shrink-0 transition-colors cursor-pointer ${
                    sortBy === 'name'
                      ? 'bg-surface border border-line text-ink font-semibold'
                      : 'text-ink-3 hover:text-ink hover:bg-surface/70 font-normal'
                  }`}
                  title={`${t('worksheet.sortLabel')}: ${t('worksheet.sortName')}`}
                >
                  <span>A–Z</span>
                  {sortBy === 'name' &&
                    (sortDir === 'asc' ? (
                      <ArrowUp className="w-2.5 h-2.5 text-indigo" />
                    ) : (
                      <ArrowDown className="w-2.5 h-2.5 text-indigo" />
                    ))}
                </button>
              </div>
              {renderResizableColumnHeader(t('finance.budget'), 'budget')}
              {renderResizableColumnHeader(t('finance.actual'), 'actual')}
              {renderResizableColumnHeader(t('worksheet.diffShort'), 'diff', 'pr-1')}
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
            <div
              onDragOver={(e) => {
                if (!draggedCatIdRef.current || !onReorderCategory) return;
                if (sortedRows.length > 0) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDropTarget({
                  groupId: gs.group.id,
                  categoryId: null,
                  position: 'after',
                });
              }}
              onDrop={(e) => {
                const activeId =
                  draggedCatIdRef.current || e.dataTransfer.getData('text/plain');
                if (!activeId || !onReorderCategory) {
                  clearDragState();
                  return;
                }
                e.preventDefault();
                e.stopPropagation();
                onReorderCategory({
                  draggedCategoryId: activeId,
                  targetGroupId: gs.group.id,
                  targetCategoryId: null,
                  position: 'after',
                  baseOrderIds: sortedRowIds,
                });
                clearDragState();
              }}
              className="divide-y divide-line/50 min-h-[4px]"
            >
              {sortedRows.map((row) => renderCategoryRow(row, sortedRowIds))}
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
            <div
              style={rowGridStyle}
              onDragOver={(e) => {
                if (!draggedCatIdRef.current || !onReorderCategory) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDropTarget({
                  groupId: gs.group.id,
                  categoryId: null,
                  position: 'after',
                });
              }}
              onDrop={(e) => {
                const activeId =
                  draggedCatIdRef.current || e.dataTransfer.getData('text/plain');
                if (!activeId || !onReorderCategory) {
                  clearDragState();
                  return;
                }
                e.preventDefault();
                e.stopPropagation();
                onReorderCategory({
                  draggedCategoryId: activeId,
                  targetGroupId: gs.group.id,
                  targetCategoryId: null,
                  position: 'after',
                  baseOrderIds: sortedRowIds,
                });
                clearDragState();
              }}
              className="grid items-center gap-1 px-2.5 py-2 bg-app/80 border-t border-line text-[12px] font-semibold"
            >
              <span className="text-ink truncate">{tf('worksheet.totalGroup', { group: displayGroupName })}</span>
              <span className="text-right tabular-nums text-ink-2 px-1.5 truncate">
                {formatNumber(gs.totalBudget)}
              </span>
              <span className="text-right tabular-nums text-ink px-1.5 truncate">
                {formatNumber(gs.totalActual)}
              </span>
              <span
                className={`text-right tabular-nums pr-1 truncate ${
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
          </div>
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
          {/* Sort Selector */}
          <div className="inline-flex items-center gap-1">
            <div className="inline-flex items-center gap-1.5 h-8 pl-2.5 pr-1 rounded-lg bg-surface border border-line text-xs text-ink-2">
              <ArrowUpDown className="w-3.5 h-3.5 text-ink-3 shrink-0" />
              <span className="hidden sm:inline text-ink-2">{t('worksheet.sortLabel')}:</span>
              <KobanSelect
                value={sortBy}
                onChange={(val) => {
                  const nextField = val as WorksheetSortField;
                  const nextDir: WorksheetSortDirection =
                    nextField === 'name' || nextField === 'manual' ? 'asc' : 'desc';
                  onUpdateSettings?.({
                    worksheetSortBy: nextField,
                    worksheetSortDir: nextDir,
                  });
                }}
                tone="surface"
                size="xs"
                className="!border-0 !bg-transparent !h-6 !px-1.5 font-medium text-ink"
                options={[
                  { value: 'manual', label: t('worksheet.sortManual') },
                  { value: 'name', label: t('worksheet.sortName') },
                  { value: 'budget', label: t('worksheet.sortBudget') },
                  { value: 'actual', label: t('worksheet.sortActual') },
                  { value: 'diff', label: t('worksheet.sortDiff') },
                ]}
              />
            </div>
            {sortBy !== 'manual' && (
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings?.({
                    worksheetSortDir: sortDir === 'asc' ? 'desc' : 'asc',
                  })
                }
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg bg-surface border border-line text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer"
                title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
              >
                {sortDir === 'asc' ? (
                  <ArrowUp className="w-3.5 h-3.5 text-indigo" />
                ) : (
                  <ArrowDown className="w-3.5 h-3.5 text-indigo" />
                )}
              </button>
            )}
          </div>

          {hasCustomWidths && (
            <button
              type="button"
              onClick={resetAllWidths}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer"
              title={t('worksheet.resizeColTip')}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t('worksheet.resetWidthsBtn')}</span>
            </button>
          )}

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

      {/* Two-Column Responsive Vertex42 Layout (automatically stacks below 900px container width) */}
      <div
        ref={splitContainerRef}
        style={
          isTwoColumn
            ? {
                gridTemplateColumns: `minmax(0, ${colWidths.leftPanePct}fr) 12px minmax(0, ${100 - colWidths.leftPanePct}fr)`,
              }
            : undefined
        }
        className={`grid items-start ${isTwoColumn ? 'gap-y-5' : 'grid-cols-1 gap-5'}`}
      >
        {/* LEFT COLUMN */}
        <div className="space-y-5 min-w-0">
          {leftGroups.map(renderGroupBlock)}
        </div>

        {/* Center Pane Split Handle */}
        {isTwoColumn && (
          <div
            role="separator"
            aria-orientation="vertical"
            onPointerDown={startSplitResize}
            onDoubleClick={() => {
              const next = { ...colWidthsRef.current, leftPanePct: 50 };
              colWidthsRef.current = next;
              setColWidths(next);
              onUpdateSettings?.({ worksheetColumnWidths: next });
            }}
            title={t('worksheet.resizeSplitTip')}
            className="self-stretch w-3 flex items-stretch justify-center cursor-col-resize group/split select-none"
          >
            <span
              className={`w-[2px] my-2 rounded-full transition-colors ${
                resizingSplit
                  ? 'bg-indigo'
                  : 'bg-line/70 group-hover/split:bg-indigo'
              }`}
            />
          </div>
        )}

        {/* RIGHT COLUMN: Starts with the iconic BUDGET SUMMARY table just like Vertex42! */}
        <div className="space-y-5 min-w-0">
          {/* BUDGET SUMMARY Box */}
          <section className="bg-surface border-2 border-ink/80 rounded-xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <div className="w-full" style={{ minWidth: `${summaryMinTableWidth}px` }}>
                <div
                  style={summaryGridStyle}
                  className="grid items-center gap-1 px-4 py-2.5 bg-ink text-on-ink text-[11px] font-semibold uppercase tracking-[0.08em]"
                >
                  <span className="truncate">{t('worksheet.budgetSummary')}</span>
                  {(
                    [
                      ['budget', t('finance.budget')],
                      ['actual', t('finance.actual')],
                      ['diff', t('worksheet.difference')],
                    ] as const
                  ).map(([field, label]) => (
                    <div
                      key={field}
                      className="relative flex items-center justify-end min-w-0 select-none"
                    >
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        onPointerDown={(e) => startColResize(field, e)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          resetNumericColWidths();
                        }}
                        title={t('worksheet.resizeColTip')}
                        className="absolute -left-1.5 top-[-6px] bottom-[-6px] w-2.5 cursor-col-resize z-10 flex items-center justify-center group/resize"
                      >
                        <span
                          className={`w-[2px] h-3.5 rounded-full transition-colors ${
                            resizingCol === field
                              ? 'bg-on-ink'
                              : 'bg-on-ink/35 group-hover/resize:bg-on-ink'
                          }`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => cycleColumnSort(field)}
                        className="inline-flex items-center justify-end gap-0.5 max-w-full truncate font-normal opacity-85 hover:opacity-100 cursor-pointer"
                        title={`${t('worksheet.sortLabel')}: ${label}`}
                      >
                        <span className="truncate">{label}</span>
                        {sortBy === field &&
                          (sortDir === 'asc' ? (
                            <ArrowUp className="w-3 h-3 shrink-0" />
                          ) : (
                            <ArrowDown className="w-3 h-3 shrink-0" />
                          ))}
                      </button>
                    </div>
                  ))}
                </div>

                <div className="divide-y divide-line text-[13px]">
                  {/* Total Income */}
                  <div
                    style={summaryGridStyle}
                    className="grid items-center gap-1 px-4 py-2.5"
                  >
                    <span className="text-ink font-medium truncate">{t('sidebar.totalIncome')}</span>
                    <span className="text-right tabular-nums text-ink-2 truncate">
                      {formatNumber(summary.incomeBudget)}
                    </span>
                    <span className="text-right tabular-nums text-positive font-semibold truncate">
                      {formatNumber(summary.incomeActual)}
                    </span>
                    <span
                      className={`text-right tabular-nums font-medium truncate ${
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
                  <div
                    style={summaryGridStyle}
                    className="grid items-center gap-1 px-4 py-2.5"
                  >
                    <span className="text-ink font-medium truncate">{t('sidebar.totalExpenses')}</span>
                    <span className="text-right tabular-nums text-ink-2 truncate">
                      {formatNumber(summary.totalOutflowBudget)}
                    </span>
                    <span className="text-right tabular-nums text-ink font-semibold truncate">
                      {formatNumber(summary.totalOutflowActual)}
                    </span>
                    <span
                      className={`text-right tabular-nums font-medium truncate ${
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
                  <div
                    style={summaryGridStyle}
                    className="grid items-center gap-1 px-4 py-3 bg-raised/70 font-semibold"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                      <span className="text-ink truncate">{t('finance.net')}</span>
                      <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-surface border border-line text-ink-2 tabular-nums shrink-0">
                        {tf('worksheet.retainedPct', { pct: summary.savingsRatePct.toFixed(1) })}
                      </span>
                    </div>
                    <span className="text-right tabular-nums text-ink-2 truncate">
                      {formatNumber(summary.netBudget)}
                    </span>
                    <span
                      className={`text-right tabular-nums truncate ${
                        summary.netActual >= 0 ? 'text-positive' : 'text-accent'
                      }`}
                    >
                      {formatNumber(summary.netActual)}
                    </span>
                    <span
                      className={`text-right tabular-nums truncate ${
                        summary.netDifference >= 0 ? 'text-positive' : 'text-accent'
                      }`}
                    >
                      {summary.netDifference > 0 ? '+' : ''}
                      {formatNumber(summary.netDifference)}
                    </span>
                  </div>
                </div>
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
