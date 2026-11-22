use crate::vault_crypto::{
    decrypt_aes256_gcm_aad, derive_windows_hello_kek, encrypt_aes256_gcm_aad, random_bytes,
};
use base64::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use zeroize::{Zeroize, Zeroizing};

#[derive(Serialize, Deserialize, Debug)]
pub struct DeviceSlotRecord {
    pub version: u32,
    pub kind: String, // "windows_hello" | "windows_hello_dpapi"
    pub key_name: String,
    pub challenge_b64: String,
    pub nonce_b64: String,
    pub ciphertext_b64: String,
}

pub fn device_slot_path(app_dir: &Path, vault_id_bytes: &[u8]) -> PathBuf {
    let id_url = BASE64_URL_SAFE_NO_PAD.encode(vault_id_bytes);
    app_dir
        .join("device-slots")
        .join(format!("{}.json", id_url))
}

pub fn has_device_slot(app_dir: &Path, vault_id_bytes: &[u8]) -> bool {
    device_slot_path(app_dir, vault_id_bytes).exists()
}

fn webdav_cred_store_path(app_dir: &Path) -> PathBuf {
    app_dir.join("credentials").join("webdav.bin")
}

fn webdav_cred_key(url: &str, username: &str) -> String {
    format!("{}|{}", url.trim(), username.trim())
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::ffi::c_void;
    use windows::core::{HSTRING, PCWSTR};
    use windows_future::IAsyncOperation;
    use windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    };
    use windows::Security::Credentials::{
        KeyCredential, KeyCredentialCreationOption, KeyCredentialManager, KeyCredentialStatus,
    };
    use windows::Security::Cryptography::CryptographicBuffer;
    use windows::Win32::Foundation::{HWND, HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
    use windows::Win32::System::WinRT::IUserConsentVerifierInterop;

    struct ComGuard(bool);
    impl ComGuard {
        fn init_mta() -> Self {
            unsafe {
                let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
                Self(hr.is_ok())
            }
        }
    }
    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    pub fn dpapi_protect(plaintext: &[u8], entropy: Option<&[u8]>) -> Result<Vec<u8>, String> {
        let in_blob = CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(plaintext.len()).map_err(|_| "DPAPI input too large")?,
            pbData: plaintext.as_ptr() as *mut u8,
        };
        let entropy_blob = entropy.map(|e| CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(e.len()).unwrap_or(0),
            pbData: e.as_ptr() as *mut u8,
        });
        let mut out_blob = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptProtectData(
                &in_blob,
                PCWSTR::null(),
                entropy_blob.as_ref().map(|b| b as *const _),
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            )
            .map_err(|e| format!("DPAPI protect failed: {}", e))?;

            let slice = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize);
            let out = slice.to_vec();
            let _ = LocalFree(Some(HLOCAL(out_blob.pbData as *mut c_void)));
            Ok(out)
        }
    }

    pub fn dpapi_unprotect(ciphertext: &[u8], entropy: Option<&[u8]>) -> Result<Zeroizing<Vec<u8>>, String> {
        let in_blob = CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(ciphertext.len()).map_err(|_| "DPAPI input too large")?,
            pbData: ciphertext.as_ptr() as *mut u8,
        };
        let entropy_blob = entropy.map(|e| CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(e.len()).unwrap_or(0),
            pbData: e.as_ptr() as *mut u8,
        });
        let mut out_blob = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptUnprotectData(
                &in_blob,
                None,
                entropy_blob.as_ref().map(|b| b as *const _),
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out_blob,
            )
            .map_err(|e| format!("DPAPI unprotect failed: {}", e))?;

            let slice = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize);
            let mut out = Zeroizing::new(slice.to_vec());
            std::ptr::write_volatile(out_blob.pbData, 0);
            if out_blob.cbData > 0 {
                std::ptr::write_bytes(out_blob.pbData, 0, out_blob.cbData as usize);
            }
            let _ = LocalFree(Some(HLOCAL(out_blob.pbData as *mut c_void)));
            let _ = &mut out;
            Ok(out)
        }
    }

    pub fn check_windows_hello_available() -> bool {
        let _com = ComGuard::init_mta();
        let key_cred_ok = KeyCredentialManager::IsSupportedAsync()
            .and_then(|op| op.join())
            .unwrap_or(false);
        if key_cred_ok {
            return true;
        }
        match UserConsentVerifier::CheckAvailabilityAsync().and_then(|op| op.join()) {
            Ok(UserConsentVerifierAvailability::Available) => true,
            _ => false,
        }
    }

    pub fn verify_user_consent(message: &str, hwnd: Option<isize>) -> Result<bool, String> {
        let _com = ComGuard::init_mta();
        let msg_h = HSTRING::from(message);

        let res = if let Some(raw_hwnd) = hwnd.filter(|&h| h != 0) {
            let interop: Result<IUserConsentVerifierInterop, _> =
                windows::core::factory::<UserConsentVerifier, IUserConsentVerifierInterop>();
            if let Ok(interop) = interop {
                let op: IAsyncOperation<UserConsentVerificationResult> = unsafe {
                    interop
                        .RequestVerificationForWindowAsync(HWND(raw_hwnd as *mut c_void), &msg_h)
                        .map_err(|e| format!("Windows Hello prompt failed: {}", e))?
                };
                op.join()
                    .map_err(|e| format!("Windows Hello verification failed: {}", e))?
            } else {
                UserConsentVerifier::RequestVerificationAsync(&msg_h)
                    .map_err(|e| format!("Windows Hello prompt failed: {}", e))?
                    .join()
                    .map_err(|e| format!("Windows Hello verification failed: {}", e))?
            }
        } else {
            UserConsentVerifier::RequestVerificationAsync(&msg_h)
                .map_err(|e| format!("Windows Hello prompt failed: {}", e))?
                .join()
                .map_err(|e| format!("Windows Hello verification failed: {}", e))?
        };

        match res {
            UserConsentVerificationResult::Verified => Ok(true),
            UserConsentVerificationResult::Canceled => {
                Err("Windows Hello verification was canceled.".into())
            }
            UserConsentVerificationResult::DeviceNotPresent
            | UserConsentVerificationResult::NotConfiguredForUser => {
                Err("Windows Hello is not configured on this Windows account.".into())
            }
            UserConsentVerificationResult::DisabledByPolicy => {
                Err("Windows Hello is disabled by system policy.".into())
            }
            UserConsentVerificationResult::DeviceBusy => {
                Err("Windows Hello device is busy. Try again.".into())
            }
            UserConsentVerificationResult::RetriesExhausted => {
                Err("Windows Hello verification retries exhausted.".into())
            }
            other => Err(format!("Windows Hello verification failed ({:?}).", other)),
        }
    }

    fn sign_challenge(cred: &KeyCredential, challenge: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
        let buf = CryptographicBuffer::CreateFromByteArray(challenge)
            .map_err(|e| format!("Failed to prepare Windows Hello challenge buffer: {}", e))?;
        let op = cred
            .RequestSignAsync(&buf)
            .map_err(|e| format!("Windows Hello sign failed: {}", e))?
            .join()
            .map_err(|e| format!("Windows Hello sign failed: {}", e))?;
        let status = op
            .Status()
            .map_err(|e| format!("Windows Hello status error: {}", e))?;
        if status == KeyCredentialStatus::UserCanceled {
            return Err("Windows Hello verification was canceled.".into());
        }
        if status != KeyCredentialStatus::Success {
            return Err(format!("Windows Hello signing failed (status {:?}).", status));
        }
        let result_buf = op
            .Result()
            .map_err(|e| format!("Windows Hello signature missing: {}", e))?;
        let mut array = windows::core::Array::new();
        CryptographicBuffer::CopyToByteArray(&result_buf, &mut array)
            .map_err(|e| format!("Failed to read Windows Hello signature: {}", e))?;
        Ok(Zeroizing::new(array.as_slice().to_vec()))
    }

    pub fn try_create_tpm_key_and_sign(
        key_name: &str,
        challenge: &[u8; 32],
    ) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        let _com = ComGuard::init_mta();
        let supported = KeyCredentialManager::IsSupportedAsync()
            .and_then(|op| op.join())
            .unwrap_or(false);
        if !supported {
            return Ok(None);
        }

        let name_h = HSTRING::from(key_name);
        let retrieval = KeyCredentialManager::RequestCreateAsync(
            &name_h,
            KeyCredentialCreationOption::ReplaceExisting,
        )
        .map_err(|e| format!("Failed to create Windows Hello key: {}", e))?
        .join()
        .map_err(|e| format!("Failed to create Windows Hello key: {}", e))?;

        let status = retrieval
            .Status()
            .map_err(|e| format!("Windows Hello key status error: {}", e))?;
        if status == KeyCredentialStatus::UserCanceled {
            return Err("Windows Hello enrollment was canceled.".into());
        }
        if status == KeyCredentialStatus::NotFound
            || status == KeyCredentialStatus::SecurityDeviceLocked
        {
            return Ok(None);
        }
        if status != KeyCredentialStatus::Success {
            return Ok(None);
        }

        let cred = retrieval
            .Credential()
            .map_err(|e| format!("Windows Hello credential missing: {}", e))?;

        let sig1 = sign_challenge(&cred, challenge)?;
        let sig2 = sign_challenge(&cred, challenge)?;
        if sig1.as_slice() != sig2.as_slice() {
            // Non-deterministic TPM key on this hardware: delete and fall back to consent + DPAPI.
            let _ = KeyCredentialManager::DeleteAsync(&name_h).and_then(|op| op.join());
            return Ok(None);
        }
        Ok(Some(sig1))
    }

    pub fn open_and_sign_tpm_key(
        key_name: &str,
        challenge: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>, String> {
        let _com = ComGuard::init_mta();
        let name_h = HSTRING::from(key_name);
        let retrieval = KeyCredentialManager::OpenAsync(&name_h)
            .map_err(|e| format!("Failed to open Windows Hello credential: {}", e))?
            .join()
            .map_err(|e| format!("Failed to open Windows Hello credential: {}", e))?;
        let status = retrieval
            .Status()
            .map_err(|e| format!("Windows Hello status error: {}", e))?;
        if status == KeyCredentialStatus::NotFound {
            return Err("Windows Hello credential for this vault was not found on this PC. Unlock with your Master Passphrase and re-enroll Windows Hello.".into());
        }
        if status == KeyCredentialStatus::UserCanceled {
            return Err("Windows Hello verification was canceled.".into());
        }
        if status != KeyCredentialStatus::Success {
            return Err(format!("Could not open Windows Hello key (status {:?}).", status));
        }
        let cred = retrieval
            .Credential()
            .map_err(|e| format!("Windows Hello credential missing: {}", e))?;
        sign_challenge(&cred, challenge)
    }

    pub fn delete_tpm_key(key_name: &str) {
        let _com = ComGuard::init_mta();
        let name_h = HSTRING::from(key_name);
        let _ = KeyCredentialManager::DeleteAsync(&name_h).and_then(|op| op.join());
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::*;
    pub fn dpapi_protect(plaintext: &[u8], _entropy: Option<&[u8]>) -> Result<Vec<u8>, String> {
        Ok(plaintext.to_vec())
    }
    pub fn dpapi_unprotect(ciphertext: &[u8], _entropy: Option<&[u8]>) -> Result<Zeroizing<Vec<u8>>, String> {
        Ok(Zeroizing::new(ciphertext.to_vec()))
    }
    pub fn check_windows_hello_available() -> bool {
        false
    }
    pub fn verify_user_consent(_message: &str, _hwnd: Option<isize>) -> Result<bool, String> {
        Err("Windows Hello is only supported on Windows.".into())
    }
    pub fn try_create_tpm_key_and_sign(
        _key_name: &str,
        _challenge: &[u8; 32],
    ) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        Err("Windows Hello is only supported on Windows.".into())
    }
    pub fn open_and_sign_tpm_key(
        _key_name: &str,
        _challenge: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>, String> {
        Err("Windows Hello is only supported on Windows.".into())
    }
    pub fn delete_tpm_key(_key_name: &str) {}
}

pub use platform::check_windows_hello_available;

pub fn enroll_windows_hello_slot(
    app_dir: &Path,
    vault_id_b64: &str,
    vault_id_bytes: &[u8],
    dek: &[u8; 32],
    hwnd: Option<isize>,
) -> Result<(), String> {
    let id_url = BASE64_URL_SAFE_NO_PAD.encode(vault_id_bytes);
    let key_name = format!("koban-vault-{}", id_url);
    let challenge = random_bytes::<32>()?;

    let record = if let Some(sig) = platform::try_create_tpm_key_and_sign(&key_name, &challenge)? {
        let kek = derive_windows_hello_kek(&sig, &challenge)?;
        let aad = format!("koban/v2/device/{}/windows_hello", vault_id_b64);
        let (nonce_b64, ct_b64) = encrypt_aes256_gcm_aad(&kek, dek, aad.as_bytes())?;
        let ct_bytes = BASE64_STANDARD.decode(&ct_b64).map_err(|e| e.to_string())?;
        let dpapi_blob = platform::dpapi_protect(&ct_bytes, Some(vault_id_bytes))?;
        DeviceSlotRecord {
            version: 1,
            kind: "windows_hello".into(),
            key_name,
            challenge_b64: BASE64_STANDARD.encode(challenge),
            nonce_b64,
            ciphertext_b64: BASE64_STANDARD.encode(dpapi_blob),
        }
    } else {
        // Fallback when hardware TPM KeyCredentialManager is unavailable: verify Windows Hello consent
        // and protect a random KEK + wrapped DEK with user-scoped DPAPI bound to vault_id entropy.
        platform::verify_user_consent("Enroll Windows Hello Quick Unlock for Koban Vault", hwnd)?;
        let kek = Zeroizing::new(random_bytes::<32>()?);
        let aad = format!("koban/v2/device/{}/windows_hello_dpapi", vault_id_b64);
        let (nonce_b64, ct_b64) = encrypt_aes256_gcm_aad(&kek, dek, aad.as_bytes())?;
        let ct_bytes = BASE64_STANDARD.decode(&ct_b64).map_err(|e| e.to_string())?;
        let mut combined = Zeroizing::new(Vec::with_capacity(32 + ct_bytes.len()));
        combined.extend_from_slice(kek.as_ref());
        combined.extend_from_slice(&ct_bytes);
        let dpapi_blob = platform::dpapi_protect(&combined, Some(vault_id_bytes))?;
        DeviceSlotRecord {
            version: 1,
            kind: "windows_hello_dpapi".into(),
            key_name,
            challenge_b64: BASE64_STANDARD.encode(challenge),
            nonce_b64,
            ciphertext_b64: BASE64_STANDARD.encode(dpapi_blob),
        }
    };

    let path = device_slot_path(app_dir, vault_id_bytes);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create device-slots folder: {}", e))?;
    }
    let json = serde_json::to_string_pretty(&record).map_err(|e| e.to_string())?;
    fs::write(&path, json.as_bytes())
        .map_err(|e| format!("Failed to save Windows Hello device slot: {}", e))?;
    Ok(())
}

