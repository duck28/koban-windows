import React, { useEffect, useRef, useState } from 'react';
import {
  PanelLeft,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  FileSpreadsheet,
  FileDown,
  Upload,
  Database,
  CheckCircle2,
  Sun,
  Moon,
  Monitor,
  Home,
  Briefcase,
  Layers,
  Sparkles,
  SlidersHorizontal,
  Lock,
} from 'lucide-react';
import { ActiveWorkspace, AppSettings } from '../types';
import { Logo } from './Logo';
import { useI18n } from '../i18n';
import { LanguageSelect } from './LanguageSelect';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function useClickOutside(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  return ref;
}

const iconBtn =
  'h-8 min-w-8 px-1.5 inline-flex items-center justify-center gap-1.5 rounded-md text-ink-2 hover:text-ink hover:bg-raised transition-colors disabled:opacity-35 disabled:pointer-events-none cursor-pointer';

interface TopBarProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  settings: AppSettings;
  onChangeWorkspace: (ws: ActiveWorkspace) => void;
  onChangeMonth: (year: number, month: number) => void;
  onChangeTheme: (theme: 'system' | 'light' | 'dark') => void;
  onChangeLanguage?: (language: string) => void;
  onOpenQuickAddTx: () => void;
  onOpenSetupWizard: () => void;
  onOpenSettings: () => void;
  onLockVault: () => void;
  onOpenImportModal: () => void;
  onExportExcel: () => void;
  onExportBudgetCsv: () => void;
  onExportTransactionsCsv: () => void;
  onManualBackup: () => void;
  isSaving: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  isSidebarOpen,
  onToggleSidebar,
  settings,
  onChangeWorkspace,
  onChangeMonth,
  onChangeTheme,
  onChangeLanguage,
  onOpenQuickAddTx,
  onOpenSetupWizard,
  onOpenSettings,
  onLockVault,
  onOpenImportModal,
  onExportExcel,
  onExportBudgetCsv,
  onExportTransactionsCsv,
  onManualBackup,
  isSaving,
}) => {
  const { t, intlLocale } = useI18n();
  const monthName = (idx: number, style: 'long' | 'short' = 'long') =>
    new Intl.DateTimeFormat(intlLocale, { month: style }).format(
      new Date(2024, idx, 1)
    );
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showMonthMenu, setShowMonthMenu] = useState(false);
  const exportRef = useClickOutside(showExportMenu, () => setShowExportMenu(false));
  const monthRef = useClickOutside(showMonthMenu, () => setShowMonthMenu(false));

  const prevMonth = () => {
    if (settings.activeMonth === 1) {
      onChangeMonth(settings.activeYear - 1, 12);
    } else {
      onChangeMonth(settings.activeYear, settings.activeMonth - 1);
    }
  };

  const nextMonth = () => {
    if (settings.activeMonth === 12) {
      onChangeMonth(settings.activeYear + 1, 1);
    } else {
      onChangeMonth(settings.activeYear, settings.activeMonth + 1);
    }
  };

  const cycleTheme = () => {
    const order: ('system' | 'light' | 'dark')[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(settings.theme) + 1) % order.length];
    onChangeTheme(next);
  };

  const ThemeIcon =
    settings.theme === 'light' ? Sun : settings.theme === 'dark' ? Moon : Monitor;

  return (
    <header className="h-12 bg-surface border-b border-line flex items-center justify-between gap-2 px-2.5 shrink-0 z-30 select-none">
      {/* Left: Sidebar toggle, Logo, and Workspace Mode Switcher */}
      <div className="flex items-center gap-1.5 min-w-0">
        <button
          onClick={onToggleSidebar}
          className={`${iconBtn} ${isSidebarOpen ? '!bg-raised !text-ink' : ''}`}
          title={t('topbar.toggleSidebar')}
        >
          <PanelLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center pl-1.5 pr-2 text-ink">
          <Logo variant="full" size={20} />
        </div>

        <span className="w-px h-4 bg-line mx-1 shrink-0" />

        {/* Workspace Switcher: Home | Freelancer | Combined */}
        <div className="flex items-center bg-raised/70 p-0.5 rounded-lg border border-line/60">
          <button
            onClick={() => onChangeWorkspace('home')}
            className={`h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] transition-all cursor-pointer ${
              settings.activeWorkspace === 'home'
                ? 'bg-surface text-ink shadow-xs font-medium'
                : 'text-ink-2 hover:text-ink'
            }`}
            title={t('workspace.home.tip')}
          >
            <Home className="w-3.5 h-3.5 text-accent" />
            <span>{t('workspace.home')}</span>
          </button>

          <button
            onClick={() => onChangeWorkspace('freelancer')}
            className={`h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] transition-all cursor-pointer ${
              settings.activeWorkspace === 'freelancer'
                ? 'bg-surface text-ink shadow-xs font-medium'
                : 'text-ink-2 hover:text-ink'
            }`}
            title={t('workspace.freelancer.tip')}
          >
            <Briefcase className="w-3.5 h-3.5 text-indigo" />
            <span>{t('workspace.freelancer')}</span>
          </button>

          <button
            onClick={() => onChangeWorkspace('combined')}
            className={`h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] transition-all cursor-pointer ${
              settings.activeWorkspace === 'combined'
                ? 'bg-surface text-ink shadow-xs font-medium'
                : 'text-ink-2 hover:text-ink'
            }`}
            title={t('workspace.combined.tip')}
          >
            <Layers className="w-3.5 h-3.5 text-positive" />
            <span className="hidden md:inline">{t('workspace.combined')}</span>
          </button>
        </div>
      </div>

      {/* Center: Month & Year Navigator */}
      <div className="flex items-center gap-1" ref={monthRef}>
        <button
          onClick={prevMonth}
          className={iconBtn}
          title={t('topbar.prevMonth')}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="relative">
          <button
            onClick={() => setShowMonthMenu((v) => !v)}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-ink hover:bg-raised transition-colors tabular-nums cursor-pointer"
          >
            <span>
              {monthName(settings.activeMonth - 1)} {settings.activeYear}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-ink-3" />
          </button>

          {showMonthMenu && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 p-3 bg-surface border border-line rounded-xl shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)] z-50">
              <div className="flex items-center justify-between mb-2 pb-2 border-b border-line">
                <button
                  onClick={() => onChangeMonth(settings.activeYear - 1, settings.activeMonth)}
                  className="p-1 rounded hover:bg-raised text-ink-2 hover:text-ink cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[13px] font-semibold tabular-nums text-ink">
                  {settings.activeYear}
                </span>
                <button
                  onClick={() => onChangeMonth(settings.activeYear + 1, settings.activeMonth)}
                  className="p-1 rounded hover:bg-raised text-ink-2 hover:text-ink cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {MONTH_NAMES.map((mName, idx) => {
                  const mNum = idx + 1;
                  const active = mNum === settings.activeMonth;
                  return (
                    <button
                      key={mName}
                      onClick={() => {
                        onChangeMonth(settings.activeYear, mNum);
                        setShowMonthMenu(false);
                      }}
                      className={`h-8 rounded-md text-[12px] transition-colors cursor-pointer ${
                        active
                          ? 'bg-ink text-on-ink font-medium'
                          : 'text-ink-2 hover:bg-raised hover:text-ink'
                      }`}
                    >
                      {monthName(idx, 'short')}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={nextMonth}
          className={iconBtn}
          title="Next Month"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Right: Quick Add, Backup Indicator, Theme, Import & Export */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onOpenQuickAddTx}
          className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md bg-raised text-ink text-[12px] hover:bg-line/70 transition-colors cursor-pointer"
          title="Log Income or Expense Transaction (Ctrl+N)"
        >
          <Plus className="w-3.5 h-3.5 text-accent" />
          <span className="hidden sm:inline">Add Entry</span>
        </button>

        <button
          onClick={onManualBackup}
          className={iconBtn}
          title={
            settings.backupDir
              ? `AES-256-GCM Encrypted Auto-Backup active (${settings.backupDir}) — Click to backup now (Ctrl+S)`
              : 'Encrypted SQLite DB — Click to backup now (Ctrl+S)'
          }
        >
          <CheckCircle2
            className={`w-4 h-4 ${
              isSaving
                ? 'text-warning animate-pulse'
                : settings.backupDir && settings.autoBackup
                  ? 'text-positive'
                  : 'text-ink-3'
            }`}
          />
        </button>

        <button
          onClick={cycleTheme}
          className={iconBtn}
          title={`Theme: ${settings.theme} (Click to switch)`}
        >
          <ThemeIcon className="w-4 h-4" />
        </button>

        <LanguageSelect variant="compact" onChanged={onChangeLanguage} />

        <button
          onClick={onOpenSettings}
          className={iconBtn}
          title="Settings & Behavioral Options"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>

        <button
          onClick={onOpenSetupWizard}
          className={iconBtn}
          title="4-Step Setup Wizard"
        >
          <Sparkles className="w-4 h-4" />
        </button>

        <button
          onClick={onLockVault}
          className={iconBtn}
          title={t('topbar.lock')}
        >
          <Lock className="w-4 h-4" />
        </button>

        {/* Dedicated Import Data Button */}
        <button
          onClick={onOpenImportModal}
          className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md border border-line bg-surface text-ink text-[12px] hover:bg-raised transition-colors cursor-pointer"
          title="Import Data (Excel, CSV, Transactions, or Encrypted DB Backup)"
        >
          <Upload className="w-3.5 h-3.5 text-indigo" />
          <span className="hidden sm:inline">{t('topbar.import')}</span>
        </button>

        <div className="relative" ref={exportRef}>
          <button
            onClick={() => setShowExportMenu((v) => !v)}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md bg-ink text-on-ink text-[12px] hover:opacity-85 transition-opacity cursor-pointer"
            title="Export (CSV / Excel / Encrypted Backup)"
          >
            <span>{t('topbar.export')}</span>
            <ChevronDown className="w-3.5 h-3.5 opacity-70" />
          </button>

          {showExportMenu && (
            <div className="absolute right-0 top-full mt-2 w-72 py-1.5 bg-surface border border-line rounded-xl shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)] z-50">
              <div className="px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-ink-3">
                Excel & CSV Exports
              </div>
              <button
                onClick={() => {
                  setShowExportMenu(false);
                  onExportExcel();
                }}
                className="w-full flex items-start gap-2.5 px-3 py-2 text-left text-xs hover:bg-raised transition-colors cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 mt-0.5 text-positive shrink-0" />
                <div>
                  <span className="block text-ink font-medium">
                    Export Excel Workbook (.xlsx)…
                  </span>
                  <span className="block text-[11px] text-ink-3 mt-0.5">
                    Monthly Worksheet, Breakdown, 12-Month & Transactions
                  </span>
                </div>
              </button>

              <button
                onClick={() => {
                  setShowExportMenu(false);
                  onExportBudgetCsv();
                }}
                className="w-full flex items-start gap-2.5 px-3 py-2 text-left text-xs hover:bg-raised transition-colors cursor-pointer"
              >
                <FileDown className="w-4 h-4 mt-0.5 text-indigo shrink-0" />
                <div>
                  <span className="block text-ink">
                    Export Monthly Budget CSV (.csv)…
                  </span>
                  <span className="block text-[11px] text-ink-3 mt-0.5">
                    2-column monthly budget sheet for Excel
                  </span>
                </div>
              </button>

              <button
                onClick={() => {
                  setShowExportMenu(false);
                  onExportTransactionsCsv();
                }}
                className="w-full flex items-start gap-2.5 px-3 py-2 text-left text-xs hover:bg-raised transition-colors cursor-pointer"
              >
                <FileDown className="w-4 h-4 mt-0.5 text-ink-2 shrink-0" />
                <div>
                  <span className="block text-ink">
                    Export Transactions & Tax CSV (.csv)…
                  </span>
                  <span className="block text-[11px] text-ink-3 mt-0.5">
                    All entries with VAT, deductible % & invoice refs
                  </span>
                </div>
              </button>

              <div className="h-px bg-line my-1" />

              <button
                onClick={() => {
                  setShowExportMenu(false);
                  onOpenImportModal();
                }}
                className="w-full flex items-start gap-2.5 px-3 py-2 text-left text-xs hover:bg-raised transition-colors cursor-pointer"
              >
                <Upload className="w-4 h-4 mt-0.5 text-accent shrink-0" />
                <div>
                  <span className="block text-ink">
                    Import Data (.xlsx, .csv, .db)…
                  </span>
                  <span className="block text-[11px] text-ink-3 mt-0.5">
                    Import budget sheets, transactions, or backups
                  </span>
                </div>
              </button>

              <button
                onClick={() => {
                  setShowExportMenu(false);
                  onManualBackup();
                }}
                className="w-full flex items-start gap-2.5 px-3 py-2 text-left text-xs hover:bg-raised transition-colors cursor-pointer"
              >
                <Database className="w-4 h-4 mt-0.5 text-ink-2 shrink-0" />
                <div>
                  <span className="block text-ink">
                    Backup Encrypted DB Now (Ctrl+S)
                  </span>
                  <span className="block text-[11px] text-ink-3 mt-0.5">
                    Save AES-256-GCM encrypted SQLite snapshot
                  </span>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
