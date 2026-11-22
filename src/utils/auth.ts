import { AuthSettings } from '../types';

export const MIN_VAULT_PASSPHRASE_LENGTH = 12;

export const DEFAULT_AUTH_SETTINGS: AuthSettings = {
  autoPromptDevice: true,
  autoLockMinutes: 15,
  lockOnMinimize: false,
};

export interface PassphraseStrength {
  length: number;
  estimatedBits: number;
  score: 0 | 1 | 2 | 3 | 4; // 0=too short, 1=weak, 2=fair, 3=good, 4=strong
  meetsMinimum: boolean;
  labelKey: string;
}

/**
 * Estimates passphrase entropy in bits (KeePassXC-inspired character-class + uniqueness model).
 * Always enforces a strict 12-character minimum for Vault Format v2 master passwords.
 */
export function evaluatePassphraseStrength(raw: string): PassphraseStrength {
  const value = raw ?? '';
  const chars = Array.from(value);
  const length = chars.length;

  let hasLower = false;
  let hasUpper = false;
  let hasDigit = false;
  let hasSymbol = false;
  let hasExtended = false;

  for (const ch of chars) {
    if (ch >= 'a' && ch <= 'z') hasLower = true;
    else if (ch >= 'A' && ch <= 'Z') hasUpper = true;
    else if (ch >= '0' && ch <= '9') hasDigit = true;
    else if (ch.charCodeAt(0) < 128) hasSymbol = true;
    else hasExtended = true;
  }

  let pool = 0;
  if (hasLower) pool += 26;
  if (hasUpper) pool += 26;
  if (hasDigit) pool += 10;
  if (hasSymbol) pool += 33;
  if (hasExtended) pool += 64;

  const uniqueRatio = length > 0 ? new Set(chars).size / length : 0;
  const effectiveBits =
    length === 0 || pool === 0
      ? 0
      : Math.round(length * Math.log2(pool) * Math.max(0.55, Math.min(1, uniqueRatio + 0.18)));

  const meetsMinimum = length >= MIN_VAULT_PASSPHRASE_LENGTH;

  let score: 0 | 1 | 2 | 3 | 4 = 0;
  if (!meetsMinimum) {
    score = 0;
  } else if (effectiveBits < 52) {
    score = 1;
  } else if (effectiveBits < 72) {
    score = 2;
  } else if (effectiveBits < 96) {
    score = 3;
  } else {
    score = 4;
  }

  const labelMap: Record<0 | 1 | 2 | 3 | 4, string> = {
    0: 'vault.strengthTooShort',
    1: 'vault.strengthWeak',
    2: 'vault.strengthFair',
    3: 'vault.strengthGood',
    4: 'vault.strengthStrong',
  };

  return {
    length,
    estimatedBits: effectiveBits,
    score,
    meetsMinimum,
    labelKey: labelMap[score],
  };
}

const PASSPHRASE_WORDS = [
  'amber', 'anchor', 'apricot', 'atlas', 'autumn', 'bamboo', 'beacon', 'breeze',
  'canyon', 'cedar', 'cinder', 'cobalt', 'compass', 'copper', 'coral', 'cosmos',
  'crimson', 'crystal', 'cypress', 'dawn', 'delta', 'dolphin', 'dune', 'echo',
  'eclipse', 'emerald', 'falcon', 'fathom', 'feather', 'flint', 'forest', 'fossil',
  'frost', 'galaxy', 'garnet', 'glacier', 'granite', 'harbor', 'hazel', 'horizon',
  'indigo', 'island', 'ivory', 'jasper', 'juniper', 'kestrel', 'lagoon', 'lantern',
  'larch', 'laurel', 'linen', 'lotus', 'lunar', 'maple', 'marble', 'meadow',
  'mercury', 'mesa', 'monarch', 'mosaic', 'nebula', 'nectar', 'nickel', 'nimbus',
  'north', 'oak', 'obsidian', 'ochre', 'olive', 'onyx', 'opal', 'orbit',
  'orchid', 'osprey', 'pebble', 'pelican', 'petal', 'pine', 'planet', 'platinum',
  'plume', 'polar', 'prairie', 'prism', 'quartz', 'quill', 'raven', 'redwood',
  'ridge', 'ripple', 'river', 'saffron', 'sapphire', 'sequoia', 'shadow', 'sierra',
  'signal', 'silver', 'solstice', 'spruce', 'starlight', 'stone', 'summit', 'sunlit',
  'tamarind', 'terra', 'thistle', 'timber', 'topaz', 'torrent', 'tundra', 'umber',
  'valley', 'velvet', 'vermilion', 'vesper', 'violet', 'walnut', 'whisper', 'willow',
  'winter', 'wren', 'zenith', 'zephyr',
] as const;

function randomUnbiasedIndex(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) {
      return buf[0] % maxExclusive;
    }
  }
}

/**
 * Generates a high-entropy passphrase using WebCrypto CSPRNG with rejection sampling.
 */
export function generateStrongPassphrase(mode: 'passphrase' | 'password' = 'passphrase'): string {
  if (mode === 'password') {
    const alphabet =
      'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+';
    const out: string[] = [];
    for (let i = 0; i < 24; i += 1) {
      out.push(alphabet[randomUnbiasedIndex(alphabet.length)]);
    }
    return out.join('');
  }

  const words: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    words.push(PASSPHRASE_WORDS[randomUnbiasedIndex(PASSPHRASE_WORDS.length)]);
  }
  const num = 10 + randomUnbiasedIndex(90);
  return `${words.join('-')}-${num}`;
}

/**
 * Normalizes a Crockford Base32 recovery key input (strips hyphens/spaces, uppercases,
 * maps O->0 and I/L->1) and formats into readable 4-character hyphen groups.
 */
export function normalizeRecoveryKeyInput(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export function formatRecoveryKeyGrouped(rawOrNorm: string): string {
  const clean = normalizeRecoveryKeyInput(rawOrNorm);
  const groups: string[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    groups.push(clean.slice(i, i + 4));
  }
  return groups.join('-');
}

/**
 * Removes legacy v1 client-side auth entries from localStorage so no stale auth metadata persists.
 */
export function clearLegacyLocalAuthCache(): void {
  try {
    localStorage.removeItem('koban_auth_config');
    localStorage.removeItem('koban_auth_session_unlocked');
  } catch {
    // ignore storage access issues
  }
}
