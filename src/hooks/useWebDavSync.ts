import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { WebDavCheckResult, WebDavConfig, WebDavMode, WebDavSyncResult } from '../types';
import {
  checkWebDav,
  isTauriEnv,
  isWebDavConflictError,
  isWebDavPrimary,
  pullFromWebDav,
  pushToWebDav,
  webDavErrorMessage,
} from '../utils/storage';

/**
 * WebDAV "primary storage" sync engine (see WEBDAV-SPEC §4).
 *
 * - sync-now on startup / when switching to primary, every 5 minutes and on window focus
 * - debounced push (If-Match) 2 s after every successful local save
 * - never two operations at once (one queued follow-up at most)
 * - no automatic operations while the conflict dialog is open or sync is paused
 *
 * Live status is kept in memory: persisting it into the (synced) ledger would itself be a
 * local change that triggers another upload. Manual card actions still record
 * lastSyncAt / lastSyncStatus / lastSyncMessage in the ledger as before.
 */

export type WebDavSyncPhase = 'idle' | 'syncing' | 'synced' | 'offline' | 'paused' | 'error';

export interface WebDavSyncStatus {
  phase: WebDavSyncPhase;
  message: string;
  /** unix secs of the last successful sync */
  at?: number;
}

export interface WebDavConflictInfo {
  firstLink: boolean;
  remoteLastModified?: string | null;
  /** unix secs */
  localModified?: number | null;
}

export type WebDavConflictChoice = 'cloud' | 'local' | 'later' | 'cancel';

export interface WebDavSyncController {
  isPrimary: boolean;
  status: WebDavSyncStatus;
  conflict: WebDavConflictInfo | null;
  isPaused: boolean;
  isResolving: boolean;
  /** Manual "Sync now" (also clears a paused state). */
  syncNow: () => Promise<void>;
  /** Called by the app after every successful local save. */
  notifyLocalSave: () => void;
  /** Re-opens the conflict dialog while paused. */
  openConflictDialog: () => void;
  resolveConflict: (choice: WebDavConflictChoice) => Promise<void>;
  /** Forget that this device is linked to the target (local DB content was replaced). */
  resetLink: () => void;
  /** Manual push / pull from the card, serialized with automatic operations. */
  manualPush: (cfg: WebDavConfig) => Promise<WebDavSyncResult>;
  manualPull: (cfg: WebDavConfig) => Promise<WebDavSyncResult>;
}

export const OFFLINE_MESSAGE =
  'Offline — working from the local cache. Changes will sync when the server is reachable.';
export const PAUSED_MESSAGE = 'Sync paused — the cloud vault and this device both changed.';

const PERIODIC_MS = 5 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 2000;
const FOCUS_THROTTLE_MS = 20 * 1000;

interface Options {
  config?: WebDavConfig;
  /** Ledger is loaded from the local DB and saves are allowed. */
  ready: boolean;
  /** Persists pending in-memory changes; resolves true when a save happened. */
  flushSave: () => Promise<boolean>;
  /** Runs fn while automatic saves are suspended (DB file is being replaced). */
  withSavesSuspended: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Reloads the ledger from the local DB, keeping this device's WebDAV settings. */
  reloadFromDb: () => Promise<boolean>;
  notify: (message: string) => void;
  setMode: (mode: WebDavMode) => void;
}

function targetKey(cfg?: WebDavConfig): string {
  if (!isWebDavPrimary(cfg) || !cfg) return '';
  return [cfg.url.trim(), (cfg.remoteFileName || '').trim(), cfg.username.trim(), cfg.password].join(
    '\u0000'
  );
}

function isOfflineError(msg: string): boolean {
  return /transport error|connection error|unavailable|timed out|timeout|dns|network/i.test(msg);
}

function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

