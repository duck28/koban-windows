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
  KeyRound,
  FileKey2,
  Fingerprint,
} from 'lucide-react';
import { DbInfo, AppSettings, BackupEntry, VaultStatus } from '../types';
import { DbLocationCard } from './DbLocationCard';
import { WebDavSyncCard } from './WebDavSyncCard';
import { KeyFileSelector } from './KeyFileSelector';
import {
  getDatabaseInfo,
  listBackupFiles,
  pickFolderDialog,
  pickOpenFileDialog,
  pickSaveFileDialog,
  revealPathInExplorer,
} from '../utils/storage';
import { useI18n } from '../i18n';

interface BackupsExportViewProps {
  settings: AppSettings;
  vaultStatus: VaultStatus | null;
  onUpdateBackupSettings: (patch: Partial<AppSettings>) => void;
  onOpenSecuritySettings: () => void;
  onManualBackup: () => Promise<void>;
  onRestoreFromPath: (
    path: string,
    passphrase?: string,
    keyfilePath?: string
  ) => Promise<void>;
  onExportExcel: () => Promise<void>;
  onExportBudgetCsv: () => Promise<void>;
  onExportTransactionsCsv: () => Promise<void>;
  onExportSqliteCopy: (targetPath: string) => Promise<void>;
  onOpenImportModal: () => void;
  onReloadLedgerState?: () => Promise<void>;
}

