import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudDownload,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  RefreshCw,
  Server,
  X,
} from 'lucide-react';
import { testWebDavConnection, webDavErrorMessage } from '../utils/storage';

export interface WebDavOpenVaultRequest {
  url: string;
  username: string;
  password: string;
  remoteFileName: string;
}

interface WebDavOpenVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Downloads the vault, reloads it and configures WebDAV primary storage. Throws on failure. */
  onDownloadAndOpen: (req: WebDavOpenVaultRequest) => Promise<void>;
}

/** First-run "Open Vault from WebDAV…" form (WEBDAV-SPEC §6, new device). */
export const WebDavOpenVaultModal: React.FC<WebDavOpenVaultModalProps> = ({
  isOpen,
  onClose,
  onDownloadAndOpen,
}) => {
  const [form, setForm] = useState<WebDavOpenVaultRequest>({
    url: '',
    username: '',
    password: '',
    remoteFileName: 'koban-vault.db',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  if (!isOpen) return null;

  const busy = isTesting || isDownloading;
  const complete = Boolean(form.url.trim() && form.username.trim() && form.password);
  const update = (patch: Partial<WebDavOpenVaultRequest>) => setForm((f) => ({ ...f, ...patch }));

  const handleTest = async () => {
    if (!complete) {
      setFeedback({
        type: 'error',
        text: 'Please enter WebDAV Server URL, Username, and Password / App Token.',
      });
      return;
    }
    setIsTesting(true);
    setFeedback(null);
    try {
      const msg = await testWebDavConnection(form.url, form.username, form.password);
      setFeedback({ type: 'success', text: msg });
    } catch (err) {
      setFeedback({ type: 'error', text: webDavErrorMessage(err, 'WebDAV connection failed.') });
    } finally {
      setIsTesting(false);
    }
  };

  const handleDownload = async () => {
    if (!complete) {
      setFeedback({
        type: 'error',
        text: 'Please enter WebDAV Server URL, Username, and Password / App Token.',
      });
      return;
    }
    setIsDownloading(true);
    setFeedback(null);
    try {
      await onDownloadAndOpen(form);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: webDavErrorMessage(err, 'Could not download the vault from WebDAV.'),
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const inputCls =
    'w-full h-9 px-3 rounded-lg bg-app border border-line text-xs text-ink focus:outline-none';

  return (
    <div className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-xl bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden my-auto">
        <div className="px-5 py-4 border-b border-line bg-app/60 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Cloud className="w-5 h-5 text-indigo shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-medium text-ink">Open Vault from WebDAV</h2>
              <p className="text-xs text-ink-2 mt-0.5 leading-relaxed">
                Download an existing Koban vault (from another Windows or Mac device) and use the
                WebDAV file as this device’s primary storage.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isDownloading}
            className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-raised cursor-pointer disabled:opacity-50"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {feedback && (
            <div
              className={`p-3 rounded-lg border flex items-center gap-2 text-xs ${
                feedback.type === 'success'
                  ? 'bg-positive/10 border-positive/20 text-positive'
                  : 'bg-negative/10 border-negative/20 text-negative'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span className="flex-1 break-all">{feedback.text}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-8">
              <label className="block text-[11px] text-ink-2 mb-1">WebDAV Server URL</label>
              <div className="relative">
                <Server className="w-3.5 h-3.5 text-ink-3 absolute left-3 top-3" />
                <input
                  type="url"
                  value={form.url}
                  onChange={(e) => update({ url: e.target.value })}
                  placeholder="https://nextcloud.example.com/remote.php/dav/files/myuser/Koban/"
                  className={`${inputCls} pl-8`}
                  autoFocus
                />
              </div>
            </div>
            <div className="md:col-span-4">
              <label className="block text-[11px] text-ink-2 mb-1">Remote Database Filename</label>
              <input
                type="text"
                value={form.remoteFileName}
                onChange={(e) => update({ remoteFileName: e.target.value })}
                placeholder="koban-vault.db"
                className={`${inputCls} font-mono`}
              />
            </div>
            <div className="md:col-span-6">
              <label className="block text-[11px] text-ink-2 mb-1">WebDAV Username</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => update({ username: e.target.value })}
                placeholder="user@example.com or username"
                className={inputCls}
              />
            </div>
            <div className="md:col-span-6">
              <label className="block text-[11px] text-ink-2 mb-1">
                WebDAV Password / App Token
              </label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 text-ink-3 absolute left-3 top-3" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => update({ password: e.target.value })}
                  placeholder="Password or app token"
                  className={`${inputCls} pl-8 pr-9`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-2.5 text-ink-3 hover:text-ink cursor-pointer"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-ink-3 leading-relaxed">
            Any existing local database is kept as a <code className="text-ink-2">koban-pre-webdav-sync-…db</code> file
            next to it. If the vault is protected with a custom passphrase, you will be asked for it after the download.
          </p>
        </div>

        <div className="px-5 py-3.5 border-t border-line flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={handleTest}
            className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-raised border border-line text-xs text-ink hover:bg-line/60 cursor-pointer disabled:opacity-50 transition-colors"
          >
            {isTesting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>Test Connection</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleDownload}
            className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg bg-ink text-on-ink text-xs font-medium hover:opacity-90 cursor-pointer disabled:opacity-50 shadow-xs transition-opacity"
          >
            {isDownloading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CloudDownload className="w-3.5 h-3.5" />
            )}
            <span>Download & Open</span>
          </button>
        </div>
      </div>
    </div>
  );
};
