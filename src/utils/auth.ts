import { invoke } from '@tauri-apps/api/core';
import { AuthConfig, PasskeyCredentialRecord } from '../types';
import { isTauriEnv } from './storage';

const AUTH_STORAGE_KEY = 'koban_auth_config_v1';

export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  enabled: false,
  userDisplayName: 'Koban Owner',
  autoPromptPasskeyOnLaunch: false,
  autoLockMinutes: 15,
  passkeys: [],
  hasMasterPassphrase: false,
};

function bufferToBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

export async function loadAuthConfig(): Promise<AuthConfig> {
  try {
    if (isTauriEnv()) {
      const raw = await invoke<string | null>('get_auth_config');
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AuthConfig>;
        return {
          ...DEFAULT_AUTH_CONFIG,
          ...parsed,
          passkeys: parsed.passkeys ?? [],
        };
      }
    }
    const local = localStorage.getItem(AUTH_STORAGE_KEY);
    if (local) {
      const parsed = JSON.parse(local) as Partial<AuthConfig>;
      return {
        ...DEFAULT_AUTH_CONFIG,
        ...parsed,
        passkeys: parsed.passkeys ?? [],
      };
    }
  } catch (err) {
    console.error('Failed to load auth config:', err);
  }
  return { ...DEFAULT_AUTH_CONFIG };
}

export async function saveAuthConfig(config: AuthConfig): Promise<void> {
  const json = JSON.stringify(config);
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, json);
  } catch {
    // ignore storage quota errors
  }
  if (isTauriEnv()) {
    await invoke('save_auth_config', { configJson: json });
  }
}

export async function checkBiometricPasskeySupport(): Promise<{
  webauthnAvailable: boolean;
  platformAuthenticatorAvailable: boolean;
  windowsHelloNativeAvailable: boolean;
}> {
  const webauthnAvailable =
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function';

  let platformAuthenticatorAvailable = false;
  if (
    webauthnAvailable &&
    typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable ===
      'function'
  ) {
    try {
      platformAuthenticatorAvailable =
        await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      platformAuthenticatorAvailable = false;
    }
  }

  let windowsHelloNativeAvailable = false;
  if (isTauriEnv()) {
    try {
      windowsHelloNativeAvailable = await invoke<boolean>(
        'check_windows_hello_available'
      );
    } catch {
      windowsHelloNativeAvailable = false;
    }
  }

  return {
    webauthnAvailable,
    platformAuthenticatorAvailable,
    windowsHelloNativeAvailable,
  };
}

async function wrapVaultSecret(
  credentialId: string,
  secret?: string
): Promise<string | undefined> {
  if (!secret || !secret.trim()) return undefined;
  if (isTauriEnv()) {
    return invoke<string>('wrap_vault_secret_for_credential', {
      credentialId,
      secret: secret.trim(),
    });
  }
  return btoa(unescape(encodeURIComponent(secret.trim())));
}

export async function unwrapVaultSecret(
  credentialId: string,
  wrappedToken?: string
): Promise<string | undefined> {
  if (!wrappedToken) return undefined;
  if (isTauriEnv()) {
    return invoke<string>('unwrap_vault_secret_for_credential', {
      credentialId,
      wrappedToken,
    });
  }
  try {
    return decodeURIComponent(escape(atob(wrappedToken)));
  } catch {
    return undefined;
  }
}

