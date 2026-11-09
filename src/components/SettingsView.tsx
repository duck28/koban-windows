import React, { useEffect, useState } from 'react';
import {
  SlidersHorizontal,
  CopyCheck,
  Calculator,
  Globe,
  Sun,
  Moon,
  Monitor,
  ShieldCheck,
  Sparkles,
  FolderOpen,
  Fingerprint,
  KeyRound,
  Lock,
  Laptop,
  Trash2,
  CheckCircle2,
  Plus,
  Palette,
  Check,
} from 'lucide-react';
import {
  AppSettings,
  AuthConfig,
  MonthCopyScope,
  ProfileSetupMode,
  ThemePalette,
} from '../types';
import { pickFolderDialog } from '../utils/storage';
import { useI18n } from '../i18n';
import { LanguageSelect } from './LanguageSelect';
import { DbLocationCard } from './DbLocationCard';
import { WebDavSyncCard } from './WebDavSyncCard';
import {
  checkBiometricPasskeySupport,
  hashPassphraseVerifier,
  registerPasskeyOrWindowsHello,
} from '../utils/auth';

interface SettingsViewProps {
  settings: AppSettings;
  authConfig: AuthConfig;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onUpdateAuthConfig: (next: AuthConfig) => void;
  onLockVaultNow: () => void;
  onOpenSetupWizard: () => void;
  onOpenBackupsTab: () => void;
  onReloadLedgerState?: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  authConfig,
  onUpdateSettings,
  onUpdateAuthConfig,
  onLockVaultNow,
  onOpenSetupWizard,
  onOpenBackupsTab,
  onReloadLedgerState,
}) => {
  const { t } = useI18n();
  const [newCredentialLabel, setNewCredentialLabel] = useState(
    'Windows Hello / Passkey'
  );
  const [newPassphrase, setNewPassphrase] = useState('');
  const [authStatusMsg, setAuthStatusMsg] = useState<string | null>(null);
  const [isRegisteringPasskey, setIsRegisteringPasskey] = useState(false);
  const [windowsHelloNativeAvailable, setWindowsHelloNativeAvailable] =
    useState(false);

  useEffect(() => {
    checkBiometricPasskeySupport().then((info) => {
      setWindowsHelloNativeAvailable(info.windowsHelloNativeAvailable);
    });
  }, []);

  const handleRegisterPasskey = async (
    preferMode: 'auto' | 'webauthn' | 'windows_hello'
  ) => {
    setIsRegisteringPasskey(true);
    setAuthStatusMsg(null);
    try {
      const cred = await registerPasskeyOrWindowsHello({
        userDisplayName: authConfig.userDisplayName || 'Koban Owner',
        credentialLabel:
          newCredentialLabel.trim() ||
          (preferMode === 'windows_hello'
            ? 'Windows Hello (This PC)'
            : 'Passkey / Windows Hello'),
        preferMode,
      });
      onUpdateAuthConfig({
        ...authConfig,
        enabled: true,
        passkeys: [...authConfig.passkeys, cred],
      });
      setAuthStatusMsg(`Enrolled "${cred.name}" successfully.`);
    } catch (err) {
      setAuthStatusMsg(
        err instanceof Error
          ? err.message
          : 'Passkey / Windows Hello registration failed.'
      );
    } finally {
      setIsRegisteringPasskey(false);
    }
  };

  const handleRemovePasskey = (id: string) => {
    const remaining = authConfig.passkeys.filter((p) => p.id !== id);
    onUpdateAuthConfig({
      ...authConfig,
      passkeys: remaining,
    });
    setAuthStatusMsg('Removed Passkey credential.');
  };

  const handleSetMasterPassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPassphrase.trim();
    if (trimmed.length < 4) {
      setAuthStatusMsg('Master Passphrase / PIN must be at least 4 characters.');
      return;
    }
    const { saltB64, hashB64 } = await hashPassphraseVerifier(trimmed);
    onUpdateAuthConfig({
      ...authConfig,
      enabled: true,
      hasMasterPassphrase: true,
      passphraseSaltB64: saltB64,
      passphraseVerifierHashB64: hashB64,
    });
    setNewPassphrase('');
    setAuthStatusMsg('Updated Master Passphrase / PIN.');
  };

  const handleChooseBackupFolder = async () => {
    const picked = await pickFolderDialog(
      'Select Automatic Encrypted Database Backup Folder'
    );
    if (picked) {
      onUpdateSettings({ backupDir: picked, autoBackup: true });
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-line">
        <div>
          <span className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
            {t('settings.subtitle')}
          </span>
          <h1 className="text-xl font-medium text-ink tracking-tight mt-0.5">
            {t('settings.title')}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onLockVaultNow}
            className="h-8 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-raised border border-line text-xs text-ink hover:bg-line/70 transition-colors cursor-pointer"
            title="Lock Koban immediately (Ctrl+L)"
          >
            <Lock className="w-3.5 h-3.5 text-indigo" />
            <span>{t('settings.lockNow')}</span>
          </button>

          <button
            onClick={onOpenSetupWizard}
            className="h-8 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line text-xs text-ink hover:bg-raised transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            <span>{t('settings.wizard')}</span>
          </button>
        </div>
      </div>

      {/* Language */}
      <section className="p-5 rounded-xl bg-surface border border-line space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b border-line">
          <Globe className="w-4 h-4 text-accent" />
          <div>
            <h2 className="text-sm font-medium text-ink">
              {t('settings.language.title')}
            </h2>
            <p className="text-xs text-ink-2">{t('settings.language.desc')}</p>
          </div>
        </div>
        <div className="max-w-xs">
          <label className="block text-[11px] text-ink-2 mb-1">
            {t('settings.language.label')}
          </label>
          <LanguageSelect
            onChanged={(code) => onUpdateSettings({ language: code })}
          />
        </div>
      </section>

      {/* 0. Login, Passkeys & Windows Hello Authentication */}
      <section className="p-5 rounded-xl bg-surface border border-line space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-line">
          <div className="flex items-center gap-2">
            <Fingerprint className="w-4 h-4 text-indigo" />
            <div>
              <h2 className="text-sm font-medium text-ink">
                {t('settings.login.title')}
              </h2>
              <p className="text-xs text-ink-2">
                Require authentication when opening Koban using WebAuthn Passkeys, Windows Hello Biometrics/PIN, or a Master Passphrase
              </p>
            </div>
          </div>

          <span
            className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium inline-flex items-center gap-1 border ${
              authConfig.enabled
                ? 'bg-positive/12 border-positive/30 text-positive'
                : 'bg-raised border-line text-ink-3'
            }`}
          >
            <CheckCircle2 className="w-3 h-3" />
            <span>
              {authConfig.enabled ? t('settings.login.enabled') : t('settings.login.disabled')}
            </span>
          </span>
        </div>

        {authStatusMsg && (
          <div className="p-2.5 rounded-lg bg-indigo/10 border border-indigo/25 text-xs text-indigo">
            {authStatusMsg}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-app border border-line cursor-pointer">
            <div>
              <div className="text-xs font-medium text-ink">
                {t('settings.login.require')}
              </div>
              <p className="text-[11px] text-ink-2 mt-0.5">
                Lock the ledger behind Passkey / Windows Hello or Master Passphrase on startup.
              </p>
            </div>
            <input
              type="checkbox"
              checked={authConfig.enabled}
              onChange={(e) =>
                onUpdateAuthConfig({
                  ...authConfig,
                  enabled: e.target.checked,
                })
              }
              className="mt-0.5 rounded border-line"
            />
          </label>

          <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-app border border-line cursor-pointer">
            <div>
              <div className="text-xs font-medium text-ink">
                Auto-prompt Passkey / Windows Hello on launch
              </div>
              <p className="text-[11px] text-ink-2 mt-0.5">
                Automatically open the Windows Hello / Passkey prompt as soon as the lock screen appears.
              </p>
            </div>
            <input
              type="checkbox"
              checked={authConfig.autoPromptPasskeyOnLaunch}
              onChange={(e) =>
                onUpdateAuthConfig({
                  ...authConfig,
                  autoPromptPasskeyOnLaunch: e.target.checked,
                })
              }
              className="mt-0.5 rounded border-line"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-app border border-line">
            <label className="block text-[11px] font-medium text-ink-2 mb-1">
              Account Owner Display Name
            </label>
            <input
              type="text"
              value={authConfig.userDisplayName}
              onChange={(e) =>
                onUpdateAuthConfig({
                  ...authConfig,
                  userDisplayName: e.target.value,
                })
              }
              placeholder="e.g. Roland"
              className="w-full h-8 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none"
            />
          </div>

          <div className="p-3 rounded-lg bg-app border border-line">
            <label className="block text-[11px] font-medium text-ink-2 mb-1">
              Inactivity Auto-Lock Timer
            </label>
            <select
              value={authConfig.autoLockMinutes}
              onChange={(e) =>
                onUpdateAuthConfig({
                  ...authConfig,
                  autoLockMinutes: parseInt(e.target.value, 10) || 0,
                })
              }
              className="w-full h-8 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none"
            >
              <option value={0}>Never auto-lock while open</option>
              <option value={5}>Lock after 5 minutes idle</option>
              <option value={15}>Lock after 15 minutes idle</option>
              <option value={30}>Lock after 30 minutes idle</option>
              <option value={60}>Lock after 60 minutes idle</option>
            </select>
          </div>
        </div>

        {/* Registered Passkeys & Windows Hello */}
        <div className="p-3.5 rounded-xl bg-app border border-line space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-ink">
                Enrolled Passkeys & Windows Hello Credentials ({authConfig.passkeys.length})
              </div>
              <p className="text-[11px] text-ink-2">
                Register Windows Hello (Face, Fingerprint, PIN) or a FIDO2 hardware security key
              </p>
            </div>
          </div>

          {authConfig.passkeys.length > 0 ? (
            <div className="space-y-1.5">
              {authConfig.passkeys.map((pk) => (
                <div
                  key={pk.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface border border-line text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <Laptop className="w-3.5 h-3.5 text-indigo shrink-0" />
                    <div>
                      <div className="font-medium text-ink">{pk.name}</div>
                      <div className="text-[10px] text-ink-3">
                        {pk.kind === 'windows_hello_native'
                          ? 'Native Windows Hello OS Verifier'
                          : 'WebAuthn FIDO2 Passkey'}{' '}
                        • Added{' '}
                        {new Date(pk.createdAt * 1000).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemovePasskey(pk.id)}
                    className="h-7 px-2 rounded-md text-ink-3 hover:text-negative hover:bg-negative/10 inline-flex items-center gap-1 text-[11px] cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Remove</span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-ink-3 py-1">
              No Passkey or Windows Hello credential registered yet.
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2 pt-1">
            <div className="flex-[1_1_200px] min-w-[160px]">
              <label className="block text-[10px] text-ink-3 mb-1">
                Credential Label
              </label>
              <input
                type="text"
                value={newCredentialLabel}
                onChange={(e) => setNewCredentialLabel(e.target.value)}
                placeholder="e.g. Windows Hello (Workstation)"
                className="w-full h-8 px-2.5 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none"
              />
            </div>

            <button
              type="button"
              disabled={isRegisteringPasskey}
              onClick={() => handleRegisterPasskey('auto')}
              className="h-8 px-3.5 rounded-lg bg-ink text-app text-xs font-medium inline-flex items-center gap-1.5 hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Enroll Passkey / Windows Hello</span>
            </button>

            {windowsHelloNativeAvailable && (
              <button
                type="button"
                disabled={isRegisteringPasskey}
                onClick={() => handleRegisterPasskey('windows_hello')}
                className="h-8 px-3 rounded-lg bg-surface border border-line text-xs text-ink hover:bg-raised inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Laptop className="w-3.5 h-3.5 text-indigo" />
                <span>Enroll Native Windows Hello</span>
              </button>
            )}
          </div>
        </div>

        {/* Backup Master Passphrase / PIN */}
        <form
          onSubmit={handleSetMasterPassphrase}
          className="p-3.5 rounded-xl bg-app border border-line flex flex-wrap items-end gap-2.5"
        >
          <div className="flex-[1_1_240px] min-w-[180px]">
            <label className="block text-[11px] font-medium text-ink-2 mb-1">
              {authConfig.hasMasterPassphrase
                ? 'Update Master Passphrase / PIN (Configured)'
                : 'Set Optional Backup Master Passphrase / PIN'}
            </label>
            <div className="relative">
              <KeyRound className="w-3.5 h-3.5 text-ink-3 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={newPassphrase}
                onChange={(e) => setNewPassphrase(e.target.value)}
                placeholder="Enter new Master Passphrase or PIN…"
                className="w-full h-8 pl-8 pr-3 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!newPassphrase.trim()}
            className="h-8 px-3.5 rounded-lg bg-surface border border-line text-xs font-medium text-ink hover:bg-raised transition-colors cursor-pointer disabled:opacity-40"
          >
            {authConfig.hasMasterPassphrase
              ? 'Update Passphrase'
              : 'Save Passphrase'}
          </button>

          {authConfig.hasMasterPassphrase && (
            <button
              type="button"
              onClick={() => {
                onUpdateAuthConfig({
                  ...authConfig,
                  hasMasterPassphrase: false,
                  passphraseSaltB64: undefined,
                  passphraseVerifierHashB64: undefined,
                });
                setAuthStatusMsg('Removed Master Passphrase.');
              }}
              className="h-8 px-3 rounded-lg text-xs text-ink-3 hover:text-negative hover:bg-negative/10 cursor-pointer"
            >
              Remove Passphrase
            </button>
          )}
        </form>
      </section>

      {/* 1. Month-to-Month Rollover & Copy Behavior */}
      <section className="p-5 rounded-xl bg-surface border border-line space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-line">
          <CopyCheck className="w-4 h-4 text-positive" />
          <div>
            <h2 className="text-sm font-medium text-ink">
              {t('settings.copy.title')}
            </h2>
            <p className="text-xs text-ink-2">
              Control how Koban copies last month&apos;s values into the next month and when confirmation prompts appear
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {/* Confirm before copying */}
          <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-app border border-line cursor-pointer">
            <div>
              <div className="text-xs font-medium text-ink">
                Ask for confirmation before copying values between months
              </div>
              <p className="text-[11px] text-ink-2 mt-0.5">
                When enabled, Koban always asks if you are sure before copying last month&apos;s values into the next month or across all 12 months.
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.confirmBeforeMonthCopy ?? true}
              onChange={(e) =>
                onUpdateSettings({ confirmBeforeMonthCopy: e.target.checked })
              }
              className="mt-0.5 rounded border-line"
            />
          </label>

          {/* Offer carry-over banner on empty month */}
          <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-app border border-line cursor-pointer">
            <div>
              <div className="text-xs font-medium text-ink">
                Show carry-over prompt when viewing an empty month
              </div>
              <p className="text-[11px] text-ink-2 mt-0.5">
                When navigating to a month with 0.00 budgets and actuals, display a quick prompt to copy the previous month&apos;s values.
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.autoPromptCopyOnEmptyMonth ?? true}
              onChange={(e) =>
                onUpdateSettings({
                  autoPromptCopyOnEmptyMonth: e.target.checked,
                })
              }
              className="mt-0.5 rounded border-line"
            />
          </label>

          {/* Overwrite existing non-zero values */}
          <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-app border border-line cursor-pointer">
            <div>
              <div className="text-xs font-medium text-ink">
                Overwrite existing non-zero values in target month by default
              </div>
              <p className="text-[11px] text-ink-2 mt-0.5">
                If disabled, copying a month will only fill categories that are currently 0.00 in the target month.
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.monthCopyOverwriteExisting ?? true}
              onChange={(e) =>
                onUpdateSettings({
                  monthCopyOverwriteExisting: e.target.checked,
                })
              }
              className="mt-0.5 rounded border-line"
            />
          </label>

          {/* Default Month Copy Scope */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-app border border-line">
            <div>
              <div className="text-xs font-medium text-ink">
                Default Values to Copy Between Months
              </div>
              <p className="text-[11px] text-ink-2 mt-0.5">
                Choose whether copying last month carries over only Planned Budgets or both Budgets and Direct Actuals.
              </p>
            </div>
            <select
              value={settings.monthCopyScope ?? 'budgets_and_actuals'}
              onChange={(e) =>
                onUpdateSettings({
                  monthCopyScope: e.target.value as MonthCopyScope,
                })
              }
              className="h-8 px-3 rounded-lg bg-surface border border-line text-xs text-ink focus:outline-none"
            >
              <option value="budgets_and_actuals">
                Copy Both Planned Budgets & Direct Actuals
              </option>
              <option value="budgets_only">
                Copy Planned Budgets Only (Reset Actuals)
              </option>
            </select>
          </div>
        </div>
      </section>

      {/* 2. Data Import Preview, Worksheet & Deletion Safety Behavior */}
      <section className="p-5 rounded-xl bg-surface border border-line space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-line">
          <SlidersHorizontal className="w-4 h-4 text-indigo" />
          <div>
            <h2 className="text-sm font-medium text-ink">
              {t('settings.import.title')}
            </h2>
            <p className="text-xs text-ink-2">
              Control import data preview & confirmation prompts, table visibility, and deletion safety
            </p>
          </div>
        </div>

        <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-app border border-line cursor-pointer">
          <div>
            <div className="text-xs font-medium text-ink">
              {t('settings.import.preview')}
            </div>
            <p className="text-[11px] text-ink-2 mt-0.5">
              When enabled, importing an Excel workbook, CSV budget sheet, transaction statement, or encrypted database backup shows a detailed preview table of parsed categories, amounts, or transactions and asks for your confirmation before modifying the ledger.
            </p>
          </div>
          <input
            type="checkbox"
            checked={settings.confirmAndPreviewBeforeImport ?? true}
            onChange={(e) =>
              onUpdateSettings({
                confirmAndPreviewBeforeImport: e.target.checked,
              })
            }
            className="mt-0.5 rounded border-line"
          />
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-app border border-line cursor-pointer">
            <div>
              <div className="text-xs font-medium text-ink">
                Ask for confirmation before deleting categories, groups, or accounts
              </div>
              <p className="text-[11px] text-ink-2 mt-0.5">
                Prevents accidental removal of categories or financial accounts that have historical data.
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.confirmBeforeDelete ?? true}
              onChange={(e) =>
                onUpdateSettings({ confirmBeforeDelete: e.target.checked })
              }
              className="mt-0.5 rounded border-line"
            />
          </label>

          <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-app border border-line cursor-pointer">
            <div>
              <div className="text-xs font-medium text-ink">
                Hide 0.00 rows by default in Monthly Worksheet
              </div>
              <p className="text-[11px] text-ink-2 mt-0.5">
                Start the Monthly Budget worksheet with inactive (0 budget & 0 actual) categories collapsed.
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.defaultHideZeroRows ?? false}
              onChange={(e) =>
                onUpdateSettings({ defaultHideZeroRows: e.target.checked })
              }
              className="mt-0.5 rounded border-line"
            />
          </label>
        </div>
      </section>

      {/* 3. Workspace Profile, Currency, Theme & Tax Defaults */}
      <section className="p-5 rounded-xl bg-surface border border-line space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-line">
          <Globe className="w-4 h-4 text-accent" />
          <div>
            <h2 className="text-sm font-medium text-ink">
              {t('settings.workspace.title')}
            </h2>
            <p className="text-xs text-ink-2">
              Regional currency formatting, Freelancer VAT/Tax reserve rates, and Washi/Sumi theme
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-[11px] text-ink-2 mb-1">
              Enabled Profile Mode
            </label>
            <select
              value={settings.setupMode}
              onChange={(e) => {
                const mode = e.target.value as ProfileSetupMode;
                onUpdateSettings({
                  setupMode: mode,
                  activeWorkspace:
                    mode === 'freelancer'
                      ? 'freelancer'
                      : mode === 'home'
                        ? 'home'
                        : settings.activeWorkspace,
                });
              }}
              className="w-full h-9 px-2.5 rounded-lg bg-app border border-line text-xs text-ink focus:outline-none"
            >
              <option value="both">Both (Home + Freelancer)</option>
              <option value="home">Home Budget Only</option>
              <option value="freelancer">Freelancer / Business Only</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-ink-2 mb-1">
              {t('settings.currency')}
            </label>
            <select
              value={settings.currency}
              onChange={(e) => onUpdateSettings({ currency: e.target.value })}
              className="w-full h-9 px-2.5 rounded-lg bg-app border border-line text-xs text-ink focus:outline-none"
            >
              <option value="CHF">CHF — Swiss Franc</option>
              <option value="EUR">EUR (€) — Euro</option>
              <option value="USD">USD ($) — US Dollar</option>
              <option value="GBP">GBP (£) — British Pound</option>
              <option value="JPY">JPY (¥) — Japanese Yen</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-ink-2 mb-1">
              Default Freelancer VAT %
            </label>
            <div className="relative">
              <Calculator className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                type="number"
                step="0.1"
                value={settings.defaultVatRate}
                onChange={(e) =>
                  onUpdateSettings({
                    defaultVatRate: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full h-9 pl-8 pr-3 rounded-lg bg-app border border-line text-xs text-ink tabular-nums focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-ink-2 mb-1">
              Tax Reserve Set-Aside %
            </label>
            <input
              type="number"
              step="1"
              value={settings.taxReserveRate}
              onChange={(e) =>
                onUpdateSettings({
                  taxReserveRate: parseFloat(e.target.value) || 0,
                })
              }
              className="w-full h-9 px-3 rounded-lg bg-app border border-line text-xs text-ink tabular-nums focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* 4. Themes & Personalization */}
      <section className="p-5 rounded-xl bg-surface border border-line space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-line">
          <div className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-accent" />
            <div>
              <h2 className="text-sm font-medium text-ink">
                {t('settings.themeAndPersonalization.title')}
              </h2>
              <p className="text-xs text-ink-2">
                {t('settings.themeAndPersonalization.desc')}
              </p>
            </div>
          </div>
          {/* Light / Dark Mode selector */}
          <div className="flex items-center gap-1.5 bg-app p-1 rounded-lg border border-line text-xs">
            {(
              [
                { id: 'system', label: t('settings.themeMode.system'), icon: Monitor },
                { id: 'light', label: t('settings.themeMode.light'), icon: Sun },
                { id: 'dark', label: t('settings.themeMode.dark'), icon: Moon },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = settings.theme === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onUpdateSettings({ theme: item.id })}
                  className={`h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md cursor-pointer transition-colors ${
                    active
                      ? 'bg-surface text-ink font-medium shadow-2xs'
                      : 'text-ink-2 hover:text-ink'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Color Palette Selector Cards */}
        <div>
          <label className="block text-xs font-medium text-ink mb-2">
            {t('settings.palette.title')}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                id: 'default' as ThemePalette,
                name: t('settings.palette.default'),
                desc: t('settings.palette.defaultDesc'),
                swatches: ['#b9432f', '#3f704d', '#3f6e8c', '#b8862d'],
                badge: 'Default Zen',
              },
              {
                id: 'monochrome' as ThemePalette,
                name: t('settings.palette.monochrome'),
                desc: t('settings.palette.monochromeDesc'),
                swatches: ['#111111', '#383838', '#757575', '#ffffff'],
                badge: 'Pure B&W',
              },
              {
                id: 'slate' as ThemePalette,
                name: t('settings.palette.slate'),
                desc: t('settings.palette.slateDesc'),
                swatches: ['#0284c7', '#059669', '#3b82f6', '#d97706'],
                badge: 'Arctic Nord',
              },
              {
                id: 'forest' as ThemePalette,
                name: t('settings.palette.forest'),
                desc: t('settings.palette.forestDesc'),
                swatches: ['#1e5a38', '#2e7d32', '#2c6e64', '#c28100'],
                badge: 'Botanical',
              },
            ].map((p) => {
              const currentPalette = settings.themePalette || 'default';
              const active = currentPalette === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onUpdateSettings({ themePalette: p.id })}
                  className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                    active
                      ? 'border-ink bg-raised/70 ring-1 ring-ink/30 shadow-xs'
                      : 'border-line bg-app hover:border-ink-3 hover:bg-raised/40'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-xs font-semibold text-ink flex items-center gap-1.5">
                        {p.name}
                        {active && <Check className="w-3.5 h-3.5 text-accent inline" />}
                      </span>
                      <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-surface border border-line text-ink-2">
                        {p.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-ink-2 line-clamp-2 leading-relaxed mb-3">
                      {p.desc}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 pt-2 border-t border-line/60">
                    {p.swatches.map((color, idx) => (
                      <span
                        key={idx}
                        className="w-4 h-4 rounded-full border border-line/80 shadow-2xs inline-block"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Additional Personalization Options */}
        <div className="pt-3 border-t border-line grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center justify-between p-3 rounded-lg bg-app border border-line">
            <div>
              <div className="text-xs font-medium text-ink">
                {t('settings.density.title')}
              </div>
              <div className="text-[11px] text-ink-2">
                Comfortable spacious layout or compact data density
              </div>
            </div>
            <div className="flex items-center gap-1 bg-surface p-1 rounded-md border border-line text-xs">
              <button
                type="button"
                onClick={() => onUpdateSettings({ density: 'comfortable' })}
                className={`px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                  (settings.density || 'comfortable') === 'comfortable'
                    ? 'bg-raised text-ink font-medium shadow-2xs'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                Cozy
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ density: 'compact' })}
                className={`px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                  settings.density === 'compact'
                    ? 'bg-raised text-ink font-medium shadow-2xs'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                Compact
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-app border border-line">
            <div>
              <div className="text-xs font-medium text-ink">
                {t('settings.contrast.title')}
              </div>
              <div className="text-[11px] text-ink-2">
                {t('settings.contrast.desc')}
              </div>
            </div>
            <input
              type="checkbox"
              checked={Boolean(settings.highContrastAmounts)}
              onChange={(e) =>
                onUpdateSettings({ highContrastAmounts: e.target.checked })
              }
              className="w-4 h-4 rounded border-line text-accent cursor-pointer accent-accent"
            />
          </div>
        </div>
      </section>

      {/* 4. Automatic Encrypted Database Backups Quick Config */}
      <section className="p-5 rounded-xl bg-surface border border-line space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-line">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-positive" />
            <div>
              <h2 className="text-sm font-medium text-ink">
                AES-256-GCM Database & Auto-Backup Preferences
              </h2>
              <p className="text-xs text-ink-2">
                Automatic encrypted snapshots to your chosen directory
              </p>
            </div>
          </div>

          <button
            onClick={onOpenBackupsTab}
            className="text-xs text-indigo hover:underline cursor-pointer"
          >
            Open Full Vault & Backup Manager →
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-7">
            <label className="block text-[11px] text-ink-2 mb-1">
              Automatic Backup Folder Path
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={settings.backupDir}
                onChange={(e) =>
                  onUpdateSettings({ backupDir: e.target.value })
                }
                placeholder="Choose a folder for automatic encrypted backups…"
                className="flex-1 h-9 px-3 rounded-lg bg-app border border-line text-xs text-ink focus:outline-none"
              />
              <button
                type="button"
                onClick={handleChooseBackupFolder}
                className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-raised border border-line text-xs text-ink hover:bg-line/60 cursor-pointer shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Browse…</span>
              </button>
            </div>
          </div>

          <div className="md:col-span-3">
            <label className="block text-[11px] text-ink-2 mb-1">
              Max Rolling Snapshots
            </label>
            <input
              type="number"
              min={3}
              max={200}
              value={settings.maxBackups}
              onChange={(e) =>
                onUpdateSettings({
                  maxBackups: Math.max(3, parseInt(e.target.value, 10) || 20),
                })
              }
              className="w-full h-9 px-3 rounded-lg bg-app border border-line text-xs text-ink tabular-nums focus:outline-none"
            />
          </div>

          <div className="md:col-span-2 flex items-center h-9">
            <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoBackup}
                onChange={(e) =>
                  onUpdateSettings({ autoBackup: e.target.checked })
                }
                className="rounded border-line"
              />
              <span>Auto-Backup</span>
            </label>
          </div>
        </div>
      </section>

      {/* 5. Expert Settings: Relocate Database Location */}
      <DbLocationCard />

      {/* 6. Cloud Sync: WebDAV Synchronization */}
      <WebDavSyncCard
        settings={settings}
        onUpdateSettings={onUpdateSettings}
        onStateReloaded={onReloadLedgerState}
      />
    </div>
  );
};