export const BackupsExportView: React.FC<BackupsExportViewProps> = ({
  settings,
  vaultStatus,
  onUpdateBackupSettings,
  onOpenSecuritySettings,
  onManualBackup,
  onRestoreFromPath,
  onExportExcel,
  onExportBudgetCsv,
  onExportTransactionsCsv,
  onExportSqliteCopy,
  onOpenImportModal,
  onReloadLedgerState,
}) => {
  const { t, tf, intlLocale } = useI18n();
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [restoreKeyfilePath, setRestoreKeyfilePath] = useState<string | null>(null);
  const [showRestoreCreds, setShowRestoreCreds] = useState(false);

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
    const picked = await pickFolderDialog(t('settings.backups.folderPlaceholder'));
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
      await onRestoreFromPath(
        picked,
        restorePassphrase || undefined,
        restoreKeyfilePath || undefined
      );
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

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 KB';
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const formatTime = (secs: number) => {
    if (!secs) return '—';
    return new Date(secs * 1000).toLocaleString(intlLocale);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-normal text-ink tracking-tight">
          {t('backups.title')}
        </h1>
        <p className="text-xs text-ink-2 mt-0.5">
          {t('backups.subtitle')}
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
                  {t('backups.vaultTitle')}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-positive/15 text-positive">
                  {tf('backups.encryptedRecordsBadge', {
                    cipher: dbInfo?.cipher ?? 'AES-256-GCM',
                    count: dbInfo?.encrypted_records ?? 0,
                  })}
                </span>
              </div>
              <p className="text-[11px] text-ink-3 mt-0.5">
                {t('backups.primaryDbLabel')} <code className="text-ink-2">{dbInfo?.db_path ?? t('backups.loading')}</code> ({formatBytes(dbInfo?.db_size ?? 0)})
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
                <span>{t('backups.locateDbBtn')}</span>
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
              <span>{t('backups.backupNowBtn')}</span>
            </button>
          </div>
        </div>

        {/* Vault Format v2 Encryption Status Row */}
        <div className="p-3.5 rounded-lg bg-app border border-line flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-[240px] flex-1">
            <Lock className="w-4 h-4 text-positive shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="text-xs font-medium text-ink">
                {vaultStatus?.formatVersion === 2
                  ? t('vault.badgeV2')
                  : t('vault.badgeLegacyV1')}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="px-2 py-0.5 rounded-full bg-surface border border-line text-ink-2 inline-flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5 text-positive" />
                  <span>Master Password (Argon2id)</span>
                </span>
                {vaultStatus?.requiresKeyFile && (
                  <span className="px-2 py-0.5 rounded-full bg-indigo/10 border border-indigo/25 text-indigo inline-flex items-center gap-1">
                    <FileKey2 className="w-2.5 h-2.5" />
                    <span>Composite Key File (.key)</span>
                  </span>
                )}
                {vaultStatus?.deviceSlotEnrolled && (
                  <span className="px-2 py-0.5 rounded-full bg-positive/10 border border-positive/25 text-positive inline-flex items-center gap-1">
                    <Fingerprint className="w-2.5 h-2.5" />
                    <span>Windows Hello</span>
                  </span>
                )}
                {vaultStatus?.slots.some((s) => s.kind === 'recovery') && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-400 inline-flex items-center gap-1">
                    <KeyRound className="w-2.5 h-2.5" />
                    <span>Recovery Key</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenSecuritySettings}
            className="h-8 px-3.5 rounded-lg bg-raised border border-line text-xs font-medium text-ink hover:bg-line/70 cursor-pointer"
          >
            Manage Credentials &amp; Keys
          </button>
        </div>

        {/* Backup Folder Configuration */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-2 border-t border-line/60 items-end">
          <div className="md:col-span-7">
            <label className="block text-xs text-ink-2 mb-1">
              {t('backups.folderLabel')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder={t('backups.folderPlaceholder')}
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
                <span>{t('settings.backups.browse')}</span>
              </button>
              {settings.backupDir && (
                <button
                  onClick={() => revealPathInExplorer(settings.backupDir)}
                  className="h-9 px-2.5 inline-flex items-center justify-center rounded-lg bg-raised border border-line text-ink-2 hover:text-ink cursor-pointer"
                  title={t('sidebar.revealBackupWin')}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs text-ink-2 mb-1">
              {t('backups.keepSnapshotsLabel')}
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
              <span>{t('settings.backups.autoBackup')}</span>
            </label>
          </div>
        </div>

        {/* Existing Backups in Chosen Folder */}
        <div className="space-y-2 pt-3 border-t border-line/60">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-ink-3 font-semibold">
              {tf('backups.snapshotsListTitle', { count: backups.length })}
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowRestoreCreds((v) => !v)}
                className="text-xs text-ink-2 hover:text-ink cursor-pointer"
              >
                {showRestoreCreds ? 'Hide backup unlock options' : 'Older / foreign backup credentials…'}
              </button>
              <button
                onClick={handleBrowseRestoreFile}
                className="text-xs text-indigo hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{t('backups.restoreFromFile')}</span>
              </button>
              <button
                onClick={refreshInfo}
                className="p-1 rounded text-ink-3 hover:text-ink cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isLoadingBackups ? 'animate-spin' : ''}`}
                />
              </button>
            </div>
          </div>

          {showRestoreCreds && (
            <div className="p-3 rounded-lg bg-app border border-line space-y-2">
              <p className="text-[11px] text-ink-2">
                Leave empty if the backup shares your current vault key. Enter credentials only for backups protected with an older password or Key File.
              </p>
              <input
                type="password"
                value={restorePassphrase}
                onChange={(e) => setRestorePassphrase(e.target.value)}
                placeholder="Backup passphrase (optional)"
                className="w-full h-8 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none"
              />
              <KeyFileSelector
                keyfilePath={restoreKeyfilePath}
                onChange={setRestoreKeyfilePath}
                allowGenerate={false}
                compact
              />
            </div>
          )}

          {backups.length === 0 ? (
            <p className="text-xs text-ink-3 py-3">
              {settings.backupDir
                ? t('backups.emptyDir')
                : t('backups.emptyNoDir')}
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto divide-y divide-line/50 border border-line rounded-lg bg-app">
              {backups.map((b) => (
                <div
                  key={b.path}
                  className="px-3 py-2 flex items-center justify-between gap-2 text-xs hover:bg-raised/50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-ink font-medium truncate">{b.name}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          b.format_version === 2
                            ? 'bg-positive/12 text-positive'
                            : 'bg-amber-500/12 text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {b.format_version === 2 ? 'v2 Argon2id' : 'v1 Legacy'}
                      </span>
                    </div>
                    <div className="text-[10px] text-ink-3 tabular-nums">
                      {formatBytes(b.size)} · {formatTime(b.modified)} · AES-256-GCM
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => revealPathInExplorer(b.path)}
                      className="px-2 py-1 rounded bg-surface border border-line text-[11px] text-ink-2 hover:text-ink cursor-pointer"
                    >
                      {t('backups.revealBtn')}
                    </button>
                    <button
                      onClick={() =>
                        onRestoreFromPath(
                          b.path,
                          restorePassphrase || undefined,
                          restoreKeyfilePath || undefined
                        )
                      }
                      className="px-2 py-1 rounded bg-ink text-on-ink text-[11px] hover:opacity-90 cursor-pointer"
                    >
                      {t('backups.restoreBtn')}
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
          {t('backups.exportsSectionTitle')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Import Data Card */}
          <div className="p-4 rounded-xl bg-surface border-2 border-ink/80 flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <Upload className="w-4 h-4 text-accent" />
                <span>{t('backups.importCardTitle')}</span>
              </div>
              <p className="text-xs text-ink-2 mt-1 leading-relaxed">
                {t('backups.importCardDesc')}
              </p>
            </div>
            <button
              onClick={onOpenImportModal}
              className="h-8 px-3 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 cursor-pointer"
            >
              {t('backups.importCardBtn')}
            </button>
          </div>

          <div className="p-4 rounded-xl bg-surface border border-line flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <FileSpreadsheet className="w-4 h-4 text-positive" />
                <span>{t('backups.excelCardTitle')}</span>
              </div>
              <p className="text-xs text-ink-2 mt-1 leading-relaxed">
                {t('backups.excelCardDesc')}
              </p>
            </div>
            <button
              onClick={onExportExcel}
              className="h-8 px-3 rounded-lg bg-raised border border-line text-xs text-ink font-medium hover:bg-line/60 cursor-pointer"
            >
              {t('backups.excelCardBtn')}
            </button>
          </div>

          <div className="p-4 rounded-xl bg-surface border border-line flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <FileDown className="w-4 h-4 text-indigo" />
                <span>{t('backups.budgetCsvCardTitle')}</span>
              </div>
              <p className="text-xs text-ink-2 mt-1 leading-relaxed">
                {t('backups.budgetCsvCardDesc')}
              </p>
            </div>
            <button
              onClick={onExportBudgetCsv}
              className="h-8 px-3 rounded-lg bg-raised border border-line text-xs text-ink font-medium hover:bg-line/60 cursor-pointer"
            >
              {t('backups.budgetCsvCardBtn')}
            </button>
          </div>

          <div className="p-4 rounded-xl bg-surface border border-line flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <FileDown className="w-4 h-4 text-accent" />
                <span>{t('backups.txCsvCardTitle')}</span>
              </div>
              <p className="text-xs text-ink-2 mt-1 leading-relaxed">
                {t('backups.txCsvCardDesc')}
              </p>
            </div>
            <button
              onClick={onExportTransactionsCsv}
              className="h-8 px-3 rounded-lg bg-raised border border-line text-xs text-ink font-medium hover:bg-line/60 cursor-pointer"
            >
              {t('backups.txCsvCardBtn')}
            </button>
          </div>

          <div className="p-4 rounded-xl bg-surface border border-line flex flex-col justify-between gap-3 sm:col-span-2">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <HardDriveDownload className="w-4 h-4 text-ink-2" />
                <span>{t('backups.sqliteCardTitle')}</span>
              </div>
              <p className="text-xs text-ink-2 mt-1 leading-relaxed">
                {t('backups.sqliteCardDescPrefix')}<code className="text-ink">koban.db</code>{t('backups.sqliteCardDescSuffix')}
              </p>
            </div>
            <button
              onClick={handleExportStandaloneDb}
              className="h-8 px-4 self-start rounded-lg bg-raised border border-line text-xs text-ink font-medium hover:bg-line/60 cursor-pointer"
            >
              {t('backups.sqliteCardBtn')}
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
