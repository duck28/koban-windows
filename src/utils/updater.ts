import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauriEnv } from './storage';
import { version as packageVersion } from '../../package.json';

export interface UpdateCheckResult {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_url: string;
  download_url?: string | null;
  release_name?: string | null;
  published_at?: string | null;
}

// The release workflow sets package.json's version from the git tag, so this always matches the build.
export const APP_VERSION: string = packageVersion;
export const GITHUB_RELEASES_URL =
  'https://github.com/duck28/koban-windows/releases';
const GITHUB_RELEASES_API =
  'https://api.github.com/repos/duck28/koban-windows/releases/latest';

function parseSemver(v: string): [number, number, number] | null {
  const cleaned = v.trim().replace(/^v/i, '');
  const parts = cleaned.split('.');
  if (parts.length < 3) return null;
  const major = Number.parseInt(parts[0], 10);
  const minor = Number.parseInt(parts[1], 10);
  const patchMatch = parts[2].match(/^\d+/);
  const patch = patchMatch ? Number.parseInt(patchMatch[0], 10) : Number.NaN;
  if ([major, minor, patch].some((n) => !Number.isFinite(n) || n < 0)) {
    return null;
  }
  return [major, minor, patch];
}

function isNewerVersion(current: string, latest: string): boolean {
  const c = parseSemver(current);
  const l = parseSemver(latest);
  if (!c || !l) return false;
  if (l[0] !== c[0]) return l[0] > c[0];
  if (l[1] !== c[1]) return l[1] > c[1];
  return l[2] > c[2];
}

export async function checkForAppUpdates(): Promise<UpdateCheckResult> {
  if (isTauriEnv()) {
    return invoke<UpdateCheckResult>('check_for_updates');
  }

  const res = await fetch(GITHUB_RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (res.status === 404) {
    return {
      current_version: APP_VERSION,
      latest_version: APP_VERSION,
      update_available: false,
      release_url: GITHUB_RELEASES_URL,
      download_url: null,
      release_name: null,
      published_at: null,
    };
  }
  if (!res.ok) {
    throw new Error(`GitHub Releases returned HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    tag_name?: string;
    html_url?: string;
    name?: string | null;
    published_at?: string | null;
    assets?: Array<{ name?: string; browser_download_url?: string }>;
  };
  const latestVersion = (data.tag_name ?? APP_VERSION)
    .trim()
    .replace(/^v/i, '');
  const assets = data.assets ?? [];
  const preferred =
    assets.find((a) => a.name?.toLowerCase().endsWith('-setup.exe')) ??
    assets.find((a) => a.name?.toLowerCase().endsWith('.exe')) ??
    assets.find((a) => a.name?.toLowerCase().endsWith('.msi'));

  return {
    current_version: APP_VERSION,
    latest_version: latestVersion,
    update_available: isNewerVersion(APP_VERSION, latestVersion),
    release_url: data.html_url || GITHUB_RELEASES_URL,
    download_url: preferred?.browser_download_url ?? null,
    release_name: data.name ?? null,
    published_at: data.published_at ?? null,
  };
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriEnv()) {
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
