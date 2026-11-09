import React, { useEffect, useState } from 'react';
import {
  Database,
  FolderOpen,
  ShieldCheck,
  RefreshCw,
  FileSpreadsheet,
  FileDown,
  Upload,
  ExternalLink,
  RotateCcw,
  HardDriveDownload,
  Lock,
} from 'lucide-react';
import { DbInfo, AppSettings, BackupEntry } from '../types';
import { DbLocationCard } from './DbLocationCard';
import { WebDavSyncCard } from './WebDavSyncCard';
import {
  getDatabaseInfo,
  listBackupFiles,
  pickFolderDialog,
  pickOpenFileDialog,
  pickSaveFileDialog,
  revealPathInExplorer,
} from '../utils/storage';

interface BackupsExportViewProps {
  settings: AppSettings;
  onUpdateBackupSettings: (patch: Partial<AppSettings>) => void;
  onUpdateVaultPassphrase: (passphrase: string | null) => Promise<void>;
  onManualBackup: () => Promise<void>;
  onRestoreFromPath: (path: string) => Promise<void>;
  onExportExcel: () => Promise<void>;
  onExportBudgetCsv: () => Promise<void>;
  onExportTransactionsCsv: () => Promise<void>;
  onExportSqliteCopy: (targetPath: string) => Promise<void>;
  onOpenImportModal: () => void;
  onReloadLedgerState?: () => Promise<void>;
}

