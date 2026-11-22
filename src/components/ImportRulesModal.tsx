import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  Columns,
  Plus,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import {
  BankImportProfile,
  CategoryItem,
  FinancialAccount,
  ImportRule,
  ImportRuleDirection,
  ImportRuleMatchField,
  ImportRuleMatchType,
} from '../types';
import { useI18n } from '../i18n';
import { KobanSelect, KobanSelectOption } from './KobanSelect';

interface ImportRulesModalProps {
  isOpen: boolean;
  rules: ImportRule[];
  profiles: BankImportProfile[];
  categories: CategoryItem[];
  accounts: FinancialAccount[];
  onSaveRulesAndProfiles: (
    nextRules: ImportRule[],
    nextProfiles: BankImportProfile[]
  ) => void;
  onClose: () => void;
}

export const ImportRulesModal: React.FC<ImportRulesModalProps> = ({
  isOpen,
  rules,
  profiles,
  categories,
  accounts,
  onSaveRulesAndProfiles,
  onClose,
}) => {
  const { t, tCategoryName, tAccountName } = useI18n();
  const [tab, setTab] = useState<'rules' | 'profiles'>('rules');
  const [showAdd, setShowAdd] = useState(false);

  const [name, setName] = useState('');
  const [pattern, setPattern] = useState('');
  const [matchField, setMatchField] = useState<ImportRuleMatchField>('any');
  const [matchType, setMatchType] = useState<ImportRuleMatchType>('contains');
  const [direction, setDirection] = useState<ImportRuleDirection>('any');
  const [accountId, setAccountId] = useState('');
  const [setCategoryId, setSetCategoryId] = useState(categories[0]?.id ?? '');
  const [setPayee, setSetPayee] = useState('');

  if (!isOpen) return null;

  const catMap = new Map(categories.map((c) => [c.id, c]));
  const accMap = new Map(accounts.map((a) => [a.id, a]));
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  const normalizePriorities = (list: ImportRule[]): ImportRule[] =>
    list.map((r, i) => ({ ...r, priority: i + 1 }));

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    const pat = pattern.trim();
    if (!pat || !setCategoryId) return;
    const cat = catMap.get(setCategoryId);
    const today = new Date().toISOString().slice(0, 10);
    const created: ImportRule = {
      id: `imprule-${Date.now()}`,
      name: name.trim() || setPayee.trim() || pat,
      enabled: true,
      priority: 1,
      accountId: accountId || undefined,
      direction,
      matchField,
      matchType,
      pattern: pat,
      setCategoryId,
      setMode: cat?.mode,
      setPayee: setPayee.trim() || undefined,
      setTaxRate: cat?.taxRate,
      setDeductiblePct: cat?.deductiblePct,
      createdAt: today,
      updatedAt: today,
    };
    onSaveRulesAndProfiles(
      normalizePriorities([created, ...sortedRules]),
      profiles
    );
    setName('');
    setPattern('');
    setSetPayee('');
    setShowAdd(false);
  };

  const moveRule = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= sortedRules.length) return;
    const next = [...sortedRules];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onSaveRulesAndProfiles(normalizePriorities(next), profiles);
  };

  const toggleRule = (id: string) => {
    const next = sortedRules.map((r) =>
      r.id === id ? { ...r, enabled: !r.enabled } : r
    );
    onSaveRulesAndProfiles(next, profiles);
  };

  const deleteRule = (id: string) => {
    onSaveRulesAndProfiles(
      normalizePriorities(sortedRules.filter((r) => r.id !== id)),
      profiles
    );
  };

  const deleteProfile = (id: string) => {
    onSaveRulesAndProfiles(
      rules,
      profiles.filter((p) => p.id !== id)
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden my-auto">
        <div className="px-6 py-4 border-b border-line flex items-center justify-between bg-app/60">
          <div className="flex items-center gap-2.5">
            <Tag className="w-4 h-4 text-indigo" />
            <div>
              <h2 className="text-base font-medium text-ink">
                {t('bankImport.rulesManagerTitle')}
              </h2>
              <p className="text-xs text-ink-2">
                {t('bankImport.rulesManagerSub')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-raised cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center bg-raised p-1 rounded-lg border border-line text-xs">
              <button
                type="button"
                onClick={() => setTab('rules')}
                className={`px-3 py-1 rounded-md cursor-pointer ${
                  tab === 'rules'
                    ? 'bg-surface text-ink font-medium shadow-2xs'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                {t('bankImport.rulesTab')} ({sortedRules.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('profiles')}
                className={`px-3 py-1 rounded-md cursor-pointer ${
                  tab === 'profiles'
                    ? 'bg-surface text-ink font-medium shadow-2xs'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                {t('bankImport.profilesTab')} ({profiles.length})
              </button>
            </div>

            {tab === 'rules' && (
              <button
                type="button"
                onClick={() => setShowAdd((v) => !v)}
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-ink text-on-ink text-xs font-medium cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('bankImport.addRuleBtn')}</span>
              </button>
            )}
          </div>

          {tab === 'rules' ? (
            <>
              {showAdd && (
                <form
                  onSubmit={handleAddRule}
                  className="p-4 rounded-xl bg-app border border-line grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs"
                >
                  <div>
                    <label className="block text-[11px] text-ink-2 mb-1">
                      {t('bankImport.rulePattern')} *
                    </label>
                    <input
                      type="text"
                      required
                      value={pattern}
                      onChange={(e) => setPattern(e.target.value)}
                      placeholder="e.g. migros, sbb, hetzner"
                      className="w-full h-8 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-ink-2 mb-1">
                      {t('bankImport.ruleNameOptional')}
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Rule label"
                      className="w-full h-8 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink"
                    />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-[11px] text-ink-2 mb-1">
                        {t('bankImport.ruleMatch')}
                      </label>
                      <KobanSelect
                        value={matchField}
                        onChange={(v) => setMatchField(v as ImportRuleMatchField)}
                        tone="surface"
                        size="sm"
                        className="w-full"
                        options={[
                          { value: 'any', label: 'Any field' },
                          { value: 'payee', label: 'Payee' },
                          { value: 'description', label: 'Description' },
                          { value: 'iban', label: 'IBAN' },
                        ]}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[11px] text-ink-2 mb-1">
                        Match Type
                      </label>
                      <KobanSelect
                        value={matchType}
                        onChange={(v) => setMatchType(v as ImportRuleMatchType)}
                        tone="surface"
                        size="sm"
                        className="w-full"
                        options={[
                          { value: 'contains', label: 'Contains' },
                          { value: 'starts_with', label: 'Starts with' },
                          { value: 'exact', label: 'Exact' },
                          { value: 'regex', label: 'Regex' },
                        ]}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-[11px] text-ink-2 mb-1">
                        Direction
                      </label>
                      <KobanSelect
                        value={direction}
                        onChange={(v) => setDirection(v as ImportRuleDirection)}
                        tone="surface"
                        size="sm"
                        className="w-full"
                        options={[
                          { value: 'any', label: 'Any' },
                          { value: 'expense', label: 'Expense' },
                          { value: 'income', label: 'Income' },
                        ]}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[11px] text-ink-2 mb-1">
                        Account
                      </label>
                      <KobanSelect
                        value={accountId}
                        onChange={setAccountId}
                        tone="surface"
                        size="sm"
                        className="w-full"
                        options={[
                          { value: '', label: 'All accounts' },
                          ...accounts.map((a) => ({
                            value: a.id,
                            label: tAccountName(a),
                          })),
                        ]}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-ink-2 mb-1">
                      {t('bankImport.ruleAssignCategory')} *
                    </label>
                    <KobanSelect
                      value={setCategoryId}
                      onChange={setSetCategoryId}
                      tone="surface"
                      size="sm"
                      searchable
                      className="w-full"
                      options={categories.map((c): KobanSelectOption => ({
                        value: c.id,
                        label: tCategoryName(c),
                        group: c.mode === 'freelancer' ? 'Freelancer / Biz' : 'Home',
                      }))}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-ink-2 mb-1">
                      {t('bankImport.ruleRenamePayee')}
                    </label>
                    <input
                      type="text"
                      value={setPayee}
                      onChange={(e) => setSetPayee(e.target.value)}
                      placeholder="Optional clean merchant name"
                      className="w-full h-8 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink"
                    />
                  </div>
                  <div className="sm:col-span-2 flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowAdd(false)}
                      className="h-8 px-3 rounded-lg text-xs text-ink-2 hover:text-ink cursor-pointer"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="submit"
                      className="h-8 px-4 inline-flex items-center gap-1.5 rounded-lg bg-ink text-on-ink text-xs font-medium cursor-pointer"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5" />
                      <span>{t('common.save')}</span>
                    </button>
                  </div>
                </form>
              )}

              <div className="border border-line rounded-xl overflow-hidden bg-app max-h-80 overflow-y-auto divide-y divide-line/60">
                {sortedRules.length === 0 ? (
                  <div className="py-10 text-center text-xs text-ink-3">
                    {t('bankImport.noRulesYet')}
                  </div>
                ) : (
                  sortedRules.map((r, idx) => {
                    const cat = catMap.get(r.setCategoryId);
                    const acc = r.accountId ? accMap.get(r.accountId) : undefined;
                    return (
                      <div
                        key={r.id}
                        className={`px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs ${
                          r.enabled ? 'bg-surface' : 'bg-app opacity-55'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={r.enabled}
                            onChange={() => toggleRule(r.id)}
                            className="rounded border-line cursor-pointer shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="font-medium text-ink truncate">
                              {r.name}{' '}
                              <span className="text-[11px] font-normal text-ink-3">
                                ({r.matchField} · {r.matchType} "{r.pattern}")
                              </span>
                            </div>
                            <div className="text-[11px] text-ink-2 truncate">
                              → {cat ? tCategoryName(cat) : r.setCategoryId}
                              {r.setPayee ? ` · Payee "${r.setPayee}"` : ''}
                              {acc ? ` · ${tAccountName(acc)}` : ''}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveRule(idx, -1)}
                            className="p-1 rounded text-ink-3 hover:text-ink disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === sortedRules.length - 1}
                            onClick={() => moveRule(idx, 1)}
                            className="p-1 rounded text-ink-3 hover:text-ink disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteRule(r.id)}
                            className="p-1 rounded text-ink-3 hover:text-negative cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <div className="border border-line rounded-xl overflow-hidden bg-app max-h-80 overflow-y-auto divide-y divide-line/60">
              {profiles.length === 0 ? (
                <div className="py-10 text-center text-xs text-ink-3">
                  {t('bankImport.noProfilesYet')}
                </div>
              ) : (
                profiles.map((p) => {
                  const acc = p.accountId ? accMap.get(p.accountId) : undefined;
                  return (
                    <div
                      key={p.id}
                      className="px-3.5 py-2.5 bg-surface flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Columns className="w-4 h-4 text-indigo shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium text-ink truncate">
                            {p.name}
                          </div>
                          <div className="text-[11px] text-ink-2 truncate">
                            {p.dateColumn} ({p.dateFormat}) · {p.amountMode}
                            {acc ? ` · ${tAccountName(acc)}` : ''}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteProfile(p.id)}
                        className="p-1.5 rounded text-ink-3 hover:text-negative cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
