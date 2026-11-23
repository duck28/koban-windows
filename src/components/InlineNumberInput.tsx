import React from 'react';

/**
 * Number field with the Monthly Worksheet behaviour (blank when 0, saves on every
 * keystroke, no spinner) but always drawn as a box so it reads as editable.
 * Blank (placeholder "0") when the value is 0 so it can be cleared and retyped;
 * right-aligned tabular digits.
 */
interface InlineNumberInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'type'
  > {
  value: number;
  onValueChange: (value: number) => void;
  /** Round the displayed value to this many decimals (default 2). */
  decimals?: number;
  /** Clamp committed values into [min, max]. */
  clampMin?: number;
  clampMax?: number;
  /** Text alignment (default right). */
  align?: 'left' | 'center' | 'right';
  /** Text colour classes (default text-ink). */
  textClass?: string;
}

export const InlineNumberInput: React.FC<InlineNumberInputProps> = ({
  value,
  onValueChange,
  decimals = 2,
  clampMin,
  clampMax,
  align = 'right',
  textClass = 'text-ink',
  step = '0.05',
  placeholder = '0',
  className = '',
  ...rest
}) => {
  const factor = 10 ** decimals;
  const display =
    !Number.isFinite(value) || value === 0
      ? ''
      : Math.round(value * factor) / factor;

  return (
    <input
      {...rest}
      type="number"
      step={step}
      value={display}
      placeholder={placeholder}
      onChange={(e) => {
        let v = e.target.value === '' ? 0 : parseFloat(e.target.value);
        if (Number.isNaN(v)) v = 0;
        if (clampMin !== undefined) v = Math.max(clampMin, v);
        if (clampMax !== undefined) v = Math.min(clampMax, v);
        onValueChange(v);
      }}
      className={`no-spinner h-7 px-2 tabular-nums rounded bg-raised border border-line hover:border-ink-3 focus:border-ink-2 ${textClass} focus:outline-none transition-colors ${
        align === 'right'
          ? 'text-right'
          : align === 'center'
            ? 'text-center'
            : 'text-left'
      } ${className}`}
    />
  );
};
