import React, { useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';
import { useI18n, TranslationKey } from '../i18n';

/** Shortcut list shown in the dialog (and handled in App.tsx). */
export const SHORTCUT_GROUPS: { titleKey: TranslationKey; items: { keys: string[]; labelKey: TranslationKey }[] }[] = [
  {
    titleKey: 'shortcuts.groupNavigate',
    items: [
      { keys: ['1 … 9', '0'], labelKey: 'shortcuts.views' },
      { keys: ['Alt', '←'], labelKey: 'shortcuts.prevMonth' },
      { keys: ['Alt', '→'], labelKey: 'shortcuts.nextMonth' },
      { keys: ['T'], labelKey: 'shortcuts.thisMonth' },
      { keys: ['Ctrl', ','], labelKey: 'shortcuts.settings' },
      { keys: ['Ctrl', 'B'], labelKey: 'shortcuts.sidebar' },
    ],
  },
  {
    titleKey: 'shortcuts.groupActions',
    items: [
      { keys: ['Ctrl', 'N'], labelKey: 'shortcuts.newTransaction' },
      { keys: ['Ctrl', 'F'], labelKey: 'shortcuts.search' },
      { keys: ['Ctrl', 'Shift', 'P'], labelKey: 'shortcuts.postRecurring' },
      { keys: ['Ctrl', 'I'], labelKey: 'shortcuts.import' },
      { keys: ['Ctrl', 'S'], labelKey: 'shortcuts.backup' },
      { keys: ['Ctrl', 'L'], labelKey: 'shortcuts.lock' },
    ],
  },
  {
    titleKey: 'shortcuts.groupHelp',
    items: [
      { keys: ['?'], labelKey: 'shortcuts.showHelp' },
      { keys: ['Esc'], labelKey: 'shortcuts.close' },
    ],
  },
];

export const ShortcutsDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-xs flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="koban-shortcuts-title"
        className="w-full max-w-lg max-h-[85vh] bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="px-5 py-4 border-b border-line flex items-center justify-between bg-app/60">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-indigo" />
            <h3 id="koban-shortcuts-title" className="text-sm font-medium text-ink">
              {t('shortcuts.title')}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-ink-2 hover:text-ink hover:bg-raised cursor-pointer"
            title={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-5 overflow-y-auto text-xs">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.titleKey} className="space-y-2">
              <h4 className="text-[10px] uppercase tracking-[0.1em] text-ink-3">
                {t(group.titleKey)}
              </h4>
              <div className="divide-y divide-line/60 rounded-xl border border-line bg-app/40">
                {group.items.map((item) => (
                  <div key={item.labelKey} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-ink">{t(item.labelKey)}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {item.keys.map((k) => (
                        <kbd
                          key={k}
                          className="min-w-[22px] h-[22px] px-1.5 inline-flex items-center justify-center rounded-md bg-raised border border-line text-[11px] text-ink-2 font-sans tabular-nums"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};
