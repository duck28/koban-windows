import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { en, Dictionary, TranslationKey } from './locales/en';
import { de } from './locales/de';
import { hu } from './locales/hu';
import { fr } from './locales/fr';
import { es } from './locales/es';
import { it } from './locales/it';
import { pt } from './locales/pt';
import { nl } from './locales/nl';
import { pl } from './locales/pl';
import { cs } from './locales/cs';
import { sk } from './locales/sk';
import { ro } from './locales/ro';
import { bg } from './locales/bg';
import { hr } from './locales/hr';
import { sl } from './locales/sl';
import { el } from './locales/el';
import { sv } from './locales/sv';
import { da } from './locales/da';
import { nb } from './locales/nb';
import { fi } from './locales/fi';
import { tr } from './locales/tr';
import { ru } from './locales/ru';
import { uk } from './locales/uk';
import { ja } from './locales/ja';
import { zh } from './locales/zh';
import { zhTW } from './locales/zh-TW';
import { ko } from './locales/ko';
import { hi } from './locales/hi';
import { id } from './locales/id';
import { vi } from './locales/vi';
import { th } from './locales/th';
import type { AccountLiquidityClass, AccountType } from '../types';

export type { TranslationKey };

export interface LanguageInfo {
  code: string;
  /** Name written in the language itself */
  native: string;
  /** English name */
  english: string;
  /** BCP-47 locale used for Intl date formatting */
  intl: string;
  group: 'Europe' | 'Asia' | 'Default';
}

export const LANGUAGES: LanguageInfo[] = [
  { code: 'en', native: 'English', english: 'English', intl: 'en-GB', group: 'Default' },
  { code: 'de', native: 'Deutsch', english: 'German', intl: 'de-CH', group: 'Europe' },
  { code: 'hu', native: 'Magyar', english: 'Hungarian', intl: 'hu-HU', group: 'Europe' },
  { code: 'fr', native: 'Français', english: 'French', intl: 'fr-FR', group: 'Europe' },
  { code: 'es', native: 'Español', english: 'Spanish', intl: 'es-ES', group: 'Europe' },
  { code: 'it', native: 'Italiano', english: 'Italian', intl: 'it-IT', group: 'Europe' },
  { code: 'pt', native: 'Português', english: 'Portuguese', intl: 'pt-PT', group: 'Europe' },
  { code: 'nl', native: 'Nederlands', english: 'Dutch', intl: 'nl-NL', group: 'Europe' },
  { code: 'pl', native: 'Polski', english: 'Polish', intl: 'pl-PL', group: 'Europe' },
  { code: 'cs', native: 'Čeština', english: 'Czech', intl: 'cs-CZ', group: 'Europe' },
  { code: 'sk', native: 'Slovenčina', english: 'Slovak', intl: 'sk-SK', group: 'Europe' },
  { code: 'ro', native: 'Română', english: 'Romanian', intl: 'ro-RO', group: 'Europe' },
  { code: 'bg', native: 'Български', english: 'Bulgarian', intl: 'bg-BG', group: 'Europe' },
  { code: 'hr', native: 'Hrvatski', english: 'Croatian', intl: 'hr-HR', group: 'Europe' },
  { code: 'sl', native: 'Slovenščina', english: 'Slovenian', intl: 'sl-SI', group: 'Europe' },
  { code: 'el', native: 'Ελληνικά', english: 'Greek', intl: 'el-GR', group: 'Europe' },
  { code: 'sv', native: 'Svenska', english: 'Swedish', intl: 'sv-SE', group: 'Europe' },
  { code: 'da', native: 'Dansk', english: 'Danish', intl: 'da-DK', group: 'Europe' },
  { code: 'nb', native: 'Norsk bokmål', english: 'Norwegian', intl: 'nb-NO', group: 'Europe' },
  { code: 'fi', native: 'Suomi', english: 'Finnish', intl: 'fi-FI', group: 'Europe' },
  { code: 'tr', native: 'Türkçe', english: 'Turkish', intl: 'tr-TR', group: 'Europe' },
  { code: 'ru', native: 'Русский', english: 'Russian', intl: 'ru-RU', group: 'Europe' },
  { code: 'uk', native: 'Українська', english: 'Ukrainian', intl: 'uk-UA', group: 'Europe' },
  { code: 'ja', native: '日本語', english: 'Japanese', intl: 'ja-JP', group: 'Asia' },
  { code: 'zh', native: '简体中文', english: 'Chinese (Simplified)', intl: 'zh-CN', group: 'Asia' },
  { code: 'zh-TW', native: '繁體中文', english: 'Chinese (Traditional)', intl: 'zh-TW', group: 'Asia' },
  { code: 'ko', native: '한국어', english: 'Korean', intl: 'ko-KR', group: 'Asia' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi', intl: 'hi-IN', group: 'Asia' },
  { code: 'id', native: 'Bahasa Indonesia', english: 'Indonesian', intl: 'id-ID', group: 'Asia' },
  { code: 'vi', native: 'Tiếng Việt', english: 'Vietnamese', intl: 'vi-VN', group: 'Asia' },
  { code: 'th', native: 'ไทย', english: 'Thai', intl: 'th-TH', group: 'Asia' },
];

const DICTIONARIES: Record<string, Dictionary> = {
  en,
  de,
  hu,
  fr,
  es,
  it,
  pt,
  nl,
  pl,
  cs,
  sk,
  ro,
  bg,
  hr,
  sl,
  el,
  sv,
  da,
  nb,
  fi,
  tr,
  ru,
  uk,
  ja,
  zh,
  'zh-TW': zhTW,
  ko,
  hi,
  id,
  vi,
  th,
};

const STORAGE_KEY = 'koban_language_v1';

export function detectInitialLanguage(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && DICTIONARIES[saved]) return saved;
  } catch {
    // ignore
  }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  if (DICTIONARIES[nav]) return nav;
  if (/^zh[-_](TW|HK|MO|Hant)/i.test(nav)) return 'zh-TW';
  const base = nav.split(/[-_]/)[0].toLowerCase();
  if (base === 'no' || base === 'nn') return 'nb';
  return DICTIONARIES[base] ? base : 'en';
}

