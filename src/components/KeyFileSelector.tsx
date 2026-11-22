import React, { useState } from 'react';
import { FileKey2, FolderOpen, Loader2, Sparkles, X } from 'lucide-react';
import { useI18n } from '../i18n';
import {
  generateKeyFile,
  isTauriEnv,
  pickOpenFileDialog,
  pickSaveFileDialog,
} from '../utils/storage';

interface KeyFileSelectorProps {
  keyfilePath: string | null;
  onChange: (path: string | null) => void;
  allowGenerate?: boolean;
  rememberChecked?: boolean;
  onRememberChange?: (remember: boolean) => void;
  requiredBadge?: boolean;
  compact?: boolean;
  onStatusMessage?: (message: string) => void;
}

export const KeyFileSelector: React.FC<KeyFileSelectorProps> = ({
  keyfilePath,
  onChange,
  allowGenerate = true,
  rememberChecked,
  onRememberChange,
  requiredBadge = false,
  compact = false,
  onStatusMessage,
}) => {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const handleBrowse = async () => {
    setBusy(true);
    try {
      const picked = await pickOpenFileDialog(
        'Koban Key Files & All Files',
        ['key', 'keyx', '*']
      );
      if (picked) {
        onChange(picked);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleGenerate = async () => {
    setBusy(true);
    try {
      const target = await pickSaveFileDialog(
        'koban-vault.key',
        'Koban Key File (*.key)',
        ['key']
      );
      if (!target) return;
      const res = await generateKeyFile(target);
      onChange(res.path);
      onStatusMessage?.(`Created 256-bit Key File (${res.fingerprint})`);
    } finally {
      setBusy(false);
    }
  };

  const fileName = keyfilePath ? keyfilePath.split(/[/\\]/).pop() || keyfilePath : '';

  return (
    <div
      className={`rounded-xl border border-line bg-app/75 ${
        compact ? 'p-3 space-y-2' : 'p-3.5 space-y-2.5'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <FileKey2 className="w-4 h-4 text-indigo shrink-0 mt-0.5" />
          <div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-ink">
              <span>{t('vault.keyFileTitle')}</span>
              {requiredBadge && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium">
                  Required
                </span>
              )}
            </div>
            {!compact && (
              <p className="text-[11px] text-ink-3 mt-0.5 leading-relaxed">
                {t('vault.keyFileDesc')}
              </p>
            )}
          </div>
        </div>
        {keyfilePath && (
          <button
            type="button"
            onClick={() => onChange(null)}
            title={t('vault.keyFileClear')}
            className="text-ink-3 hover:text-negative p-1 rounded-md cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {keyfilePath ? (
        <div
          className="px-2.5 py-1.5 rounded-lg bg-surface border border-line text-[11px] font-mono text-ink truncate"
          title={keyfilePath}
        >
          {fileName}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !isTauriEnv()}
          onClick={handleBrowse}
          className="h-8 px-3 rounded-lg border border-line bg-surface hover:bg-raised text-xs text-ink inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderOpen className="w-3.5 h-3.5" />}
          <span>{t('vault.keyFileAttach')}</span>
        </button>
        {allowGenerate && (
          <button
            type="button"
            disabled={busy || !isTauriEnv()}
            onClick={handleGenerate}
            className="h-8 px-3 rounded-lg border border-indigo/30 bg-indigo/10 hover:bg-indigo/15 text-xs text-indigo font-medium inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t('vault.keyFileGenerate')}</span>
          </button>
        )}
      </div>

      {keyfilePath && onRememberChange && (
        <label className="flex items-center gap-2 text-[11px] text-ink-2 cursor-pointer pt-0.5">
          <input
            type="checkbox"
            checked={Boolean(rememberChecked)}
            onChange={(e) => onRememberChange(e.target.checked)}
            className="rounded border-line"
          />
          <span>{t('vault.keyFileRemember')}</span>
        </label>
      )}
    </div>
  );
};
