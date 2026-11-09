import { invoke } from '@tauri-apps/api/core';
import {
  BackupEntry,
  DbInfo,
  LedgerState,
  SaveResult,
  WebDavCheckResult,
  WebDavConfig,
  WebDavRemoteInfo,
  WebDavSyncResult,
} from '../types';

const LOCAL_STORAGE_KEY = 'koban_encrypted_vault_v1';

export function isTauriEnv(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function getDatabaseInfo(): Promise<DbInfo> {
  if (isTauriEnv()) {
    return invoke<DbInfo>('get_db_info');
  }
  const raw = localStorage.getItem(LOCAL_STORAGE_KEY) ?? '';
  return {
    db_path: 'Local Encrypted Storage (AES-256-GCM)',
    db_size: new Blob([raw]).size,
    last_modified: Math.floor(Date.now() / 1000),
    encrypted: true,
    cipher: 'AES-256-GCM',
    encrypted_records: raw ? 1 : 0,
    has_custom_passphrase: false,
    is_custom_location: false,
  };
}

export async function moveDatabaseLocation(targetFolder: string): Promise<DbInfo> {
  if (isTauriEnv()) {
    return invoke<DbInfo>('move_database_location', { targetFolder });
  }
  return getDatabaseInfo();
}

export async function resetDatabaseLocation(): Promise<DbInfo> {
  if (isTauriEnv()) {
    return invoke<DbInfo>('reset_database_location');
  }
  return getDatabaseInfo();
}

export async function testWebDavConnection(
  url: string,
  username: string,
  password: string
): Promise<string> {
  if (isTauriEnv()) {
    try {
      return await invoke<string>('test_webdav_connection', { url, username, password });
    } catch (err) {
      throw toError(err);
    }
  }
  throw new Error('WebDAV sync requires running Koban in desktop mode.');
}

export async function getWebDavRemoteInfo(
  url: string,
  username: string,
  password: string,
  filename?: string
): Promise<WebDavRemoteInfo> {
  if (isTauriEnv()) {
    return invoke<WebDavRemoteInfo>('get_webdav_remote_info', {
      url,
      username,
      password,
      filename: filename || null,
    });
  }
  return { exists: false };
}

/** Prefix of push errors caused by a remote change since this device's last sync. */
export const WEBDAV_CONFLICT_PREFIX = 'WEBDAV_CONFLICT:';

export function isWebDavConflictError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg.startsWith(WEBDAV_CONFLICT_PREFIX);
}

/** Strips the machine-readable conflict prefix for display. */
export function webDavErrorMessage(err: unknown, fallback = 'WebDAV request failed.'): string {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!msg) return fallback;
  return msg.startsWith(WEBDAV_CONFLICT_PREFIX)
    ? msg.slice(WEBDAV_CONFLICT_PREFIX.length).trim()
    : msg;
}

/** True when the config has everything needed for automatic WebDAV operations. */
export function isWebDavActive(cfg?: WebDavConfig | null): cfg is WebDavConfig {
  return Boolean(cfg && cfg.enabled && cfg.url?.trim() && cfg.username?.trim() && cfg.password);
}