function buildLowerEnIndex(prefix: string): Map<string, TranslationKey> {
  const map = new Map<string, TranslationKey>();
  for (const key of Object.keys(en) as TranslationKey[]) {
    if (!key.startsWith(prefix)) continue;
    const lower = en[key].trim().toLowerCase();
    if (lower && !map.has(lower)) map.set(lower, key);
  }
  return map;
}

const GROUP_BY_LOWER_EN = buildLowerEnIndex('catGroup.');
const ITEM_BY_LOWER_EN = buildLowerEnIndex('catItem.');
const ACC_BY_LOWER_EN = buildLowerEnIndex('defaultAcc.');
const GOAL_BY_LOWER_EN = buildLowerEnIndex('defaultGoal.');

function formatTemplate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, k) =>
    k in vars ? String(vars[k]) : m,
  );
}

function resolveCatalogLabel(
  prefix: 'catGroup.' | 'catItem.' | 'defaultAcc.' | 'defaultGoal.',
  byLowerEn: Map<string, TranslationKey>,
  input: string | { id?: string; name: string },
  t: (key: TranslationKey) => string,
): string {
  const id = typeof input === 'string' ? undefined : input.id;
  const rawName = typeof input === 'string' ? input : input.name;
  const trimmed = rawName.trim();
  if (!trimmed) return rawName;
  if (id) {
    const byIdKey = `${prefix}${id}` as TranslationKey;
    if (byIdKey in en) {
      return trimmed.toLowerCase() === en[byIdKey].trim().toLowerCase()
        ? t(byIdKey)
        : rawName;
    }
  }
  const byEnKey = byLowerEn.get(trimmed.toLowerCase());
  return byEnKey ? t(byEnKey) : rawName;
}

interface I18nContextValue {
  language: string;
  setLanguage: (code: string) => void;
  t: (key: TranslationKey) => string;
  tf: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  intlLocale: string;
  tGroupName: (group: string | { id?: string; name: string }) => string;
  tCategoryName: (cat: string | { id?: string; name: string }) => string;
  tAccountName: (acc: string | { id?: string; name: string }) => string;
  tGoalName: (goal: string | { id?: string; name: string }) => string;
  tAccType: (type: AccountType | string) => string;
  tAccTypeShort: (type: AccountType | string) => string;
  tAccClass: (cls: AccountLiquidityClass | string) => string;
  tAccClassOpt: (cls: AccountLiquidityClass | string) => string;
  formatMonth: (month1To12: number, style?: 'long' | 'short') => string;
}

