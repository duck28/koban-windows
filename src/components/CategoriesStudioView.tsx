import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  Upload,
  Check,
  Sparkles,
  Repeat,
  ArrowLeftRight,
} from 'lucide-react';
import {
  CategoryGroup,
  CategoryItem,
  CategoryKind,
  LedgerMode,
} from '../types';
import {
  FREELANCER_CATEGORY_CATALOG,
  HOME_CATEGORY_CATALOG,
  ZEN_PALETTE,
} from '../data/templates';

interface CategoriesStudioViewProps {
  groups: CategoryGroup[];
  categories: CategoryItem[];
  currency: string;
  initialMode: LedgerMode;
  onAddGroup: (
    mode: LedgerMode,
    name: string,
    kind: CategoryKind,
    column: 0 | 1,
    color?: string
  ) => void;
  onUpdateGroup: (
    groupId: string,
    patch: Partial<Pick<CategoryGroup, 'name' | 'color' | 'column' | 'kind'>>
  ) => void;
  onDeleteGroup: (groupId: string) => void;
  onAddCategory: (
    groupId: string,
    mode: LedgerMode,
    kind: CategoryKind,
    name: string,
    defaultBudget: number,
    taxRate?: number,
    deductiblePct?: number
  ) => void;
  onUpdateCategory: (
    categoryId: string,
    patch: Partial<
      Pick<
        CategoryItem,
        'name' | 'defaultBudget' | 'taxRate' | 'deductiblePct'
      >
    >
  ) => void;
  onToggleCategoryRecurring: (categoryId: string) => void;
  onDeleteCategory: (categoryId: string) => void;
  onOpenSetupWizard: () => void;
  onImportExcelOrCsv: () => void;
}

