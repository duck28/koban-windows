import React, { useRef, useState, useEffect } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { LANGUAGES, useI18n } from '../i18n';

interface LanguageSelectProps {
  /** Called after the language changed so it can be persisted in settings */
  onChanged?: (code: string) => void;
  className?: string;
  variant?: 'full' | 'compact';
}

export const LanguageSelect: React.FC<LanguageSelectProps> = ({
  onChanged,
  className = '',
  variant = 'full',
}) => {
  const { language, setLanguage } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const groups: ('Default' | 'Europe' | 'Asia')[] = ['Default', 'Europe', 'Asia'];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSelect = (code: string) => {
    setLanguage(code);
    onChanged?.(code);
    setOpen(false);
  };

  const currentLang = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];

  if (variant === 'compact') {
    return (
      <div className={`relative ${className}`} ref={containerRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="h-8 px-2 inline-flex items-center gap-1.5 rounded-md text-ink-2 hover:text-ink hover:bg-raised transition-colors cursor-pointer text-[12px] font-medium"
          title={`Language: ${currentLang.native} (${currentLang.english})`}
        >
          <Globe className="w-3.5 h-3.5 text-ink-2" />
          <span className="uppercase text-[11px] tracking-wide">{currentLang.code.split('-')[0]}</span>
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1.5 w-60 max-h-80 overflow-y-auto py-1.5 bg-surface border border-line rounded-xl shadow-[0_8px_24px_-12px_rgba(0,0,0,0.3)] z-50 divide-y divide-line/50">
            {groups.map((g) => (
              <div key={g} className="py-1">
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-ink-3 font-semibold">
                  {g === 'Default' ? 'Default' : g === 'Europe' ? 'Europe' : 'Asia'}
                </div>
                {LANGUAGES.filter((l) => l.group === g).map((l) => {
                  const isSelected = l.code === language;
                  return (
                    <button
                      key={l.code}
                      type="button"
                      onClick={() => handleSelect(l.code)}
                      className={`w-full px-3 py-1.5 flex items-center justify-between text-left text-xs transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-raised font-medium text-ink'
                          : 'text-ink-2 hover:bg-raised/60 hover:text-ink'
                      }`}
                    >
                      <span>
                        {l.native}
                        {l.native !== l.english ? (
                          <span className="text-[11px] text-ink-3 ml-1.5 font-normal">
                            ({l.english})
                          </span>
                        ) : null}
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <Globe className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
      <select
        value={language}
        onChange={(e) => {
          setLanguage(e.target.value);
          onChanged?.(e.target.value);
        }}
        className="w-full h-9 pl-8 pr-2.5 rounded-lg bg-app border border-line text-xs text-ink focus:outline-none cursor-pointer"
      >
        {groups.map((g) => (
          <optgroup
            key={g}
            label={g === 'Default' ? 'Default' : g === 'Europe' ? 'Europe' : 'Asia'}
          >
            {LANGUAGES.filter((l) => l.group === g).map((l) => (
              <option key={l.code} value={l.code}>
                {l.native}
                {l.native !== l.english ? ` — ${l.english}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
};
