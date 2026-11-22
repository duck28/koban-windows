import React, { useState } from 'react';
import { Check, Copy, Download, KeyRound, ShieldAlert } from 'lucide-react';
import { useI18n } from '../i18n';
import { isTauriEnv, pickSaveFileDialog, saveTextFile } from '../utils/storage';

interface RecoveryKeyModalProps {
  recoveryKey: string;
  onConfirm: () => void;
}

export const RecoveryKeyModal: React.FC<RecoveryKeyModalProps> = ({
  recoveryKey,
  onConfirm,
}) => {
  const { t } = useI18n();
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleDownload = async () => {
    const body = [
      'Koban Vault Format v2 — Emergency Recovery Key',
      '==================================================',
      '',
      `Recovery Key: ${recoveryKey}`,
      '',
      'Keep this Recovery Key in a secure offline location (e.g. printed paper or password manager).',
      'Anyone holding this key can decrypt your Koban database.',
      '',
    ].join('\n');

    if (isTauriEnv()) {
      const target = await pickSaveFileDialog(
        'koban-recovery-key.txt',
        'Text File (*.txt)',
        ['txt']
      );
      if (target) {
        await saveTextFile(target, body);
      }
      return;
    }
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'koban-recovery-key.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-line flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-ink">{t('vault.recoveryTitle')}</h2>
            <p className="text-[11px] text-ink-3 mt-0.5">
              160-bit Crockford Base32 · Shown once and never stored in plaintext
            </p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-2.5 text-xs text-ink-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <span>{t('vault.recoveryDesc')}</span>
          </div>

          <div className="p-4 rounded-xl bg-app border border-line font-mono text-sm font-semibold text-ink tracking-wider text-center select-all break-all">
            {recoveryKey}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="h-8 px-3 rounded-lg border border-line bg-surface hover:bg-raised text-xs text-ink inline-flex items-center gap-1.5 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-positive" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy Key'}</span>
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="h-8 px-3 rounded-lg border border-line bg-surface hover:bg-raised text-xs text-ink inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Save .txt Backup</span>
            </button>
          </div>

          <label className="flex items-start gap-2.5 p-3 rounded-xl bg-raised/60 border border-line cursor-pointer text-xs text-ink">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 rounded border-line"
            />
            <span>{t('vault.recoveryConfirmLabel')}</span>
          </label>
        </div>

        <div className="px-6 py-3.5 border-t border-line flex justify-end">
          <button
            type="button"
            disabled={!confirmed}
            onClick={onConfirm}
            className="h-9 px-5 rounded-xl bg-ink text-on-ink text-xs font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {t('vault.recoveryConfirmBtn')}
          </button>
        </div>
      </div>
    </div>
  );
};