pub fn unlock_windows_hello_slot(
    app_dir: &Path,
    vault_id_b64: &str,
    vault_id_bytes: &[u8],
    hwnd: Option<isize>,
) -> Result<Zeroizing<[u8; 32]>, String> {
    let path = device_slot_path(app_dir, vault_id_bytes);
    if !path.exists() {
        return Err("Windows Hello is not enrolled on this PC for this vault.".into());
    }
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read device slot file: {}", e))?;
    let record: DeviceSlotRecord = serde_json::from_str(&raw)
        .map_err(|e| format!("Corrupt Windows Hello device slot: {}", e))?;

    let dpapi_blob = BASE64_STANDARD
        .decode(&record.ciphertext_b64)
        .map_err(|_| "Corrupt device slot ciphertext.".to_string())?;
    let unprotected = platform::dpapi_unprotect(&dpapi_blob, Some(vault_id_bytes))?;

    let dek_vec = match record.kind.as_str() {
        "windows_hello" => {
            let challenge = BASE64_STANDARD
                .decode(&record.challenge_b64)
                .map_err(|_| "Corrupt device slot challenge.".to_string())?;
            let sig = platform::open_and_sign_tpm_key(&record.key_name, &challenge)?;
            let kek = derive_windows_hello_kek(&sig, &challenge)?;
            let aad = format!("koban/v2/device/{}/windows_hello", vault_id_b64);
            let ct_b64 = BASE64_STANDARD.encode(unprotected.as_slice());
            decrypt_aes256_gcm_aad(&kek, &record.nonce_b64, &ct_b64, aad.as_bytes())?
        }
        "windows_hello_dpapi" => {
            if unprotected.len() < 32 {
                return Err("Corrupt DPAPI device slot payload.".into());
            }
            platform::verify_user_consent("Unlock Koban Encrypted Budget & Net Worth Vault", hwnd)?;
            let mut kek = Zeroizing::new([0u8; 32]);
            kek.copy_from_slice(&unprotected[..32]);
            let ct_b64 = BASE64_STANDARD.encode(&unprotected[32..]);
            let aad = format!("koban/v2/device/{}/windows_hello_dpapi", vault_id_b64);
            decrypt_aes256_gcm_aad(&kek, &record.nonce_b64, &ct_b64, aad.as_bytes())?
        }
        other => return Err(format!("Unsupported device slot kind: {}", other)),
    };

    if dek_vec.len() != 32 {
        return Err("Unwrapped vault key has invalid length.".into());
    }
    let mut dek = Zeroizing::new([0u8; 32]);
    dek.copy_from_slice(&dek_vec);
    Ok(dek)
}

