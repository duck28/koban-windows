import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

export interface KobanSelectOption {
  value: string;
  label: string;
  group?: string;
  subtitle?: string;
  disabled?: boolean;
}

interface KobanSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: KobanSelectOption[];
  placeholder?: string;
  className?: string;
  menuClassName?: string;
  size?: 'xs' | 'sm' | 'md';
  searchable?: boolean;
  searchPlaceholder?: string;
  tone?: 'default' | 'surface' | 'attention';
  disabled?: boolean;
  title?: string;
}

export interface MenuPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
}

export interface TriggerRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

/**
 * Computes fixed-viewport coordinates and outer maxHeight so the dropdown menu
 * (including optional search header and borders) never overflows any viewport edge.
 */
export function computeKobanSelectPosition(
  rect: TriggerRect,
  viewportWidth: number,
  viewportHeight: number
): MenuPosition | null {
  if (rect.bottom < 0 || rect.top > viewportHeight) {
    return null;
  }

  const gap = 6;
  const viewportPad = 12;
  const idealMax = Math.min(340, Math.max(80, viewportHeight - viewportPad * 2));

  const width = Math.min(
    Math.max(rect.width, 200),
    Math.max(120, viewportWidth - viewportPad * 2)
  );
  const left = Math.max(
    viewportPad,
    Math.min(rect.left, viewportWidth - width - viewportPad)
  );

  const topBelow = Math.max(viewportPad, rect.bottom + gap);
  const availBelow = Math.max(0, viewportHeight - viewportPad - topBelow);

  const bottomAbove = Math.max(viewportPad, viewportHeight - rect.top + gap);
  const availAbove = Math.max(0, viewportHeight - bottomAbove - viewportPad);

  if (availBelow >= idealMax) {
    return {
      top: topBelow,
      left,
      width,
      maxHeight: idealMax,
    };
  }

  if (availAbove > availBelow && availAbove >= 140) {
    return {
      bottom: bottomAbove,
      left,
      width,
      maxHeight: Math.min(idealMax, availAbove),
    };
  }

  if (availBelow >= 140) {
    return {
      top: topBelow,
      left,
      width,
      maxHeight: Math.min(idealMax, availBelow),
    };
  }

  return {
    top: viewportPad,
    left,
    width,
    maxHeight: Math.max(80, viewportHeight - viewportPad * 2),
  };
}

const SIZE_CLASSES: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'h-7 px-2 text-xs rounded',
  sm: 'h-8 px-2.5 text-xs rounded-lg',
  md: 'h-9 px-3 text-xs rounded-lg',
};

const TONE_CLASSES: Record<'default' | 'surface' | 'attention', string> = {
  default: 'bg-app border border-line text-ink hover:bg-raised/60',
  surface: 'bg-surface border border-line text-ink hover:bg-raised',
  attention:
    'bg-surface border border-accent/60 text-accent font-medium hover:bg-raised',
};

