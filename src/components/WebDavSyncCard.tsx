import React, { useEffect, useState } from 'react';
import {
  Cloud,
  CloudOff,
  HardDriveUpload,
  Database,
  PauseCircle,
  CloudUpload,
  CloudDownload,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Eye,
  EyeOff,
  Server,
  Lock,
  Loader2,
  Info,
} from 'lucide-react';
import { AppSettings, WebDavConfig, WebDavMode } from '../types';
import {
  isWebDavActive,
  pullFromWebDav,
  pushToWebDav,
  testWebDavConnection,
  webDavErrorMessage,
} from '../utils/storage';
import { useWebDavSyncController } from '../hooks/useWebDavSync';
import { useI18n } from '../i18n';

type DraftFields = Pick<WebDavConfig, 'url' | 'username' | 'password' | 'remoteFileName'>;

interface WebDavSyncCardProps {
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onStateReloaded?: () => Promise<void>;
  className?: string;
}

export const WebDavSyncCard: React.FC<WebDavSyncCardProps> = ({
  settings,
  onUpdateSettings,
  onStateReloaded,
  className = '',
}) => {
  const { t, intlLocale } = useI18n();
  const modeOptions: { id: WebDavMode; label: string; icon: typeof Cloud; description: string }[] = [
    {
      id: 'backup',
      label: t('webdav.modeBackup'),
      icon: HardDriveUpload,
      description: t('webdav.modeBackupDesc'),
    },
    {
      id: 'primary',
      label: t('webdav.modePrimary'),
      icon: Database,
      description: t('webdav.modePrimaryDesc'),
    },
  ];
  const sync = useWebDavSyncController();
  const form: WebDavConfig = settings.webdav || {
    enabled: false,
    url: '',
    username: '',
    password: '',
    remoteFileName: 'koban-vault.db',
    autoSync: false,
  };
  const mode: WebDavMode = form.mode === 'primary' ? 'primary' : 'backup';
  const isPrimaryMode = mode === 'primary';

  // Connection fields are edited as a draft and committed on blur, so a half-typed URL
  // never becomes the sync target of an active primary-storage vault.
  const toDraft = (cfg: WebDavConfig): DraftFields => ({
    url: cfg.url || '',
    username: cfg.username || '',
    password: cfg.password || '',
    remoteFileName: cfg.remoteFileName || 'koban-vault.db',
  });
  const [draft, setDraft] = useState<DraftFields>(() => toDraft(form));
  useEffect(() => {
    setDraft(toDraft(form));
  }, [form.url, form.username, form.password, form.remoteFileName]);

  const [showPassword, setShowPassword] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);
  const [showConfirmPull, setShowConfirmPull] = useState(false);

  /** Effective config including uncommitted draft edits. */
  const effective = (): WebDavConfig => ({ ...form, ...draft });

  const updateConfig = (patch: Partial<WebDavConfig>) => {
    onUpdateSettings({ webdav: { ...effective(), ...patch } });
  };

  const commitDraft = () => {
    const current = toDraft(form);
    if (
      current.url !== draft.url ||
      current.username !== draft.username ||
      current.password !== draft.password ||
      current.remoteFileName !== draft.remoteFileName
    ) {
      onUpdateSettings({ webdav: effective() });
    }
  };

  const handleModeChange = (next: WebDavMode) => {
    if (next === mode) return;
    setFeedback(null);
    updateConfig(next === 'primary' ? { mode: 'primary', autoSync: true } : { mode: 'backup' });
  };

  const handleTestConnection = async () => {
    const cfg = effective();
    if (!cfg.url.trim() || !cfg.username.trim() || !cfg.password) {
      setFeedback({
        type: 'error',
        text: t('webdav.errEnterCreds'),
      });
      return;
    }

    setIsTesting(true);
    setFeedback(null);
    try {
      const msg = await testWebDavConnection(cfg.url, cfg.username, cfg.password!);
      setFeedback({ type: 'success', text: msg });
      updateConfig({ lastSyncStatus: 'success', lastSyncMessage: msg });
    } catch (err) {
      const msg = webDavErrorMessage(err, 'WebDAV connection failed.');
      setFeedback({ type: 'error', text: msg });
      updateConfig({ lastSyncStatus: 'error', lastSyncMessage: msg });
    } finally {
      setIsTesting(false);
    }
  };

  const handlePush = async () => {
    const cfg = effective();
    if (!cfg.url.trim() || !cfg.username.trim() || !cfg.password) {
      setFeedback({
        type: 'error',
        text: t('webdav.errCompleteCreds'),
      });
      return;
    }

    commitDraft();
    setIsPushing(true);
    setFeedback(null);
    try {
      const res = sync
        ? await sync.manualPush(cfg)
        : await pushToWebDav(cfg.url, cfg.username, cfg.password!, cfg.remoteFileName, {
            force: true,
          });
      setFeedback({ type: 'success', text: res.message });
      updateConfig({
        lastSyncAt: res.timestamp,
        lastSyncStatus: 'success',
        lastSyncMessage: res.message,
      });
    } catch (err) {
      const msg = webDavErrorMessage(err, 'Failed to push to WebDAV.');
      setFeedback({ type: 'error', text: msg });
      updateConfig({
        lastSyncStatus: 'error',
        lastSyncMessage: msg,
      });
    } finally {
      setIsPushing(false);
    }
  };

  const handleExecutePull = async () => {
    const cfg = effective();
    if (!cfg.url.trim() || !cfg.username.trim() || !cfg.password) {
      setFeedback({
        type: 'error',
        text: t('webdav.errCompleteCreds'),
      });
      return;
    }

    commitDraft();
    setIsPulling(true);
    setShowConfirmPull(false);
    setFeedback(null);
    try {
      let res;
      if (sync) {
        // Pulls and reloads the ledger (keeping this device's WebDAV settings).
        res = await sync.manualPull(cfg);
      } else {
        res = await pullFromWebDav(cfg.url, cfg.username, cfg.password!, cfg.remoteFileName);
        await onStateReloaded?.();
      }
      setFeedback({ type: 'success', text: res.message });
      updateConfig({
        lastSyncAt: res.timestamp,
        lastSyncStatus: 'success',
        lastSyncMessage: res.message,
      });
    } catch (err) {
      const msg = webDavErrorMessage(err, 'Failed to download from WebDAV.');
      setFeedback({ type: 'error', text: msg });
      updateConfig({
        lastSyncStatus: 'error',
        lastSyncMessage: msg,
      });
    } finally {
      setIsPulling(false);
    }
  };

  const formatLastSync = (secs?: number) => {
    if (!secs) return t('webdav.never');
    return new Date(secs * 1000).toLocaleString(intlLocale);
  };

  return (
    <section className={`p-5 rounded-xl bg-surface border border-line space-y-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-line">
        <div className="flex items-center gap-2.5">
          <Cloud className="w-5 h-5 text-indigo shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-ink">
                {t('webdav.title')}
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-raised text-ink-2 border border-line">
                Nextcloud · ownCloud · NAS · mailbox.org
              </span>
            </div>
            <p className="text-xs text-ink-2 mt-0.5">
              {t('webdav.desc')}
            </p>
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-ink font-medium cursor-pointer">
          <span>{t('webdav.enableToggle')}</span>
          <input
            type="checkbox"
            checked={Boolean(form.enabled)}
            onChange={(e) => updateConfig({ enabled: e.target.checked })}
            className="w-4 h-4 rounded border-line text-accent cursor-pointer accent-accent"
          />
        </label>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-lg border flex items-center gap-2 text-xs ${
            feedback.type === 'success'
              ? 'bg-positive/10 border-positive/20 text-positive'
              : feedback.type === 'error'
              ? 'bg-negative/10 border-negative/20 text-negative'
              : 'bg-indigo/10 border-indigo/20 text-indigo'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : feedback.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          ) : (
            <Info className="w-4 h-4 shrink-0" />
          )}
          <span className="flex-1 break-all">{feedback.text}</span>
        </div>
      )}

      {/* Configuration Form */}
      <div className={`space-y-3 transition-opacity ${form.enabled ? 'opacity-100' : 'opacity-60'}`}>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Server URL */}
          <div className="md:col-span-8">
            <label className="block text-[11px] text-ink-2 mb-1">
              {t('webdav.urlLabel')}
            </label>
            <div className="relative">
              <Server className="w-3.5 h-3.5 text-ink-3 absolute left-3 top-3" />
              <input
                type="url"
                value={draft.url}
                onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
                onBlur={commitDraft}
                placeholder="https://nextcloud.example.com/remote.php/dav/files/myuser/Koban/"
                className="w-full h-9 pl-8 pr-3 rounded-lg bg-app border border-line text-xs text-ink focus:outline-none"
              />
            </div>
            <span className="text-[10px] text-ink-3 mt-0.5 block">
              {t('webdav.urlTipPrefix')}<code className="text-ink-2">/Koban/</code>{t('webdav.urlTipSuffix')}
            </span>
          </div>

          {/* Remote Filename */}
          <div className="md:col-span-4">
            <label className="block text-[11px] text-ink-2 mb-1">
              {t('webdav.filenameLabel')}
            </label>
            <input
              type="text"
              value={draft.remoteFileName}
              onChange={(e) => setDraft((d) => ({ ...d, remoteFileName: e.target.value }))}
              onBlur={commitDraft}
              placeholder="koban-vault.db"
              className="w-full h-9 px-3 rounded-lg bg-app border border-line text-xs text-ink font-mono focus:outline-none"
            />
          </div>

          {/* Username */}
          <div className="md:col-span-6">
            <label className="block text-[11px] text-ink-2 mb-1">
              {t('webdav.usernameLabel')}
            </label>
            <input
              type="text"
              value={draft.username}
              onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))}
              onBlur={commitDraft}
              placeholder={t('webdav.usernamePlaceholder')}
              className="w-full h-9 px-3 rounded-lg bg-app border border-line text-xs text-ink focus:outline-none"
            />
          </div>

          {/* Password / App Token */}
          <div className="md:col-span-6">
            <label className="block text-[11px] text-ink-2 mb-1">
              {t('webdav.passwordLabel')}
            </label>
            <div className="relative">
              <Lock className="w-3.5 h-3.5 text-ink-3 absolute left-3 top-3" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={draft.password || ''}
                onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
                onBlur={commitDraft}
                placeholder={t('webdav.passwordPlaceholder')}
                className="w-full h-9 pl-8 pr-9 rounded-lg bg-app border border-line text-xs text-ink focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-2.5 text-ink-3 hover:text-ink cursor-pointer"
                title={showPassword ? t('webdav.passwordHideTip') : t('webdav.passwordShowTip')}
              >
                {showPassword ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            <span className="text-[10px] text-ink-3 mt-0.5 block">
              {t('webdav.passwordTip')}
            </span>
          </div>
        </div>

        {/* Storage Mode */}
        <div className="space-y-2">
          <div className="text-[11px] text-ink-2">{t('webdav.storageModeLabel')}</div>
          <div
            role="radiogroup"
            aria-label={t('webdav.storageModeLabel')}
            className="inline-flex p-0.5 rounded-lg bg-app border border-line"
          >
            {modeOptions.map((opt) => {
              const Icon = opt.icon;
              const active = mode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => handleModeChange(opt.id)}
                  className={`h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                    active
                      ? 'bg-surface text-ink border border-line shadow-xs font-medium'
                      : 'text-ink-2 hover:text-ink border border-transparent'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${active ? 'text-indigo' : ''}`} />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-ink-3 leading-relaxed">
            {modeOptions.find((o) => o.id === mode)?.description}
          </p>
        </div>

        {/* Auto Sync Toggle (backup mode) & Live Status */}
        <div className="p-3 rounded-lg bg-app border border-line flex flex-wrap items-center justify-between gap-3 text-xs">
          {isPrimaryMode ? (
            <div className="flex items-center gap-2 text-ink">
              <input
                type="checkbox"
                checked
                disabled
                className="w-4 h-4 rounded border-line accent-accent opacity-60"
              />
              <span>
                <strong>{t('webdav.autoSyncLabel')}</strong> {t('webdav.autoSyncPrimaryDesc')}
              </span>
            </div>
          ) : (
            <label className="flex items-center gap-2 text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(form.autoSync)}
                onChange={(e) => updateConfig({ autoSync: e.target.checked })}
                className="w-4 h-4 rounded border-line text-accent cursor-pointer accent-accent"
              />
              <span>
                <strong>{t('webdav.autoSyncLabel')}</strong> {t('webdav.autoSyncBackupDesc')}
              </span>
            </label>
          )}

          {isPrimaryMode && sync ? (
            <PrimaryStatusLine
              phase={sync.isPaused ? 'paused' : sync.status.phase}
              message={sync.status.message}
              at={sync.status.at ?? form.lastSyncAt}
              configured={isWebDavActive(form)}
              onSyncNow={() => void sync.syncNow()}
              onResolve={sync.isPaused ? sync.openConflictDialog : undefined}
            />
          ) : (
            <div className="flex items-center gap-3 text-ink-3 text-[11px]">
              <span>
                {t('webdav.lastSyncedLabel')}{' '}
                <strong className="text-ink-2 font-mono">
                  {formatLastSync(form.lastSyncAt)}
                </strong>
              </span>
              {form.lastSyncStatus === 'success' && (
                <span className="text-positive font-medium">{t('webdav.statusUpToDate')}</span>
              )}
              {form.lastSyncStatus === 'error' && (
                <span className="text-negative font-medium">{t('webdav.statusError')}</span>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons: Test, Push, Pull */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-line">
          <button
            type="button"
            disabled={isTesting || isPushing || isPulling}
            onClick={handleTestConnection}
            className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-raised border border-line text-xs text-ink hover:bg-line/60 cursor-pointer disabled:opacity-50 transition-colors"
          >
            {isTesting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>{t('webdav.testBtn')}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isTesting || isPushing || isPulling}
              onClick={handlePush}
              className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-raised border border-line text-xs text-ink hover:bg-line/60 cursor-pointer disabled:opacity-50 transition-colors"
              title={t('webdav.pushTip')}
            >
              {isPushing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CloudUpload className="w-3.5 h-3.5 text-indigo" />
              )}
              <span>{t('webdav.pushBtn')}</span>
            </button>

            <button
              type="button"
              disabled={isTesting || isPushing || isPulling}
              onClick={() => setShowConfirmPull(true)}
              className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 cursor-pointer disabled:opacity-50 shadow-xs transition-opacity"
              title={t('webdav.pullTip')}
            >
              {isPulling ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CloudDownload className="w-3.5 h-3.5" />
              )}
              <span>{t('webdav.pullBtn')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Drawer for Pulling Database */}
      {showConfirmPull && (
        <div className="p-4 rounded-xl bg-app border border-amber-500/30 space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="text-xs font-medium text-ink">
                {t('webdav.confirmPullTitle')}
              </div>
              <p className="text-xs text-ink-2 leading-relaxed">
                {t('webdav.confirmPullPrefix')}<code className="text-ink font-mono">{form.remoteFileName || 'koban-vault.db'}</code>{t('webdav.confirmPullSuffix')}
              </p>
              <p className="text-[11px] text-ink-3">
                {t('webdav.confirmPullSafety')}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={isPulling}
              onClick={() => setShowConfirmPull(false)}
              className="h-8 px-3 rounded-lg border border-line bg-surface text-xs text-ink hover:bg-raised cursor-pointer disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={isPulling}
              onClick={handleExecutePull}
              className="h-8 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {isPulling && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{t('webdav.confirmPullBtn')}</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

interface PrimaryStatusLineProps {
  phase: 'idle' | 'syncing' | 'synced' | 'offline' | 'paused' | 'error';
  message: string;
  at?: number;
  configured: boolean;
  onSyncNow: () => void;
  onResolve?: () => void;
}

/** Live primary-storage status: Synced (time) · Syncing… · Offline — local cache · Sync paused — conflict · Error: … */
const PrimaryStatusLine: React.FC<PrimaryStatusLineProps> = ({
  phase,
  message,
  at,
  configured,
  onSyncNow,
  onResolve,
}) => {
  const { t, intlLocale } = useI18n();
  const time = at ? new Date(at * 1000).toLocaleString(intlLocale) : null;
  let content: React.ReactNode;
  if (!configured) {
    content = (
      <span className="text-ink-3">{t('webdav.statusEnableHint')}</span>
    );
  } else if (phase === 'syncing') {
    content = (
      <span className="inline-flex items-center gap-1.5 text-ink-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {t('webdav.statusSyncing')}
      </span>
    );
  } else if (phase === 'offline') {
    content = (
      <span className="inline-flex items-center gap-1.5 text-amber-600" title={message}>
        <CloudOff className="w-3.5 h-3.5" />
        {t('webdav.statusOffline')}
      </span>
    );
  } else if (phase === 'paused') {
    content = (
      <span className="inline-flex items-center gap-1.5 text-amber-600" title={message}>
        <PauseCircle className="w-3.5 h-3.5" />
        {t('webdav.statusPaused')}
      </span>
    );
  } else if (phase === 'error') {
    content = (
      <span className="inline-flex items-center gap-1.5 text-negative break-all">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        {message}
      </span>
    );
  } else if (phase === 'synced' || time) {
    content = (
      <span className="inline-flex items-center gap-1.5 text-positive">
        <CheckCircle2 className="w-3.5 h-3.5" />
        {t('webdav.statusSynced')}{time ? <span className="font-mono text-ink-2">({time})</span> : null}
      </span>
    );
  } else {
    content = <span className="text-ink-3">{t('webdav.statusNotSyncedYet')}</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      {content}
      {configured && onResolve && (
        <button
          type="button"
          onClick={onResolve}
          className="h-7 px-2.5 rounded-md border border-amber-500/40 bg-surface text-amber-600 hover:bg-raised cursor-pointer"
        >
          {t('webdav.resolveBtn')}
        </button>
      )}
      {configured && (
        <button
          type="button"
          disabled={phase === 'syncing'}
          onClick={onSyncNow}
          className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md border border-line bg-surface text-ink hover:bg-raised cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className="w-3 h-3" />
          {t('webdav.syncNowBtn')}
        </button>
      )}
    </div>
  );
};
