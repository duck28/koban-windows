import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CloudDownload,
  Eye,
  EyeOff,
  FileKey2,
  Fingerprint,
  FolderOpen,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { LedgerState, VaultStatus } from '../types';
import { useI18n } from '../i18n';
import { Logo } from './Logo';
import { KeyFileSelector } from './KeyFileSelector';
import { PassphraseStrengthBar } from './PassphraseStrengthBar';
import { MIN_VAULT_PASSPHRASE_LENGTH } from '../utils/auth';
import {
  getVaultStatus,
  isTauriEnv,
  migrateV1ToV2,
  openDatabaseFile,
  pickOpenFileDialog,
  unlockV1ForMigration,
  unlockVault,
  unlockVaultWithDevice,
  unlockVaultWithRecovery,
} from '../utils/storage';

interface AuthLockScreenProps {
  vaultStatus: VaultStatus;
  onUnlocked: (state: LedgerState, nextStatus: VaultStatus) => Promise<void> | void;
  onMigrated: (
    state: LedgerState,
    nextStatus: VaultStatus,
    recoveryKey: string | null
  ) => Promise<void> | void;
  onOpenWebDavVault: () => void;
  onVaultFileSwitched: () => Promise<void>;
}

export const AuthLockScreen: React.FC<AuthLockScreenProps> = ({
  vaultStatus,
  onUnlocked,
  onMigrated,
  onOpenWebDavVault,
  onVaultFileSwitched,
}) => {
  const { t } = useI18n();

  // Normal v2 unlock state
  const [unlockTab, setUnlockTab] = useState<'password' | 'recovery'>('password');
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [keyfilePath, setKeyfilePath] = useState<string | null>(
    vaultStatus.rememberedKeyFilePath ?? null
  );
  const [showKeyFileBox, setShowKeyFileBox] = useState(vaultStatus.requiresKeyFile);
  const [rememberKeyfile, setRememberKeyfile] = useState(
    Boolean(vaultStatus.rememberedKeyFilePath)
  );
  const [recoveryInput, setRecoveryInput] = useState('');

  // Legacy v1 -> v2 migration state
  const [v1Passphrase, setV1Passphrase] = useState('');
  const [v1UnlockedPreview, setV1UnlockedPreview] = useState(
    !vaultStatus.hasLegacyCustomPassphrase
  );
  const [v1OwnerName, setV1OwnerName] = useState<string | null>(null);
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmNewPassphrase, setConfirmNewPassphrase] = useState('');
  const [migrationKeyfilePath, setMigrationKeyfilePath] = useState<string | null>(null);
  const [rememberMigrationKeyfile, setRememberMigrationKeyfile] = useState(false);
  const [createRecoveryKey, setCreateRecoveryKey] = useState(true);

  const [busy, setBusy] = useState<'none' | 'unlock' | 'device' | 'recovery' | 'migrate'>(
    'none'
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [didAutoDevicePrompt, setDidAutoDevicePrompt] = useState(false);

  // Sync keyfile requirements if vaultStatus changes (e.g. user opened a different DB)
  useEffect(() => {
    setKeyfilePath(vaultStatus.rememberedKeyFilePath ?? null);
    setShowKeyFileBox(vaultStatus.requiresKeyFile || Boolean(vaultStatus.rememberedKeyFilePath));
    setRememberKeyfile(Boolean(vaultStatus.rememberedKeyFilePath));
    setV1UnlockedPreview(!vaultStatus.hasLegacyCustomPassphrase);
    setErrorMsg(null);
  }, [vaultStatus.dbPath, vaultStatus.requiresKeyFile, vaultStatus.rememberedKeyFilePath, vaultStatus.hasLegacyCustomPassphrase]);

  // Preload legacy owner display name if v1 doesn't require passphrase
  useEffect(() => {
    if (!vaultStatus.needsMigration || vaultStatus.hasLegacyCustomPassphrase) return;
    let cancelled = false;
    unlockV1ForMigration(null)
      .then((res) => {
        if (!cancelled) {
          setV1UnlockedPreview(true);
          setV1OwnerName(res.legacyDisplayName ?? null);
        }
      })
      .catch(() => {
        // user can unlock below
      });
    return () => {
      cancelled = true;
    };
  }, [vaultStatus.needsMigration, vaultStatus.hasLegacyCustomPassphrase, vaultStatus.dbPath]);

  const handleDeviceUnlock = async () => {
    setErrorMsg(null);
    setBusy('device');
    try {
      const state = await unlockVaultWithDevice();
      const refreshed = await getVaultStatus();
      await onUnlocked(state, refreshed);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('none');
    }
  };

  useEffect(() => {
    if (
      !vaultStatus.needsMigration &&
      vaultStatus.deviceSlotEnrolled &&
      vaultStatus.windowsHelloAvailable &&
      vaultStatus.authSettings.autoPromptDevice &&
      !didAutoDevicePrompt
    ) {
      setDidAutoDevicePrompt(true);
      const timer = setTimeout(() => {
        void handleDeviceUnlock();
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [
    vaultStatus.needsMigration,
    vaultStatus.deviceSlotEnrolled,
    vaultStatus.windowsHelloAvailable,
    vaultStatus.authSettings.autoPromptDevice,
    didAutoDevicePrompt,
  ]);

  const handlePasswordUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!passphrase) {
      setErrorMsg('Please enter your Master Password.');
      return;
    }
    if (vaultStatus.requiresKeyFile && !keyfilePath) {
      setErrorMsg(t('vault.keyFileRequired'));
      setShowKeyFileBox(true);
      return;
    }
    setBusy('unlock');
    try {
      const state = await unlockVault(
        passphrase,
        keyfilePath,
        keyfilePath ? rememberKeyfile : false
      );
      const refreshed = await getVaultStatus();
      await onUnlocked(state, refreshed);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('none');
    }
  };

  const handleRecoveryUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!recoveryInput.trim()) {
      setErrorMsg('Please enter your 160-bit Recovery Key.');
      return;
    }
    setBusy('recovery');
    try {
      const state = await unlockVaultWithRecovery(recoveryInput.trim());
      const refreshed = await getVaultStatus();
      await onUnlocked(state, refreshed);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('none');
    }
  };

  const handleUnlockLegacyV1 = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setBusy('migrate');
    try {
      const res = await unlockV1ForMigration(v1Passphrase || null);
      setV1OwnerName(res.legacyDisplayName ?? null);
      setV1UnlockedPreview(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('none');
    }
  };

  const handleMigrateToV2 = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!migrationKeyfilePath && newPassphrase.length < MIN_VAULT_PASSPHRASE_LENGTH) {
      setErrorMsg(
        `Master Password must be at least ${MIN_VAULT_PASSPHRASE_LENGTH} characters.`
      );
      return;
    }
    if (newPassphrase !== newPassphrase.trim()) {
      setErrorMsg('Master Password cannot start or end with spaces.');
      return;
    }
    if (newPassphrase !== confirmNewPassphrase) {
      setErrorMsg('Passphrases do not match.');
      return;
    }
    setBusy('migrate');
    try {
      const res = await migrateV1ToV2({
        v1Passphrase: vaultStatus.hasLegacyCustomPassphrase ? v1Passphrase : null,
        newPassphrase,
        keyfilePath: migrationKeyfilePath,
        createRecoveryKey,
        rememberKeyfile: Boolean(migrationKeyfilePath && rememberMigrationKeyfile),
      });
      if (!res.ledgerJson) {
        throw new Error('Migration completed without returning ledger payload.');
      }
      const parsed = JSON.parse(res.ledgerJson) as LedgerState;
      await onMigrated(parsed, res.status, res.recoveryKey ?? null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('none');
    }
  };

  const handleOpenAnotherDb = async () => {
    setErrorMsg(null);
    const picked = await pickOpenFileDialog('Koban Database (*.db)', ['db']);
    if (!picked) return;
    try {
      await openDatabaseFile(picked);
      await onVaultFileSwitched();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const dbFileName = vaultStatus.dbPath.split(/[/\\]/).pop() || 'koban.db';

  return (
    <div className="min-h-screen w-full bg-app flex flex-col items-center justify-center p-6 select-none">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface shadow-2xl overflow-hidden">
        <div className="px-6 pt-7 pb-5 border-b border-line text-center">
          <div className="flex justify-center mb-3.5">
            <div className="w-12 h-12 rounded-2xl bg-raised border border-line flex items-center justify-center shadow-xs">
              <Logo className="w-7 h-7" />
            </div>
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">
            {vaultStatus.needsMigration
              ? t('vault.migrateTitle')
              : t('lock.signIn')}
          </h1>
          <p className="text-xs text-ink-3 mt-1 font-mono truncate" title={vaultStatus.dbPath}>
            {dbFileName}
          </p>
          <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-positive/10 border border-positive/20 text-[10px] font-medium text-positive">
            <ShieldCheck className="w-3 h-3" />
            <span>
              {vaultStatus.needsMigration
                ? t('vault.badgeLegacyV1')
                : t('vault.badgeV2')}
            </span>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-negative/10 border border-negative/25 text-xs text-negative flex items-start gap-2 select-text">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {statusNote && !errorMsg && (
            <div className="p-2.5 rounded-xl bg-positive/10 border border-positive/25 text-xs text-positive">
              {statusNote}
            </div>
          )}

          {vaultStatus.needsMigration ? (
            !v1UnlockedPreview ? (
              <form onSubmit={handleUnlockLegacyV1} className="space-y-4">
                <p className="text-xs text-ink-2 leading-relaxed">
                  Enter your legacy v1 vault passphrase to inspect and upgrade this database to Vault Format v2.
                </p>
                <div>
                  <label className="block text-[11px] font-medium text-ink-2 mb-1">
                    Legacy v1 Passphrase
                  </label>
                  <input
                    type="password"
                    value={v1Passphrase}
                    onChange={(e) => setV1Passphrase(e.target.value)}
                    autoFocus
                    className="w-full h-10 px-3 rounded-xl bg-app border border-line text-sm text-ink focus:outline-none focus:border-ink"
                    placeholder="Enter current database passphrase"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy !== 'none'}
                  className="w-full h-10 rounded-xl bg-ink text-on-ink text-xs font-medium inline-flex items-center justify-center gap-2 hover:opacity-90 cursor-pointer disabled:opacity-50"
                >
                  {busy === 'migrate' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArrowRight className="w-4 h-4" />
                  )}
                  <span>Verify Legacy Vault</span>
                </button>
              </form>
            ) : (
              <form onSubmit={handleMigrateToV2} className="space-y-3.5">
                <p className="text-xs text-ink-2 leading-relaxed">
                  {v1OwnerName
                    ? `Upgrading vault for ${v1OwnerName}. `
                    : ''}
                  {t('vault.migrateDesc')}
                </p>

                <div>
                  <label className="block text-[11px] font-medium text-ink-2 mb-1">
                    New Master Password (min {MIN_VAULT_PASSPHRASE_LENGTH} chars)
                  </label>
                  <div className="relative">
                    <input
                      type={showPassphrase ? 'text' : 'password'}
                      value={newPassphrase}
                      onChange={(e) => setNewPassphrase(e.target.value)}
                      autoFocus
                      className="w-full h-10 pl-3 pr-9 rounded-xl bg-app border border-line text-sm text-ink focus:outline-none focus:border-ink"
                      placeholder="Choose a strong Master Password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassphrase((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink cursor-pointer"
                    >
                      {showPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="mt-2">
                    <PassphraseStrengthBar
                      passphrase={newPassphrase}
                      onGenerate={(g) => {
                        setNewPassphrase(g);
                        setConfirmNewPassphrase(g);
                        setShowPassphrase(true);
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-ink-2 mb-1">
                    Confirm Master Password
                  </label>
                  <input
                    type={showPassphrase ? 'text' : 'password'}
                    value={confirmNewPassphrase}
                    onChange={(e) => setConfirmNewPassphrase(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-app border border-line text-sm text-ink focus:outline-none focus:border-ink"
                    placeholder="Repeat Master Password"
                  />
                </div>

                <KeyFileSelector
                  keyfilePath={migrationKeyfilePath}
                  onChange={setMigrationKeyfilePath}
                  allowGenerate
                  rememberChecked={rememberMigrationKeyfile}
                  onRememberChange={setRememberMigrationKeyfile}
                  onStatusMessage={setStatusNote}
                />

                <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-raised/50 border border-line text-xs text-ink-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createRecoveryKey}
                    onChange={(e) => setCreateRecoveryKey(e.target.checked)}
                    className="mt-0.5 rounded border-line"
                  />
                  <span>Generate a 160-bit emergency Recovery Key (recommended)</span>
                </label>

                <button
                  type="submit"
                  disabled={busy !== 'none'}
                  className="w-full h-10 rounded-xl bg-ink text-on-ink text-xs font-medium inline-flex items-center justify-center gap-2 hover:opacity-90 cursor-pointer disabled:opacity-50"
                >
                  {busy === 'migrate' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-4 h-4" />
                  )}
                  <span>{t('vault.migrateConfirm')}</span>
                </button>
              </form>
            )
          ) : (
            <>
              {vaultStatus.deviceSlotEnrolled && vaultStatus.windowsHelloAvailable && (
                <button
                  type="button"
                  disabled={busy !== 'none'}
                  onClick={handleDeviceUnlock}
                  className="w-full h-10 rounded-xl bg-ink text-on-ink text-xs font-medium inline-flex items-center justify-center gap-2 hover:opacity-90 cursor-pointer disabled:opacity-50"
                >
                  {busy === 'device' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Fingerprint className="w-4 h-4" />
                  )}
                  <span>{t('vault.windowsHelloUnlock')}</span>
                </button>
              )}

              <div className="grid grid-cols-2 p-1 rounded-xl bg-raised border border-line text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setUnlockTab('password');
                    setErrorMsg(null);
                  }}
                  className={`h-8 rounded-lg font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                    unlockTab === 'password'
                      ? 'bg-surface text-ink shadow-xs'
                      : 'text-ink-3 hover:text-ink'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>{t('vault.passwordTab')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUnlockTab('recovery');
                    setErrorMsg(null);
                  }}
                  className={`h-8 rounded-lg font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                    unlockTab === 'recovery'
                      ? 'bg-surface text-ink shadow-xs'
                      : 'text-ink-3 hover:text-ink'
                  }`}
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>{t('vault.recoveryTab')}</span>
                </button>
              </div>

              {unlockTab === 'password' ? (
                <form onSubmit={handlePasswordUnlock} className="space-y-3.5">
                  <div>
                    <label className="block text-[11px] font-medium text-ink-2 mb-1">
                      {t('lock.passphraseLabel')}
                    </label>
                    <div className="relative">
                      <input
                        type={showPassphrase ? 'text' : 'password'}
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        autoFocus={!vaultStatus.deviceSlotEnrolled}
                        className="w-full h-10 pl-3 pr-9 rounded-xl bg-app border border-line text-sm text-ink focus:outline-none focus:border-ink"
                        placeholder={t('lock.passphrasePlaceholder')}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassphrase((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink cursor-pointer"
                      >
                        {showPassphrase ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {vaultStatus.requiresKeyFile || showKeyFileBox ? (
                    <KeyFileSelector
                      keyfilePath={keyfilePath}
                      onChange={setKeyfilePath}
                      allowGenerate={false}
                      rememberChecked={rememberKeyfile}
                      onRememberChange={setRememberKeyfile}
                      requiredBadge={vaultStatus.requiresKeyFile}
                      compact
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowKeyFileBox(true)}
                      className="text-[11px] text-indigo hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <FileKey2 className="w-3.5 h-3.5" />
                      <span>Use Key File (.key)</span>
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={busy !== 'none'}
                    className={`w-full h-10 rounded-xl text-xs font-medium inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${
                      vaultStatus.deviceSlotEnrolled && vaultStatus.windowsHelloAvailable
                        ? 'border border-line bg-raised text-ink hover:bg-line/50'
                        : 'bg-ink text-on-ink hover:opacity-90'
                    }`}
                  >
                    {busy === 'unlock' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Lock className="w-4 h-4" />
                    )}
                    <span>{t('lock.unlockPassphrase')}</span>
                  </button>
                </form>
              ) : (
                <form onSubmit={handleRecoveryUnlock} className="space-y-3.5">
                  <div>
                    <label className="block text-[11px] font-medium text-ink-2 mb-1">
                      160-bit Recovery Key (Crockford Base32)
                    </label>
                    <input
                      type="text"
                      value={recoveryInput}
                      onChange={(e) => setRecoveryInput(e.target.value)}
                      autoFocus
                      className="w-full h-10 px-3 rounded-xl bg-app border border-line text-xs font-mono text-ink tracking-wider focus:outline-none focus:border-ink"
                      placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy !== 'none'}
                    className="w-full h-10 rounded-xl bg-ink text-on-ink text-xs font-medium inline-flex items-center justify-center gap-2 hover:opacity-90 cursor-pointer disabled:opacity-50"
                  >
                    {busy === 'recovery' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <KeyRound className="w-4 h-4" />
                    )}
                    <span>Unlock with Recovery Key</span>
                  </button>
                </form>
              )}
            </>
          )}

          {isTauriEnv() && (
            <div className="pt-3 border-t border-line flex items-center justify-between gap-2 text-[11px]">
              <button
                type="button"
                onClick={handleOpenAnotherDb}
                className="inline-flex items-center gap-1.5 text-ink-2 hover:text-ink cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>{t('vault.openAnotherDb')}</span>
              </button>
              <button
                type="button"
                onClick={onOpenWebDavVault}
                className="inline-flex items-center gap-1.5 text-ink-2 hover:text-ink cursor-pointer"
              >
                <CloudDownload className="w-3.5 h-3.5" />
                <span>{t('onboarding.openWebDav')}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
