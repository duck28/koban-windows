import React from 'react';
import kobanFullLight from '../assets/koban-full-light.png';
import kobanFullDark from '../assets/koban-full-dark.png';
import kobanMarkDark from '../assets/koban-mark-dark.png';
import kobanMarkWhite from '../assets/koban-mark-white.png';

interface LogoProps {
  /** Height in pixels */
  size?: number;
  /**
   * 'full' = Horizontal "K Koban" lockup (switches between light & dark mode)
   * 'mark' = Square "K" monogram mark (switches between light & dark mode)
   * 'app-icon' = White "K" monogram on dark rounded background
   */
  variant?: 'full' | 'mark' | 'app-icon';
  className?: string;
  title?: string;
}

export const Logo: React.FC<LogoProps> = ({
  size = 22,
  variant = 'full',
  className = '',
  title = 'Koban',
}) => {
  if (variant === 'app-icon') {
    const pad = Math.max(4, Math.round(size * 0.16));
    return (
      <span
        className={`inline-flex items-center justify-center rounded-xl bg-[#0d0d0d] border border-white/10 shadow-xs shrink-0 select-none ${className}`}
        style={{ width: size, height: size, padding: pad }}
        title={title}
      >
        <img
          src={kobanMarkWhite}
          alt={title}
          draggable={false}
          className="w-full h-full object-contain"
        />
      </span>
    );
  }

  if (variant === 'mark') {
    return (
      <span
        className={`inline-flex items-center justify-center shrink-0 select-none ${className}`}
        style={{ width: size, height: size }}
        title={title}
      >
        <img
          src={kobanMarkDark}
          alt={title}
          draggable={false}
          className="koban-logo-light w-full h-full object-contain"
        />
        <img
          src={kobanMarkWhite}
          alt={title}
          draggable={false}
          className="koban-logo-dark w-full h-full object-contain"
        />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center shrink-0 select-none ${className}`}
      style={{ height: size }}
      title={title}
    >
      <img
        src={kobanFullLight}
        alt={title}
        draggable={false}
        style={{ height: size, width: 'auto' }}
        className="koban-logo-light object-contain"
      />
      <img
        src={kobanFullDark}
        alt={title}
        draggable={false}
        style={{ height: size, width: 'auto' }}
        className="koban-logo-dark object-contain"
      />
    </span>
  );
};
