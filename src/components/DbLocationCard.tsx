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

interface DbLocationCardProps {
  onDatabaseMoved?: (newDbInfo: DbInfo) => void;
  className?: string;
}

export const DbLocationCard: React.FC<DbLocationCardProps> = ({
  onDatabaseMoved,
  className = '',
}) => {
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
      const picked = await pickFolderDialog('Select New Database Folder Location');
      if (picked) {
        setPendingMoveFolder(picked);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to select folder.');
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
      setStatusMsg(`Database successfully relocated to: ${updated.db_path}`);
      onDatabaseMoved?.(updated);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to move database.');
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
      setStatusMsg('Database location reset to default (%LOCALAPPDATA%\\Koban).');
      onDatabaseMoved?.(updated);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to reset location.');
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
                Database Storage Location
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo/15 text-indigo border border-indigo/20">
                Expert Setting
              </span>
              {dbInfo?.is_custom_location ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-500 border border-amber-500/20">
                  Custom Location
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-raised text-ink-2 border border-line">
                  Default AppData Location
                </span>
              )}
            </div>
            <p className="text-xs text-ink-2 mt-0.5">
              Change where the encrypted SQLite database (<code className="text-ink">koban.db</code>) is stored (e.g. secondary drive, encrypted partition, or local sync folder).
            </p>
          </div>
        </div>

        {dbInfo?.db_path && (
          <button
            type="button"
            onClick={() => revealPathInExplorer(dbInfo.db_path)}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-raised border border-line text-xs text-ink-2 hover:text-ink cursor-pointer transition-colors"
            title="Open folder in Windows File Explorer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Show in Explorer</span>
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
            Active Encrypted SQLite File Path
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              readOnly
              value={dbInfo?.db_path ?? (isLoading ? 'Detecting active database path…' : '—')}
              className="flex-1 min-w-[280px] h-9 px-3 rounded-lg bg-app border border-line text-xs text-ink font-mono select-all focus:outline-none"
            />
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleBrowseFolder}
              className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer shrink-0 transition-opacity"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Move to Another Folder…</span>
            </button>

            {dbInfo?.is_custom_location && (
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => setShowConfirmReset(true)}
                className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-raised border border-line text-xs text-ink-2 hover:text-ink hover:bg-line/60 disabled:opacity-50 cursor-pointer shrink-0 transition-colors"
                title="Move database back to %LOCALAPPDATA%\Koban"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to Default</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between text-[11px] text-ink-3 gap-2 pt-1">
          <div className="flex items-center gap-3">
            <span>Size: <strong className="text-ink-2 font-mono">{formatBytes(dbInfo?.db_size ?? 0)}</strong></span>
            <span>Cipher: <strong className="text-ink-2">{dbInfo?.cipher ?? 'AES-256-GCM'}</strong></span>
            <span>Records: <strong className="text-ink-2 font-mono">{dbInfo?.encrypted_records ?? 0}</strong></span>
          </div>
          <span className="text-ink-3">
            Koban automatically points to the relocated path on every launch.
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
                Confirm Relocation to New Folder?
              </div>
              <p className="text-xs text-ink-2 leading-relaxed">
                Your encrypted database (<code className="text-ink font-mono">koban.db</code>) will be safely copied to:
              </p>
              <div className="p-2 rounded bg-surface border border-line text-xs font-mono text-ink break-all select-all">
                {pendingMoveFolder}\koban.db
              </div>
              <p className="text-[11px] text-ink-3">
                All records, encryption keys, and SQLite state will transfer safely. Koban will immediately switch to using the new file.
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
              Cancel
            </button>
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleExecuteMove}
              className="h-8 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {isProcessing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Confirm & Transfer Database</span>
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
                Reset to Default Location?
              </div>
              <p className="text-xs text-ink-2 leading-relaxed">
                The database will be copied back to the default Windows AppData folder (<code className="text-ink font-mono">%LOCALAPPDATA%\Koban\koban.db</code>) and the custom location pointer will be cleared.
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
              Cancel
            </button>
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleExecuteReset}
              className="h-8 px-4 rounded-lg bg-ink text-on-ink text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {isProcessing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Reset to Default</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
