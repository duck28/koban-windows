import React, { useState } from 'react';
import {
  LayoutGrid,
  CalendarRange,
  ReceiptText,
  Landmark,
  PieChart,
  FolderKanban,
  Repeat,
  Target,
  DatabaseBackup,
  SlidersHorizontal,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { AppSettings, ViewTab } from '../types';
import { useI18n } from '../i18n';
import {
  formatCurrency,
  MonthSummaryMetrics,
  NetWorthSummaryMetrics,
} from '../utils/calculations';

interface SidebarProps {
  isOpen: boolean;
  activeTab: ViewTab;
  onSelectTab: (tab: ViewTab) => void;
  summary: MonthSummaryMetrics;
  netWorth: NetWorthSummaryMetrics;
  settings: AppSettings;
  txCount: number;
  recurringCount: number;
  goalsCount: number;
  onRevealBackupDir: () => void;
  onOpenSetupWizard: () => void;
}

type SidePanelMode = 'nav' | 'groups';

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  activeTab,
  onSelectTab,
  summary,
  netWorth,
  settings,
  txCount,
  recurringCount,
  goalsCount,
  onRevealBackupDir,
  onOpenSetupWizard,
}) => {
  const [panelMode, setPanelMode] = useState<SidePanelMode>('nav');
  const { t } = useI18n();

  if (!isOpen) return null;

  const navItems: {
    id: ViewTab;
    label: string;
    icon: React.ElementType;
    badge?: string | number;
    shortcut?: string;
  }[] = [
    {
      id: 'worksheet',
      label: t('nav.monthly'),
      icon: LayoutGrid,
      badge: summary.groups.length,
      shortcut: '1',
    },
    {
      id: 'yearly_planner',
      label: t('nav.yearly'),
      icon: CalendarRange,
      shortcut: '2',
    },
    {
      id: 'transactions',
      label: t('nav.transactions'),
      icon: ReceiptText,
      badge: txCount || undefined,
      shortcut: '3',
    },
    {
      id: 'accounts',
      label: t('nav.accounts'),
      icon: Landmark,
      badge: netWorth.accounts.length || undefined,
      shortcut: '4',
    },
    {
      id: 'reports',
      label: t('nav.reports'),
      icon: PieChart,
      shortcut: '5',
    },
    {
      id: 'categories',
      label: t('nav.categories'),
      icon: FolderKanban,
      shortcut: '6',
    },
    {
      id: 'recurring',
      label: t('nav.recurring'),
      icon: Repeat,
      badge: recurringCount || undefined,
      shortcut: '7',
    },
    {
      id: 'goals',
      label: t('nav.savings'),
      icon: Target,
      badge: goalsCount || undefined,
      shortcut: '8',
    },
    {
      id: 'backups',
      label: t('nav.backups'),
      icon: DatabaseBackup,
      shortcut: '9',
    },
    {
      id: 'settings',
      label: t('nav.settings'),
      icon: SlidersHorizontal,
      shortcut: '0',
    },
  ];

  return (
    <aside className="w-64 bg-surface border-r border-line flex flex-col h-full shrink-0 z-20 select-none">
      {/* Top tabs: Navigation vs Group Breakdown */}
      <nav className="flex items-center gap-4 px-4 h-10 border-b border-line shrink-0">
        <button
          onClick={() => setPanelMode('nav')}
          className={`relative h-full text-[12px] tracking-wide transition-colors cursor-pointer ${
            panelMode === 'nav' ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
          }`}
        >
          {t('sidebar.workspace')}
          {panelMode === 'nav' && (
            <span className="absolute left-0 right-0 -bottom-px h-px bg-ink" />
          )}
        </button>
        <button
          onClick={() => setPanelMode('groups')}
          className={`relative h-full text-[12px] tracking-wide transition-colors cursor-pointer ${
            panelMode === 'groups' ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
          }`}
        >
          {t('sidebar.groups')} ({summary.groups.length})
          {panelMode === 'groups' && (
            <span className="absolute left-0 right-0 -bottom-px h-px bg-ink" />
          )}
        </button>
      </nav>

      {panelMode === 'nav' ? (
        <div className="flex-1 overflow-y-auto px-2 py-3 flex flex-col justify-between">
          <div className="space-y-0.5">
            <div className="px-2.5 pb-1.5 text-[10px] uppercase tracking-[0.12em] text-ink-3">
              {settings.activeWorkspace === 'home'
                ? 'Home Budget Ledger'
                : settings.activeWorkspace === 'freelancer'
                  ? 'Freelancer Business'
                  : 'Combined Ledger'}
            </div>

            {navItems.map((item) => {
              const Icon = item.icon;
              const isSelected = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectTab(item.id)}
                  className={`w-full group relative flex items-center gap-2.5 h-8 pl-4 pr-2.5 text-[13px] rounded-md transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-raised text-ink font-medium'
                      : 'text-ink-2 hover:bg-raised hover:text-ink'
                  }`}
                >
                  {isSelected && (
                    <span className="absolute left-1.5 w-1 h-1 rounded-full bg-accent" />
                  )}
                  <Icon className="w-4 h-4 shrink-0 text-ink-2 group-hover:text-ink" />
                  <span className="truncate flex-1 text-left">{item.label}</span>
                  {item.badge !== undefined && (
                    <span className="text-[11px] text-ink-3 tabular-nums">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Bottom Summary & Backup Status Card */}
          <div className="space-y-2.5 pt-3 border-t border-line px-1">
            {/* Quick Month Snapshot */}
            <div className="p-3 rounded-lg bg-app border border-line space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-[0.12em] text-ink-3">
                  Monthly Summary
                </span>
                <span className="text-[11px] tabular-nums text-ink-2">
                  {summary.monthKey}
                </span>
              </div>

              <div className="space-y-1 text-[12px]">
                <div className="flex justify-between">
                  <span className="text-ink-2">Total Income</span>
                  <span className="tabular-nums text-positive font-medium">
                    {formatCurrency(summary.incomeActual, settings.currency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-2">Total Expenses</span>
                  <span className="tabular-nums text-ink">
                    {formatCurrency(summary.totalOutflowActual, settings.currency)}
                  </span>
                </div>
                <div className="h-px bg-line my-1" />
                <div className="flex justify-between font-medium">
                  <span className="text-ink">NET</span>
                  <span
                    className={`tabular-nums ${
                      summary.netActual >= 0 ? 'text-positive' : 'text-accent'
                    }`}
                  >
                    {formatCurrency(summary.netActual, settings.currency)}
                  </span>
                </div>
              </div>

              {settings.activeWorkspace !== 'home' && (
                <div className="pt-1.5 border-t border-line/70 flex justify-between text-[11px]">
                  <span className="text-ink-3">Deductible Exp.</span>
                  <span className="tabular-nums text-indigo">
                    {formatCurrency(
                      summary.deductibleExpensesActual,
                      settings.currency
                    )}
                  </span>
                </div>
              )}

              <div
                onClick={() => onSelectTab('accounts')}
                className="pt-1.5 border-t border-line/70 space-y-0.5 cursor-pointer hover:opacity-90"
                title="Open Accounts & Net Worth Tracker"
              >
                <div className="flex justify-between text-[11px]">
                  <span className="text-ink-2 font-medium">Net Worth</span>
                  <span
                    className={`tabular-nums font-medium ${
                      netWorth.netWorth >= 0 ? 'text-positive' : 'text-accent'
                    }`}
                  >
                    {formatCurrency(netWorth.netWorth, settings.currency)}
                  </span>
                </div>
                <div className="flex justify-between text-[10px] text-ink-3">
                  <span>Liquid / Retirement</span>
                  <span className="tabular-nums">
                    {formatCurrency(netWorth.liquidAssets, settings.currency)} /{' '}
                    {formatCurrency(netWorth.retirementAssets, settings.currency)}
                  </span>
                </div>
              </div>
            </div>

            {/* Automatic Backup Status */}
            <div className="p-2.5 rounded-lg bg-raised/60 border border-line text-[11px] space-y-1">
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  {settings.backupDir && settings.autoBackup ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-positive shrink-0" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-ink-3 shrink-0" />
                  )}
                  <span className="font-medium text-ink truncate">
                    {settings.backupDir && settings.autoBackup
                      ? 'Auto-Backup Active'
                      : 'Local SQLite Saved'}
                  </span>
                </div>
                {settings.backupDir && (
                  <button
                    onClick={onRevealBackupDir}
                    className="text-ink-3 hover:text-ink cursor-pointer"
                    title="Reveal Backup Folder in Explorer"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                )}
              </div>
              <p
                onClick={() => onSelectTab('backups')}
                className="text-ink-3 truncate cursor-pointer hover:text-ink-2"
                title={
                  settings.backupDir ||
                  'Click to choose an automatic backup folder'
                }
              >
                {settings.backupDir
                  ? settings.backupDir
                  : 'Choose auto-backup path →'}
              </p>
            </div>

            <button
              onClick={onOpenSetupWizard}
              className="w-full h-7 px-2.5 inline-flex items-center justify-center gap-1.5 rounded-md text-[11px] text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer"
            >
              <Sparkles className="w-3 h-3 text-accent" />
              <span>Re-run Setup / Change Mode</span>
            </button>
          </div>
        </div>
      ) : (
        /* Groups quick breakdown list */
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {summary.groups.map((gs) => {
            const pct =
              gs.totalBudget > 0
                ? Math.min(100, Math.round((gs.totalActual / gs.totalBudget) * 100))
                : 0;
            return (
              <div
                key={gs.group.id}
                onClick={() => onSelectTab('worksheet')}
                className="p-2 rounded-md hover:bg-raised cursor-pointer transition-colors space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: gs.group.color }}
                    />
                    <span className="text-[12px] text-ink truncate font-medium">
                      {gs.group.name}
                    </span>
                  </div>
                  <span className="text-[11px] tabular-nums text-ink-2">
                    {formatCurrency(gs.totalActual, settings.currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-ink-3 tabular-nums">
                  <span>Budget: {formatCurrency(gs.totalBudget, settings.currency)}</span>
                  <span
                    className={
                      gs.totalDifference >= 0 ? 'text-positive' : 'text-accent'
                    }
                  >
                    {gs.totalDifference >= 0 ? '+' : ''}
                    {formatCurrency(gs.totalDifference, settings.currency)}
                  </span>
                </div>
                <div className="h-1 bg-line rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      backgroundColor:
                        gs.group.kind !== 'income' && gs.totalActual > gs.totalBudget
                          ? 'var(--accent)'
                          : gs.group.color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
};
