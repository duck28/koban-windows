import React, { useEffect, useRef, useState } from 'react';
import {
  Fingerprint,
  KeyRound,
  Lock,
  ShieldCheck,
  Eye,
  EyeOff,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  UserCheck,
  Laptop,
  ArrowRight,
} from 'lucide-react';
import { AuthConfig, PasskeyCredentialRecord } from '../types';
import {
  authenticateWithPasskeyOrWindowsHello,
  checkBiometricPasskeySupport,
  hashPassphraseVerifier,
  registerPasskeyOrWindowsHello,
  verifyMasterPassphrase,
} from '../utils/auth';
import { Logo } from './Logo';
import { useI18n } from '../i18n';
import { LanguageSelect } from './LanguageSelect';

interface AuthLockScreenProps {
  authConfig: AuthConfig;
  hasCustomDbPassphrase?: boolean;
  onUnlockSuccess: (opts: {
    unlockedVaultSecret?: string;
    updatedConfig?: AuthConfig;
  }) => void;
}

export const AuthLockScreen: React.FC<AuthLockScreenProps> = ({
  authConfig,
  hasCustomDbPassphrase,
  onUnlockSuccess,
}) => {
  const { t } = useI18n();
  const hasCredentialsConfigured =
    authConfig.passkeys.length > 0 ||
    authConfig.hasMasterPassphrase ||
    Boolean(hasCustomDbPassphrase);

  const [displayName, setDisplayName] = useState(
    authConfig.userDisplayName || 'Koban Owner'
  );
  const [passphraseInput, setPassphraseInput] = useState('');
  const [confirmPassphraseInput, setConfirmPassphraseInput] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [supportInfo, setSupportInfo] = useState<{
    webauthnAvailable: boolean;
    platformAuthenticatorAvailable: boolean;
    windowsHelloNativeAvailable: boolean;
  }>({
    webauthnAvailable: true,
    platformAuthenticatorAvailable: true,
    windowsHelloNativeAvailable: false,
  });

  const autoPromptTriggered = useRef(false);

  useEffect(() => {
    checkBiometricPasskeySupport().then(setSupportInfo);
  }, []);

  // Auto-prompt Passkey / Windows Hello on launch if enabled and passkeys exist
  useEffect(() => {
    if (
      hasCredentialsConfigured &&
      authConfig.autoPromptPasskeyOnLaunch &&
      authConfig.passkeys.length > 0 &&
      !autoPromptTriggered.current
    ) {
      autoPromptTriggered.current = true;
      handleSignInWithPasskey();
    }
  }, [hasCredentialsConfigured, authConfig]);

  const handleSignInWithPasskey = async (specificId?: string) => {
    setErrorMsg(null);
    setStatusMsg('Waiting for Passkey / Windows Hello verification…');
    setIsBusy(true);
    try {
      const res = await authenticateWithPasskeyOrWindowsHello(
        authConfig,
        specificId
      );
      if (res.verified) {
        const now = Math.floor(Date.now() / 1000);
        const updatedPasskeys = authConfig.passkeys.map((p) =>
          p.id === res.credential.id ? { ...p, lastUsedAt: now } : p
        );
        const nextConfig: AuthConfig = {
          ...authConfig,
          passkeys: updatedPasskeys,
        };
        setStatusMsg('Verified via Passkey / Windows Hello.');
        onUnlockSuccess({
          unlockedVaultSecret: res.unwrappedVaultSecret,
          updatedConfig: nextConfig,
        });
      }
    } catch (err) {
      setStatusMsg(null);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Passkey / Windows Hello verification was canceled or failed.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleSignInWithPassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = passphraseInput.trim();
    if (!trimmed) {
      setErrorMsg('Please enter your Master Passphrase or PIN.');
      return;
    }

    setErrorMsg(null);
    setIsBusy(true);
    try {
      if (authConfig.hasMasterPassphrase) {
        const valid = await verifyMasterPassphrase(trimmed, authConfig);
        if (!valid) {
          setErrorMsg('Incorrect Master Passphrase or PIN. Please try again.');
          setIsBusy(false);
          return;
        }
      }
      onUnlockSuccess({
        unlockedVaultSecret: trimmed,
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to verify passphrase.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleEnrollPasskeyFirstTime = async (
    preferMode: 'auto' | 'webauthn' | 'windows_hello'
  ) => {
    setErrorMsg(null);
    setStatusMsg(
      preferMode === 'windows_hello'
        ? 'Opening Windows Hello security prompt…'
        : 'Opening Passkey / Windows Hello registration prompt…'
    );
    setIsBusy(true);
    try {
      const cleanName = displayName.trim() || 'Koban Owner';
      const secretToWrap = passphraseInput.trim() || undefined;
      const newCred: PasskeyCredentialRecord =
        await registerPasskeyOrWindowsHello({
          userDisplayName: cleanName,
          credentialLabel:
            preferMode === 'windows_hello'
              ? 'Windows Hello (This PC)'
              : 'Windows Hello / Passkey',
          preferMode,
          vaultSecretToWrap: secretToWrap,
        });

      let nextConfig: AuthConfig = {
        ...authConfig,
        enabled: true,
        userDisplayName: cleanName,
        passkeys: [...authConfig.passkeys, newCred],
      };

      if (secretToWrap) {
        const { saltB64, hashB64 } = await hashPassphraseVerifier(secretToWrap);
        nextConfig = {
          ...nextConfig,
          hasMasterPassphrase: true,
          passphraseSaltB64: saltB64,
          passphraseVerifierHashB64: hashB64,
        };
      }

      onUnlockSuccess({
        unlockedVaultSecret: secretToWrap,
        updatedConfig: nextConfig,
      });
    } catch (err) {
      setStatusMsg(null);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Could not complete Passkey / Windows Hello registration.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleEnrollPassphraseOnlyFirstTime = async (e: React.FormEvent) => {
    e.preventDefault();
    const p1 = passphraseInput.trim();
    const p2 = confirmPassphraseInput.trim();
    if (p1.length < 4) {
      setErrorMsg('Master Passphrase / PIN must be at least 4 characters.');
      return;
    }
    if (p1 !== p2) {
      setErrorMsg('Passphrases do not match.');
      return;
    }

    setErrorMsg(null);
    setIsBusy(true);
    try {
      const cleanName = displayName.trim() || 'Koban Owner';
      const { saltB64, hashB64 } = await hashPassphraseVerifier(p1);
      const nextConfig: AuthConfig = {
        ...authConfig,
        enabled: true,
        userDisplayName: cleanName,
        hasMasterPassphrase: true,
        passphraseSaltB64: saltB64,
        passphraseVerifierHashB64: hashB64,
      };
      onUnlockSuccess({
        unlockedVaultSecret: p1,
        updatedConfig: nextConfig,
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to configure passphrase.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-app text-ink flex flex-col items-center justify-center p-6 select-none relative overflow-hidden">
      {/* Subtle Ambient Background Grid */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
          backgroundSize: '28px 28px',
        }}
      />

      <div className="w-full max-w-md bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden relative z-10">
        <div className="absolute top-3.5 right-3.5 z-20">
          <LanguageSelect variant="compact" />
        </div>
        {/* Top Header */}
        <div className="px-6 pt-7 pb-5 border-b border-line bg-app/50 flex flex-col items-center text-center">
          <div className="mb-3.5 flex items-center justify-center">
            <Logo variant="full" size={28} />
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-positive/10 border border-positive/25 text-positive text-[10px] font-medium mb-2">
            <ShieldCheck className="w-3 h-3" />
            <span>{t('lock.encrypted')}</span>
          </div>

          <h1 className="text-lg font-semibold text-ink tracking-tight">
            {hasCredentialsConfigured
              ? t('lock.signIn')
              : t('lock.configure')}
          </h1>

          <p className="text-xs text-ink-2 mt-1 max-w-xs">
            {hasCredentialsConfigured
              ? `Welcome back, ${authConfig.userDisplayName || 'Koban Owner'}. Verify your identity to decrypt and unlock your ledger.`
              : `Protect your Home Budget, Freelance Ledger & Net Worth with Windows Hello, a Passkey, or a Master Passphrase.`}
          </p>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-negative/10 border border-negative/25 flex items-start gap-2.5 text-xs text-negative">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {statusMsg && !errorMsg && (
            <div className="p-3 rounded-xl bg-indigo/10 border border-indigo/25 flex items-center gap-2.5 text-xs text-indigo">
              <Sparkles className="w-4 h-4 shrink-0 animate-pulse" />
              <span>{statusMsg}</span>
            </div>
          )}

          {hasCredentialsConfigured ? (
            /* ================= EXISTING USER SIGN-IN VIEW ================= */
            <>
              {authConfig.passkeys.length > 0 && (
                <div className="space-y-2.5">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleSignInWithPasskey()}
                    className="w-full h-11 px-4 rounded-xl bg-ink text-app font-medium text-xs inline-flex items-center justify-center gap-2.5 hover:opacity-90 transition-opacity shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    <Fingerprint className="w-4 h-4" />
                    <span>{t('lock.passkeyBtn')}</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
                  </button>

                  {authConfig.passkeys.length > 1 && (
                    <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                      {authConfig.passkeys.map((pk) => (
                        <button
                          key={pk.id}
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleSignInWithPasskey(pk.id)}
                          className="px-2.5 py-1 rounded-lg bg-raised border border-line text-[11px] text-ink-2 hover:text-ink hover:bg-line/50 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Laptop className="w-3 h-3 text-indigo" />
                          <span>{pk.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {authConfig.passkeys.length > 0 &&
                (authConfig.hasMasterPassphrase || hasCustomDbPassphrase) && (
                  <div className="relative flex items-center justify-center">
                    <div className="border-t border-line w-full" />
                    <span className="bg-surface px-3 text-[10px] uppercase tracking-wider text-ink-3">
                      {t('lock.orPassphrase')}
                    </span>
                    <div className="border-t border-line w-full" />
                  </div>
                )}

              {(authConfig.hasMasterPassphrase ||
                hasCustomDbPassphrase ||
                authConfig.passkeys.length === 0) && (
                <form
                  onSubmit={handleSignInWithPassphrase}
                  className="space-y-3"
                >
                  <div>
                    <label className="block text-[11px] font-medium text-ink-2 mb-1.5">
                      {t('lock.passphraseLabel')}
                    </label>
                    <div className="relative">
                      <KeyRound className="w-3.5 h-3.5 text-ink-3 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type={showPassphrase ? 'text' : 'password'}
                        value={passphraseInput}
                        onChange={(e) => setPassphraseInput(e.target.value)}
                        placeholder="Enter passphrase or PIN…"
                        autoFocus={authConfig.passkeys.length === 0}
                        className="w-full h-10 pl-9 pr-9 rounded-xl bg-raised border border-line text-xs text-ink focus:outline-none focus:border-ink-2"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassphrase((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink cursor-pointer"
                      >
                        {showPassphrase ? (
                          <EyeOff className="w-3.5 h-3.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isBusy}
                    className={`w-full h-10 px-4 rounded-xl text-xs font-medium inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50 ${
                      authConfig.passkeys.length === 0
                        ? 'bg-ink text-app hover:opacity-90'
                        : 'bg-raised border border-line text-ink hover:bg-line/70'
                    }`}
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>{t('lock.unlockPassphrase')}</span>
                  </button>
                </form>
              )}
            </>
          ) : (
            /* ================= FIRST-TIME LOGIN ENROLLMENT VIEW ================= */
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-medium text-ink-2 mb-1.5">
                  Account Display Name
                </label>
                <div className="relative">
                  <UserCheck className="w-3.5 h-3.5 text-ink-3 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Roland"
                    className="w-full h-9 pl-9 pr-3 rounded-xl bg-raised border border-line text-xs text-ink focus:outline-none focus:border-ink-2"
                  />
                </div>
              </div>

              {/* Primary Passkey / Windows Hello Enrollment Box */}
              <div className="p-3.5 rounded-xl bg-indigo/8 border border-indigo/25 space-y-2.5">
                <div className="flex items-start gap-2.5">
                  <Fingerprint className="w-4 h-4 text-indigo shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-medium text-ink">
                      Passkey & Windows Hello (Recommended)
                    </div>
                    <p className="text-[11px] text-ink-2 leading-relaxed mt-0.5">
                      Sign in with your Windows Hello Face, Fingerprint, PIN, or
                      hardware security key without typing a password.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleEnrollPasskeyFirstTime('auto')}
                    className="w-full h-10 px-4 rounded-xl bg-ink text-app text-xs font-medium inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                  >
                    <Fingerprint className="w-4 h-4" />
                    <span>{t('lock.enroll')}</span>
                  </button>

                  {supportInfo.windowsHelloNativeAvailable && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        handleEnrollPasskeyFirstTime('windows_hello')
                      }
                      className="w-full h-9 px-3 rounded-xl bg-surface border border-line text-xs text-ink hover:bg-raised inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Laptop className="w-3.5 h-3.5 text-indigo" />
                      <span>Use Native Windows Hello OS Prompt</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="relative flex items-center justify-center">
                <div className="border-t border-line w-full" />
                <span className="bg-surface px-3 text-[10px] uppercase tracking-wider text-ink-3">
                  Or set Master Passphrase / PIN
                </span>
                <div className="border-t border-line w-full" />
              </div>

              <form
                onSubmit={handleEnrollPassphraseOnlyFirstTime}
                className="space-y-2.5"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type={showPassphrase ? 'text' : 'password'}
                    value={passphraseInput}
                    onChange={(e) => setPassphraseInput(e.target.value)}
                    placeholder="Passphrase or PIN…"
                    className="w-full h-9 px-3 rounded-xl bg-raised border border-line text-xs text-ink focus:outline-none focus:border-ink-2"
                  />
                  <input
                    type={showPassphrase ? 'text' : 'password'}
                    value={confirmPassphraseInput}
                    onChange={(e) => setConfirmPassphraseInput(e.target.value)}
                    placeholder="Confirm…"
                    className="w-full h-9 px-3 rounded-xl bg-raised border border-line text-xs text-ink focus:outline-none focus:border-ink-2"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isBusy || !passphraseInput.trim()}
                  className="w-full h-9 px-3 rounded-xl bg-raised border border-line text-xs font-medium text-ink hover:bg-line/70 transition-colors cursor-pointer disabled:opacity-40"
                >
                  Save Passphrase & Sign In
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-line bg-app/40 flex items-center justify-between text-[11px] text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-positive" />
            <span>WebAuthn FIDO2 / Windows Hello Ready</span>
          </span>
          <span>Local Zero-Knowledge Vault</span>
        </div>
      </div>
    </div>
  );
};