export const BackupsExportView: React.FC<BackupsExportViewProps> = ({
  settings,
  onUpdateBackupSettings,
  onUpdateVaultPassphrase,
  onManualBackup,
  onRestoreFromPath,
  onExportExcel,
  onExportBudgetCsv,
  onExportTransactionsCsv,
  onExportSqliteCopy,
  onOpenImportModal,
  onReloadLedgerState,
}) => {
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [newPassphrase, setNewPassphrase] = useState('');

  const refreshInfo = async () => {
    setIsLoadingBackups(true);
    try {
      const info = await getDatabaseInfo();
      setDbInfo(info);
      if (settings.backupDir) {
        const list = await listBackupFiles(settings.backupDir);
        setBackups(list);
      } else {
        setBackups([]);
      }
    } finally {
      setIsLoadingBackups(false);
    }
  };

  useEffect(() => {
    refreshInfo();
  }, [settings.backupDir, settings.lastBackupAt]);

  const handleChooseBackupDir = async () => {
    const picked = await pickFolderDialog('Select Automatic Backup Folder');
    if (picked) {
      onUpdateBackupSettings({
        backupDir: picked,
        autoBackup: true,
      });
    }
  };

  const handleBrowseRestoreFile = async () => {
    const picked = await pickOpenFileDialog(
      'Koban Encrypted Backup (*.db, *.sqlite, *.json)',
      ['db', 'sqlite', 'json']
    );
    if (picked) {
      await onRestoreFromPath(picked);
      await refreshInfo();
    }
  };

  const handleExportStandaloneDb = async () => {
    const target = await pickSaveFileDialog(
      `koban-encrypted-${new Date().toISOString().slice(0, 10)}.db`,
      'Encrypted SQLite Database (*.db)',
      ['db']
    );
    if (target) {
      await onExportSqliteCopy(target);
    }
  };

  const handleApplyPassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdateVaultPassphrase(newPassphrase.trim() || null);
    setNewPassphrase('');
    await refreshInfo();
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 KB';
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const formatTime = (secs: number) => {
    if (!secs) return '—';
    return new Date(secs * 1000).toLocaleString();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-normal text-ink tracking-tight">
          Encrypted Database, Backups & Data Import / Export
        </h1>
        <p className="text-xs text-ink-2 mt-0.5">
          All database records and automatic backups are encrypted at rest with authenticated AES-256-GCM.
        </p>
      </div>

      {/* 1. AES-256-GCM Encryption & Automatic Backup Configuration */}
      <section className="p-5 rounded-xl bg-surface border border-line space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-positive" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium text-ink">
                  AES-256-GCM Encrypted SQLite Vault
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-positive/15 text-positive">
                  {dbInfo?.cipher ?? 'AES-256-GCM'} · {dbInfo?.encrypted_records ?? 0} Encrypted Records
                </span>
              </div>
              <p className="text-[11px] text-ink-3 mt-0.5">
                Primary DB: <code className="text-ink-2">{dbInfo?.db_path ?? 'Loading…'}</code> ({formatBytes(dbInfo?.db_size ?? 0)})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {dbInfo?.db_path && (
              <button
                onClick={() => revealPathInExplorer(dbInfo.db_path)}
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-raised border border-line text-xs text-ink-2 hover:text-ink cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Locate Encrypted DB</span>
              </button>
            )}
            <button
              onClick={async () => {
                await onManualBackup();
                await refreshInfo();
              }}
              className="h-8 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 cursor-pointer"
            >
              <Database className="w-3.5 h-3.5" />
              <span>Backup Now</span>
            </button>
          </div>
        </div>

        {/* Custom Vault Passphrase Row */}
        <form
          onSubmit={handleApplyPassphrase}
          className="p-3.5 rounded-lg bg-app border border-line flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5 min-w-[240px] flex-1">
            <Lock className="w-4 h-4 text-indigo shrink-0" />
            <div>
              <div className="text-xs font-medium text-ink">
                Vault Encryption Key Mode:{' '}
                <span className="text-positive">
                  {dbInfo?.has_custom_passphrase
                    ? 'Custom Passphrase Active (PBKDF2-SHA256 + AES-256-GCM)'
                    : 'Automatic Hardware/App Key (AES-256-GCM)'}
                </span>
              </div>
              <p className="text-[11px] text-ink-3">
                Every category, budget, and transaction row in SQLite is stored as authenticated AES-256-GCM ciphertext.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="password"
              placeholder="Set or change custom passphrase (leave empty for default)…"
              value={newPassphrase}
              onChange={(e) => setNewPassphrase(e.target.value)}
              className="w-64 h-8 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink placeholder:text-ink-3 focus:outline-none"
            />
            <button
              type="submit"
              className="h-8 px-3 rounded-lg bg-raised border border-line text-xs text-ink hover:bg-line/70 cursor-pointer"
            >
              {newPassphrase.trim() ? 'Set Passphrase' : 'Use Default Key'}
            </button>
          </div>
        </form>

        {/* Backup Folder Configuration */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-2 border-t border-line/60 items-end">
          <div className="md:col-span-7">
            <label className="block text-xs text-ink-2 mb-1">
              User-Chosen Automatic Backup Folder Path
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Choose a folder path for automatic encrypted SQLite (.db) backups…"
                value={settings.backupDir}
                onChange={(e) =>
                  onUpdateBackupSettings({ backupDir: e.target.value })
                }
                className="flex-1 h-9 px-3 rounded-lg bg-raised border border-line text-xs text-ink placeholder:text-ink-3 focus:outline-none"
              />
              <button
                onClick={handleChooseBackupDir}
                className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-raised border border-line text-xs text-ink hover:bg-line/70 shrink-0 cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Browse…</span>
              </button>
              {settings.backupDir && (
                <button
                  onClick={() => revealPathInExplorer(settings.backupDir)}
                  className="h-9 px-2.5 inline-flex items-center justify-center rounded-lg bg-raised border border-line text-ink-2 hover:text-ink cursor-pointer"
                  title="Open Backup Folder in Windows Explorer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs text-ink-2 mb-1">
              Rolling Snapshots to Keep
            </label>
            <input
              type="number"
              min="5"
              max="100"
              value={settings.maxBackups || 20}
              onChange={(e) =>
                onUpdateBackupSettings({
                  maxBackups: parseInt(e.target.value, 10) || 20,
                })
              }
              className="w-full h-9 px-3 rounded-lg bg-raised border border-line text-xs text-ink tabular-nums"
            />
          </div>

          <div className="md:col-span-2 flex items-center h-9">
            <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoBackup}
                onChange={(e) =>
                  onUpdateBackupSettings({ autoBackup: e.target.checked })
                }
                className="rounded border-line"
              />
              <span>Auto-Backup</span>
            </label>
          </div>
        </div>

        {/* Existing Backups in Chosen Folder */}
        <div className="space-y-2 pt-3 border-t border-line/60">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-ink-3 font-semibold">
              Encrypted Snapshots in Backup Folder ({backups.length})
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBrowseRestoreFile}
                className="text-xs text-indigo hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Restore from file…</span>
              </button>
              <button
                onClick={refreshInfo}
                className="p-1 rounded text-ink-3 hover:text-ink cursor-pointer"
                title="Refresh backup list"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isLoadingBackups ? 'animate-spin' : ''}`}
                />
              </button>
            </div>
          </div>

          {backups.length === 0 ? (
            <p className="text-xs text-ink-3 py-3">
              {settings.backupDir
                ? 'No backup files in this folder yet. Click "Backup Now" to create your first encrypted snapshot.'
                : 'Select a backup folder above to enable automatic encrypted SQLite backups.'}
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto divide-y divide-line/50 border border-line rounded-lg bg-app">
              {backups.map((b) => (
                <div
                  key={b.path}
                  className="px-3 py-2 flex items-center justify-between gap-2 text-xs hover:bg-raised/50"
                >
                  <div className="min-w-0">
                    <div className="text-ink font-medium truncate">{b.name}</div>
                    <div className="text-[10px] text-ink-3 tabular-nums">
                      {formatBytes(b.size)} · {formatTime(b.modified)} · AES-256-GCM
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => revealPathInExplorer(b.path)}
                      className="px-2 py-1 rounded bg-surface border border-line text-[11px] text-ink-2 hover:text-ink cursor-pointer"
                    >
                      Reveal
                    </button>
                    <button
                      onClick={() => onRestoreFromPath(b.path)}
                      className="px-2 py-1 rounded bg-ink text-on-ink text-[11px] hover:opacity-90 cursor-pointer"
                    >
                      Restore
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 2. Import Data & External Exports */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-ink">
          Import Data & External Excel (.xlsx) / CSV (.csv) Exports
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Import Data Card */}
          <div className="p-4 rounded-xl bg-surface border-2 border-ink/80 flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <Upload className="w-4 h-4 text-accent" />
                <span>Import Data (.xlsx, .csv, .db)</span>
              </div>
              <p className="text-xs text-ink-2 mt-1 leading-relaxed">
                Import a Monthly Budget sheet, bank/transaction CSV or Excel file, or restore an encrypted Koban SQLite database backup.
              </p>
            </div>
            <button
              onClick={onOpenImportModal}
              className="h-8 px-3 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 cursor-pointer"
            >
              Open Import Data Wizard…
            </button>
          </div>

          <div className="p-4 rounded-xl bg-surface border border-line flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <FileSpreadsheet className="w-4 h-4 text-positive" />
                <span>Full Excel Workbook (.xlsx)</span>
              </div>
              <p className="text-xs text-ink-2 mt-1 leading-relaxed">
                Multi-sheet Excel file containing the 2-column Monthly Budget sheet, Category Breakdown, 12-Month Overview, and Transactions.
              </p>
            </div>
            <button
              onClick={onExportExcel}
              className="h-8 px-3 rounded-lg bg-raised border border-line text-xs text-ink font-medium hover:bg-line/60 cursor-pointer"
            >
              Export Excel Workbook (.xlsx)…
            </button>
          </div>

          <div className="p-4 rounded-xl bg-surface border border-line flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <FileDown className="w-4 h-4 text-indigo" />
                <span>Monthly Budget CSV (.csv)</span>
              </div>
              <p className="text-xs text-ink-2 mt-1 leading-relaxed">
                Exports the side-by-side 2-column Monthly Budget layout with UTF-8 BOM for direct opening in Microsoft Excel or Google Sheets.
              </p>
            </div>
            <button
              onClick={onExportBudgetCsv}
              className="h-8 px-3 rounded-lg bg-raised border border-line text-xs text-ink font-medium hover:bg-line/60 cursor-pointer"
            >
              Export Monthly Budget (.csv)…
            </button>
          </div>

          <div className="p-4 rounded-xl bg-surface border border-line flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <FileDown className="w-4 h-4 text-accent" />
                <span>Transactions & Tax CSV (.csv)</span>
              </div>
              <p className="text-xs text-ink-2 mt-1 leading-relaxed">
                Complete transaction log with Freelancer client names, invoice numbers, VAT rates, and tax-deductible expense amounts.
              </p>
            </div>
            <button
              onClick={onExportTransactionsCsv}
              className="h-8 px-3 rounded-lg bg-raised border border-line text-xs text-ink font-medium hover:bg-line/60 cursor-pointer"
            >
              Export Transactions (.csv)…
            </button>
          </div>

          <div className="p-4 rounded-xl bg-surface border border-line flex flex-col justify-between gap-3 sm:col-span-2">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <HardDriveDownload className="w-4 h-4 text-ink-2" />
                <span>Export Encrypted SQLite Database (.db)</span>
              </div>
              <p className="text-xs text-ink-2 mt-1 leading-relaxed">
                Save a standalone copy of your AES-256-GCM encrypted SQLite database (<code className="text-ink">koban.db</code>) to any external drive or folder.
              </p>
            </div>
            <button
              onClick={handleExportStandaloneDb}
              className="h-8 px-4 self-start rounded-lg bg-raised border border-line text-xs text-ink font-medium hover:bg-line/60 cursor-pointer"
            >
              Export Encrypted SQLite (.db)…
            </button>
          </div>
        </div>
      </section>

      {/* 4. Expert Settings: Relocate Database Location */}
      <DbLocationCard onDatabaseMoved={() => refreshInfo()} />

      {/* 5. Cloud Sync: WebDAV Synchronization */}
      <WebDavSyncCard
        settings={settings}
        onUpdateSettings={onUpdateBackupSettings}
        onStateReloaded={onReloadLedgerState}
      />
    </div>
  );
};