export const KobanSelect: React.FC<KobanSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  className = '',
  menuClassName = '',
  size = 'sm',
  searchable,
  searchPlaceholder = 'Search…',
  tone = 'default',
  disabled = false,
  title,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [pos, setPos] = useState<MenuPosition | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const showSearch = searchable ?? options.length >= 12;

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value),
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const hay = `${o.label} ${o.subtitle ?? ''} ${o.group ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [options, query]);

  const groupedSections = useMemo(() => {
    const sections: { group: string | undefined; items: KobanSelectOption[] }[] = [];
    const indexByGroup = new Map<string, number>();
    for (const item of filteredOptions) {
      const key = item.group ?? '__default__';
      const existing = indexByGroup.get(key);
      if (existing !== undefined) {
        sections[existing].items.push(item);
      } else {
        indexByGroup.set(key, sections.length);
        sections.push({ group: item.group, items: [item] });
      }
    }
    return sections;
  }, [filteredOptions]);

  const computePosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = computeKobanSelectPosition(
      rect,
      window.innerWidth,
      window.innerHeight
    );
    if (!next) {
      setOpen(false);
      return;
    }
    setPos(next);
  };

  useEffect(() => {
    if (!open) return;
    computePosition();
    setQuery('');
    const currentIdx = Math.max(
      0,
      options.findIndex((o) => o.value === value && !o.disabled)
    );
    setActiveIndex(currentIdx);

    const raf = requestAnimationFrame(() => {
      if (showSearch) {
        searchRef.current?.focus();
      }
      const selectedEl = listRef.current?.querySelector<HTMLElement>(
        `[data-option-index="${currentIdx}"]`
      );
      selectedEl?.scrollIntoView({ block: 'nearest' });
    });

    const handleReposition = () => computePosition();
    const handleScroll = (e: Event) => {
      if (
        menuRef.current &&
        e.target instanceof Node &&
        menuRef.current.contains(e.target)
      ) {
        return;
      }
      computePosition();
    };
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };

    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (activeIndex >= filteredOptions.length) {
      setActiveIndex(Math.max(0, filteredOptions.length - 1));
    }
  }, [filteredOptions.length, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-option-index="${activeIndex}"]`
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const selectValue = (opt: KobanSelectOption | undefined) => {
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!disabled) setOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredOptions.length === 0) return;
      let next = activeIndex;
      for (let i = 0; i < filteredOptions.length; i++) {
        next = (next + 1) % filteredOptions.length;
        if (!filteredOptions[next]?.disabled) {
          setActiveIndex(next);
          break;
        }
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredOptions.length === 0) return;
      let prev = activeIndex;
      for (let i = 0; i < filteredOptions.length; i++) {
        prev = (prev - 1 + filteredOptions.length) % filteredOptions.length;
        if (!filteredOptions[prev]?.disabled) {
          setActiveIndex(prev);
          break;
        }
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      selectValue(filteredOptions[activeIndex]);
    }
  };

  const displayLabel = selectedOption?.label ?? placeholder;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title={title ?? selectedOption?.label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
        onKeyDown={handleKeyDown}
        className={`inline-flex items-center justify-between gap-2 text-left transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${SIZE_CLASSES[size]} ${TONE_CLASSES[tone]} ${className}`}
      >
        <span
          className={`truncate ${
            selectedOption ? '' : 'text-ink-3'
          }`}
        >
          {displayLabel}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 opacity-70 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            onKeyDown={handleKeyDown}
            style={{
              position: 'fixed',
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
            className={`z-[100] bg-surface border border-line rounded-xl shadow-[0_12px_32px_-8px_rgba(0,0,0,0.45)] text-ink overflow-hidden flex flex-col ${menuClassName}`}
          >
            {showSearch && (
              <div className="p-1.5 border-b border-line bg-app/50 flex items-center gap-1.5 shrink-0">
                <Search className="w-3.5 h-3.5 text-ink-3 ml-1.5 shrink-0" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIndex(0);
                  }}
                  placeholder={searchPlaceholder}
                  className="w-full h-7 bg-transparent text-xs text-ink placeholder:text-ink-3 focus:outline-none"
                />
              </div>
            )}

            <div
              ref={listRef}
              className="flex-1 min-h-0 overflow-y-auto py-1 divide-y divide-line/40"
            >
              {filteredOptions.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-ink-3">
                  No matching options
                </div>
              ) : (
                groupedSections.map((sec, sIdx) => (
                  <div key={sec.group ?? `sec-${sIdx}`} className="py-0.5">
                    {sec.group && (
                      <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-ink-3 font-semibold">
                        {sec.group}
                      </div>
                    )}
                    {sec.items.map((opt) => {
                      const flatIndex = filteredOptions.indexOf(opt);
                      const isSelected = opt.value === value;
                      const isActive = flatIndex === activeIndex;
                      return (
                        <button
                          key={`${opt.group ?? ''}:${opt.value}`}
                          type="button"
                          role="option"
                          data-option-index={flatIndex}
                          aria-selected={isSelected}
                          disabled={opt.disabled}
                          onMouseEnter={() => setActiveIndex(flatIndex)}
                          onClick={() => selectValue(opt)}
                          className={`w-full px-3 py-1.5 flex items-center justify-between gap-2 text-left text-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                            isSelected
                              ? 'bg-raised font-medium text-ink'
                              : isActive
                                ? 'bg-raised/70 text-ink'
                                : 'text-ink hover:bg-raised/60'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate">{opt.label}</div>
                            {opt.subtitle && (
                              <div className="text-[10px] text-ink-3 truncate">
                                {opt.subtitle}
                              </div>
                            )}
                          </div>
                          {isSelected && (
                            <Check className="w-3.5 h-3.5 text-accent shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