export function useWebDavSync(opts: Options): WebDavSyncController {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const key = targetKey(opts.config);
  const isPrimary = key !== '';

  const [status, setStatusState] = useState<WebDavSyncStatus>(() => ({
    phase: 'idle',
    message: '',
    at: opts.config?.lastSyncAt,
  }));
  const [conflict, setConflict] = useState<WebDavConflictInfo | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isResolving, setIsResolving] = useState(false);

  const statusRef = useRef(status);
  const conflictRef = useRef<WebDavConflictInfo | null>(null);
  const lastConflictRef = useRef<WebDavConflictInfo | null>(null);
  const pausedRef = useRef(false);
  const keyRef = useRef(key);
  keyRef.current = key;
  /** Target key this device has successfully synced with during this session. */
  const linkedKeyRef = useRef<string>('');

  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingAutoRef = useRef<'sync' | 'push' | null>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const lastAutoSyncRef = useRef(0);

  const setStatus = useCallback((next: WebDavSyncStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const setSynced = useCallback(
    (message = 'Synced') => setStatus({ phase: 'synced', message, at: nowSecs() }),
    [setStatus]
  );

  const showConflict = useCallback((info: WebDavConflictInfo) => {
    conflictRef.current = info;
    lastConflictRef.current = info;
    setConflict(info);
  }, []);

  const closeConflict = useCallback(() => {
    conflictRef.current = null;
    setConflict(null);
  }, []);

  const setPaused = useCallback((paused: boolean) => {
    pausedRef.current = paused;
    setIsPaused(paused);
  }, []);

  /** Async mutex: never run two WebDAV operations concurrently. */
  const exclusive = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const prev = chainRef.current;
    let release: () => void = () => {};
    chainRef.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    return prev.then(fn).finally(() => release());
  }, []);

  const canAuto = () =>
    isTauriEnv() &&
    optsRef.current.ready &&
    keyRef.current !== '' &&
    !conflictRef.current &&
    !pausedRef.current;

  const currentConfig = (): WebDavConfig | null => {
    const cfg = optsRef.current.config;
    return isWebDavPrimary(cfg) && cfg ? cfg : null;
  };

  const markFailure = useCallback(
    (msg: string) => {
      if (isOfflineError(msg)) {
        setStatus({ phase: 'offline', message: OFFLINE_MESSAGE, at: statusRef.current.at });
      } else {
        setStatus({ phase: 'error', message: msg, at: statusRef.current.at });
      }
    },
    [setStatus]
  );

  const conflictFromCheck = (res: WebDavCheckResult | null, firstLink = false): WebDavConflictInfo => ({
    firstLink: res ? res.firstLink : firstLink,
    remoteLastModified: res?.remoteLastModified ?? null,
    localModified: res?.localModified ?? null,
  });

  /** Pull + reload; must run inside `exclusive`. */
  const pullAndReload = async (cfg: WebDavConfig): Promise<WebDavSyncResult> => {
    const o = optsRef.current;
    const res = await o.withSavesSuspended(async () => {
      const pulled = await pullFromWebDav(cfg.url, cfg.username, cfg.password!, cfg.remoteFileName);
      if (!(await o.reloadFromDb())) {
        throw new Error(
          'The downloaded vault could not be opened with the current passphrase. Unlock it to continue.'
        );
      }
      return pulled;
    });
    linkedKeyRef.current = targetKey(cfg);
    return res;
  };

  /** Push with optimistic concurrency; must run inside `exclusive`. */
  const pushChecked = async (cfg: WebDavConfig): Promise<void> => {
    try {
      await pushToWebDav(cfg.url, cfg.username, cfg.password!, cfg.remoteFileName, { force: false });
      linkedKeyRef.current = targetKey(cfg);
      setSynced();
    } catch (err) {
      if (isWebDavConflictError(err)) {
        let info: WebDavCheckResult | null = null;
        try {
          info = await checkWebDav(cfg.url, cfg.username, cfg.password!, cfg.remoteFileName);
        } catch {
          info = null;
        }
        setStatus({ phase: 'paused', message: PAUSED_MESSAGE, at: statusRef.current.at });
        showConflict(conflictFromCheck(info));
      } else {
        markFailure(webDavErrorMessage(err));
      }
    }
  };

  /** sync-now (§4.1); must run inside `exclusive`. */
  const doSyncNow = async (): Promise<void> => {
    const cfg = currentConfig();
    if (!cfg) return;
    const o = optsRef.current;
    lastAutoSyncRef.current = Date.now();
    setStatus({ phase: 'syncing', message: 'Syncing…', at: statusRef.current.at });
    try {
      await o.flushSave();
      let res = await checkWebDav(cfg.url, cfg.username, cfg.password!, cfg.remoteFileName);

      if (res.status === 'remote_ahead') {
        // Make sure nothing unsaved is pending before replacing the local file.
        const saved = await o.flushSave();
        if (saved) {
          res = await checkWebDav(cfg.url, cfg.username, cfg.password!, cfg.remoteFileName);
        }
      }

      switch (res.status) {
        case 'remote_missing':
          await pushToWebDav(cfg.url, cfg.username, cfg.password!, cfg.remoteFileName, {
            force: true,
          });
          linkedKeyRef.current = targetKey(cfg);
          setSynced();
          o.notify('Cloud vault initialized on WebDAV.');
          break;
        case 'local_ahead':
          await pushChecked(cfg);
          break;
        case 'remote_ahead':
          await pullAndReload(cfg);
          setSynced();
          o.notify('Loaded the latest vault from WebDAV.');
          break;
        case 'conflict':
          setStatus({ phase: 'paused', message: PAUSED_MESSAGE, at: statusRef.current.at });
          showConflict(conflictFromCheck(res));
          break;
        case 'offline':
          setStatus({ phase: 'offline', message: OFFLINE_MESSAGE, at: statusRef.current.at });
          break;
        case 'error':
          setStatus({ phase: 'error', message: res.message, at: statusRef.current.at });
          break;
        case 'in_sync':
        default:
          linkedKeyRef.current = targetKey(cfg);
          setSynced();
          break;
      }
    } catch (err) {
      markFailure(webDavErrorMessage(err, 'WebDAV sync failed.'));
    }
  };

  /** Automatic debounced push after a local save (§4.2); must run inside `exclusive`. */
  const doAutoPush = async (): Promise<void> => {
    const cfg = currentConfig();
    if (!cfg) return;
    // Only push blindly-with-If-Match once this device is known to be linked to the target;
    // otherwise go through sync-now so a first link never overwrites an existing vault.
    if (linkedKeyRef.current !== targetKey(cfg)) {
      await doSyncNow();
      return;
    }
    setStatus({ phase: 'syncing', message: 'Syncing…', at: statusRef.current.at });
    await pushChecked(cfg);
  };

  const requestAuto = (task: 'sync' | 'push') => {
    if (!canAuto()) return;
    if (pendingAutoRef.current) {
      // At most one queued follow-up; a sync supersedes a push.
      if (task === 'sync') pendingAutoRef.current = 'sync';
      return;
    }
    pendingAutoRef.current = task;
    void exclusive(async () => {
      const next = pendingAutoRef.current;
      pendingAutoRef.current = null;
      if (!next || !canAuto()) return;
      if (next === 'sync') await doSyncNow();
      else await doAutoPush();
    });
  };

  // Startup / switching to primary / target change → sync-now.
  useEffect(() => {
    linkedKeyRef.current = linkedKeyRef.current === key ? key : '';
    if (!key) {
      closeConflict();
      setPaused(false);
      setStatus({ phase: 'idle', message: '', at: statusRef.current.at });
      return;
    }
    if (!opts.ready) return;
    setPaused(false);
    closeConflict();
    requestAuto('sync');
  }, [key, opts.ready]);

  // Periodic sync + on focus.
  useEffect(() => {
    if (!key || !opts.ready) return;
    const interval = window.setInterval(() => requestAuto('sync'), PERIODIC_MS);
    const onFocus = () => {
      if (Date.now() - lastAutoSyncRef.current < FOCUS_THROTTLE_MS) return;
      requestAuto('sync');
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [key, opts.ready]);

  useEffect(() => () => window.clearTimeout(saveTimerRef.current), []);

  const notifyLocalSave = useCallback(() => {
    if (!keyRef.current) return;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => requestAuto('push'), SAVE_DEBOUNCE_MS);
  }, []);

  const syncNow = useCallback(async () => {
    if (!currentConfig()) return;
    setPaused(false);
    closeConflict();
    await exclusive(doSyncNow);
  }, []);

  const openConflictDialog = useCallback(() => {
    showConflict(lastConflictRef.current ?? { firstLink: false });
  }, [showConflict]);

  const resolveConflict = useCallback(
    async (choice: WebDavConflictChoice) => {
      const o = optsRef.current;
      if (choice === 'later') {
        closeConflict();
        setPaused(true);
        setStatus({ phase: 'paused', message: PAUSED_MESSAGE, at: statusRef.current.at });
        return;
      }
      if (choice === 'cancel') {
        closeConflict();
        setPaused(false);
        o.setMode('backup');
        return;
      }
      const cfg = currentConfig();
      if (!cfg) {
        closeConflict();
        return;
      }
      setIsResolving(true);
      try {
        await exclusive(async () => {
          setStatus({ phase: 'syncing', message: 'Syncing…', at: statusRef.current.at });
          if (choice === 'cloud') {
            await pullAndReload(cfg);
            setSynced();
            o.notify('Loaded the cloud version of the vault. This device’s copy was kept as a backup file.');
          } else {
            await o.flushSave();
            const res = await pushToWebDav(cfg.url, cfg.username, cfg.password!, cfg.remoteFileName, {
              force: true,
              preserveRemote: true,
            });
            linkedKeyRef.current = targetKey(cfg);
            setSynced();
            o.notify(res.message);
          }
        });
        closeConflict();
        setPaused(false);
      } catch (err) {
        markFailure(webDavErrorMessage(err, 'Could not resolve the WebDAV conflict.'));
        // Keep the dialog open so the user can retry or decide later.
      } finally {
        setIsResolving(false);
      }
      },
    []
  );

  const resetLink = useCallback(() => {
    linkedKeyRef.current = '';
  }, []);

  const manualPush = useCallback(
    (cfg: WebDavConfig) =>
      exclusive(async () => {
        const primary = isWebDavPrimary(cfg);
        if (primary) await optsRef.current.flushSave();
        try {
          const res = await pushToWebDav(cfg.url, cfg.username, cfg.password || '', cfg.remoteFileName, {
            // Backup mode keeps today's unconditional overwrite.
            force: !primary,
          });
          if (primary) {
            linkedKeyRef.current = targetKey(cfg);
            setSynced();
          }
          return res;
        } catch (err) {
          if (primary && isWebDavConflictError(err)) {
            let info: WebDavCheckResult | null = null;
            try {
              info = await checkWebDav(cfg.url, cfg.username, cfg.password || '', cfg.remoteFileName);
            } catch {
              info = null;
            }
            setStatus({ phase: 'paused', message: PAUSED_MESSAGE, at: statusRef.current.at });
            showConflict(conflictFromCheck(info));
          }
          throw err;
        }
      }),
    []
  );

  const manualPull = useCallback(
    (cfg: WebDavConfig) =>
      exclusive(async () => {
        const res = await pullAndReload(cfg);
        if (isWebDavPrimary(cfg)) {
          setPaused(false);
          closeConflict();
          setSynced();
        }
        return res;
      }),
    []
  );

  return {
    isPrimary,
    status,
    conflict,
    isPaused,
    isResolving,
    syncNow,
    notifyLocalSave,
    openConflictDialog,
    resolveConflict,
    resetLink,
    manualPush,
    manualPull,
  };
}

export const WebDavSyncContext = createContext<WebDavSyncController | null>(null);

export function useWebDavSyncController(): WebDavSyncController | null {
  return useContext(WebDavSyncContext);
}

