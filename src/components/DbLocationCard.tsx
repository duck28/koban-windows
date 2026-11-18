import React, { useEffect, useState } from 'react';
import {
  FolderOpen,
  ExternalLink,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  HardDrive,
  Loader2,
} from 'lucide-react';
import { DbInfo } from '../types';
import {
  getDatabaseInfo,
  moveDatabaseLocation,
  pickFolderDialog,
  resetDatabaseLocation,
  revealPathInExplorer,
} from '../utils/storage';
import { useI18n } from '../i18n';

interface DbLocationCardProps {
  onDatabaseMoved?: (newDbInfo: DbInfo) => void;
  className?: string;
}

export const DbLocationCard: React.FC<DbLocationCardProps> = ({
  onDatabaseMoved,
  className = '',
}) => {
  const { t, tf } = useI18n();
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingMoveFolder, setPendingMoveFolder] = useState<string | null>(null);
  const [showConfirmReset, setShowConfirmReset] = useState(false);

  const refreshInfo = async () => {
    setIsLoading(true);
    try {
      const info = await getDatabaseInfo();
      setDbInfo(info);
    } catch (err) {
      console.error('Failed to get database info:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshInfo();
  }, []);

  const handleBrowseFolder = async () => {
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const picked = await pickFolderDialog(t('dbLoc.moveBtn'));
      if (picked) {
        setPendingMoveFolder(picked);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('dbLoc.errSelectFolder'));
    }
  };

  const handleExecuteMove = async () => {
    if (!pendingMoveFolder) return;
    setIsProcessing(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const updated = await moveDatabaseLocation(pendingMoveFolder);
      setDbInfo(updated);
      setPendingMoveFolder(null);
      setStatusMsg(tf('dbLoc.relocatedSuccess', { path: updated.db_path }));
      onDatabaseMoved?.(updated);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('dbLoc.errMove'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecuteReset = async () => {
    setIsProcessing(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const updated = await resetDatabaseLocation();
      setDbInfo(updated);
      setShowConfirmReset(false);
      setStatusMsg(t('dbLoc.resetSuccessWin'));
      onDatabaseMoved?.(updated);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('dbLoc.errReset'));
    } finally {
      setIsProcessing(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 KB';
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <section className={`p-5 rounded-xl bg-surface border border-line space-y-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-line">
        <div className="flex items-center gap-2.5">
          <HardDrive className="w-5 h-5 text-indigo shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-ink">
                {t('dbLoc.title')}
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo/15 text-indigo border border-indigo/20">
                {t('dbLoc.expertBadge')}
              </span>
              {dbInfo?.is_custom_location ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-500 border border-amber-500/20">
                  {t('dbLoc.customBadge')}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-raised text-ink-2 border border-line">
                  {t('dbLoc.defaultBadgeWin')}
                </span>
              )}
            </div>
            <p className="text-xs text-ink-2 mt-0.5">
              {t('dbLoc.descPrefix')}<code className="text-ink">koban.db</code>{t('dbLoc.descSuffix')}
            </p>
          </div>
        </div>

        {dbInfo?.db_path && (
          <button
            type="button"
            onClick={() => revealPathInExplorer(dbInfo.db_path)}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-raised border border-line text-xs text-ink-2 hover:text-ink cursor-pointer transition-colors"
            title={t('dbLoc.showInExplorerTip')}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{t('dbLoc.showInExplorer')}</span>
          </button>
        )}
      </div>

      {statusMsg && (
        <div className="p-3 rounded-lg bg-positive/10 border border-positive/20 flex items-center gap-2 text-xs text-positive">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span className="flex-1 break-all">{statusMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 rounded-lg bg-negative/10 border border-negative/20 flex items-center gap-2 text-xs text-negative">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1 break-all">{errorMsg}</span>
        </div>
      )}

      {/* Current Path Bar & Action Buttons */}
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] text-ink-2 mb-1">
            {t('dbLoc.activePathLabel')}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              readOnly
              value={dbInfo?.db_path ?? (isLoading ? t('dbLoc.detectingPath') : '—')}
              className="flex-1 min-w-[280px] h-9 px-3 rounded-lg bg-app border border-line text-xs text-ink font-mono select-all focus:outline-none"
            />
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleBrowseFolder}
              className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer shrink-0 transition-opacity"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>{t('dbLoc.moveBtn')}</span>
            </button>

            {dbInfo?.is_custom_location && (
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => setShowConfirmReset(true)}
                className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-raised border border-line text-xs text-ink-2 hover:text-ink hover:bg-line/60 disabled:opacity-50 cursor-pointer shrink-0 transition-colors"
                title={t('dbLoc.resetWinTip')}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t('dbLoc.resetBtn')}</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between text-[11px] text-ink-3 gap-2 pt-1">
          <div className="flex items-center gap-3">
            <span>{t('dbLoc.sizeLabel')} <strong className="text-ink-2 font-mono">{formatBytes(dbInfo?.db_size ?? 0)}</strong></span>
            <span>{t('dbLoc.cipherLabel')} <strong className="text-ink-2">{dbInfo?.cipher ?? 'AES-256-GCM'}</strong></span>
            <span>{t('dbLoc.recordsLabel')} <strong className="text-ink-2 font-mono">{dbInfo?.encrypted_records ?? 0}</strong></span>
          </div>
          <span className="text-ink-3">
            {t('dbLoc.footnote')}
          </span>
        </div>
      </div>

      {/* Confirmation Drawer for Moving Database */}
      {pendingMoveFolder && (
        <div className="p-4 rounded-xl bg-app border border-amber-500/30 space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="text-xs font-medium text-ink">
                {t('dbLoc.confirmMoveTitle')}
              </div>
              <p className="text-xs text-ink-2 leading-relaxed">
                {t('dbLoc.confirmMoveBodyPrefix')}<code className="text-ink font-mono">koban.db</code>{t('dbLoc.confirmMoveBodySuffix')}
              </p>
              <div className="p-2 rounded bg-surface border border-line text-xs font-mono text-ink break-all select-all">
                {pendingMoveFolder}\koban.db
              </div>
              <p className="text-[11px] text-ink-3">
                {t('dbLoc.confirmMoveNote')}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => setPendingMoveFolder(null)}
              className="h-8 px-3 rounded-lg border border-line bg-surface text-xs text-ink hover:bg-raised cursor-pointer disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleExecuteMove}
              className="h-8 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {isProcessing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{t('dbLoc.confirmMoveBtn')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Drawer for Resetting Database */}
      {showConfirmReset && (
        <div className="p-4 rounded-xl bg-app border border-line space-y-3">
          <div className="flex items-start gap-2.5">
            <RotateCcw className="w-4 h-4 text-indigo shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="text-xs font-medium text-ink">
                {t('dbLoc.confirmResetTitle')}
              </div>
              <p className="text-xs text-ink-2 leading-relaxed">
                {t('dbLoc.confirmResetWinPrefix')}<code className="text-ink font-mono">%LOCALAPPDATA%\Koban\koban.db</code>{t('dbLoc.confirmResetSuffix')}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => setShowConfirmReset(false)}
              className="h-8 px-3 rounded-lg border border-line bg-surface text-xs text-ink hover:bg-raised cursor-pointer disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleExecuteReset}
              className="h-8 px-4 rounded-lg bg-ink text-on-ink text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {isProcessing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{t('dbLoc.resetBtn')}</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
