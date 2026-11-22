import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  FileKey2,
  Fingerprint,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { AppSettings, BackupEntry, LedgerState, VaultStatus } from '../types';
import { useI18n } from '../i18n';
import { KeyFileSelector } from './KeyFileSelector';
import { PassphraseStrengthBar } from './PassphraseStrengthBar';
import { MIN_VAULT_PASSPHRASE_LENGTH } from '../utils/auth';
import {
  changeVaultCredentials,
  deleteLegacyV1Backup,
  enrollDeviceUnlock,
  generateRecoveryKey,
  listLegacyV1Backups,
  removeDeviceUnlock,
  saveAuthSettings,
  setRememberedKeyfile,
  upgradeLegacyV1Backup,
} from '../utils/storage';

interface VaultSecuritySettingsSectionProps {
  settings: AppSettings;
  ledgerState: LedgerState;
  vaultStatus: VaultStatus | null;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onVaultStatusUpdated: (next: VaultStatus) => void;
  onShowRecoveryKey: (recoveryKey: string) => void;
  onLockVaultNow: () => void;
}

export const VaultSecuritySettingsSection: React.FC<VaultSecuritySettingsSectionProps> = ({
  settings,
  ledgerState,
  vaultStatus,
  onUpdateSettings,
  onVaultStatusUpdated,
  onShowRecoveryKey,
  onLockVaultNow,
}) => {
  const { t, intlLocale } = useI18n();

  const [currentPassphrase, setCurrentPassphrase] = useState('');
  const [currentKeyfilePath, setCurrentKeyfilePath] = useState<string | null>(
    vaultStatus?.rememberedKeyFilePath ?? null
  );
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmNewPassphrase, setConfirmNewPassphrase] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [newKeyfilePath, setNewKeyfilePath] = useState<string | null>(null);
  const [rememberNewKeyfile, setRememberNewKeyfile] = useState(false);
  const [rekeyDek, setRekeyDek] = useState(false);

  const [busyAction, setBusyAction] = useState<
    'none' | 'credentials' | 'device' | 'recovery' | 'settings' | 'legacy'
  >('none');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [legacyBackups, setLegacyBackups] = useState<BackupEntry[]>([]);
  const [legacyV1Pass, setLegacyV1Pass] = useState('');

  const refreshLegacyBackups = async () => {
    try {
      const list = await listLegacyV1Backups(settings.backupDir || null);
      setLegacyBackups(list);
    } catch {
      setLegacyBackups([]);
    }
  };

  useEffect(() => {
    void refreshLegacyBackups();
  }, [settings.backupDir]);

  useEffect(() => {
    if (vaultStatus?.rememberedKeyFilePath && !currentKeyfilePath) {
      setCurrentKeyfilePath(vaultStatus.rememberedKeyFilePath);
    }
  }, [vaultStatus?.rememberedKeyFilePath]);

  const handleUpdateAuthPref = async (patch: Partial<VaultStatus['authSettings']>) => {
    if (!vaultStatus) return;
    setErrorMsg(null);
    setBusyAction('settings');
    try {
      const nextPrefs = { ...vaultStatus.authSettings, ...patch };
      const updated = await saveAuthSettings(nextPrefs);
      onVaultStatusUpdated(updated);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction('none');
    }
  };

  const handleEnrollOrRemoveWindowsHello = async () => {
    if (!vaultStatus) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setBusyAction('device');
    try {
      const updated = vaultStatus.deviceSlotEnrolled
        ? await removeDeviceUnlock()
        : await enrollDeviceUnlock();
      onVaultStatusUpdated(updated);
      setStatusMsg(
        vaultStatus.deviceSlotEnrolled
          ? 'Removed Windows Hello Quick Unlock slot from this PC.'
          : 'Enabled Windows Hello Quick Unlock (hardware TPM + DPAPI).'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction('none');
    }
  };

  const handleGenerateRecoveryKey = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    setBusyAction('recovery');
    try {
      const key = await generateRecoveryKey();
      onShowRecoveryKey(key);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction('none');
    }
  };

  const handleChangeCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    const minLen = newKeyfilePath ? 8 : MIN_VAULT_PASSPHRASE_LENGTH;
    if (newPassphrase.length < minLen) {
      setErrorMsg(`New Master Password must be at least ${minLen} characters.`);
      return;
    }
    if (newPassphrase !== newPassphrase.trim()) {
      setErrorMsg('Master Password cannot start or end with spaces.');
      return;
    }
    if (newPassphrase !== confirmNewPassphrase) {
      setErrorMsg('New passwords do not match.');
      return;
    }

    setBusyAction('credentials');
    try {
      const updated = await changeVaultCredentials({
        currentPassphrase: currentPassphrase || null,
        currentKeyfilePath: currentKeyfilePath || null,
        newPassphrase,
        newKeyfilePath: newKeyfilePath || null,
        rekeyDek,
        rememberKeyfile: newKeyfilePath ? rememberNewKeyfile : false,
        currentState: ledgerState,
      });
      onVaultStatusUpdated(updated);
      setCurrentPassphrase('');
      setNewPassphrase('');
      setConfirmNewPassphrase('');
      setRekeyDek(false);
      setStatusMsg(
        rekeyDek
          ? 'Updated Master Credentials and rotated 256-bit database encryption key.'
          : 'Updated Vault Master Credentials successfully.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction('none');
    }
  };

  const handleUpgradeLegacyBackup = async (path: string) => {
    setErrorMsg(null);
    setBusyAction('legacy');
    try {
      await upgradeLegacyV1Backup(path, legacyV1Pass || null);
      setStatusMsg('Upgraded legacy v1 backup snapshot to Vault Format v2.');
      await refreshLegacyBackups();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction('none');
    }
  };

  const handleDeleteLegacyBackup = async (path: string) => {
    setErrorMsg(null);
    setBusyAction('legacy');
    try {
      await deleteLegacyV1Backup(path);
      setStatusMsg('Deleted legacy v1 backup file.');
      await refreshLegacyBackups();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction('none');
    }
  };

  const handleForgetRememberedKeyfile = async () => {
    try {
      const updated = await setRememberedKeyfile(null);
      onVaultStatusUpdated(updated);
      setCurrentKeyfilePath(null);
      setStatusMsg('Forgot remembered Key File path on this PC.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const authSettings = vaultStatus?.authSettings;

  return (
    <section className="p-5 rounded-xl bg-surface border border-line space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-line">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-4 h-4 text-positive" />
          <div>
            <h2 className="text-sm font-medium text-ink">
              Vault Security &amp; Encryption (Format v2)
            </h2>
            <p className="text-xs text-ink-2">
              Argon2id (64 MiB · 3 iterations · 4 lanes) + 256-bit AES-GCM-256 with authenticated AAD &amp; key slots
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onLockVaultNow}
          className="h-8 px-3 rounded-lg bg-raised border border-line text-xs text-ink hover:bg-line/70 inline-flex items-center gap-1.5 cursor-pointer"
        >
          <Lock className="w-3.5 h-3.5 text-indigo" />
          <span>{t('settings.lockNow')}</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-xl bg-negative/10 border border-negative/25 text-xs text-negative flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {statusMsg && (
        <div className="p-3 rounded-xl bg-positive/10 border border-positive/25 text-xs text-positive flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Owner Display Name & Lock Policy */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-app border border-line">
          <label className="block text-[11px] font-medium text-ink-2 mb-1">
            {t('settings.login.ownerName')}
          </label>
          <input
            type="text"
            value={settings.ownerDisplayName ?? 'Koban Owner'}
            onChange={(e) => onUpdateSettings({ ownerDisplayName: e.target.value })}
            placeholder="Koban Owner"
            className="w-full h-8 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none"
          />
        </div>

        <div className="p-3 rounded-lg bg-app border border-line">
          <label className="block text-[11px] font-medium text-ink-2 mb-1">
            {t('vault.autoLockLabel')}
          </label>
          <select
            value={authSettings?.autoLockMinutes ?? 15}
            disabled={busyAction !== 'none'}
            onChange={(e) =>
              void handleUpdateAuthPref({
                autoLockMinutes: parseInt(e.target.value, 10) || 0,
              })
            }
            className="w-full h-8 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none"
          >
            <option value={0}>{t('settings.login.autoLockNever')}</option>
            <option value={1}>1 minute</option>
            <option value={5}>{t('settings.login.autoLock5')}</option>
            <option value={15}>{t('settings.login.autoLock15')}</option>
            <option value={30}>{t('settings.login.autoLock30')}</option>
            <option value={60}>{t('settings.login.autoLock60')}</option>
          </select>
        </div>

        <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-app border border-line cursor-pointer">
          <div>
            <div className="text-xs font-medium text-ink">{t('vault.lockOnMinimize')}</div>
            <p className="text-[11px] text-ink-2 mt-0.5">
              Zeroes the in-memory encryption key immediately when Koban is minimized
            </p>
          </div>
          <input
            type="checkbox"
            checked={Boolean(authSettings?.lockOnMinimize)}
            disabled={busyAction !== 'none'}
            onChange={(e) =>
              void handleUpdateAuthPref({ lockOnMinimize: e.target.checked })
            }
            className="mt-0.5 rounded border-line"
          />
        </label>

        <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-app border border-line cursor-pointer">
          <div>
            <div className="text-xs font-medium text-ink">{t('settings.login.autoPrompt')}</div>
            <p className="text-[11px] text-ink-2 mt-0.5">{t('settings.login.autoPromptDesc')}</p>
          </div>
          <input
            type="checkbox"
            checked={authSettings?.autoPromptDevice ?? true}
            disabled={busyAction !== 'none'}
            onChange={(e) =>
              void handleUpdateAuthPref({ autoPromptDevice: e.target.checked })
            }
            className="mt-0.5 rounded border-line"
          />
        </label>
      </div>

      {/* Active Key Slots Overview */}
      {vaultStatus && vaultStatus.slots.length > 0 && (
        <div className="p-3.5 rounded-xl bg-app border border-line space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-ink">Active Vault Key Slots</span>
            {vaultStatus.rememberedKeyFilePath && (
              <button
                type="button"
                onClick={handleForgetRememberedKeyfile}
                className="text-[11px] text-indigo hover:underline cursor-pointer"
              >
                Forget remembered Key File path
              </button>
            )}
          </div>
          <div className="divide-y divide-line/60 rounded-lg border border-line bg-surface">
            {vaultStatus.slots.map((slot) => (
              <div
                key={slot.id}
                className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {slot.kind === 'composite_keyfile' ? (
                    <FileKey2 className="w-3.5 h-3.5 text-indigo shrink-0" />
                  ) : slot.kind === 'recovery' ? (
                    <KeyRound className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-positive shrink-0" />
                  )}
                  <span className="font-medium text-ink truncate">{slot.label}</span>
                  {slot.keyfileFingerprint && (
                    <span className="px-1.5 py-0.5 rounded bg-raised font-mono text-[10px] text-ink-2">
                      sha256:{slot.keyfileFingerprint}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-ink-3 shrink-0">
                  {slot.createdAt
                    ? new Date(slot.createdAt * 1000).toLocaleDateString(intlLocale)
                    : 'Active'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Windows Hello & Recovery Key Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3.5 rounded-xl bg-app border border-line flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Fingerprint className="w-4 h-4 text-indigo shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-medium text-ink">Windows Hello Quick Unlock</div>
              <p className="text-[11px] text-ink-2 mt-0.5">
                {vaultStatus?.windowsHelloAvailable
                  ? vaultStatus.deviceSlotEnrolled
                    ? 'TPM + DPAPI slot active on this Windows device'
                    : 'Not enrolled on this PC yet'
                  : 'Windows Hello biometric/PIN is unavailable on this PC'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={
              busyAction !== 'none' ||
              (!vaultStatus?.windowsHelloAvailable && !vaultStatus?.deviceSlotEnrolled)
            }
            onClick={handleEnrollOrRemoveWindowsHello}
            className="h-8 px-3 rounded-lg bg-surface border border-line text-xs font-medium text-ink hover:bg-raised shrink-0 cursor-pointer disabled:opacity-40"
          >
            {busyAction === 'device' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : vaultStatus?.deviceSlotEnrolled ? (
              t('common.remove')
            ) : (
              'Enable'
            )}
          </button>
        </div>

        <div className="p-3.5 rounded-xl bg-app border border-line flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <KeyRound className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-medium text-ink">Emergency Recovery Key</div>
              <p className="text-[11px] text-ink-2 mt-0.5">
                {vaultStatus?.slots.some((s) => s.kind === 'recovery')
                  ? 'Active (generating replaces the previous Recovery Key)'
                  : 'No Recovery Key slot yet — generate one now'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busyAction !== 'none'}
            onClick={handleGenerateRecoveryKey}
            className="h-8 px-3 rounded-lg bg-surface border border-line text-xs font-medium text-ink hover:bg-raised shrink-0 cursor-pointer disabled:opacity-40"
          >
            {busyAction === 'recovery' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              t('vault.regenerateRecovery')
            )}
          </button>
        </div>
      </div>

      {/* Change Master Credentials & Composite Key File */}
      <form
        onSubmit={handleChangeCredentials}
        className="p-4 rounded-xl bg-app border border-line space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-ink">
            Change Master Password / Key File (.key)
          </span>
          <button
            type="button"
            onClick={() => setShowPass((v) => !v)}
            className="text-[11px] text-ink-3 hover:text-ink inline-flex items-center gap-1 cursor-pointer"
          >
            {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{showPass ? 'Hide' : 'Show'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <div>
            <label className="block text-[11px] text-ink-2 mb-1">
              Current Master Password
            </label>
            <input
              type={showPass ? 'text' : 'password'}
              value={currentPassphrase}
              onChange={(e) => setCurrentPassphrase(e.target.value)}
              placeholder="Current password"
              className="w-full h-9 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] text-ink-2 mb-1">
              New Master Password (min {newKeyfilePath ? 8 : MIN_VAULT_PASSPHRASE_LENGTH} chars)
            </label>
            <input
              type={showPass ? 'text' : 'password'}
              value={newPassphrase}
              onChange={(e) => setNewPassphrase(e.target.value)}
              placeholder="New Master Password"
              className="w-full h-9 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] text-ink-2 mb-1">
              Confirm New Password
            </label>
            <input
              type={showPass ? 'text' : 'password'}
              value={confirmNewPassphrase}
              onChange={(e) => setConfirmNewPassphrase(e.target.value)}
              placeholder="Confirm new password"
              className="w-full h-9 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none"
            />
          </div>
        </div>

        {newPassphrase.length > 0 && (
          <PassphraseStrengthBar
            passphrase={newPassphrase}
            onGenerate={(g) => {
              setNewPassphrase(g);
              setConfirmNewPassphrase(g);
              setShowPass(true);
            }}
          />
        )}

        {vaultStatus?.requiresKeyFile && (
          <div className="space-y-1">
            <span className="block text-[11px] text-ink-2">
              Current Key File (required to verify current password)
            </span>
            <KeyFileSelector
              keyfilePath={currentKeyfilePath}
              onChange={setCurrentKeyfilePath}
              allowGenerate={false}
              compact
            />
          </div>
        )}

        <div className="space-y-1">
          <span className="block text-[11px] text-ink-2">
            New Key File (optional — leave empty to use Master Password alone)
          </span>
          <KeyFileSelector
            keyfilePath={newKeyfilePath}
            onChange={setNewKeyfilePath}
            allowGenerate
            rememberChecked={rememberNewKeyfile}
            onRememberChange={setRememberNewKeyfile}
            onStatusMessage={setStatusMsg}
            compact
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
            <input
              type="checkbox"
              checked={rekeyDek}
              onChange={(e) => setRekeyDek(e.target.checked)}
              className="rounded border-line"
            />
            <span>{t('vault.rekeyDek')}</span>
          </label>

          <button
            type="submit"
            disabled={busyAction !== 'none' || !newPassphrase}
            className="h-9 px-4 rounded-lg bg-ink text-on-ink text-xs font-medium inline-flex items-center gap-1.5 hover:opacity-90 cursor-pointer disabled:opacity-40"
          >
            {busyAction === 'credentials' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>Save Master Credentials</span>
          </button>
        </div>
      </form>

      {/* Legacy v1 Backups Scanner */}
      {legacyBackups.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-500/8 border border-amber-500/25 space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span>{t('vault.legacyBackupsTitle')} ({legacyBackups.length})</span>
          </div>
          <p className="text-[11px] text-ink-2">{t('vault.legacyBackupsDesc')}</p>
          <input
            type="password"
            value={legacyV1Pass}
            onChange={(e) => setLegacyV1Pass(e.target.value)}
            placeholder="Legacy v1 passphrase (if backups used a custom v1 password)"
            className="w-full h-8 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none"
          />
          <div className="divide-y divide-line rounded-lg border border-line bg-surface">
            {legacyBackups.map((b) => (
              <div
                key={b.path}
                className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
              >
                <span className="truncate font-mono text-[11px] text-ink">{b.name}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={busyAction !== 'none'}
                    onClick={() => handleUpgradeLegacyBackup(b.path)}
                    className="h-7 px-2.5 rounded-md bg-ink text-on-ink text-[11px] inline-flex items-center gap-1 cursor-pointer disabled:opacity-40"
                  >
                    <Upload className="w-3 h-3" />
                    <span>{t('vault.upgradeBackup')}</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyAction !== 'none'}
                    onClick={() => handleDeleteLegacyBackup(b.path)}
                    className="h-7 px-2.5 rounded-md border border-line text-[11px] text-negative hover:bg-negative/10 inline-flex items-center gap-1 cursor-pointer disabled:opacity-40"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>{t('vault.deleteBackup')}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
