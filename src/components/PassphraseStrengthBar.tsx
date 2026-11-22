import React from 'react';
import { Sparkles } from 'lucide-react';
import { useI18n } from '../i18n';
import {
  evaluatePassphraseStrength,
  generateStrongPassphrase,
} from '../utils/auth';

interface PassphraseStrengthBarProps {
  passphrase: string;
  onGenerate?: (generated: string) => void;
}

export const PassphraseStrengthBar: React.FC<PassphraseStrengthBarProps> = ({
  passphrase,
  onGenerate,
}) => {
  const { t } = useI18n();
  const info = evaluatePassphraseStrength(passphrase);

  const barColors: Record<0 | 1 | 2 | 3 | 4, string> = {
    0: 'bg-negative',
    1: 'bg-negative',
    2: 'bg-amber-500',
    3: 'bg-indigo',
    4: 'bg-positive',
  };

  const pct =
    info.length === 0 ? 0 : Math.min(100, Math.max(12, info.score * 25));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span
          className={
            info.meetsMinimum ? 'text-ink-2 font-medium' : 'text-negative font-medium'
          }
        >
          {t(info.labelKey as any)}
          {info.length > 0 ? ` · ~${info.estimatedBits} bits` : ''}
        </span>
        {onGenerate && (
          <button
            type="button"
            onClick={() => onGenerate(generateStrongPassphrase('passphrase'))}
            className="inline-flex items-center gap-1 text-indigo hover:underline cursor-pointer"
          >
            <Sparkles className="w-3 h-3" />
            <span>{t('vault.generatePassphrase')}</span>
          </button>
        )}
      </div>
      <div className="h-1.5 w-full rounded-full bg-raised overflow-hidden">
        <div
          className={`h-full transition-all duration-200 ${barColors[info.score]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};