pub fn remove_windows_hello_slot(app_dir: &Path, vault_id_bytes: &[u8]) {
    let path = device_slot_path(app_dir, vault_id_bytes);
    if path.exists() {
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(record) = serde_json::from_str::<DeviceSlotRecord>(&raw) {
                platform::delete_tpm_key(&record.key_name);
            }
        }
        let _ = fs::remove_file(path);
    }
}

// ===================== DPAPI WebDAV Credential Store =====================

const WEBDAV_DPAPI_ENTROPY: &[u8] = b"koban/v2/webdav-credentials";

fn read_webdav_cred_map(app_dir: &Path) -> HashMap<String, String> {
    let path = webdav_cred_store_path(app_dir);
    let Ok(blob) = fs::read(&path) else {
        return HashMap::new();
    };
    let Ok(plain) = platform::dpapi_unprotect(&blob, Some(WEBDAV_DPAPI_ENTROPY)) else {
        return HashMap::new();
    };
    serde_json::from_slice::<HashMap<String, String>>(&plain).unwrap_or_default()
}

fn write_webdav_cred_map(app_dir: &Path, map: &HashMap<String, String>) -> Result<(), String> {
    let path = webdav_cred_store_path(app_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create credentials folder: {}", e))?;
    }
    let mut json = Zeroizing::new(serde_json::to_vec(map).map_err(|e| e.to_string())?);
    let blob = platform::dpapi_protect(&json, Some(WEBDAV_DPAPI_ENTROPY))?;
    json.zeroize();
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, &blob).map_err(|e| format!("Failed to write WebDAV credentials: {}", e))?;
    if path.exists() {
        let _ = fs::remove_file(&path);
    }
    fs::rename(&tmp, &path).map_err(|e| format!("Failed to save WebDAV credentials: {}", e))?;
    Ok(())
}

pub fn save_webdav_password(app_dir: &Path, url: &str, username: &str, password: &str) -> Result<(), String> {
    let u = url.trim();
    let user = username.trim();
    if u.is_empty() || user.is_empty() {
        return Ok(());
    }
    let mut map = read_webdav_cred_map(app_dir);
    let key = webdav_cred_key(u, user);
    if password.is_empty() {
        map.remove(&key);
    } else {
        map.insert(key, password.to_string());
    }
    write_webdav_cred_map(app_dir, &map)
}

pub fn load_webdav_password(app_dir: &Path, url: &str, username: &str) -> Option<String> {
    let u = url.trim();
    let user = username.trim();
    if u.is_empty() || user.is_empty() {
        return None;
    }
    let map = read_webdav_cred_map(app_dir);
    map.get(&webdav_cred_key(u, user)).cloned()
}
