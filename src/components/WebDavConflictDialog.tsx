import React from 'react';
import {
  AlertTriangle,
  Clock,
  CloudDownload,
  CloudUpload,
  Laptop,
  Loader2,
} from 'lucide-react';
import { WebDavConflictChoice, WebDavConflictInfo } from '../hooks/useWebDavSync';

interface WebDavConflictDialogProps {
  info: WebDavConflictInfo;
  isResolving: boolean;
  errorMessage?: string;
  onChoose: (choice: WebDavConflictChoice) => void;
}

function formatHttpDate(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function formatSecs(value?: number | null): string | null {
  if (!value) return null;
  return new Date(value * 1000).toLocaleString();
}

/** Modal shown when the cloud vault and this device both changed (WEBDAV-SPEC §5). */
export const WebDavConflictDialog: React.FC<WebDavConflictDialogProps> = ({
  info,
  isResolving,
  errorMessage,
  onChoose,
}) => {
  const remoteTime = formatHttpDate(info.remoteLastModified);
  const localTime = formatSecs(info.localModified);
  const firstLink = info.firstLink;

  const title = firstLink
    ? 'A Koban vault already exists at this WebDAV location'
    : 'Cloud vault changed on another device';
  const body = firstLink
    ? 'This device has never synced with this WebDAV file. Choose which data to keep — the other one is kept as a backup file.'
    : 'Both the WebDAV copy and this device have changes since the last sync. Choose which version to keep — the other one is kept as a backup file.';

  const btnBase =
    'h-9 px-3.5 inline-flex items-center justify-center gap-1.5 rounded-lg text-xs cursor-pointer disabled:opacity-50 transition-colors';

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="webdav-conflict-title"
    >
      <div className="w-full max-w-lg bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden my-auto">
        <div className="px-5 py-4 border-b border-line bg-app/60 flex items-start gap-2.5">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h2 id="webdav-conflict-title" className="text-sm font-medium text-ink">
              {title}
            </h2>
            <p className="text-xs text-ink-2 leading-relaxed">{body}</p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          {(remoteTime || localTime) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <div className="p-2.5 rounded-lg bg-app border border-line">
                <div className="flex items-center gap-1.5 text-ink-3">
                  <CloudDownload className="w-3.5 h-3.5 text-indigo" />
                  <span>Cloud copy last modified</span>
                </div>
                <div className="mt-0.5 font-mono text-ink-2">{remoteTime ?? 'Unknown'}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-app border border-line">
                <div className="flex items-center gap-1.5 text-ink-3">
                  <Laptop className="w-3.5 h-3.5" />
                  <span>This device last saved</span>
                </div>
                <div className="mt-0.5 font-mono text-ink-2">{localTime ?? 'Unknown'}</div>
              </div>
            </div>
          )}

          {errorMessage && !isResolving && (
            <div className="p-2.5 rounded-lg border bg-negative/10 border-negative/20 text-negative text-xs break-all">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-line flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={isResolving}
            onClick={() => onChoose(firstLink ? 'cancel' : 'later')}
            className={`${btnBase} border border-line bg-surface text-ink hover:bg-raised`}
          >
            {!firstLink && <Clock className="w-3.5 h-3.5" />}
            <span>{firstLink ? 'Cancel' : 'Decide later'}</span>
          </button>
          <button
            type="button"
            disabled={isResolving}
            onClick={() => onChoose('local')}
            className={`${btnBase} bg-raised border border-line text-ink hover:bg-line/60`}
          >
            {isResolving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CloudUpload className="w-3.5 h-3.5 text-indigo" />
            )}
            <span>{firstLink ? 'Upload this device’s data' : 'Keep this device’s version'}</span>
          </button>
          <button
            type="button"
            disabled={isResolving}
            onClick={() => onChoose('cloud')}
            className={`${btnBase} bg-ink text-on-ink font-medium hover:opacity-90 shadow-xs`}
          >
            {isResolving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CloudDownload className="w-3.5 h-3.5" />
            )}
            <span>{firstLink ? 'Use the cloud vault' : 'Use cloud version'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