export async function registerPasskeyOrWindowsHello(opts: {
  userDisplayName: string;
  credentialLabel?: string;
  preferMode?: 'auto' | 'webauthn' | 'windows_hello';
  vaultSecretToWrap?: string;
}): Promise<PasskeyCredentialRecord> {
  const preferMode = opts.preferMode ?? 'auto';
  const now = Math.floor(Date.now() / 1000);
  const displayName = opts.userDisplayName.trim() || 'Koban Owner';

  // 1. Try WebAuthn Passkey (triggers Windows Hello Passkey dialog or FIDO2 security key)
  if (
    preferMode !== 'windows_hello' &&
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined'
  ) {
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const userId = new Uint8Array(16);
      crypto.getRandomValues(userId);

      const createOptions: PublicKeyCredentialCreationOptions = {
        challenge,
        rp: {
          name: 'Koban Encrypted Budget & Net Worth',
          id: window.location.hostname || 'localhost',
        },
        user: {
          id: userId,
          name: displayName.toLowerCase().replace(/\s+/g, '.'),
          displayName,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' }, // ES256
          { alg: -257, type: 'public-key' }, // RS256
        ],
        authenticatorSelection: {
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
      };

      const cred = (await navigator.credentials.create({
        publicKey: createOptions,
      })) as PublicKeyCredential | null;

      if (cred) {
        const credentialId = bufferToBase64Url(cred.rawId);
        const response = cred.response as AuthenticatorAttestationResponse;
        const pubKeyBuf =
          typeof response.getPublicKey === 'function'
            ? response.getPublicKey()
            : null;
        const publicKeyB64 = pubKeyBuf
          ? bufferToBase64Url(pubKeyBuf)
          : undefined;
        const wrappedVaultSecret = await wrapVaultSecret(
          credentialId,
          opts.vaultSecretToWrap
        );

        return {
          id: credentialId,
          name:
            opts.credentialLabel?.trim() ||
            'Passkey / Windows Hello (WebAuthn)',
          kind: 'webauthn_passkey',
          createdAt: now,
          lastUsedAt: now,
          publicKeyB64,
          wrappedVaultSecret,
        };
      }
    } catch (webauthnErr) {
      // If user explicitly chose webauthn or we are not in Tauri on Windows, rethrow unless fallback applies
      if (preferMode === 'webauthn' || !isTauriEnv()) {
        throw webauthnErr instanceof Error
          ? webauthnErr
          : new Error(String(webauthnErr));
      }
    }
  }

  // 2. Native Windows Hello OS Verification (via Tauri WinRT UserConsentVerifier)
  if (isTauriEnv()) {
    const verified = await invoke<boolean>('verify_windows_hello', {
      message: `Register Windows Hello for ${displayName} in Koban Vault`,
    });
    if (!verified) {
      throw new Error('Windows Hello verification did not complete.');
    }
    const randomIdBytes = new Uint8Array(16);
    crypto.getRandomValues(randomIdBytes);
    const credentialId = `winhello-${bufferToBase64Url(randomIdBytes)}`;
    const wrappedVaultSecret = await wrapVaultSecret(
      credentialId,
      opts.vaultSecretToWrap
    );

    return {
      id: credentialId,
      name: opts.credentialLabel?.trim() || 'Windows Hello (Biometric / PIN)',
      kind: 'windows_hello_native',
      createdAt: now,
      lastUsedAt: now,
      wrappedVaultSecret,
    };
  }

  throw new Error(
    'Passkeys / Windows Hello are not supported in this environment.'
  );
}

export async function authenticateWithPasskeyOrWindowsHello(
  config: AuthConfig,
  specificCredentialId?: string
): Promise<{
  verified: boolean;
  credential: PasskeyCredentialRecord;
  unwrappedVaultSecret?: string;
}> {
  const candidates = specificCredentialId
    ? config.passkeys.filter((p) => p.id === specificCredentialId)
    : config.passkeys;

  if (candidates.length === 0) {
    throw new Error('No Passkey or Windows Hello credential is registered.');
  }

  const webauthnCreds = candidates.filter((c) => c.kind === 'webauthn_passkey');
  const winHelloCreds = candidates.filter(
    (c) => c.kind === 'windows_hello_native'
  );

  // 1. Try WebAuthn Passkeys first if present
  if (
    webauthnCreds.length > 0 &&
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined'
  ) {
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const allowCredentials: PublicKeyCredentialDescriptor[] =
        webauthnCreds.map((c) => ({
          id: base64UrlToUint8Array(c.id) as unknown as BufferSource,
          type: 'public-key',
        }));

      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: window.location.hostname || 'localhost',
          allowCredentials,
          userVerification: 'required',
          timeout: 60000,
        },
      })) as PublicKeyCredential | null;

      if (assertion) {
        const matchedId = bufferToBase64Url(assertion.rawId);
        const matched =
          webauthnCreds.find((c) => c.id === matchedId) ?? webauthnCreds[0];
        const unwrappedVaultSecret = await unwrapVaultSecret(
          matched.id,
          matched.wrappedVaultSecret
        );
        return {
          verified: true,
          credential: matched,
          unwrappedVaultSecret,
        };
      }
    } catch (err) {
      if (winHelloCreds.length === 0) {
        throw err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  // 2. Native Windows Hello credential verification
  if (winHelloCreds.length > 0 && isTauriEnv()) {
    const target = winHelloCreds[0];
    const verified = await invoke<boolean>('verify_windows_hello', {
      message: `Unlock Koban Vault for ${config.userDisplayName || 'Koban Owner'}`,
    });
    if (verified) {
      const unwrappedVaultSecret = await unwrapVaultSecret(
        target.id,
        target.wrappedVaultSecret
      );
      return {
        verified: true,
        credential: target,
        unwrappedVaultSecret,
      };
    }
  }

  throw new Error('Passkey / Windows Hello authentication failed.');
}

export async function hashPassphraseVerifier(
  passphrase: string,
  existingSaltB64?: string
): Promise<{ saltB64: string; hashB64: string }> {
  const salt = existingSaltB64
    ? base64UrlToUint8Array(existingSaltB64)
    : (() => {
        const s = new Uint8Array(16);
        crypto.getRandomValues(s);
        return s;
      })();

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  return {
    saltB64: bufferToBase64Url(salt),
    hashB64: bufferToBase64Url(derivedBits),
  };
}

export async function verifyMasterPassphrase(
  passphrase: string,
  config: AuthConfig
): Promise<boolean> {
  if (
    !config.hasMasterPassphrase ||
    !config.passphraseSaltB64 ||
    !config.passphraseVerifierHashB64
  ) {
    return false;
  }
  const { hashB64 } = await hashPassphraseVerifier(
    passphrase,
    config.passphraseSaltB64
  );
  return hashB64 === config.passphraseVerifierHashB64;
}