export const CategoriesStudioView: React.FC<CategoriesStudioViewProps> = ({
  groups,
  categories,
  currency,
  initialMode,
  onAddGroup,
  onUpdateGroup,
  onDeleteGroup,
  onAddCategory,
  onUpdateCategory,
  onToggleCategoryRecurring,
  onDeleteCategory,
  onOpenSetupWizard,
  onImportExcelOrCsv,
}) => {
  const [editMode, setEditMode] = useState<LedgerMode>(initialMode);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupKind, setNewGroupKind] = useState<CategoryKind>('expense');
  const [newGroupCol, setNewGroupCol] = useState<0 | 1>(0);
  const [newGroupColor, setNewGroupColor] = useState(ZEN_PALETTE[1]);

  const [addingCatToGroup, setAddingCatToGroup] = useState<string | null>(null);
  const [catName, setCatName] = useState('');
  const [catBudget, setCatBudget] = useState('');
  const [catTax, setCatTax] = useState('8.1');
  const [catDed, setCatDed] = useState('100');

  const modeGroups = groups
    .filter((g) => g.mode === editMode)
    .sort((a, b) => a.order - b.order);

  const catalog =
    editMode === 'home' ? HOME_CATEGORY_CATALOG : FREELANCER_CATEGORY_CATALOG;

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    onAddGroup(
      editMode,
      newGroupName.trim().toUpperCase(),
      newGroupKind,
      newGroupCol,
      newGroupColor
    );
    setNewGroupName('');
  };

  const handleCreateCat = (e: React.FormEvent, grp: CategoryGroup) => {
    e.preventDefault();
    if (!catName.trim()) return;
    onAddCategory(
      grp.id,
      editMode,
      grp.kind,
      catName.trim(),
      parseFloat(catBudget) || 0,
      editMode === 'freelancer' ? parseFloat(catTax) || 0 : 0,
      editMode === 'freelancer' ? parseFloat(catDed) || 100 : 0
    );
    setCatName('');
    setCatBudget('');
    setAddingCatToGroup(null);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-normal text-ink tracking-tight">
            Categories & Structure
          </h1>
          <p className="text-xs text-ink-2 mt-0.5">
            Add, rename, reorder, or toggle categories across your Home and Freelancer workspaces.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onOpenSetupWizard}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            <span>Quick Category Picker</span>
          </button>

          <button
            onClick={onImportExcelOrCsv}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-indigo" />
            <span>Import from Excel / CSV…</span>
          </button>

          {/* Mode Switcher */}
          <div className="flex items-center bg-surface border border-line rounded-xl p-1 gap-1">
            <button
              onClick={() => setEditMode('home')}
              className={`px-3 py-1 rounded-lg text-xs transition-colors cursor-pointer ${
                editMode === 'home'
                  ? 'bg-ink text-on-ink font-medium'
                  : 'text-ink-2 hover:text-ink'
              }`}
            >
              Home ({categories.filter((c) => c.mode === 'home').length})
            </button>
            <button
              onClick={() => setEditMode('freelancer')}
              className={`px-3 py-1 rounded-lg text-xs transition-colors cursor-pointer ${
                editMode === 'freelancer'
                  ? 'bg-ink text-on-ink font-medium'
                  : 'text-ink-2 hover:text-ink'
              }`}
            >
              Freelancer ({categories.filter((c) => c.mode === 'freelancer').length})
            </button>
          </div>
        </div>
      </div>

      {/* Add New Category Group Form */}
      <form
        onSubmit={handleCreateGroup}
        className="p-4 rounded-xl bg-surface border border-line flex flex-wrap items-end gap-3"
      >
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[11px] text-ink-2 mb-1">
            New {editMode === 'home' ? 'Home' : 'Freelancer'} Category Group Name
          </label>
          <input
            type="text"
            placeholder="e.g. INVESTMENTS, CHILDCARE, STUDIO GEAR"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            className="w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-[11px] text-ink-2 mb-1">Kind</label>
          <select
            value={newGroupKind}
            onChange={(e) => setNewGroupKind(e.target.value as CategoryKind)}
            className="h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink"
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="savings">Savings / Reserve</option>
          </select>
        </div>

        <div>
          <label className="block text-[11px] text-ink-2 mb-1">Column</label>
          <select
            value={newGroupCol}
            onChange={(e) => setNewGroupCol(Number(e.target.value) as 0 | 1)}
            className="h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink"
          >
            <option value={0}>Left Column</option>
            <option value={1}>Right Column</option>
          </select>
        </div>

        <div>
          <label className="block text-[11px] text-ink-2 mb-1">Accent</label>
          <div className="flex items-center gap-1 h-8 px-2 rounded-lg bg-raised border border-line">
            {ZEN_PALETTE.slice(0, 6).map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setNewGroupColor(c)}
                className={`w-4 h-4 rounded-full cursor-pointer ${
                  newGroupColor === c ? 'ring-2 ring-ink ring-offset-1' : ''
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="h-8 px-4 inline-flex items-center gap-1.5 rounded-lg bg-ink text-on-ink text-xs font-medium cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Group</span>
        </button>
      </form>

      {/* Groups & Categories Editor Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {modeGroups.map((grp) => {
          const grpCats = categories
            .filter((c) => c.groupId === grp.id)
            .sort((a, b) => a.order - b.order);

          const existingNames = new Set(
            grpCats.map((c) => c.name.toLowerCase())
          );
          const catalogGrp = catalog.find(
            (cg) => cg.id === grp.id || cg.name.toLowerCase() === grp.name.toLowerCase()
          );
          const suggestedUnadded = (catalogGrp?.items ?? []).filter(
            (item) => !existingNames.has(item.name.toLowerCase())
          );

          return (
            <section
              key={grp.id}
              className="bg-surface border border-line rounded-xl overflow-hidden"
            >
              {/* Group Header */}
              <div className="p-3 bg-raised/70 border-b border-line flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <input
                    type="color"
                    value={grp.color}
                    onChange={(e) =>
                      onUpdateGroup(grp.id, { color: e.target.value })
                    }
                    className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent shrink-0"
                    title="Change group color"
                  />
                  <input
                    type="text"
                    value={grp.name}
                    onChange={(e) =>
                      onUpdateGroup(grp.id, { name: e.target.value })
                    }
                    className="bg-transparent text-xs font-semibold uppercase tracking-wider text-ink focus:bg-surface focus:px-1.5 rounded focus:outline-none flex-1 min-w-0"
                  />
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() =>
                      onUpdateGroup(grp.id, {
                        column: grp.column === 0 ? 1 : 0,
                      })
                    }
                    className="px-2 py-0.5 rounded bg-surface border border-line text-[10px] text-ink-2 hover:text-ink inline-flex items-center gap-1 cursor-pointer"
                    title="Switch between Left and Right worksheet column"
                  >
                    <ArrowLeftRight className="w-2.5 h-2.5" />
                    <span>{grp.column === 0 ? 'Left Col' : 'Right Col'}</span>
                  </button>

                  <button
                    onClick={() =>
                      setAddingCatToGroup(
                        addingCatToGroup === grp.id ? null : grp.id
                      )
                    }
                    className="p-1 rounded bg-surface border border-line text-ink-2 hover:text-ink cursor-pointer"
                    title="Add subcategory"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => onDeleteGroup(grp.id)}
                    className="p-1 rounded text-ink-3 hover:text-accent cursor-pointer"
                    title="Delete group"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Active Subcategories List */}
              <div className="divide-y divide-line/60 text-xs">
                {grpCats.map((cat) => (
                  <div
                    key={cat.id}
                    className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-raised/40"
                  >
                    <input
                      type="text"
                      value={cat.name}
                      onChange={(e) =>
                        onUpdateCategory(cat.id, { name: e.target.value })
                      }
                      className="flex-1 bg-transparent text-ink focus:bg-surface focus:px-1.5 rounded focus:outline-none min-w-0"
                    />

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onToggleCategoryRecurring(cat.id)}
                        className={`h-6 px-1.5 rounded inline-flex items-center gap-1 text-[10px] border transition-colors cursor-pointer ${
                          cat.isRecurring
                            ? 'bg-indigo/15 text-indigo border-indigo/30 font-medium'
                            : 'bg-raised border-line text-ink-3 hover:text-indigo'
                        }`}
                        title={
                          cat.isRecurring
                            ? 'Recurring monthly item (click to disable)'
                            : 'Click to mark as recurring monthly item'
                        }
                      >
                        <Repeat className="w-3 h-3" />
                      </button>

                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-ink-3">
                          Budget ({currency}):
                        </span>
                        <input
                          type="number"
                          step="0.05"
                          value={cat.defaultBudget}
                          onChange={(e) =>
                            onUpdateCategory(cat.id, {
                              defaultBudget: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="no-spinner w-20 h-6 px-1.5 rounded bg-raised border border-line text-right tabular-nums text-ink focus:outline-none"
                        />
                      </div>

                      {editMode === 'freelancer' && (
                        <>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-ink-3">VAT%:</span>
                            <input
                              type="number"
                              step="0.1"
                              value={cat.taxRate ?? 0}
                              onChange={(e) =>
                                onUpdateCategory(cat.id, {
                                  taxRate: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="no-spinner w-12 h-6 px-1 rounded bg-raised border border-line text-right tabular-nums text-ink focus:outline-none"
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-ink-3">Ded%:</span>
                            <input
                              type="number"
                              step="10"
                              value={cat.deductiblePct ?? 100}
                              onChange={(e) =>
                                onUpdateCategory(cat.id, {
                                  deductiblePct: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="no-spinner w-12 h-6 px-1 rounded bg-raised border border-line text-right tabular-nums text-ink focus:outline-none"
                            />
                          </div>
                        </>
                      )}

                      <button
                        onClick={() => onDeleteCategory(cat.id)}
                        className="p-1 text-ink-3 hover:text-accent cursor-pointer"
                        title="Remove category"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick-Add Additional Suggestions for this Group */}
              {suggestedUnadded.length > 0 && (
                <div className="px-3 py-2 bg-app/60 border-t border-line/60 space-y-1.5">
                  <span className="block text-[10px] uppercase tracking-wider text-ink-3">
                    Additional Categories (Click to add)
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {suggestedUnadded.map((sug) => (
                      <button
                        key={sug.id}
                        type="button"
                        onClick={() =>
                          onAddCategory(
                            grp.id,
                            editMode,
                            grp.kind,
                            sug.name,
                            0,
                            sug.taxRate ?? 0,
                            sug.deductiblePct ?? (editMode === 'freelancer' ? 100 : 0)
                          )
                        }
                        className="h-6 px-2 rounded-md border border-dashed border-line hover:border-ink-2 text-[11px] text-ink-2 hover:text-ink inline-flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Plus className="w-3 h-3 text-ink-3" />
                        <span>{sug.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Add Custom Subcategory Inline Form */}
              {addingCatToGroup === grp.id && (
                <form
                  onSubmit={(e) => handleCreateCat(e, grp)}
                  className="p-2.5 bg-app border-t border-line flex flex-wrap items-center gap-2"
                >
                  <input
                    type="text"
                    placeholder="Custom category name…"
                    value={catName}
                    onChange={(e) => setCatName(e.target.value)}
                    autoFocus
                    className="flex-1 min-w-[140px] h-7 px-2 rounded bg-surface border border-line text-xs text-ink focus:outline-none"
                  />
                  <input
                    type="number"
                    step="0.05"
                    placeholder="Default Budget"
                    value={catBudget}
                    onChange={(e) => setCatBudget(e.target.value)}
                    className="w-24 h-7 px-2 rounded bg-surface border border-line text-xs text-ink tabular-nums text-right focus:outline-none"
                  />
                  {editMode === 'freelancer' && (
                    <>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="VAT %"
                        value={catTax}
                        onChange={(e) => setCatTax(e.target.value)}
                        className="w-16 h-7 px-2 rounded bg-surface border border-line text-xs text-ink tabular-nums text-right focus:outline-none"
                      />
                      <input
                        type="number"
                        step="10"
                        placeholder="Ded %"
                        value={catDed}
                        onChange={(e) => setCatDed(e.target.value)}
                        className="w-16 h-7 px-2 rounded bg-surface border border-line text-xs text-ink tabular-nums text-right focus:outline-none"
                      />
                    </>
                  )}
                  <button
                    type="submit"
                    className="h-7 px-2.5 rounded bg-ink text-on-ink text-xs inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Check className="w-3 h-3" />
                    <span>Add</span>
                  </button>
                </form>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
};