export function isWebDavPrimary(cfg?: WebDavConfig | null): boolean {
  return isWebDavActive(cfg) && cfg.mode === 'primary';
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export async function pushToWebDav(
  url: string,
  username: string,
  password: string,
  filename?: string,
  options: { force?: boolean; preserveRemote?: boolean } = {}
): Promise<WebDavSyncResult> {
  if (isTauriEnv()) {
    try {
      return await invoke<WebDavSyncResult>('push_to_webdav', {
        url,
        username,
        password,
        filename: filename || null,
        force: options.force ?? true,
        preserveRemote: options.preserveRemote ?? false,
      });
    } catch (err) {
      throw toError(err);
    }
  }
  throw new Error('WebDAV sync requires running Koban in desktop mode.');
}

export async function pullFromWebDav(
  url: string,
  username: string,
  password: string,
  filename?: string
): Promise<WebDavSyncResult> {
  if (isTauriEnv()) {
    try {
      return await invoke<WebDavSyncResult>('pull_from_webdav', {
        url,
        username,
        password,
        filename: filename || null,
      });
    } catch (err) {
      throw toError(err);
    }
  }
  throw new Error('WebDAV sync requires running Koban in desktop mode.');
}

/** HEADs the remote file and compares it with this device's sync state. */
export async function checkWebDav(
  url: string,
  username: string,
  password: string,
  filename?: string
): Promise<WebDavCheckResult> {
  if (isTauriEnv()) {
    try {
      return await invoke<WebDavCheckResult>('webdav_check', {
        url,
        username,
        password,
        filename: filename || null,
      });
    } catch (err) {
      throw toError(err);
    }
  }
  throw new Error('WebDAV sync requires running Koban in desktop mode.');
}

/** New device: downloads the cloud vault into the active local DB path. */
export async function downloadVaultFromWebDav(
  url: string,
  username: string,
  password: string,
  filename?: string
): Promise<WebDavSyncResult> {
  if (isTauriEnv()) {
    try {
      return await invoke<WebDavSyncResult>('webdav_download_vault', {
        url,
        username,
        password,
        filename: filename || null,
      });
    } catch (err) {
      throw toError(err);
    }
  }
  throw new Error('Opening a vault from WebDAV requires running Koban in desktop mode.');
}

/** Marks the local DB as "never synced" after its content was replaced by an import. */
export async function forgetWebDavSyncState(): Promise<void> {
  if (isTauriEnv()) {
    await invoke('webdav_forget_sync_state');
  }
}

export async function updateVaultPassphrase(
  passphrase: string | null,
  currentState: LedgerState
): Promise<DbInfo> {
  if (isTauriEnv()) {
    return invoke<DbInfo>('set_vault_passphrase', {
      passphrase,
      currentStateJson: JSON.stringify(currentState),
    });
  }
  return getDatabaseInfo();
}

// ================= PER-DEVICE BACKUP FOLDER =================
// `settings.backupDir` lives inside the synced ledger, but a folder only makes sense on the device
// that chose it (a Mac path like `/Users/…` is meaningless on Windows and vice versa). Each device
// keeps its own folder here and overlays it on every ledger it loads.
const DEVICE_BACKUP_DIR_KEY = 'koban_device_backup_dir_v1';

/** True for a Windows folder path (`C:\…`, `C:/…` or a UNC share `\\server\…`). */
export function isLocalBackupPath(path: string | null | undefined): boolean {
  const p = (path ?? '').trim();
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

/** Remembers the backup folder chosen on this device ('' = none). */
export function rememberDeviceBackupDir(dir: string): void {
  try {
    localStorage.setItem(DEVICE_BACKUP_DIR_KEY, dir);
  } catch {
    // ignore storage errors
  }
}

/**
 * Replaces the ledger's backup folder with this device's own. On first use the ledger's folder is
 * adopted when it is a valid path here (otherwise none).
 */
export function applyDeviceBackupDir(state: LedgerState): LedgerState {
  if (!state.settings) return state;
  let dir: string | null = null;
  try {
    dir = localStorage.getItem(DEVICE_BACKUP_DIR_KEY);
  } catch {
    dir = null;
  }
  if (dir === null) {
    const fromLedger = state.settings.backupDir ?? '';
    dir = isLocalBackupPath(fromLedger) ? fromLedger : '';
    rememberDeviceBackupDir(dir);
  }
  if ((state.settings.backupDir ?? '') === dir) return state;
  return { ...state, settings: { ...state.settings, backupDir: dir } };
}

export async function loadLedgerFromDb(
  passphrase?: string
): Promise<LedgerState | null> {
  try {
    if (isTauriEnv()) {
      const jsonStr = await invoke<string | null>('load_ledger_db', {
        passphrase: passphrase ?? null,
      });
      if (jsonStr) {
        return JSON.parse(jsonStr) as LedgerState;
      }
    }
    const fallback = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (fallback) {
      const decoded = atob(fallback);
      return JSON.parse(decoded) as LedgerState;
    }
  } catch (err) {
    console.error('Failed to load encrypted ledger state:', err);
  }
  return null;
}

export async function saveLedgerToDb(state: LedgerState): Promise<SaveResult> {
  const jsonStr = JSON.stringify(state);
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, btoa(unescape(encodeURIComponent(jsonStr))));
    localStorage.removeItem('koban_state_v1');
    localStorage.removeItem('zenledger_state_v1');
  } catch {
    // ignore storage quota errors
  }

  if (isTauriEnv()) {
    const res = await invoke<SaveResult>('save_ledger_db', {
      stateJson: jsonStr,
      backupDir: state.settings.backupDir || null,
      autoBackup: state.settings.autoBackup,
      maxBackups: state.settings.maxBackups || 20,
    });

    // Backup mode: unchanged fire-and-forget overwrite after each save.
    // Primary mode is driven by the WebDAV sync engine (useWebDavSync) instead.
    const webdav = state.settings.webdav;
    if (isWebDavActive(webdav) && webdav.mode !== 'primary' && webdav.autoSync) {
      pushToWebDav(webdav.url, webdav.username, webdav.password!, webdav.remoteFileName, {
        force: true,
      }).catch((err) => {
        console.warn('Background WebDAV auto-sync failed:', err);
      });
    }

    return res;
  }

  return {
    db_path: 'Local Encrypted Storage',
    db_size: new Blob([jsonStr]).size,
    backup_path: null,
    timestamp: Math.floor(Date.now() / 1000),
    encrypted_records:
      state.groups.length +
      state.categories.length +
      state.transactions.length +
      1,
  };
}

