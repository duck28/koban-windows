import React, { useState } from 'react';
import { Plus, Trash2, Target } from 'lucide-react';
import { ActiveWorkspace, LedgerMode, SavingsGoal } from '../types';
import { formatCurrency } from '../utils/calculations';
import { ZEN_PALETTE } from '../data/templates';

interface SavingsGoalsViewProps {
  goals: SavingsGoal[];
  workspace: ActiveWorkspace;
  currency: string;
  onAddGoal: (goal: Omit<SavingsGoal, 'id'>) => void;
  onUpdateGoalAmount: (id: string, currentAmount: number) => void;
  onDeleteGoal: (id: string) => void;
}

export const SavingsGoalsView: React.FC<SavingsGoalsViewProps> = ({
  goals,
  workspace,
  currency,
  onAddGoal,
  onUpdateGoalAmount,
  onDeleteGoal,
}) => {
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [currentAmount, setCurrentAmount] = useState('');
  const [monthlyContribution, setMonthlyContribution] = useState('');
  const [targetDate, setTargetDate] = useState('2027-12-31');
  const [mode, setMode] = useState<LedgerMode>(
    workspace === 'freelancer' ? 'freelancer' : 'home'
  );

  const visibleGoals = goals.filter((g) =>
    workspace === 'combined' ? true : g.mode === workspace
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAddGoal({
      mode:
        workspace === 'combined'
          ? mode
          : workspace === 'freelancer'
            ? 'freelancer'
            : 'home',
      name: name.trim(),
      targetAmount: parseFloat(targetAmount) || 1000,
      currentAmount: parseFloat(currentAmount) || 0,
      monthlyContribution: parseFloat(monthlyContribution) || 0,
      targetDate,
      color: ZEN_PALETTE[visibleGoals.length % ZEN_PALETTE.length],
    });
    setName('');
    setTargetAmount('');
    setCurrentAmount('');
    setMonthlyContribution('');
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-normal text-ink tracking-tight">
          Savings Goals, Sinking Funds &amp; Tax Reserves
        </h1>
        <p className="text-xs text-ink-2 mt-0.5">
          Track progress toward emergency funds, equipment replacements, and freelancer tax set-asides.
        </p>
      </div>

      {/* Add Goal Form — Flex-wrap layout so no input or button ever overflows */}
      <form
        onSubmit={handleSubmit}
        className="p-4 rounded-xl bg-surface border border-line flex flex-wrap items-end gap-3"
      >
        <div className="flex-[2_1_200px] min-w-[180px]">
          <label className="block text-[11px] text-ink-2 mb-1 truncate">
            Goal / Reserve Name
          </label>
          <input
            type="text"
            placeholder="e.g. Emergency Fund, Tax Provision"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink focus:outline-none"
          />
        </div>

        <div className="flex-[1_1_110px] min-w-[100px]">
          <label className="block text-[11px] text-ink-2 mb-1 truncate">
            Target ({currency})
          </label>
          <input
            type="number"
            step="10"
            placeholder="10000"
            value={targetAmount}
            onChange={(e) => setTargetAmount(e.target.value)}
            required
            className="w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink tabular-nums text-right focus:outline-none"
          />
        </div>

        <div className="flex-[1_1_110px] min-w-[100px]">
          <label className="block text-[11px] text-ink-2 mb-1 truncate">
            Saved So Far
          </label>
          <input
            type="number"
            step="10"
            placeholder="0"
            value={currentAmount}
            onChange={(e) => setCurrentAmount(e.target.value)}
            className="w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink tabular-nums text-right focus:outline-none"
          />
        </div>

        <div className="flex-[1_1_110px] min-w-[100px]">
          <label className="block text-[11px] text-ink-2 mb-1 truncate">
            Monthly Plan
          </label>
          <input
            type="number"
            step="10"
            placeholder="250"
            value={monthlyContribution}
            onChange={(e) => setMonthlyContribution(e.target.value)}
            className="w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink tabular-nums text-right focus:outline-none"
          />
        </div>

        {workspace === 'combined' && (
          <div className="flex-[1_1_115px] min-w-[105px]">
            <label className="block text-[11px] text-ink-2 mb-1 truncate">
              Workspace
            </label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as LedgerMode)}
              className="w-full h-8 px-2 rounded-lg bg-raised border border-line text-xs text-ink focus:outline-none"
            >
              <option value="home">Home</option>
              <option value="freelancer">Freelancer</option>
            </select>
          </div>
        )}

        <div className="flex-[1_1_140px] min-w-[135px]">
          <label className="block text-[11px] text-ink-2 mb-1 truncate">
            Target Date
          </label>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="w-full h-8 px-2.5 rounded-lg bg-raised border border-line text-xs text-ink focus:outline-none"
          />
        </div>

        <button
          type="submit"
          className="h-8 px-4 rounded-lg bg-ink text-on-ink text-xs font-medium inline-flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Goal</span>
        </button>
      </form>

      {/* Goals Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {visibleGoals.map((goal) => {
          const pct =
            goal.targetAmount > 0
              ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100)
              : 0;
          const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
          const monthsToGoal =
            goal.monthlyContribution > 0
              ? Math.ceil(remaining / goal.monthlyContribution)
              : null;

          return (
            <section
              key={goal.id}
              className="p-5 rounded-xl bg-surface border border-line space-y-4 overflow-hidden"
            >
              <div className="flex items-start justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
                    style={{ backgroundColor: goal.color }}
                  >
                    <Target className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-ink truncate">
                      {goal.name}
                    </h3>
                    <span className="block text-[11px] text-ink-3 uppercase tracking-wider truncate">
                      {goal.mode} · Target Date: {goal.targetDate || 'Flexible'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => onDeleteGoal(goal.id)}
                  className="p-1.5 rounded-lg text-ink-3 hover:text-accent hover:bg-raised transition-colors cursor-pointer shrink-0"
                  title="Delete goal"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                  <span className="text-ink font-semibold text-base tabular-nums">
                    {formatCurrency(goal.currentAmount, currency)}
                  </span>
                  <span className="text-ink-2 tabular-nums">
                    of {formatCurrency(goal.targetAmount, currency)} ({pct.toFixed(1)}%)
                  </span>
                </div>

                <div className="h-2.5 bg-raised rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: goal.color,
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-line/60 text-xs">
                <span className="text-ink-3 min-w-0">
                  {remaining === 0
                    ? 'Goal reached!'
                    : monthsToGoal
                      ? `~${monthsToGoal} mo left at ${formatCurrency(goal.monthlyContribution, currency)}/mo`
                      : `${formatCurrency(remaining, currency)} remaining`}
                </span>

                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  {goal.monthlyContribution > 0 && remaining > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateGoalAmount(
                          goal.id,
                          goal.currentAmount + goal.monthlyContribution
                        )
                      }
                      className="h-7 px-2 rounded bg-raised border border-line text-[11px] text-ink-2 hover:text-ink hover:bg-line/50 transition-colors cursor-pointer tabular-nums"
                      title="Add one monthly contribution to current balance"
                    >
                      +{goal.monthlyContribution}
                    </button>
                  )}
                  <span className="text-[11px] text-ink-3">Balance:</span>
                  <input
                    type="number"
                    step="50"
                    value={goal.currentAmount}
                    onChange={(e) =>
                      onUpdateGoalAmount(goal.id, parseFloat(e.target.value) || 0)
                    }
                    className="w-24 h-7 px-2 rounded bg-raised border border-line text-xs text-ink tabular-nums text-right focus:outline-none"
                  />
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};