const defaultT = (key: TranslationKey) => en[key];

const I18nContext = createContext<I18nContextValue>({
  language: 'en',
  setLanguage: () => undefined,
  t: defaultT,
  tf: (key, vars) => formatTemplate(en[key], vars),
  intlLocale: 'en-GB',
  tGroupName: (g) => resolveCatalogLabel('catGroup.', GROUP_BY_LOWER_EN, g, defaultT),
  tCategoryName: (c) => resolveCatalogLabel('catItem.', ITEM_BY_LOWER_EN, c, defaultT),
  tAccountName: (a) => resolveCatalogLabel('defaultAcc.', ACC_BY_LOWER_EN, a, defaultT),
  tGoalName: (g) => resolveCatalogLabel('defaultGoal.', GOAL_BY_LOWER_EN, g, defaultT),
  tAccType: (tp) => {
    const k = `accType.${tp}` as TranslationKey;
    return k in en ? en[k] : tp;
  },
  tAccTypeShort: (tp) => {
    const k = `accTypeShort.${tp}` as TranslationKey;
    return k in en ? en[k] : tp;
  },
  tAccClass: (c) => {
    const k = `accClass.${c}` as TranslationKey;
    return k in en ? en[k] : c;
  },
  tAccClassOpt: (c) => {
    const k = `accClassOpt.${c}` as TranslationKey;
    return k in en ? en[k] : c;
  },
  formatMonth: (month1To12, style = 'long') =>
    new Intl.DateTimeFormat('en-GB', { month: style }).format(
      new Date(2024, Math.max(0, Math.min(11, month1To12 - 1)), 1),
    ),
});

export const I18nProvider: React.FC<{
  /** Language persisted in ledger settings (takes precedence once loaded) */
  preferred?: string;
  children: React.ReactNode;
}> = ({ preferred, children }) => {
  const [language, setLanguageState] = useState<string>(detectInitialLanguage);

  useEffect(() => {
    if (preferred && DICTIONARIES[preferred] && preferred !== language) {
      setLanguageState(preferred);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferred]);

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // ignore
    }
  }, [language]);

  const setLanguage = useCallback((code: string) => {
    if (DICTIONARIES[code]) setLanguageState(code);
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const dict = DICTIONARIES[language] ?? en;
    const intlLocale = LANGUAGES.find((l) => l.code === language)?.intl ?? 'en-GB';
    const t = (key: TranslationKey) => dict[key] ?? en[key];
    return {
      language,
      setLanguage,
      t,
      tf: (key, vars) => formatTemplate(t(key), vars),
      intlLocale,
      tGroupName: (g) => resolveCatalogLabel('catGroup.', GROUP_BY_LOWER_EN, g, t),
      tCategoryName: (c) => resolveCatalogLabel('catItem.', ITEM_BY_LOWER_EN, c, t),
      tAccountName: (a) => resolveCatalogLabel('defaultAcc.', ACC_BY_LOWER_EN, a, t),
      tGoalName: (g) => resolveCatalogLabel('defaultGoal.', GOAL_BY_LOWER_EN, g, t),
      tAccType: (tp) => {
        const k = `accType.${tp}` as TranslationKey;
        return k in en ? t(k) : tp;
      },
      tAccTypeShort: (tp) => {
        const k = `accTypeShort.${tp}` as TranslationKey;
        return k in en ? t(k) : tp;
      },
      tAccClass: (c) => {
        const k = `accClass.${c}` as TranslationKey;
        return k in en ? t(k) : c;
      },
      tAccClassOpt: (c) => {
        const k = `accClassOpt.${c}` as TranslationKey;
        return k in en ? t(k) : c;
      },
      formatMonth: (month1To12, style = 'long') =>
        new Intl.DateTimeFormat(intlLocale, { month: style }).format(
          new Date(2024, Math.max(0, Math.min(11, month1To12 - 1)), 1),
        ),
    };
  }, [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