export async function runManualBackup(
  backupDir: string,
  state: LedgerState
): Promise<SaveResult> {
  const jsonStr = JSON.stringify(state);
  if (isTauriEnv()) {
    return invoke<SaveResult>('trigger_manual_backup', {
      backupDir,
      stateJson: jsonStr,
      maxBackups: state.settings.maxBackups || 20,
    });
  }
  downloadBlobInBrowser(
    new Blob([jsonStr], { type: 'application/json' }),
    `koban-backup-${new Date().toISOString().slice(0, 10)}.json`
  );
  return {
    db_path: 'Browser Download',
    db_size: new Blob([jsonStr]).size,
    backup_path: `koban-backup-${new Date().toISOString().slice(0, 10)}.json`,
    timestamp: Math.floor(Date.now() / 1000),
  };
}

export async function listBackupFiles(backupDir: string): Promise<BackupEntry[]> {
  if (!backupDir) return [];
  if (isTauriEnv()) {
    return invoke<BackupEntry[]>('list_backups', { backupDir });
  }
  return [];
}

export async function restoreFromBackupFile(
  path: string,
  passphrase?: string,
  previewOnly = false
): Promise<LedgerState> {
  if (isTauriEnv()) {
    const jsonStr = await invoke<string>('restore_backup_file', {
      path,
      passphrase: passphrase ?? null,
      previewOnly,
    });
    const parsed = JSON.parse(jsonStr) as LedgerState;
    return parsed;
  }
  throw new Error('Restore by path requires Tauri desktop runtime.');
}

export async function pickFolderDialog(title?: string): Promise<string | null> {
  if (isTauriEnv()) {
    return invoke<string | null>('pick_folder', { title: title ?? null });
  }
  return null;
}

export async function pickSaveFileDialog(
  defaultName: string,
  filterName: string,
  extensions: string[]
): Promise<string | null> {
  if (isTauriEnv()) {
    return invoke<string | null>('pick_save_file', {
      defaultName,
      filterName,
      extensions,
    });
  }
  return defaultName;
}

export async function pickOpenFileDialog(
  filterName: string,
  extensions: string[]
): Promise<string | null> {
  if (isTauriEnv()) {
    return invoke<string | null>('pick_open_file', {
      filterName,
      extensions,
    });
  }
  return null;
}

export async function saveBinaryFile(
  path: string,
  bytes: Uint8Array
): Promise<void> {
  if (isTauriEnv()) {
    const base64Data = uint8ToBase64(bytes);
    await invoke('write_binary_file', { path, base64Data });
    return;
  }
  downloadBlobInBrowser(
    new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' }),
    path
  );
}

export async function saveTextFile(
  path: string,
  content: string,
  addBom = true
): Promise<void> {
  if (isTauriEnv()) {
    await invoke('write_text_file', { path, content, addBom });
    return;
  }
  const prefix = addBom ? '\uFEFF' : '';
  downloadBlobInBrowser(
    new Blob([prefix + content], { type: 'text/csv;charset=utf-8' }),
    path
  );
}

export async function exportSqliteDatabaseCopy(
  targetPath: string,
  fallbackState: LedgerState
): Promise<void> {
  if (isTauriEnv()) {
    await invoke('copy_db_file', { targetPath });
    return;
  }
  const jsonStr = JSON.stringify(fallbackState, null, 2);
  downloadBlobInBrowser(
    new Blob([jsonStr], { type: 'application/json' }),
    targetPath.replace(/\.db$/i, '.json')
  );
}

export async function revealPathInExplorer(path: string): Promise<void> {
  if (isTauriEnv() && path) {
    await invoke('reveal_in_explorer', { path });
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function downloadBlobInBrowser(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
