import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { useI18n } from '../i18n';

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Text of the confirm button (default: "Delete"). */
  confirmLabel?: string;
  /** Red, destructive confirm button (default true). */
  destructive?: boolean;
  /** Offer "Don't ask again" (turns off Settings → confirm before deleting). */
  offerDontAsk?: boolean;
}

interface ConfirmDialogProps extends ConfirmOptions {
  onResolve: (confirmed: boolean, dontAskAgain: boolean) => void;
}

/**
 * Themed replacement for window.confirm: same look as the app's other modals, Enter confirms,
 * Escape or a click outside cancels.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  message,
  confirmLabel,
  destructive = true,
  offerDontAsk = false,
  onResolve,
}) => {
  const { t } = useI18n();
  const [dontAsk, setDontAsk] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onResolve(false, false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onResolve]);

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-xs flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onResolve(false, false);
      }}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="koban-confirm-title"
        className="w-full max-w-sm bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-3 bg-app/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={`w-8 h-8 rounded-full inline-flex items-center justify-center shrink-0 ${
                destructive ? 'bg-accent/15 text-accent' : 'bg-indigo/15 text-indigo'
              }`}
            >
              {destructive ? <Trash2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            </span>
            <h3 id="koban-confirm-title" className="text-sm font-medium text-ink truncate">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => onResolve(false, false)}
            className="p-1 rounded-lg text-ink-2 hover:text-ink hover:bg-raised cursor-pointer"
            title={t('common.cancel')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {(message || offerDontAsk) && (
          <div className="px-5 py-4 space-y-3 text-xs">
            {message && <p className="text-ink-2 leading-relaxed whitespace-pre-line">{message}</p>}
            {offerDontAsk && (
              <label className="flex items-center gap-2 text-[11px] text-ink-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dontAsk}
                  onChange={(e) => setDontAsk(e.target.checked)}
                  className="rounded border-line"
                />
                <span>{t('confirm.dontAskAgain')}</span>
              </label>
            )}
          </div>
        )}

        <div className="px-5 py-3.5 border-t border-line bg-app/50 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={() => onResolve(false, false)}
            className="h-8 px-3.5 rounded-lg bg-surface border border-line text-xs text-ink-2 hover:text-ink hover:bg-raised cursor-pointer"
          >
            {t('common.cancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onResolve(true, dontAsk)}
            className={`h-8 px-4 inline-flex items-center gap-1.5 rounded-lg text-xs font-medium hover:opacity-90 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
              destructive
                ? 'bg-accent text-on-accent focus-visible:ring-accent/50'
                : 'bg-ink text-on-ink focus-visible:ring-ink/40'
            }`}
          >
            {destructive && <Trash2 className="w-3.5 h-3.5" />}
            <span>{confirmLabel ?? t('common.delete')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
