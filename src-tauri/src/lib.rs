mod vault_crypto;
mod windows_security;

use base64::prelude::*;
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use vault_crypto::{
    decode_crockford_base32, decrypt_aes256_gcm_aad, derive_composite_kek, derive_ledger_key,
    derive_passphrase_kek, derive_recovery_kek, encode_crockford_base32, encrypt_aes256_gcm_aad,
    extract_keyfile_secret, generate_keyfile_json, normalize_nfc, random_bytes,
    DEFAULT_ARGON2_ITERATIONS, DEFAULT_ARGON2_MEMORY_KIB, DEFAULT_ARGON2_PARALLELISM,
};
use zeroize::Zeroizing;

struct VaultSession {
    dek: Option<Zeroizing<[u8; 32]>>,
    vault_id_b64: Option<String>,
    vault_id_bytes: Option<Vec<u8>>,
    last_db_sha256: Option<String>,
    legacy_v1_passphrase: Option<Zeroizing<String>>,
    legacy_v1_verified: bool,
}

impl VaultSession {
    const fn empty() -> Self {
        Self {
            dek: None,
            vault_id_b64: None,
            vault_id_bytes: None,
            last_db_sha256: None,
            legacy_v1_passphrase: None,
            legacy_v1_verified: false,
        }
    }

    fn clear(&mut self) {
        self.dek = None;
        self.vault_id_b64 = None;
        self.vault_id_bytes = None;
        self.last_db_sha256 = None;
        self.legacy_v1_passphrase = None;
        self.legacy_v1_verified = false;
    }
}

static SESSION_KEY: Mutex<VaultSession> = Mutex::new(VaultSession::empty());

/// Serializes raw access to the active DB file (SQLite writes vs. WebDAV byte reads / replacement).
static DB_FILE_LOCK: Mutex<()> = Mutex::new(());

fn lock_db_file() -> std::sync::MutexGuard<'static, ()> {
    DB_FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// Paths the user chose in a native dialog (or that `list_backups` returned) during this session.
/// File-access commands only accept these, so script running in the web view (e.g. through an XSS
/// in imported data) cannot read or overwrite arbitrary files by passing its own paths.
static USER_GRANTED_PATHS: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

fn grant_user_path(path: &Path) {
    let mut guard = USER_GRANTED_PATHS.lock().unwrap_or_else(|e| e.into_inner());
    if !guard.iter().any(|p| p == path) {
        guard.push(path.to_path_buf());
    }
}

fn require_user_path(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    let guard = USER_GRANTED_PATHS.lock().unwrap_or_else(|e| e.into_inner());
    if guard.iter().any(|p| p == &candidate) {
        Ok(candidate)
    } else {
        Err("Access denied: choose the file or folder in the dialog first.".into())
    }
}

// ===================== Public DTOs =====================

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DbInfo {
    pub db_path: String,
    pub db_size: u64,
    pub last_modified: u64,
    pub encrypted: bool,
    pub cipher: String,
    pub encrypted_records: usize,
    pub has_custom_passphrase: bool,
    pub is_custom_location: bool,
    pub format_version: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KeySlotSummary {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub keyfile_fingerprint: Option<String>,
    pub created_at: i64,
}

fn default_true() -> bool {
    true
}

fn default_auto_lock() -> u32 {
    15
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AuthSettings {
    #[serde(default = "default_true")]
    pub auto_prompt_device: bool,
    #[serde(default = "default_auto_lock")]
    pub auto_lock_minutes: u32,
    #[serde(default)]
    pub lock_on_minimize: bool,
}

impl Default for AuthSettings {
    fn default() -> Self {
        Self {
            auto_prompt_device: true,
            auto_lock_minutes: 15,
            lock_on_minimize: false,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub exists: bool,
    pub has_ledger_state: bool,
    pub format_version: u32,
    pub vault_id: Option<String>,
    pub unlocked: bool,
    pub needs_migration: bool,
    pub has_legacy_custom_passphrase: bool,
    pub slots: Vec<KeySlotSummary>,
    pub device_slot_enrolled: bool,
    pub windows_hello_available: bool,
    pub requires_key_file: bool,
    pub remembered_key_file_path: Option<String>,
    pub auth_settings: AuthSettings,
    pub db_path: String,
    pub db_size: u64,
    pub last_modified: u64,
    pub is_custom_location: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VaultCreateResult {
    pub status: VaultStatus,
    pub recovery_key: Option<String>,
    pub ledger_json: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KeyFileCreateResult {
    pub path: String,
    pub fingerprint: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExternalChangeResult {
    pub changed: bool,
    pub format_version: u32,
    pub external_state_json: Option<String>,
    pub error: Option<String>,
    pub last_modified: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct V1MigrationPreview {
    pub ledger_json: String,
    pub legacy_display_name: Option<String>,
    pub had_custom_passphrase: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BackupEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: u64,
    #[serde(default)]
    pub format_version: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WebDavSyncResult {
    pub success: bool,
    pub message: String,
    pub remote_size: Option<u64>,
    pub remote_modified: Option<String>,
    pub timestamp: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WebDavMergeFetchResult {
    pub remote_json: String,
    pub remote_modified: Option<String>,
    pub remote_size: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_url: String,
    pub download_url: Option<String>,
    pub release_name: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WebDavRemoteInfo {
    pub exists: bool,
    pub size: Option<u64>,
    pub last_modified: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SaveResult {
    pub db_path: String,
    pub db_size: u64,
    pub backup_path: Option<String>,
    pub timestamp: u64,
    pub encrypted_records: usize,
}

// ===================== Internal Slot Parameter Structs =====================

#[derive(Serialize, Deserialize, Debug, Clone)]
struct PassphraseSlotParams {
    kdf: String,
    v: u32,
    m_kib: u32,
    t: u32,
    p: u32,
    salt_b64: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct CompositeSlotParams {
    kdf: String,
    v: u32,
    m_kib: u32,
    t: u32,
    p: u32,
    salt_b64: String,
    keyfile_fingerprint: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct RecoverySlotParams {
    kdf: String,
    salt_b64: String,
}

struct StoredKeySlot {
    id: String,
    kind: String,
    label: String,
    params: String,
    nonce_b64: String,
    ciphertext_b64: String,
    created_at: i64,
}

// ===================== Legacy Vault Format v1 (Read-Only Migration Support) =====================

mod legacy_v1 {
    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Key, Nonce,
    };
    use base64::prelude::*;
    use rusqlite::Connection;
    use sha2::{Digest, Sha256};

    pub const DEFAULT_VAULT_SECRET: &str = "koban-aes256gcm-treasury-vault-v1-key";
    const KDF_ITERATIONS: u32 = 10_000;

    pub fn derive_key(secret: &str, salt: &[u8]) -> [u8; 32] {
        let mut hash = [0u8; 32];
        let mut hasher = Sha256::new();
        hasher.update(salt);
        hasher.update(secret.as_bytes());
        hasher.update(b"koban-aes-256-gcm-v1");
        hash.copy_from_slice(&hasher.finalize());

        for round in 0..KDF_ITERATIONS {
            let mut h = Sha256::new();
            h.update(hash);
            h.update(salt);
            h.update(round.to_le_bytes());
            hash.copy_from_slice(&h.finalize());
        }
        hash
    }

    pub fn decrypt_aes256_gcm(
        key_bytes: &[u8; 32],
        nonce_b64: &str,
        ciphertext_b64: &str,
    ) -> Result<Vec<u8>, String> {
        let nonce_vec = BASE64_STANDARD
            .decode(nonce_b64)
            .map_err(|e| format!("Invalid nonce base64: {}", e))?;
        if nonce_vec.len() != 12 {
            return Err("Invalid AES-GCM nonce length".into());
        }
        let ciphertext = BASE64_STANDARD
            .decode(ciphertext_b64)
            .map_err(|e| format!("Invalid ciphertext base64: {}", e))?;

        let key = Key::<Aes256Gcm>::try_from(key_bytes.as_slice())
            .map_err(|_| "Invalid AES-256 key length".to_string())?;
        let cipher = Aes256Gcm::new(&key);
        let nonce = Nonce::try_from(nonce_vec.as_slice())
            .map_err(|_| "Invalid AES-GCM nonce length".to_string())?;
        cipher
            .decrypt(&nonce, ciphertext.as_ref())
            .map_err(|_| "Decryption failed: invalid passphrase or corrupted legacy database.".into())
    }

    pub fn read_salt(conn: &Connection) -> Result<Vec<u8>, String> {
        let b64: String = conn
            .query_row(
                "SELECT value FROM vault_meta WHERE key = 'salt_b64' LIMIT 1",
                [],
                |r| r.get(0),
            )
            .map_err(|_| "Missing salt_b64 in legacy v1 vault.".to_string())?;
        BASE64_STANDARD
            .decode(&b64)
            .map_err(|e| format!("Corrupt salt in vault_meta: {}", e))
    }

    pub fn is_custom_passphrase(conn: &Connection) -> bool {
        conn.query_row(
            "SELECT value FROM vault_meta WHERE key = 'custom_passphrase' LIMIT 1",
            [],
            |r| r.get::<_, String>(0),
        )
        .map(|v| v == "true")
        .unwrap_or(false)
    }

    pub fn read_display_name(conn: &Connection) -> Option<String> {
        let raw: String = conn
            .query_row(
                "SELECT value FROM vault_meta WHERE key = 'auth_config' LIMIT 1",
                [],
                |r| r.get(0),
            )
            .ok()?;
        let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
        v.get("userDisplayName")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string())
    }

    pub fn read_encrypted_state(
        conn: &Connection,
        passphrase: Option<&str>,
    ) -> Result<Option<String>, String> {
        let row: Option<(String, String)> = conn
            .query_row(
                "SELECT nonce_b64, ciphertext_b64 FROM encrypted_vault WHERE key = 'ledger_state' LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        let Some((nonce_b64, ct_b64)) = row else {
            return Ok(None);
        };

        let salt = read_salt(conn)?;
        let custom = is_custom_passphrase(conn);

        if !custom && passphrase.map(|s| s.is_empty()).unwrap_or(true) {
            let key = derive_key(DEFAULT_VAULT_SECRET, &salt);
            let decrypted = decrypt_aes256_gcm(&key, &nonce_b64, &ct_b64)?;
            let json_str = String::from_utf8(decrypted)
                .map_err(|e| format!("Invalid UTF-8 in decrypted payload: {}", e))?;
            return Ok(Some(json_str));
        }

        let input = passphrase.ok_or_else(|| {
            "This legacy vault requires its custom passphrase to migrate to Vault v2.".to_string()
        })?;
        if input.is_empty() {
            return Err("Enter your legacy vault passphrase to unlock and upgrade.".into());
        }

        // Try exact passphrase first, then trimmed (v1 trimmed inconsistently).
        let key_exact = derive_key(input, &salt);
        if let Ok(decrypted) = decrypt_aes256_gcm(&key_exact, &nonce_b64, &ct_b64) {
            let json_str = String::from_utf8(decrypted)
                .map_err(|e| format!("Invalid UTF-8 in decrypted payload: {}", e))?;
            return Ok(Some(json_str));
        }

        let trimmed = input.trim();
        if trimmed != input && !trimmed.is_empty() {
            let key_trim = derive_key(trimmed, &salt);
            if let Ok(decrypted) = decrypt_aes256_gcm(&key_trim, &nonce_b64, &ct_b64) {
                let json_str = String::from_utf8(decrypted)
                    .map_err(|e| format!("Invalid UTF-8 in decrypted payload: {}", e))?;
                return Ok(Some(json_str));
            }
        }

        Err("Incorrect legacy vault passphrase.".into())
    }
}

// ===================== Path & File Helpers =====================

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn koban_app_dir() -> PathBuf {
    let base = env::var("LOCALAPPDATA")
        .or_else(|_| env::var("APPDATA"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let dir = base.join("Koban");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn default_db_path() -> PathBuf {
    koban_app_dir().join("koban.db")
}

fn db_pointer_path() -> PathBuf {
    koban_app_dir().join("db_location.txt")
}

fn get_active_db_path() -> PathBuf {
    let pointer = db_pointer_path();
    if pointer.exists() {
        if let Ok(content) = fs::read_to_string(&pointer) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                let candidate = PathBuf::from(trimmed);
                let final_path = if candidate.is_dir()
                    || trimmed.ends_with('\\')
                    || trimmed.ends_with('/')
                {
                    candidate.join("koban.db")
                } else {
                    candidate
                };
                if let Some(parent) = final_path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                return final_path;
            }
        }
    }
    default_db_path()
}

fn sidecar_path(db_path: &Path, suffix: &str) -> PathBuf {
    let name = db_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "koban.db".to_string());
    db_path.with_file_name(format!("{}{}", name, suffix))
}

fn remove_sqlite_sidecars(db_path: &Path) {
    for suffix in ["-journal", "-wal", "-shm"] {
        let p = sidecar_path(db_path, suffix);
        if p.exists() {
            let _ = fs::remove_file(p);
        }
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(64);
    for b in digest.iter() {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

fn file_sha256_hex(path: &Path) -> Option<String> {
    fs::read(path).ok().map(|b| sha256_hex(&b))
}

fn file_mtime_secs(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

fn remembered_keyfile_store_path(vault_id_bytes: &[u8]) -> PathBuf {
    let id_url = BASE64_URL_SAFE_NO_PAD.encode(vault_id_bytes);
    koban_app_dir()
        .join("device-slots")
        .join(format!("{}.keypath", id_url))
}

fn read_remembered_keyfile_path(vault_id_bytes: &[u8]) -> Option<String> {
    let p = remembered_keyfile_store_path(vault_id_bytes);
    fs::read_to_string(p)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn write_remembered_keyfile_path(vault_id_bytes: &[u8], keyfile_path: Option<&str>) -> Result<(), String> {
    let p = remembered_keyfile_store_path(vault_id_bytes);
    if let Some(path) = keyfile_path.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&p, path.as_bytes()).map_err(|e| e.to_string())?;
    } else if p.exists() {
        let _ = fs::remove_file(&p);
    }
    Ok(())
}

/// Resolves a keyfile path either from `USER_GRANTED_PATHS` or the natively stored remembered keyfile path.
fn resolve_authorized_keyfile_path(
    keyfile_path: &str,
    vault_id_bytes: Option<&[u8]>,
) -> Result<PathBuf, String> {
    if let Ok(granted) = require_user_path(keyfile_path) {
        return Ok(granted);
    }
    if let Some(id_bytes) = vault_id_bytes {
        if let Some(remembered) = read_remembered_keyfile_path(id_bytes) {
            if remembered == keyfile_path.trim() {
                return Ok(PathBuf::from(remembered));
            }
        }
    }
    Err("Access denied: select the key file using the file picker first.".into())
}

// ===================== WebDAV Credential Store Integration =====================

fn strip_and_store_webdav_password(state_json: &str) -> Result<String, String> {
    let Ok(mut root) = serde_json::from_str::<serde_json::Value>(state_json) else {
        return Ok(state_json.to_string());
    };
    let app_dir = koban_app_dir();
    let mut modified = false;
    if let Some(settings) = root.get_mut("settings").and_then(|v| v.as_object_mut()) {
        if let Some(webdav) = settings.get_mut("webdav").and_then(|v| v.as_object_mut()) {
            let url = webdav
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let username = webdav
                .get("username")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if let Some(pass_val) = webdav.get("password").and_then(|v| v.as_str()) {
                if !pass_val.is_empty() && !url.trim().is_empty() && !username.trim().is_empty() {
                    let _ = windows_security::save_webdav_password(&app_dir, &url, &username, pass_val);
                }
                webdav.remove("password");
                modified = true;
            }
        }
    }
    if modified {
        serde_json::to_string(&root).map_err(|e| e.to_string())
    } else {
        Ok(state_json.to_string())
    }
}

fn inject_local_webdav_password(state_json: &str) -> String {
    let Ok(mut root) = serde_json::from_str::<serde_json::Value>(state_json) else {
        return state_json.to_string();
    };
    let app_dir = koban_app_dir();
    let mut modified = false;
    if let Some(settings) = root.get_mut("settings").and_then(|v| v.as_object_mut()) {
        if let Some(webdav) = settings.get_mut("webdav").and_then(|v| v.as_object_mut()) {
            let url = webdav
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let username = webdav
                .get("username")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let existing_pass = webdav
                .get("password")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if !existing_pass.is_empty() {
                if !url.trim().is_empty() && !username.trim().is_empty() {
                    let _ = windows_security::save_webdav_password(&app_dir, &url, &username, &existing_pass);
                }
            } else if let Some(stored) = windows_security::load_webdav_password(&app_dir, &url, &username) {
                webdav.insert("password".into(), serde_json::Value::String(stored));
                modified = true;
            }
        }
    }
    if modified {
        serde_json::to_string(&root).unwrap_or_else(|_| state_json.to_string())
    } else {
        state_json.to_string()
    }
}

// ===================== Vault Format v2 Schema & Helpers =====================

fn init_v2_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = DELETE;
        PRAGMA synchronous = FULL;

        CREATE TABLE IF NOT EXISTS vault_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS key_slots (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            label TEXT NOT NULL,
            params TEXT NOT NULL,
            nonce_b64 TEXT NOT NULL,
            ciphertext_b64 TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS encrypted_vault (
            key TEXT PRIMARY KEY,
            nonce_b64 TEXT NOT NULL,
            ciphertext_b64 TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        ",
    )
    .map_err(|e| format!("Failed to initialize Vault v2 schema: {}", e))
}

fn slot_aad(vault_id_b64: &str, slot_id: &str, kind: &str) -> String {
    format!("koban/v2/slot/{}/{}/{}", vault_id_b64, slot_id, kind)
}

fn ledger_aad(vault_id_b64: &str) -> String {
    format!("koban/v2/ledger/{}/ledger_state", vault_id_b64)
}

fn get_meta_value(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM vault_meta WHERE key = ?1 LIMIT 1",
        params![key],
        |r| r.get(0),
    )
    .ok()
}

fn table_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        params![name],
        |r| r.get::<_, i64>(0),
    )
    .unwrap_or(0)
        > 0
}

fn has_ledger_state_row(conn: &Connection) -> bool {
    if !table_exists(conn, "encrypted_vault") {
        return false;
    }
    conn.query_row(
        "SELECT COUNT(*) FROM encrypted_vault WHERE key = 'ledger_state'",
        [],
        |r| r.get::<_, i64>(0),
    )
    .unwrap_or(0)
        > 0
}

fn detect_db_format_version(conn: &Connection) -> Result<u32, String> {
    if !table_exists(conn, "vault_meta") {
        if table_exists(conn, "app_state") {
            return Ok(1);
        }
        return Ok(0);
    }
    if let Some(ver_str) = get_meta_value(conn, "format_version") {
        let ver = ver_str.trim().parse::<u32>().map_err(|_| {
            format!(
                "Unknown vault format version '{}'. Update Koban to open this database.",
                ver_str
            )
        })?;
        if ver > 2 {
            return Err(format!(
                "This database uses vault format v{}, which is newer than this version of Koban supports. Please update Koban.",
                ver
            ));
        }
        return Ok(ver);
    }

    let kdf = get_meta_value(conn, "kdf");
    let has_salt = get_meta_value(conn, "salt_b64").is_some();
    let has_state = has_ledger_state_row(conn);
    if kdf.as_deref() == Some("SHA256-10000-Salted") || (has_salt && has_state) {
        return Ok(1);
    }
    if table_exists(conn, "app_state") {
        return Ok(1);
    }
    Ok(0)
}

fn load_key_slots(conn: &Connection) -> Result<Vec<StoredKeySlot>, String> {
    if !table_exists(conn, "key_slots") {
        return Ok(Vec::new());
    }
    let mut stmt = conn
        .prepare(
            "SELECT id, kind, label, params, nonce_b64, ciphertext_b64, created_at
             FROM key_slots
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(StoredKeySlot {
                id: r.get(0)?,
                kind: r.get(1)?,
                label: r.get(2)?,
                params: r.get(3)?,
                nonce_b64: r.get(4)?,
                ciphertext_b64: r.get(5)?,
                created_at: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for item in rows {
        out.push(item.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn summarize_slots(slots: &[StoredKeySlot]) -> Vec<KeySlotSummary> {
    slots
        .iter()
        .map(|s| {
            let fp = if s.kind == "composite_keyfile" {
                serde_json::from_str::<CompositeSlotParams>(&s.params)
                    .ok()
                    .map(|p| p.keyfile_fingerprint)
            } else {
                None
            };
            KeySlotSummary {
                id: s.id.clone(),
                kind: s.kind.clone(),
                label: s.label.clone(),
                keyfile_fingerprint: fp,
                created_at: s.created_at,
            }
        })
        .collect()
}

fn parse_auth_settings(conn: &Connection) -> AuthSettings {
    if !table_exists(conn, "vault_meta") {
        return AuthSettings::default();
    }
    get_meta_value(conn, "auth_settings")
        .and_then(|raw| serde_json::from_str::<AuthSettings>(&raw).ok())
        .unwrap_or_default()
}

fn count_ledger_records_json(state_json: &str) -> usize {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(state_json) else {
        return 1;
    };
    let mut total = 1usize;
    for key in [
        "groups",
        "categories",
        "monthlyBudgets",
        "transactions",
        "savingsGoals",
        "accounts",
        "netWorthSnapshots",
        "yearlyPlanItems",
    ] {
        if let Some(arr) = v.get(key).and_then(|x| x.as_array()) {
            total += arr.len();
        }
    }
    total
}

fn build_passphrase_slot(
    vault_id_b64: &str,
    dek: &[u8; 32],
    passphrase: &str,
    m_kib: u32,
    t: u32,
    p: u32,
) -> Result<StoredKeySlot, String> {
    let nfc = Zeroizing::new(normalize_nfc(passphrase));
    let salt = random_bytes::<16>()?;
    let kek = derive_passphrase_kek(&nfc, &salt, m_kib, t, p)?;
    let slot_id = BASE64_URL_SAFE_NO_PAD.encode(random_bytes::<16>()?);
    let kind = "passphrase".to_string();
    let aad = slot_aad(vault_id_b64, &slot_id, &kind);
    let (nonce_b64, ciphertext_b64) = encrypt_aes256_gcm_aad(&kek, dek, aad.as_bytes())?;
    let params_json = serde_json::to_string(&PassphraseSlotParams {
        kdf: "argon2id".into(),
        v: 19,
        m_kib,
        t,
        p,
        salt_b64: BASE64_STANDARD.encode(salt),
    })
    .map_err(|e| e.to_string())?;

    Ok(StoredKeySlot {
        id: slot_id,
        kind,
        label: "Master Passphrase (Argon2id)".into(),
        params: params_json,
        nonce_b64,
        ciphertext_b64,
        created_at: now_secs() as i64,
    })
}

fn build_composite_keyfile_slot(
    vault_id_b64: &str,
    dek: &[u8; 32],
    passphrase: &str,
    keyfile_secret: &[u8; 32],
    keyfile_fingerprint: &str,
    m_kib: u32,
    t: u32,
    p: u32,
) -> Result<StoredKeySlot, String> {
    let nfc = Zeroizing::new(normalize_nfc(passphrase));
    let salt = random_bytes::<16>()?;
    let kek = derive_composite_kek(&nfc, keyfile_secret, &salt, m_kib, t, p)?;
    let slot_id = BASE64_URL_SAFE_NO_PAD.encode(random_bytes::<16>()?);
    let kind = "composite_keyfile".to_string();
    let aad = slot_aad(vault_id_b64, &slot_id, &kind);
    let (nonce_b64, ciphertext_b64) = encrypt_aes256_gcm_aad(&kek, dek, aad.as_bytes())?;
    let params_json = serde_json::to_string(&CompositeSlotParams {
        kdf: "argon2id-composite".into(),
        v: 19,
        m_kib,
        t,
        p,
        salt_b64: BASE64_STANDARD.encode(salt),
        keyfile_fingerprint: keyfile_fingerprint.to_string(),
    })
    .map_err(|e| e.to_string())?;

    Ok(StoredKeySlot {
        id: slot_id,
        kind,
        label: format!("Master Password + Key File ({})", keyfile_fingerprint),
        params: params_json,
        nonce_b64,
        ciphertext_b64,
        created_at: now_secs() as i64,
    })
}

fn build_recovery_slot(
    vault_id_b64: &str,
    dek: &[u8; 32],
) -> Result<(StoredKeySlot, Zeroizing<String>), String> {
    let recovery_bytes = Zeroizing::new(random_bytes::<20>()?);
    let formatted_key = Zeroizing::new(encode_crockford_base32(recovery_bytes.as_ref()));
    let salt = random_bytes::<16>()?;
    let kek = derive_recovery_kek(recovery_bytes.as_ref(), &salt)?;
    let slot_id = BASE64_URL_SAFE_NO_PAD.encode(random_bytes::<16>()?);
    let kind = "recovery".to_string();
    let aad = slot_aad(vault_id_b64, &slot_id, &kind);
    let (nonce_b64, ciphertext_b64) = encrypt_aes256_gcm_aad(&kek, dek, aad.as_bytes())?;
    let params_json = serde_json::to_string(&RecoverySlotParams {
        kdf: "hkdf-sha256".into(),
        salt_b64: BASE64_STANDARD.encode(salt),
    })
    .map_err(|e| e.to_string())?;

    Ok((
        StoredKeySlot {
            id: slot_id,
            kind,
            label: "160-bit Recovery Key".into(),
            params: params_json,
            nonce_b64,
            ciphertext_b64,
            created_at: now_secs() as i64,
        },
        formatted_key,
    ))
}

fn insert_slot(tx: &rusqlite::Transaction<'_>, slot: &StoredKeySlot) -> Result<(), String> {
    tx.execute(
        "INSERT INTO key_slots (id, kind, label, params, nonce_b64, ciphertext_b64, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            slot.id,
            slot.kind,
            slot.label,
            slot.params,
            slot.nonce_b64,
            slot.ciphertext_b64,
            slot.created_at
        ],
    )
    .map_err(|e| format!("Failed to store key slot: {}", e))?;
    Ok(())
}

fn unwrap_dek_from_slot_passphrase(
    vault_id_b64: &str,
    slot: &StoredKeySlot,
    passphrase: &str,
) -> Result<Zeroizing<[u8; 32]>, String> {
    let p: PassphraseSlotParams = serde_json::from_str(&slot.params)
        .map_err(|_| "Corrupt passphrase slot parameters.".to_string())?;
    let salt = BASE64_STANDARD
        .decode(&p.salt_b64)
        .map_err(|_| "Corrupt passphrase slot salt.".to_string())?;
    let nfc = Zeroizing::new(normalize_nfc(passphrase));
    let kek = derive_passphrase_kek(&nfc, &salt, p.m_kib, p.t, p.p)?;
    let aad = slot_aad(vault_id_b64, &slot.id, &slot.kind);
    let dek_vec = decrypt_aes256_gcm_aad(&kek, &slot.nonce_b64, &slot.ciphertext_b64, aad.as_bytes())?;
    if dek_vec.len() != 32 {
        return Err("Corrupt DEK length in key slot.".into());
    }
    let mut dek = Zeroizing::new([0u8; 32]);
    dek.copy_from_slice(&dek_vec);
    Ok(dek)
}

fn unwrap_dek_from_slot_composite(
    vault_id_b64: &str,
    slot: &StoredKeySlot,
    passphrase: &str,
    keyfile_secret: &[u8; 32],
) -> Result<Zeroizing<[u8; 32]>, String> {
    let p: CompositeSlotParams = serde_json::from_str(&slot.params)
        .map_err(|_| "Corrupt composite key slot parameters.".to_string())?;
    let salt = BASE64_STANDARD
        .decode(&p.salt_b64)
        .map_err(|_| "Corrupt composite slot salt.".to_string())?;
    let nfc = Zeroizing::new(normalize_nfc(passphrase));
    let kek = derive_composite_kek(&nfc, keyfile_secret, &salt, p.m_kib, p.t, p.p)?;
    let aad = slot_aad(vault_id_b64, &slot.id, &slot.kind);
    let dek_vec = decrypt_aes256_gcm_aad(&kek, &slot.nonce_b64, &slot.ciphertext_b64, aad.as_bytes())?;
    if dek_vec.len() != 32 {
        return Err("Corrupt DEK length in composite key slot.".into());
    }
    let mut dek = Zeroizing::new([0u8; 32]);
    dek.copy_from_slice(&dek_vec);
    Ok(dek)
}

fn unwrap_dek_from_slot_recovery(
    vault_id_b64: &str,
    slot: &StoredKeySlot,
    recovery_key: &str,
) -> Result<Zeroizing<[u8; 32]>, String> {
    let p: RecoverySlotParams = serde_json::from_str(&slot.params)
        .map_err(|_| "Corrupt recovery slot parameters.".to_string())?;
    let salt = BASE64_STANDARD
        .decode(&p.salt_b64)
        .map_err(|_| "Corrupt recovery slot salt.".to_string())?;
    let rec_bytes = Zeroizing::new(decode_crockford_base32(recovery_key)?);
    let kek = derive_recovery_kek(rec_bytes.as_ref(), &salt)?;
    let aad = slot_aad(vault_id_b64, &slot.id, &slot.kind);
    let dek_vec = decrypt_aes256_gcm_aad(&kek, &slot.nonce_b64, &slot.ciphertext_b64, aad.as_bytes())?;
    if dek_vec.len() != 32 {
        return Err("Corrupt DEK length in recovery key slot.".into());
    }
    let mut dek = Zeroizing::new([0u8; 32]);
    dek.copy_from_slice(&dek_vec);
    Ok(dek)
}

fn read_v2_ledger_with_dek(
    conn: &Connection,
    vault_id_b64: &str,
    vault_id_bytes: &[u8],
    dek: &[u8; 32],
) -> Result<Option<String>, String> {
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT nonce_b64, ciphertext_b64 FROM encrypted_vault WHERE key = 'ledger_state' LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let Some((nonce_b64, ct_b64)) = row else {
        return Ok(None);
    };
    let ledger_key = derive_ledger_key(dek, vault_id_bytes)?;
    let aad = ledger_aad(vault_id_b64);
    let decrypted = decrypt_aes256_gcm_aad(&ledger_key, &nonce_b64, &ct_b64, aad.as_bytes())?;
    let json_str = String::from_utf8(decrypted)
        .map_err(|e| format!("Invalid UTF-8 in decrypted ledger payload: {}", e))?;
    Ok(Some(json_str))
}

fn write_v2_ledger_row(
    tx: &rusqlite::Transaction<'_>,
    vault_id_b64: &str,
    vault_id_bytes: &[u8],
    dek: &[u8; 32],
    state_json: &str,
) -> Result<(), String> {
    let ledger_key = derive_ledger_key(dek, vault_id_bytes)?;
    let aad = ledger_aad(vault_id_b64);
    let (nonce_b64, ct_b64) = encrypt_aes256_gcm_aad(&ledger_key, state_json.as_bytes(), aad.as_bytes())?;
    let ts = now_secs() as i64;
    tx.execute(
        "INSERT INTO encrypted_vault (key, nonce_b64, ciphertext_b64, updated_at)
         VALUES ('ledger_state', ?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET
            nonce_b64 = excluded.nonce_b64,
            ciphertext_b64 = excluded.ciphertext_b64,
            updated_at = excluded.updated_at",
        params![nonce_b64, ct_b64, ts],
    )
    .map_err(|e| format!("Failed to write encrypted_vault: {}", e))?;
    Ok(())
}

/// Atomically updates `db_path` via a sibling temporary SQLite database and atomic file replacement.
/// Never leaves partial files or active `-wal`/`-shm` sidecars in cloud-synced folders.
fn atomic_write_db<F>(db_path: &Path, seed_from_existing: bool, op: F) -> Result<String, String>
where
    F: FnOnce(&mut Connection) -> Result<(), String>,
{
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create database folder: {}", e))?;
    }

    let rand_suffix = random_bytes::<4>()?;
    let tmp_suffix = format!(
        ".write-tmp-{}-{}",
        now_secs(),
        vault_crypto::hex_encode(&rand_suffix)
    );
    let tmp_path = sidecar_path(db_path, &tmp_suffix);

    if seed_from_existing && db_path.exists() {
        fs::copy(db_path, &tmp_path)
            .map_err(|e| format!("Failed to stage temporary database copy: {}", e))?;
    }

    let res = (|| -> Result<String, String> {
        {
            let mut conn = Connection::open(&tmp_path)
                .map_err(|e| format!("Failed to open staged SQLite database: {}", e))?;
            init_v2_schema(&conn)?;
            op(&mut conn)?;
        }
        remove_sqlite_sidecars(&tmp_path);

        let bytes = fs::read(&tmp_path)
            .map_err(|e| format!("Failed to read staged SQLite database: {}", e))?;
        if bytes.len() < 16 || &bytes[0..16] != b"SQLite format 3\0" {
            return Err("Staged database failed SQLite header check.".into());
        }
        let new_sha = sha256_hex(&bytes);

        let mut last_err = None;
        for attempt in 0..4 {
            match fs::rename(&tmp_path, db_path) {
                Ok(_) => {
                    last_err = None;
                    break;
                }
                Err(e) => {
                    last_err = Some(e);
                    if attempt < 3 {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                }
            }
        }
        if let Some(err) = last_err {
            return Err(format!("Failed to atomically replace koban.db: {}", err));
        }
        remove_sqlite_sidecars(db_path);
        Ok(new_sha)
    })();

    if res.is_err() && tmp_path.exists() {
        let _ = fs::remove_file(&tmp_path);
        remove_sqlite_sidecars(&tmp_path);
    }
    res
}

fn build_vault_status_for_path(db_path: &Path) -> Result<VaultStatus, String> {
    let exists = db_path.exists();
    let is_custom_location = db_path != default_db_path();
    let meta = fs::metadata(db_path).ok();
    let db_size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let last_modified = file_mtime_secs(db_path).unwrap_or(0);

    let (unlocked, session_vault_id) = {
        let guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
        (guard.dek.is_some(), guard.vault_id_b64.clone())
    };

    if !exists || db_size == 0 {
        return Ok(VaultStatus {
            exists,
            has_ledger_state: false,
            format_version: 0,
            vault_id: None,
            unlocked: false,
            needs_migration: false,
            has_legacy_custom_passphrase: false,
            slots: Vec::new(),
            device_slot_enrolled: false,
            windows_hello_available: windows_security::check_windows_hello_available(),
            requires_key_file: false,
            remembered_key_file_path: None,
            auth_settings: AuthSettings::default(),
            db_path: db_path.to_string_lossy().to_string(),
            db_size,
            last_modified,
            is_custom_location,
        });
    }

    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to inspect SQLite database: {}", e))?;
    let format_version = detect_db_format_version(&conn)?;
    let has_ledger_state = has_ledger_state_row(&conn);
    let needs_migration = format_version == 1 && (has_ledger_state || table_exists(&conn, "app_state"));
    let has_legacy_custom_passphrase = if format_version == 1 {
        legacy_v1::is_custom_passphrase(&conn)
    } else {
        false
    };
    let vault_id = get_meta_value(&conn, "vault_id");
    let vault_id_bytes = vault_id
        .as_ref()
        .and_then(|s| BASE64_STANDARD.decode(s).ok());
    let slots = if format_version == 2 {
        load_key_slots(&conn)?
    } else {
        Vec::new()
    };
    let summaries = summarize_slots(&slots);
    let has_composite = summaries.iter().any(|s| s.kind == "composite_keyfile");
    let has_passphrase = summaries.iter().any(|s| s.kind == "passphrase");
    let requires_key_file = has_composite && !has_passphrase;

    let app_dir = koban_app_dir();
    let device_slot_enrolled = vault_id_bytes
        .as_ref()
        .map(|b| windows_security::has_device_slot(&app_dir, b))
        .unwrap_or(false);
    let remembered_key_file_path = vault_id_bytes
        .as_ref()
        .and_then(|b| read_remembered_keyfile_path(b));
    let auth_settings = parse_auth_settings(&conn);

    let session_matches = unlocked && session_vault_id.is_some() && session_vault_id == vault_id;

    Ok(VaultStatus {
        exists,
        has_ledger_state,
        format_version,
        vault_id,
        unlocked: session_matches,
        needs_migration,
        has_legacy_custom_passphrase,
        slots: summaries,
        device_slot_enrolled,
        windows_hello_available: windows_security::check_windows_hello_available(),
        requires_key_file,
        remembered_key_file_path,
        auth_settings,
        db_path: db_path.to_string_lossy().to_string(),
        db_size,
        last_modified,
        is_custom_location,
    })
}

fn create_v2_vault_file(
    db_path: &Path,
    passphrase: &str,
    keyfile_secret: Option<([u8; 32], String)>,
    create_recovery_key: bool,
    initial_state_json: &str,
    auth_settings: Option<&AuthSettings>,
    m_kib: u32,
    t: u32,
    p: u32,
) -> Result<(Zeroizing<[u8; 32]>, String, Vec<u8>, Option<Zeroizing<String>>, String), String> {
    let dek = Zeroizing::new(random_bytes::<32>()?);
    let vault_id_bytes = random_bytes::<16>()?.to_vec();
    let vault_id_b64 = BASE64_STANDARD.encode(&vault_id_bytes);
    let dummy_v1_salt = BASE64_STANDARD.encode(random_bytes::<16>()?);
    let clean_json = strip_and_store_webdav_password(initial_state_json)?;

    let primary_slot = match keyfile_secret {
        Some((kf_secret, kf_fp)) => build_composite_keyfile_slot(
            &vault_id_b64,
            &dek,
            passphrase,
            &kf_secret,
            &kf_fp,
            m_kib,
            t,
            p,
        )?,
        None => build_passphrase_slot(&vault_id_b64, &dek, passphrase, m_kib, t, p)?,
    };

    let (recovery_slot, recovery_key) = if create_recovery_key {
        let (slot, rec) = build_recovery_slot(&vault_id_b64, &dek)?;
        (Some(slot), Some(rec))
    } else {
        (None, None)
    };

    let settings_json = serde_json::to_string(auth_settings.unwrap_or(&AuthSettings::default()))
        .map_err(|e| e.to_string())?;

    let new_sha = atomic_write_db(db_path, false, |conn| {
        conn.execute_batch("PRAGMA secure_delete = ON;")
            .map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        tx.execute(
            "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('format_version', '2')",
            [],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('vault_id', ?1)",
            params![vault_id_b64],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('cipher', 'AES-256-GCM')",
            [],
        )
        .map_err(|e| e.to_string())?;
        // Tripwire for v1 builds (VAULT-V2-SPEC §7.4)
        tx.execute(
            "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('custom_passphrase', 'true')",
            [],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('salt_b64', ?1)",
            params![dummy_v1_salt],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('auth_settings', ?1)",
            params![settings_json],
        )
        .map_err(|e| e.to_string())?;

        tx.execute("DELETE FROM key_slots", [])
            .map_err(|e| e.to_string())?;
        insert_slot(&tx, &primary_slot)?;
        if let Some(ref rs) = recovery_slot {
            insert_slot(&tx, rs)?;
        }

        write_v2_ledger_row(&tx, &vault_id_b64, &vault_id_bytes, &dek, &clean_json)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })?;

    Ok((dek, vault_id_b64, vault_id_bytes, recovery_key, new_sha))
}

fn perform_backup_to_dir(
    db_path: &Path,
    backup_dir: &str,
    force_timestamped: bool,
    max_backups: usize,
) -> Result<String, String> {
    let dir = Path::new(backup_dir);
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create backup folder: {}", e))?;

    let legacy_json = dir.join("koban-latest.json");
    if legacy_json.exists() {
        let _ = fs::remove_file(&legacy_json);
    }

    let latest_db = dir.join("koban-latest.db");
    fs::copy(db_path, &latest_db)
        .map_err(|e| format!("Failed to copy encrypted SQLite database to backup folder: {}", e))?;

    let secs = now_secs();
    let day_bucket = secs / 86400;
    let snapshot_name = if force_timestamped {
        format!("koban-backup-{}.db", secs)
    } else {
        format!("koban-daily-{}.db", day_bucket)
    };
    let snapshot_path = dir.join(&snapshot_name);
    if force_timestamped || !snapshot_path.exists() {
        let _ = fs::copy(db_path, &snapshot_path);
    }

    if max_backups > 0 {
        if let Ok(entries) = fs::read_dir(dir) {
            let mut snapshots: Vec<(u64, PathBuf)> = entries
                .filter_map(|e| e.ok())
                .filter_map(|e| {
                    let p = e.path();
                    let name = e.file_name().to_string_lossy().to_string();
                    if (name.starts_with("koban-backup-") || name.starts_with("koban-daily-"))
                        && name.ends_with(".db")
                    {
                        let mtime = e
                            .metadata()
                            .ok()
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        Some((mtime, p))
                    } else {
                        None
                    }
                })
                .collect();

            snapshots.sort_by(|a, b| b.0.cmp(&a.0));
            for (_, old_path) in snapshots.into_iter().skip(max_backups) {
                let _ = fs::remove_file(old_path);
            }
        }
    }

    Ok(if force_timestamped {
        snapshot_path.to_string_lossy().to_string()
    } else {
        latest_db.to_string_lossy().to_string()
    })
}

// ===================== Vault v2 Commands =====================

#[tauri::command]
fn vault_status() -> Result<VaultStatus, String> {
    let _guard = lock_db_file();
    let db_path = get_active_db_path();
    build_vault_status_for_path(&db_path)
}

#[tauri::command]
async fn vault_create(
    passphrase: String,
    keyfile_path: Option<String>,
    create_recovery_key: bool,
    initial_state_json: String,
    remember_keyfile: Option<bool>,
) -> Result<VaultCreateResult, String> {
    let trimmed = passphrase.trim();
    if keyfile_path.as_deref().unwrap_or("").trim().is_empty() && passphrase.chars().count() < 12 {
        return Err("Master passphrase must be at least 12 characters.".into());
    }
    if passphrase != trimmed {
        return Err("Master passphrase cannot start or end with spaces.".into());
    }
    if !keyfile_path.as_deref().unwrap_or("").trim().is_empty() && passphrase.chars().count() < 8 {
        return Err("Master passphrase must be at least 8 characters even when paired with a Key File.".into());
    }

    let keyfile_data = if let Some(ref kp) = keyfile_path.as_ref().filter(|s| !s.trim().is_empty()) {
        let granted = require_user_path(kp)?;
        let raw = fs::read(&granted).map_err(|e| format!("Failed to read key file: {}", e))?;
        let (secret, fp) = extract_keyfile_secret(&raw)?;
        Some((secret, fp, granted.to_string_lossy().to_string()))
    } else {
        None
    };

    run_blocking(move || {
        let _guard = lock_db_file();
        let db_path = get_active_db_path();
        if db_path.exists() {
            let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| format!("Cannot inspect existing database: {}", e))?;
            if has_ledger_state_row(&conn) {
                return Err("A vault already exists at this location. Unlock or migrate it instead of overwriting.".into());
            }
        }

        let kf_arg = keyfile_data
            .as_ref()
            .map(|(sec, fp, _)| (*(*sec), fp.clone()));
        let (dek, vault_id_b64, vault_id_bytes, rec_key, new_sha) = create_v2_vault_file(
            &db_path,
            &passphrase,
            kf_arg,
            create_recovery_key,
            &initial_state_json,
            None,
            DEFAULT_ARGON2_MEMORY_KIB,
            DEFAULT_ARGON2_ITERATIONS,
            DEFAULT_ARGON2_PARALLELISM,
        )?;

        if remember_keyfile.unwrap_or(false) {
            if let Some((_, _, ref path_str)) = keyfile_data {
                let _ = write_remembered_keyfile_path(&vault_id_bytes, Some(path_str));
            }
        }

        {
            let mut guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
            guard.clear();
            guard.dek = Some(dek);
            guard.vault_id_b64 = Some(vault_id_b64);
            guard.vault_id_bytes = Some(vault_id_bytes);
            guard.last_db_sha256 = Some(new_sha);
        }

        let status = build_vault_status_for_path(&db_path)?;
        Ok(VaultCreateResult {
            status,
            recovery_key: rec_key.map(|r| r.to_string()),
            ledger_json: None,
        })
    })
    .await
}

#[tauri::command]
async fn vault_unlock(
    passphrase: String,
    keyfile_path: Option<String>,
    remember_keyfile: Option<bool>,
) -> Result<String, String> {
    let kf_path_trimmed = keyfile_path.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    run_blocking(move || {
        let _guard = lock_db_file();
        let db_path = get_active_db_path();
        if !db_path.exists() {
            return Err("Database file does not exist.".into());
        }

        let disk_bytes = fs::read(&db_path)
            .map_err(|e| format!("Failed to read database file: {}", e))?;
        let disk_sha = sha256_hex(&disk_bytes);

        let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("Failed to open database: {}", e))?;
        let ver = detect_db_format_version(&conn)?;
        if ver == 1 {
            return Err("NEEDS_MIGRATION: This vault uses format v1 and must be upgraded to Vault v2.".into());
        }
        if ver != 2 {
            return Err("No initialized vault found in this database.".into());
        }

        let vault_id_b64 = get_meta_value(&conn, "vault_id")
            .ok_or_else(|| "Vault is missing vault_id metadata.".to_string())?;
        let vault_id_bytes = BASE64_STANDARD
            .decode(&vault_id_b64)
            .map_err(|_| "Corrupt vault_id metadata.".to_string())?;

        let slots = load_key_slots(&conn)?;
        if slots.is_empty() {
            return Err("Vault contains no key slots.".into());
        }

        let kf_secret = if let Some(ref kp) = kf_path_trimmed {
            let authorized = resolve_authorized_keyfile_path(kp, Some(&vault_id_bytes))?;
            let raw = fs::read(&authorized).map_err(|e| format!("Failed to read key file: {}", e))?;
            let (sec, _) = extract_keyfile_secret(&raw)?;
            Some(sec)
        } else {
            None
        };

        let mut unlocked_dek: Option<Zeroizing<[u8; 32]>> = None;
        for slot in &slots {
            match slot.kind.as_str() {
                "composite_keyfile" => {
                    if let Some(ref kf) = kf_secret {
                        if let Ok(dek) = unwrap_dek_from_slot_composite(&vault_id_b64, slot, &passphrase, kf) {
                            unlocked_dek = Some(dek);
                            break;
                        }
                    }
                }
                "passphrase" => {
                    if let Ok(dek) = unwrap_dek_from_slot_passphrase(&vault_id_b64, slot, &passphrase) {
                        unlocked_dek = Some(dek);
                        break;
                    }
                }
                _ => {}
            }
        }

        let Some(dek) = unlocked_dek else {
            let needs_kf = slots.iter().any(|s| s.kind == "composite_keyfile")
                && !slots.iter().any(|s| s.kind == "passphrase");
            if needs_kf && kf_secret.is_none() {
                return Err("This vault requires both your Master Password AND its Key File (.key).".into());
            }
            return Err("Incorrect Master Password or Key File.".into());
        };

        let json_str = read_v2_ledger_with_dek(&conn, &vault_id_b64, &vault_id_bytes, &dek)?
            .ok_or_else(|| "Vault contains no encrypted ledger data.".to_string())?;

        if let Some(remember) = remember_keyfile {
            if remember {
                if let Some(ref kp) = kf_path_trimmed {
                    let _ = write_remembered_keyfile_path(&vault_id_bytes, Some(kp));
                }
            } else {
                let _ = write_remembered_keyfile_path(&vault_id_bytes, None);
            }
        }

        let with_webdav = inject_local_webdav_password(&json_str);
        {
            let mut guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
            guard.clear();
            guard.dek = Some(dek);
            guard.vault_id_b64 = Some(vault_id_b64);
            guard.vault_id_bytes = Some(vault_id_bytes);
            guard.last_db_sha256 = Some(disk_sha);
        }

        Ok(with_webdav)
    })
    .await
}

#[tauri::command]
async fn vault_unlock_recovery(recovery_key: String) -> Result<String, String> {
    run_blocking(move || {
        let _guard = lock_db_file();
        let db_path = get_active_db_path();
        if !db_path.exists() {
            return Err("Database file does not exist.".into());
        }

        let disk_bytes = fs::read(&db_path)
            .map_err(|e| format!("Failed to read database file: {}", e))?;
        let disk_sha = sha256_hex(&disk_bytes);

        let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("Failed to open database: {}", e))?;
        let ver = detect_db_format_version(&conn)?;
        if ver != 2 {
            return Err("Recovery keys are only supported on Vault v2 databases.".into());
        }

        let vault_id_b64 = get_meta_value(&conn, "vault_id")
            .ok_or_else(|| "Vault is missing vault_id metadata.".to_string())?;
        let vault_id_bytes = BASE64_STANDARD
            .decode(&vault_id_b64)
            .map_err(|_| "Corrupt vault_id metadata.".to_string())?;

        let slots = load_key_slots(&conn)?;
        let mut unlocked_dek: Option<Zeroizing<[u8; 32]>> = None;
        for slot in slots.iter().filter(|s| s.kind == "recovery") {
            if let Ok(dek) = unwrap_dek_from_slot_recovery(&vault_id_b64, slot, &recovery_key) {
                unlocked_dek = Some(dek);
                break;
            }
        }
        let Some(dek) = unlocked_dek else {
            return Err("Invalid recovery key for this vault.".into());
        };

        let json_str = read_v2_ledger_with_dek(&conn, &vault_id_b64, &vault_id_bytes, &dek)?
            .ok_or_else(|| "Vault contains no encrypted ledger data.".to_string())?;

        let with_webdav = inject_local_webdav_password(&json_str);
        {
            let mut guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
            guard.clear();
            guard.dek = Some(dek);
            guard.vault_id_b64 = Some(vault_id_b64);
            guard.vault_id_bytes = Some(vault_id_bytes);
            guard.last_db_sha256 = Some(disk_sha);
        }

        Ok(with_webdav)
    })
    .await
}

#[tauri::command]
async fn vault_unlock_device(window: tauri::WebviewWindow) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    let hwnd = window.hwnd().ok().map(|h| h.0 as isize);
    #[cfg(not(target_os = "windows"))]
    let hwnd = {
        let _ = window;
        None
    };

    run_blocking(move || {
        let _guard = lock_db_file();
        let db_path = get_active_db_path();
        if !db_path.exists() {
            return Err("Database file does not exist.".into());
        }

        let disk_bytes = fs::read(&db_path)
            .map_err(|e| format!("Failed to read database file: {}", e))?;
        let disk_sha = sha256_hex(&disk_bytes);

        let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("Failed to open database: {}", e))?;
        let ver = detect_db_format_version(&conn)?;
        if ver != 2 {
            return Err("Device quick unlock requires Vault v2.".into());
        }
        let vault_id_b64 = get_meta_value(&conn, "vault_id")
            .ok_or_else(|| "Vault is missing vault_id metadata.".to_string())?;
        let vault_id_bytes = BASE64_STANDARD
            .decode(&vault_id_b64)
            .map_err(|_| "Corrupt vault_id metadata.".to_string())?;

        let app_dir = koban_app_dir();
        let dek = windows_security::unlock_windows_hello_slot(
            &app_dir,
            &vault_id_b64,
            &vault_id_bytes,
            hwnd,
        )?;

        let json_str = read_v2_ledger_with_dek(&conn, &vault_id_b64, &vault_id_bytes, &dek)?
            .ok_or_else(|| "Vault contains no encrypted ledger data.".to_string())?;

        let with_webdav = inject_local_webdav_password(&json_str);
        {
            let mut guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
            guard.clear();
            guard.dek = Some(dek);
            guard.vault_id_b64 = Some(vault_id_b64);
            guard.vault_id_bytes = Some(vault_id_bytes);
            guard.last_db_sha256 = Some(disk_sha);
        }

        Ok(with_webdav)
    })
    .await
}

#[tauri::command]
fn vault_lock() -> Result<(), String> {
    let mut guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
    guard.clear();
    Ok(())
}

#[tauri::command]
async fn vault_unlock_v1_for_migration(passphrase: Option<String>) -> Result<V1MigrationPreview, String> {
    run_blocking(move || {
        let _guard = lock_db_file();
        let db_path = get_active_db_path();
        if !db_path.exists() {
            return Err("Database file does not exist.".into());
        }
        let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("Failed to open legacy database: {}", e))?;
        let ver = detect_db_format_version(&conn)?;
        if ver != 1 {
            return Err("Database is not a legacy v1 vault.".into());
        }

        let had_custom = legacy_v1::is_custom_passphrase(&conn);
        let legacy_display_name = legacy_v1::read_display_name(&conn);
        let state_json = if table_exists(&conn, "app_state") && !has_ledger_state_row(&conn) {
            conn.query_row(
                "SELECT value FROM app_state WHERE key = 'ledger_state' LIMIT 1",
                [],
                |r| r.get::<_, String>(0),
            )
            .map_err(|_| "No ledger data found in legacy database.".to_string())?
        } else {
            legacy_v1::read_encrypted_state(&conn, passphrase.as_deref())?
                .ok_or_else(|| "No ledger data found in legacy database.".to_string())?
        };

        {
            let mut guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
            guard.clear();
            guard.legacy_v1_passphrase = passphrase.filter(|s| !s.is_empty()).map(Zeroizing::new);
            guard.legacy_v1_verified = true;
        }

        Ok(V1MigrationPreview {
            ledger_json: inject_local_webdav_password(&state_json),
            legacy_display_name,
            had_custom_passphrase: had_custom,
        })
    })
    .await
}

#[tauri::command]
async fn vault_migrate_v1_to_v2(
    v1_passphrase: Option<String>,
    new_passphrase: String,
    keyfile_path: Option<String>,
    create_recovery_key: bool,
    remember_keyfile: Option<bool>,
    current_state_json: Option<String>,
) -> Result<VaultCreateResult, String> {
    if keyfile_path.as_deref().unwrap_or("").trim().is_empty() && new_passphrase.chars().count() < 12 {
        return Err("Master passphrase must be at least 12 characters.".into());
    }
    if new_passphrase != new_passphrase.trim() {
        return Err("Master passphrase cannot start or end with spaces.".into());
    }
    if !keyfile_path.as_deref().unwrap_or("").trim().is_empty() && new_passphrase.chars().count() < 8 {
        return Err("Master passphrase must be at least 8 characters even when paired with a Key File.".into());
    }

    let keyfile_data = if let Some(ref kp) = keyfile_path.as_ref().filter(|s| !s.trim().is_empty()) {
        let granted = require_user_path(kp)?;
        let raw = fs::read(&granted).map_err(|e| format!("Failed to read key file: {}", e))?;
        let (sec, fp) = extract_keyfile_secret(&raw)?;
        Some((sec, fp, granted.to_string_lossy().to_string()))
    } else {
        None
    };

    run_blocking(move || {
        let _guard = lock_db_file();
        let db_path = get_active_db_path();
        if !db_path.exists() {
            return Err("Database file does not exist.".into());
        }

        let (verified_json, auth_settings) = {
            let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| format!("Failed to open legacy database: {}", e))?;
            let ver = detect_db_format_version(&conn)?;
            if ver != 1 {
                return Err("This database is already on Vault v2.".into());
            }

            let session_pass = {
                let guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
                if guard.legacy_v1_verified {
                    guard.legacy_v1_passphrase.as_ref().map(|z| z.to_string())
                } else {
                    None
                }
            };
            let effective_v1_pass = v1_passphrase.or(session_pass);

            let decrypted_v1 = if table_exists(&conn, "app_state") && !has_ledger_state_row(&conn) {
                conn.query_row(
                    "SELECT value FROM app_state WHERE key = 'ledger_state' LIMIT 1",
                    [],
                    |r| r.get::<_, String>(0),
                )
                .map_err(|_| "No ledger data found in legacy database.".to_string())?
            } else {
                legacy_v1::read_encrypted_state(&conn, effective_v1_pass.as_deref())?
                    .ok_or_else(|| "No ledger data found in legacy database.".to_string())?
            };

            let mut settings = AuthSettings::default();
            if let Some(raw_auth) = get_meta_value(&conn, "auth_config") {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw_auth) {
                    if let Some(m) = val.get("autoLockMinutes").and_then(|v| v.as_u64()) {
                        settings.auto_lock_minutes = m as u32;
                    }
                    if let Some(ap) = val.get("autoPromptPasskeyOnLaunch").and_then(|v| v.as_bool()) {
                        settings.auto_prompt_device = ap;
                    }
                }
            }
            (decrypted_v1, settings)
        };

        let target_json = current_state_json.unwrap_or(verified_json);
        let clean_json = strip_and_store_webdav_password(&target_json)?;

        let dek = Zeroizing::new(random_bytes::<32>()?);
        let vault_id_bytes = random_bytes::<16>()?.to_vec();
        let vault_id_b64 = BASE64_STANDARD.encode(&vault_id_bytes);

        let primary_slot = match keyfile_data {
            Some((ref kf_secret, ref kf_fp, _)) => build_composite_keyfile_slot(
                &vault_id_b64,
                &dek,
                &new_passphrase,
                kf_secret,
                kf_fp,
                DEFAULT_ARGON2_MEMORY_KIB,
                DEFAULT_ARGON2_ITERATIONS,
                DEFAULT_ARGON2_PARALLELISM,
            )?,
            None => build_passphrase_slot(
                &vault_id_b64,
                &dek,
                &new_passphrase,
                DEFAULT_ARGON2_MEMORY_KIB,
                DEFAULT_ARGON2_ITERATIONS,
                DEFAULT_ARGON2_PARALLELISM,
            )?,
        };

        let (recovery_slot, recovery_key) = if create_recovery_key {
            let (slot, rec) = build_recovery_slot(&vault_id_b64, &dek)?;
            (Some(slot), Some(rec))
        } else {
            (None, None)
        };

        let settings_json = serde_json::to_string(&auth_settings).map_err(|e| e.to_string())?;

        let new_sha = atomic_write_db(&db_path, true, |conn| {
            conn.execute_batch("PRAGMA secure_delete = ON;")
                .map_err(|e| e.to_string())?;
            {
                let tx = conn.transaction().map_err(|e| e.to_string())?;
                tx.execute(
                    "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('format_version', '2')",
                    [],
                )
                .map_err(|e| e.to_string())?;
                tx.execute(
                    "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('vault_id', ?1)",
                    params![vault_id_b64],
                )
                .map_err(|e| e.to_string())?;
                tx.execute(
                    "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('cipher', 'AES-256-GCM')",
                    [],
                )
                .map_err(|e| e.to_string())?;
                tx.execute(
                    "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('custom_passphrase', 'true')",
                    [],
                )
                .map_err(|e| e.to_string())?;
                tx.execute(
                    "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('auth_settings', ?1)",
                    params![settings_json],
                )
                .map_err(|e| e.to_string())?;
                tx.execute(
                    "DELETE FROM vault_meta WHERE key IN ('kdf', 'auth_config')",
                    [],
                )
                .map_err(|e| e.to_string())?;

                tx.execute("DELETE FROM key_slots", [])
                    .map_err(|e| e.to_string())?;
                insert_slot(&tx, &primary_slot)?;
                if let Some(ref rs) = recovery_slot {
                    insert_slot(&tx, rs)?;
                }

                write_v2_ledger_row(&tx, &vault_id_b64, &vault_id_bytes, &dek, &clean_json)?;

                tx.execute_batch(
                    "
                    DROP TABLE IF EXISTS encrypted_records;
                    DROP TABLE IF EXISTS app_state;
                    DROP TABLE IF EXISTS category_groups;
                    DROP TABLE IF EXISTS categories;
                    DROP TABLE IF EXISTS monthly_budgets;
                    DROP TABLE IF EXISTS transactions;
                    DROP TABLE IF EXISTS savings_goals;
                    ",
                )
                .map_err(|e| e.to_string())?;
                tx.commit().map_err(|e| e.to_string())?;
            }
            conn.execute_batch("VACUUM;").map_err(|e| e.to_string())?;
            Ok(())
        })?;

        if remember_keyfile.unwrap_or(false) {
            if let Some((_, _, ref path_str)) = keyfile_data {
                let _ = write_remembered_keyfile_path(&vault_id_bytes, Some(path_str));
            }
        }

        {
            let mut guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
            guard.clear();
            guard.dek = Some(dek);
            guard.vault_id_b64 = Some(vault_id_b64);
            guard.vault_id_bytes = Some(vault_id_bytes);
            guard.last_db_sha256 = Some(new_sha);
        }

        let status = build_vault_status_for_path(&db_path)?;
        Ok(VaultCreateResult {
            status,
            recovery_key: recovery_key.map(|r| r.to_string()),
            ledger_json: Some(inject_local_webdav_password(&target_json)),
        })
    })
    .await
}

#[tauri::command]
async fn vault_change_credentials(
    current_passphrase: Option<String>,
    current_keyfile_path: Option<String>,
    new_passphrase: String,
    new_keyfile_path: Option<String>,
    rekey_dek: bool,
    remember_keyfile: Option<bool>,
    current_state_json: Option<String>,
) -> Result<VaultStatus, String> {
    if new_keyfile_path.as_deref().unwrap_or("").trim().is_empty() && new_passphrase.chars().count() < 12 {
        return Err("New Master Password must be at least 12 characters.".into());
    }
    if new_passphrase != new_passphrase.trim() {
        return Err("Master Password cannot start or end with spaces.".into());
    }
    if !new_keyfile_path.as_deref().unwrap_or("").trim().is_empty() && new_passphrase.chars().count() < 8 {
        return Err("Master Password must be at least 8 characters even when paired with a Key File.".into());
    }

    let new_kf_data = if let Some(ref kp) = new_keyfile_path.as_ref().filter(|s| !s.trim().is_empty()) {
        let authorized = resolve_authorized_keyfile_path(kp, None)?;
        let raw = fs::read(&authorized).map_err(|e| format!("Failed to read new key file: {}", e))?;
        let (sec, fp) = extract_keyfile_secret(&raw)?;
        Some((sec, fp, authorized.to_string_lossy().to_string()))
    } else {
        None
    };

    let cur_kf_path = current_keyfile_path.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    run_blocking(move || {
        let _guard = lock_db_file();
        let db_path = get_active_db_path();
        let (session_dek, vault_id_b64, vault_id_bytes) = {
            let guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
            let dek = guard
                .dek
                .clone()
                .ok_or_else(|| "Vault must be unlocked before changing credentials.".to_string())?;
            let vid = guard
                .vault_id_b64
                .clone()
                .ok_or_else(|| "Vault ID missing in session.".to_string())?;
            let vib = guard
                .vault_id_bytes
                .clone()
                .ok_or_else(|| "Vault ID bytes missing in session.".to_string())?;
            (dek, vid, vib)
        };

        // Verify current credentials if supplied (or require unlocked session if just recovered via recovery key).
        let (existing_slots, current_disk_json) = {
            let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| e.to_string())?;
            let slots = load_key_slots(&conn)?;
            if let Some(ref cur_pw) = current_passphrase.as_ref().filter(|s| !s.is_empty()) {
                let cur_kf = if let Some(ref kp) = cur_kf_path {
                    let auth = resolve_authorized_keyfile_path(kp, Some(&vault_id_bytes))?;
                    let raw = fs::read(&auth).map_err(|e| format!("Failed to read current key file: {}", e))?;
                    Some(extract_keyfile_secret(&raw)?.0)
                } else {
                    None
                };
                let mut ok = false;
                for slot in &slots {
                    match slot.kind.as_str() {
                        "composite_keyfile" => {
                            if let Some(ref kf) = cur_kf {
                                if unwrap_dek_from_slot_composite(&vault_id_b64, slot, cur_pw, kf).is_ok() {
                                    ok = true;
                                    break;
                                }
                            }
                        }
                        "passphrase" => {
                            if unwrap_dek_from_slot_passphrase(&vault_id_b64, slot, cur_pw).is_ok() {
                                ok = true;
                                break;
                            }
                        }
                        _ => {}
                    }
                }
                if !ok {
                    return Err("Current Master Password or Key File is incorrect.".into());
                }
            }
            let json = read_v2_ledger_with_dek(&conn, &vault_id_b64, &vault_id_bytes, &session_dek)?;
            (slots, json)
        };

        let active_dek = if rekey_dek {
            Zeroizing::new(random_bytes::<32>()?)
        } else {
            session_dek
        };

        let new_primary = match new_kf_data {
            Some((ref sec, ref fp, _)) => build_composite_keyfile_slot(
                &vault_id_b64,
                &active_dek,
                &new_passphrase,
                sec,
                fp,
                DEFAULT_ARGON2_MEMORY_KIB,
                DEFAULT_ARGON2_ITERATIONS,
                DEFAULT_ARGON2_PARALLELISM,
            )?,
            None => build_passphrase_slot(
                &vault_id_b64,
                &active_dek,
                &new_passphrase,
                DEFAULT_ARGON2_MEMORY_KIB,
                DEFAULT_ARGON2_ITERATIONS,
                DEFAULT_ARGON2_PARALLELISM,
            )?,
        };

        // Keep existing recovery slots if not rekeying; if rekeying, drop old recovery slots because
        // they still wrap the old DEK (user will generate a new recovery key if desired).
        let keep_recovery_slots: Vec<&StoredKeySlot> = if rekey_dek {
            Vec::new()
        } else {
            existing_slots
                .iter()
                .filter(|s| s.kind == "recovery")
                .collect()
        };

        let state_to_write = if rekey_dek {
            let raw = current_state_json
                .or(current_disk_json)
                .ok_or_else(|| "Cannot re-key vault without decrypted ledger state.".to_string())?;
            Some(strip_and_store_webdav_password(&raw)?)
        } else {
            None
        };

        let new_sha = atomic_write_db(&db_path, true, |conn| {
            conn.execute_batch("PRAGMA secure_delete = ON;")
                .map_err(|e| e.to_string())?;
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM key_slots", [])
                .map_err(|e| e.to_string())?;
            insert_slot(&tx, &new_primary)?;
            for rs in keep_recovery_slots {
                insert_slot(&tx, rs)?;
            }
            if let Some(ref clean_json) = state_to_write {
                write_v2_ledger_row(&tx, &vault_id_b64, &vault_id_bytes, &active_dek, clean_json)?;
            }
            tx.commit().map_err(|e| e.to_string())?;
            Ok(())
        })?;

        if let Some((_, _, ref path_str)) = new_kf_data {
            if remember_keyfile.unwrap_or(true) {
                let _ = write_remembered_keyfile_path(&vault_id_bytes, Some(path_str));
            }
        } else {
            let _ = write_remembered_keyfile_path(&vault_id_bytes, None);
        }

        // If Windows Hello was enrolled and DEK was rekeyed, remove stale device slot so user can re-enroll cleanly
        if rekey_dek {
            let app_dir = koban_app_dir();
            if windows_security::has_device_slot(&app_dir, &vault_id_bytes) {
                windows_security::remove_windows_hello_slot(&app_dir, &vault_id_bytes);
            }
        }

        {
            let mut guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
            guard.dek = Some(active_dek);
            guard.last_db_sha256 = Some(new_sha);
        }

        build_vault_status_for_path(&db_path)
    })
    .await
}

#[tauri::command]
async fn vault_generate_recovery_key() -> Result<String, String> {
    run_blocking(move || {
        let _guard = lock_db_file();
        let db_path = get_active_db_path();
        let (dek, vault_id_b64) = {
            let guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
            let dek = guard
                .dek
                .clone()
                .ok_or_else(|| "Vault must be unlocked to generate a recovery key.".to_string())?;
            let vid = guard
                .vault_id_b64
                .clone()
                .ok_or_else(|| "Vault ID missing in session.".to_string())?;
            (dek, vid)
        };

        let (rec_slot, rec_key) = build_recovery_slot(&vault_id_b64, &dek)?;
        let new_sha = atomic_write_db(&db_path, true, |conn| {
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM key_slots WHERE kind = 'recovery'", [])
                .map_err(|e| e.to_string())?;
            insert_slot(&tx, &rec_slot)?;
            tx.commit().map_err(|e| e.to_string())?;
            Ok(())
        })?;

        if let Ok(mut guard) = SESSION_KEY.lock() {
            guard.last_db_sha256 = Some(new_sha);
        }
        Ok(rec_key.to_string())
    })
    .await
}

#[tauri::command]
fn vault_generate_keyfile(target_path: String) -> Result<KeyFileCreateResult, String> {
    let granted = require_user_path(&target_path)?;
    let (json, _secret, fingerprint) = generate_keyfile_json(now_secs())?;
    fs::write(&granted, json.as_bytes())
        .map_err(|e| format!("Failed to write Key File: {}", e))?;
    Ok(KeyFileCreateResult {
        path: granted.to_string_lossy().to_string(),
        fingerprint,
    })
}

#[tauri::command]
async fn vault_enroll_device_unlock(window: tauri::WebviewWindow) -> Result<VaultStatus, String> {
    #[cfg(target_os = "windows")]
    let hwnd = window.hwnd().ok().map(|h| h.0 as isize);
    #[cfg(not(target_os = "windows"))]
    let hwnd = {
        let _ = window;
        None
    };

    run_blocking(move || {
        let _guard = lock_db_file();
        let db_path = get_active_db_path();
        let (dek, vault_id_b64, vault_id_bytes) = {
            let guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
            let dek = guard
                .dek
                .clone()
                .ok_or_else(|| "Vault must be unlocked before enrolling Windows Hello.".to_string())?;
            let vid = guard
                .vault_id_b64
                .clone()
                .ok_or_else(|| "Vault ID missing in session.".to_string())?;
            let vib = guard
                .vault_id_bytes
                .clone()
                .ok_or_else(|| "Vault ID bytes missing in session.".to_string())?;
            (dek, vid, vib)
        };

        let app_dir = koban_app_dir();
        windows_security::enroll_windows_hello_slot(
            &app_dir,
            &vault_id_b64,
            &vault_id_bytes,
            &dek,
            hwnd,
        )?;
        build_vault_status_for_path(&db_path)
    })
    .await
}

#[tauri::command]
fn vault_remove_device_unlock() -> Result<VaultStatus, String> {
    let _guard = lock_db_file();
    let db_path = get_active_db_path();
    let vault_id_bytes = {
        let guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
        guard.vault_id_bytes.clone()
    }
    .or_else(|| {
        Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .ok()
            .and_then(|c| get_meta_value(&c, "vault_id"))
            .and_then(|s| BASE64_STANDARD.decode(s).ok())
    });

    if let Some(vib) = vault_id_bytes {
        windows_security::remove_windows_hello_slot(&koban_app_dir(), &vib);
    }
    build_vault_status_for_path(&db_path)
}

#[tauri::command]
fn vault_save_auth_settings(settings_json: String) -> Result<VaultStatus, String> {
    let parsed: AuthSettings = serde_json::from_str(&settings_json)
        .map_err(|e| format!("Invalid auth settings: {}", e))?;
    let clean = serde_json::to_string(&parsed).map_err(|e| e.to_string())?;

    let _guard = lock_db_file();
    let db_path = get_active_db_path();
    if db_path.exists() {
        let new_sha = atomic_write_db(&db_path, true, |conn| {
            let ver = detect_db_format_version(conn)?;
            if ver > 2 {
                return Err("Cannot write to unknown higher vault format.".into());
            }
            conn.execute(
                "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('auth_settings', ?1)",
                params![clean],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })?;
        if let Ok(mut guard) = SESSION_KEY.lock() {
            if guard.dek.is_some() {
                guard.last_db_sha256 = Some(new_sha);
            }
        }
    }
    build_vault_status_for_path(&db_path)
}

#[tauri::command]
fn vault_set_remembered_keyfile(keyfile_path: Option<String>) -> Result<VaultStatus, String> {
    let _guard = lock_db_file();
    let db_path = get_active_db_path();
    let vault_id_bytes = {
        let guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
        guard.vault_id_bytes.clone()
    }
    .ok_or_else(|| "Vault must be unlocked.".to_string())?;

    if let Some(ref kp) = keyfile_path.as_ref().filter(|s| !s.trim().is_empty()) {
        let authorized = resolve_authorized_keyfile_path(kp, Some(&vault_id_bytes))?;
        write_remembered_keyfile_path(&vault_id_bytes, Some(&authorized.to_string_lossy()))?;
    } else {
        write_remembered_keyfile_path(&vault_id_bytes, None)?;
    }
    build_vault_status_for_path(&db_path)
}

#[tauri::command]
async fn vault_check_external_change() -> Result<ExternalChangeResult, String> {
    run_blocking(move || {
        let _guard = lock_db_file();
        let db_path = get_active_db_path();
        if !db_path.exists() {
            return Ok(ExternalChangeResult {
                changed: false,
                format_version: 0,
                external_state_json: None,
                error: None,
                last_modified: 0,
            });
        }

        let (session_dek, session_vid_b64, session_vid_bytes, last_sha) = {
            let guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
            (
                guard.dek.clone(),
                guard.vault_id_b64.clone(),
                guard.vault_id_bytes.clone(),
                guard.last_db_sha256.clone(),
            )
        };

        let Some(expected_sha) = last_sha else {
            return Ok(ExternalChangeResult {
                changed: false,
                format_version: 0,
                external_state_json: None,
                error: None,
                last_modified: file_mtime_secs(&db_path).unwrap_or(0),
            });
        };

        let disk_bytes = fs::read(&db_path)
            .map_err(|e| format!("Failed to read active database file: {}", e))?;
        let disk_sha = sha256_hex(&disk_bytes);
        let last_modified = file_mtime_secs(&db_path).unwrap_or(0);

        if disk_sha == expected_sha {
            return Ok(ExternalChangeResult {
                changed: false,
                format_version: 2,
                external_state_json: None,
                error: None,
                last_modified,
            });
        }

        // Database on disk changed externally (e.g., Synology Drive / OneDrive / Dropbox).
        if let Err(e) = validate_downloaded_vault(&db_path) {
            return Ok(ExternalChangeResult {
                changed: true,
                format_version: 0,
                external_state_json: None,
                error: Some(e),
                last_modified,
            });
        }

        let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("Failed to inspect updated database: {}", e))?;
        let ver = detect_db_format_version(&conn)?;
        if ver != 2 {
            return Ok(ExternalChangeResult {
                changed: true,
                format_version: ver,
                external_state_json: None,
                error: Some(format!("External database uses format v{}.", ver)),
                last_modified,
            });
        }

        let (Some(dek), Some(vid_b64), Some(vid_bytes)) = (session_dek, session_vid_b64, session_vid_bytes) else {
            return Ok(ExternalChangeResult {
                changed: true,
                format_version: 2,
                external_state_json: None,
                error: Some("Vault is locked.".into()),
                last_modified,
            });
        };

        let disk_vid = get_meta_value(&conn, "vault_id").unwrap_or_default();
        if disk_vid != vid_b64 {
            return Ok(ExternalChangeResult {
                changed: true,
                format_version: 2,
                external_state_json: None,
                error: Some("The database file on disk was replaced by a different vault. Please lock and unlock again.".into()),
                last_modified,
            });
        }

        match read_v2_ledger_with_dek(&conn, &vid_b64, &vid_bytes, &dek) {
            Ok(Some(json_str)) => {
                if let Ok(mut guard) = SESSION_KEY.lock() {
                    guard.last_db_sha256 = Some(disk_sha);
                }
                Ok(ExternalChangeResult {
                    changed: true,
                    format_version: 2,
                    external_state_json: Some(inject_local_webdav_password(&json_str)),
                    error: None,
                    last_modified,
                })
            }
            Ok(None) => Ok(ExternalChangeResult {
                changed: true,
                format_version: 2,
                external_state_json: None,
                error: Some("Updated database file has no ledger_state row.".into()),
                last_modified,
            }),
            Err(e) => Ok(ExternalChangeResult {
                changed: true,
                format_version: 2,
                external_state_json: None,
                error: Some(e),
                last_modified,
            }),
        }
    })
    .await
}

#[tauri::command]
fn vault_open_database_file(path: String) -> Result<VaultStatus, String> {
    let target = require_user_path(&path)?;
    if !target.exists() {
        return Err("Selected database file does not exist.".into());
    }
    validate_downloaded_vault(&target)?;

    let _guard = lock_db_file();
    let pointer = db_pointer_path();
    fs::write(&pointer, target.to_string_lossy().as_bytes())
        .map_err(|e| format!("Failed to save database location pointer: {}", e))?;

    if let Ok(mut guard) = SESSION_KEY.lock() {
        guard.clear();
    }
    build_vault_status_for_path(&target)
}

#[tauri::command]
fn get_db_info() -> Result<DbInfo, String> {
    let _guard = lock_db_file();
    let db_path = get_active_db_path();
    let is_custom_location = db_path != default_db_path();
    let meta = fs::metadata(&db_path).ok();
    let db_size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let last_modified = file_mtime_secs(&db_path).unwrap_or(0);

    if !db_path.exists() || db_size == 0 {
        return Ok(DbInfo {
            db_path: db_path.to_string_lossy().to_string(),
            db_size,
            last_modified,
            encrypted: true,
            cipher: "AES-256-GCM".into(),
            encrypted_records: 0,
            has_custom_passphrase: false,
            is_custom_location,
            format_version: 0,
        });
    }

    let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let format_version = detect_db_format_version(&conn)?;

    let (encrypted_records, has_custom_passphrase) = if format_version == 2 {
        let guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
        let count = if let (Some(dek), Some(vid_b64), Some(vid_bytes)) =
            (&guard.dek, &guard.vault_id_b64, &guard.vault_id_bytes)
        {
            if get_meta_value(&conn, "vault_id").as_deref() == Some(vid_b64.as_str()) {
                read_v2_ledger_with_dek(&conn, vid_b64, vid_bytes, dek)
                    .ok()
                    .flatten()
                    .map(|j| count_ledger_records_json(&j))
                    .unwrap_or(1)
            } else {
                1
            }
        } else {
            usize::from(has_ledger_state_row(&conn))
        };
        (count, true)
    } else {
        let count_rows = |sql: &str| -> usize {
            conn.query_row(sql, [], |r| r.get::<_, i64>(0))
                .map(|n| usize::try_from(n).unwrap_or(0))
                .unwrap_or(0)
        };
        let recs = if table_exists(&conn, "encrypted_records") {
            count_rows("SELECT COUNT(*) FROM encrypted_records")
        } else {
            0
        } + if table_exists(&conn, "encrypted_vault") {
            count_rows("SELECT COUNT(*) FROM encrypted_vault")
        } else {
            0
        };
        (recs, legacy_v1::is_custom_passphrase(&conn))
    };

    Ok(DbInfo {
        db_path: db_path.to_string_lossy().to_string(),
        db_size,
        last_modified,
        encrypted: true,
        cipher: if format_version == 2 {
            "Argon2id + AES-256-GCM".into()
        } else {
            "AES-256-GCM (v1)".into()
        },
        encrypted_records,
        has_custom_passphrase,
        is_custom_location,
        format_version,
    })
}

#[tauri::command]
fn save_ledger_db(
    state_json: String,
    backup_dir: Option<String>,
    auto_backup: bool,
    max_backups: Option<usize>,
    force_overwrite: Option<bool>,
) -> Result<SaveResult, String> {
    let _guard = lock_db_file();
    let db_path = get_active_db_path();

    let (dek, vault_id_b64, vault_id_bytes, last_sha) = {
        let guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
        let dek = guard
            .dek
            .clone()
            .ok_or_else(|| "Vault is locked. Unlock before saving.".to_string())?;
        let vid = guard
            .vault_id_b64
            .clone()
            .ok_or_else(|| "Vault ID missing in session.".to_string())?;
        let vib = guard
            .vault_id_bytes
            .clone()
            .ok_or_else(|| "Vault ID bytes missing in session.".to_string())?;
        (dek, vid, vib, guard.last_db_sha256.clone())
    };

    if !force_overwrite.unwrap_or(false) && db_path.exists() {
        if let Some(ref expected) = last_sha {
            if let Some(disk_sha) = file_sha256_hex(&db_path) {
                if &disk_sha != expected {
                    return Err("EXTERNAL_DB_MODIFIED: The database file on disk was updated externally since it was loaded.".into());
                }
            }
        }
    }

    let encrypted_records = count_ledger_records_json(&state_json);
    let clean_json = strip_and_store_webdav_password(&state_json)?;

    let new_sha = atomic_write_db(&db_path, true, |conn| {
        let ver = detect_db_format_version(conn)?;
        if ver != 2 {
            return Err("Database must be upgraded to Vault v2 before saving.".into());
        }
        let disk_vid = get_meta_value(conn, "vault_id").unwrap_or_default();
        if disk_vid != vault_id_b64 {
            return Err("Active database file does not match unlocked vault identity.".into());
        }
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        write_v2_ledger_row(&tx, &vault_id_b64, &vault_id_bytes, &dek, &clean_json)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })?;

    if let Ok(mut guard) = SESSION_KEY.lock() {
        guard.last_db_sha256 = Some(new_sha);
    }

    let mut backup_path_res = None;
    if auto_backup {
        if let Some(ref dir) = backup_dir {
            if !dir.trim().is_empty() {
                if let Ok(bp) = perform_backup_to_dir(
                    &db_path,
                    dir,
                    false,
                    max_backups.unwrap_or(20),
                ) {
                    backup_path_res = Some(bp);
                }
            }
        }
    }

    let meta = fs::metadata(&db_path).ok();
    Ok(SaveResult {
        db_path: db_path.to_string_lossy().to_string(),
        db_size: meta.map(|m| m.len()).unwrap_or(0),
        backup_path: backup_path_res,
        timestamp: now_secs(),
        encrypted_records,
    })
}

#[tauri::command]
fn trigger_manual_backup(
    backup_dir: String,
    state_json: String,
    max_backups: Option<usize>,
) -> Result<SaveResult, String> {
    let save_res = save_ledger_db(state_json, None, false, max_backups, Some(true))?;
    let _guard = lock_db_file();
    let db_path = get_active_db_path();
    let bp = perform_backup_to_dir(&db_path, &backup_dir, true, max_backups.unwrap_or(20))?;
    Ok(SaveResult {
        backup_path: Some(bp),
        ..save_res
    })
}

/// File names Koban itself writes for vaults and backups (`koban.db`, `koban-latest.db`,
/// `koban-daily-*.db`, `koban-backup-*.db`, `koban-encrypted-*.db`, `koban-pre-webdav-sync-*.db`, …).
fn is_koban_vault_file_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let stem = lower
        .strip_suffix(".db")
        .or_else(|| lower.strip_suffix(".sqlite"));
    match stem {
        Some(s) => {
            (s == "koban" || s.starts_with("koban-"))
                && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        }
        None => false,
    }
}

#[tauri::command]
fn list_backups(backup_dir: String) -> Result<Vec<BackupEntry>, String> {
    let p = Path::new(&backup_dir);
    if !p.exists() || !p.is_dir() {
        return Ok(Vec::new());
    }
    let mut list = Vec::new();
    if let Ok(entries) = fs::read_dir(p) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let name = entry.file_name().to_string_lossy().to_string();
                if is_koban_vault_file_name(&name) {
                    grant_user_path(&path);
                    let meta = entry.metadata().ok();
                    let fmt_ver = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                        .ok()
                        .and_then(|c| detect_db_format_version(&c).ok())
                        .unwrap_or(0);
                    list.push(BackupEntry {
                        name,
                        path: path.to_string_lossy().to_string(),
                        size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                        modified: meta
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0),
                        format_version: fmt_ver,
                    });
                }
            }
        }
    }
    list.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(list)
}

#[tauri::command]
fn list_legacy_v1_backups(backup_dir: Option<String>) -> Result<Vec<BackupEntry>, String> {
    let mut dirs = Vec::new();
    let active_db = get_active_db_path();
    if let Some(parent) = active_db.parent() {
        dirs.push(parent.to_path_buf());
    }
    if let Some(ref bdir) = backup_dir.filter(|s| !s.trim().is_empty()) {
        let p = PathBuf::from(bdir);
        if !dirs.contains(&p) {
            dirs.push(p);
        }
    }

    let mut list = Vec::new();
    for dir in dirs {
        if !dir.exists() || !dir.is_dir() {
            continue;
        }
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() || path == active_db {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_string();
                if is_koban_vault_file_name(&name) {
                    if let Ok(conn) = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
                        if matches!(detect_db_format_version(&conn), Ok(1)) {
                            grant_user_path(&path);
                            let meta = entry.metadata().ok();
                            list.push(BackupEntry {
                                name,
                                path: path.to_string_lossy().to_string(),
                                size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                                modified: meta
                                    .and_then(|m| m.modified().ok())
                                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                                    .map(|d| d.as_secs())
                                    .unwrap_or(0),
                                format_version: 1,
                            });
                        }
                    }
                }
            }
        }
    }
    list.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(list)
}

#[tauri::command]
async fn upgrade_legacy_v1_backup(
    path: String,
    v1_passphrase: Option<String>,
) -> Result<(), String> {
    let granted = require_user_path(&path)?;
    run_blocking(move || {
        let (dek, vault_id_b64, vault_id_bytes, session_v1_pass) = {
            let guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
            let dek = guard
                .dek
                .clone()
                .ok_or_else(|| "Vault must be unlocked to upgrade legacy backup files.".to_string())?;
            let vid = guard
                .vault_id_b64
                .clone()
                .ok_or_else(|| "Vault ID missing in session.".to_string())?;
            let vib = guard
                .vault_id_bytes
                .clone()
                .ok_or_else(|| "Vault ID bytes missing in session.".to_string())?;
            (
                dek,
                vid,
                vib,
                guard.legacy_v1_passphrase.as_ref().map(|z| z.to_string()),
            )
        };

        let active_db = get_active_db_path();
        if granted == active_db {
            return Err("Use the primary migration wizard to upgrade the active vault.".into());
        }

        let (v1_json, current_slots) = {
            let conn = Connection::open_with_flags(&granted, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| format!("Failed to open legacy backup: {}", e))?;
            if detect_db_format_version(&conn)? != 1 {
                return Err("Backup is not a legacy v1 file.".into());
            }
            let effective_pass = v1_passphrase.or(session_v1_pass);
            let json = legacy_v1::read_encrypted_state(&conn, effective_pass.as_deref())?
                .ok_or_else(|| "No ledger data in backup file.".to_string())?;

            let active_conn = Connection::open_with_flags(&active_db, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| e.to_string())?;
            let slots = load_key_slots(&active_conn)?;
            (json, slots)
        };

        let clean_json = strip_and_store_webdav_password(&v1_json)?;
        let _ = atomic_write_db(&granted, true, |conn| {
            conn.execute_batch("PRAGMA secure_delete = ON;")
                .map_err(|e| e.to_string())?;
            {
                let tx = conn.transaction().map_err(|e| e.to_string())?;
                tx.execute(
                    "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('format_version', '2')",
                    [],
                )
                .map_err(|e| e.to_string())?;
                tx.execute(
                    "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('vault_id', ?1)",
                    params![vault_id_b64],
                )
                .map_err(|e| e.to_string())?;
                tx.execute(
                    "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('cipher', 'AES-256-GCM')",
                    [],
                )
                .map_err(|e| e.to_string())?;
                tx.execute(
                    "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('custom_passphrase', 'true')",
                    [],
                )
                .map_err(|e| e.to_string())?;
                tx.execute(
                    "DELETE FROM vault_meta WHERE key IN ('kdf', 'auth_config')",
                    [],
                )
                .map_err(|e| e.to_string())?;
                tx.execute("DELETE FROM key_slots", [])
                    .map_err(|e| e.to_string())?;
                for slot in &current_slots {
                    insert_slot(&tx, slot)?;
                }
                write_v2_ledger_row(&tx, &vault_id_b64, &vault_id_bytes, &dek, &clean_json)?;
                tx.execute_batch(
                    "
                    DROP TABLE IF EXISTS encrypted_records;
                    DROP TABLE IF EXISTS app_state;
                    ",
                )
                .map_err(|e| e.to_string())?;
                tx.commit().map_err(|e| e.to_string())?;
            }
            conn.execute_batch("VACUUM;").map_err(|e| e.to_string())?;
            Ok(())
        })?;
        Ok(())
    })
    .await
}

#[tauri::command]
fn delete_legacy_v1_backup(path: String) -> Result<(), String> {
    let granted = require_user_path(&path)?;
    if granted == get_active_db_path() {
        return Err("Refusing to delete the active database.".into());
    }
    if granted.exists() {
        fs::remove_file(&granted).map_err(|e| format!("Failed to delete backup file: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn restore_backup_file(
    path: String,
    passphrase: Option<String>,
    keyfile_path: Option<String>,
    preview_only: Option<bool>,
) -> Result<String, String> {
    let granted = require_user_path(&path)?;
    if !granted.exists() {
        return Err("Backup file does not exist.".into());
    }

    let kf_secret = if let Some(ref kp) = keyfile_path.as_ref().filter(|s| !s.trim().is_empty()) {
        let auth = resolve_authorized_keyfile_path(kp, None)?;
        let raw = fs::read(&auth).map_err(|e| format!("Failed to read key file: {}", e))?;
        Some(extract_keyfile_secret(&raw)?.0)
    } else {
        None
    };

    run_blocking(move || {
        let p = granted.as_path();
        let ext = p
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        let state_json = if ext == "db" || ext == "sqlite" {
            let conn = Connection::open_with_flags(p, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| format!("Failed to open backup SQLite database: {}", e))?;
            let ver = detect_db_format_version(&conn)?;
            if ver == 2 {
                let vid_b64 = get_meta_value(&conn, "vault_id")
                    .ok_or_else(|| "Backup database is missing vault_id.".to_string())?;
                let vid_bytes = BASE64_STANDARD
                    .decode(&vid_b64)
                    .map_err(|_| "Corrupt vault_id in backup.".to_string())?;

                // 1) Try session DEK first if no explicit passphrase/keyfile was typed
                let mut decrypted: Option<String> = None;
                if passphrase.as_deref().unwrap_or("").is_empty() && kf_secret.is_none() {
                    let maybe_dek = SESSION_KEY.lock().ok().and_then(|g| g.dek.clone());
                    if let Some(dek) = maybe_dek {
                        if let Ok(Some(json)) = read_v2_ledger_with_dek(&conn, &vid_b64, &vid_bytes, &dek) {
                            decrypted = Some(json);
                        }
                    }
                }

                // 2) Try slots with supplied passphrase/keyfile/recovery key
                if decrypted.is_none() {
                    let slots = load_key_slots(&conn)?;
                    let pw = passphrase.as_deref().unwrap_or("");
                    for slot in &slots {
                        let candidate_dek = match slot.kind.as_str() {
                            "composite_keyfile" => kf_secret.as_ref().and_then(|kf| {
                                unwrap_dek_from_slot_composite(&vid_b64, slot, pw, kf).ok()
                            }),
                            "passphrase" => {
                                if !pw.is_empty() {
                                    unwrap_dek_from_slot_passphrase(&vid_b64, slot, pw).ok()
                                } else {
                                    None
                                }
                            }
                            "recovery" => {
                                if !pw.is_empty() {
                                    unwrap_dek_from_slot_recovery(&vid_b64, slot, pw).ok()
                                } else {
                                    None
                                }
                            }
                            _ => None,
                        };
                        if let Some(dek) = candidate_dek {
                            if let Ok(Some(json)) = read_v2_ledger_with_dek(&conn, &vid_b64, &vid_bytes, &dek) {
                                decrypted = Some(json);
                                break;
                            }
                        }
                    }
                }

                decrypted.ok_or_else(|| {
                    "Could not decrypt backup database. Enter the passphrase (and key file, if used) that was active when this backup was taken.".to_string()
                })?
            } else {
                legacy_v1::read_encrypted_state(&conn, passphrase.as_deref())?
                    .ok_or_else(|| "No encrypted ledger data found in backup database.".to_string())?
            }
        } else {
            let data = fs::read(p).map_err(|e| format!("Failed to read file: {}", e))?;
            let data = data.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&data);
            String::from_utf8_lossy(data).into_owned()
        };

        let result_json = inject_local_webdav_password(&state_json);

        if !preview_only.unwrap_or(false) {
            let _guard = lock_db_file();
            let active_db = get_active_db_path();
            let (dek, vid_b64, vid_bytes) = {
                let guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
                let dek = guard
                    .dek
                    .clone()
                    .ok_or_else(|| "Active vault must be unlocked before restoring.".to_string())?;
                let vid = guard
                    .vault_id_b64
                    .clone()
                    .ok_or_else(|| "Vault ID missing in session.".to_string())?;
                let vib = guard
                    .vault_id_bytes
                    .clone()
                    .ok_or_else(|| "Vault ID bytes missing in session.".to_string())?;
                (dek, vid, vib)
            };
            let clean_json = strip_and_store_webdav_password(&result_json)?;
            let new_sha = atomic_write_db(&active_db, true, |conn| {
                let tx = conn.transaction().map_err(|e| e.to_string())?;
                write_v2_ledger_row(&tx, &vid_b64, &vid_bytes, &dek, &clean_json)?;
                tx.commit().map_err(|e| e.to_string())?;
                Ok(())
            })?;
            if let Ok(mut guard) = SESSION_KEY.lock() {
                guard.last_db_sha256 = Some(new_sha);
            }
            remove_webdav_sync_state(&active_db);
        }

        Ok(result_json)
    })
    .await
}

// ===================== File Dialog & Export Commands =====================

#[tauri::command]
fn pick_folder(title: Option<String>) -> Result<Option<String>, String> {
    let dialog = rfd::FileDialog::new()
        .set_title(&title.unwrap_or_else(|| "Select Backup Folder".into()));
    let folder = dialog.pick_folder();
    if let Some(ref p) = folder {
        grant_user_path(p);
    }
    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn pick_save_file(
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let ext_refs: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    let dialog = rfd::FileDialog::new()
        .set_title("Export File")
        .set_file_name(&default_name)
        .add_filter(&filter_name, &ext_refs)
        .add_filter("All Files", &["*"]);
    let file = dialog.save_file();
    if let Some(ref p) = file {
        grant_user_path(p);
    }
    Ok(file.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn pick_open_file(filter_name: String, extensions: Vec<String>) -> Result<Option<String>, String> {
    let ext_refs: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    let dialog = rfd::FileDialog::new()
        .set_title("Select File")
        .add_filter(&filter_name, &ext_refs)
        .add_filter("All Files", &["*"]);
    let file = dialog.pick_file();
    if let Some(ref p) = file {
        grant_user_path(p);
    }
    Ok(file.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn write_binary_file(path: String, base64_data: String) -> Result<(), String> {
    let path = require_user_path(&path)?;
    let bytes = BASE64_STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;
    fs::write(&path, bytes).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<String, String> {
    let path = require_user_path(&path)?;
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    Ok(BASE64_STANDARD.encode(&bytes))
}

#[tauri::command]
fn write_text_file(path: String, content: String, add_bom: bool) -> Result<(), String> {
    let path = require_user_path(&path)?;
    if add_bom {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(content.as_bytes());
        fs::write(&path, bytes).map_err(|e| format!("Failed to write file: {}", e))
    } else {
        fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))
    }
}

#[tauri::command]
fn copy_db_file(target_path: String) -> Result<(), String> {
    let target_path = require_user_path(&target_path)?;
    let _guard = lock_db_file();
    let db_path = get_active_db_path();
    fs::copy(&db_path, &target_path)
        .map_err(|e| format!("Failed to export encrypted SQLite DB: {}", e))?;
    Ok(())
}

/// Only an existing, absolute, local path may be shown in Explorer.
fn validate_reveal_path(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    let unc = path.starts_with("\\\\") || path.starts_with("//");
    if path.is_empty()
        || path.contains('"')
        || path.chars().any(|c| c.is_control())
        || unc
        || !p.is_absolute()
    {
        return Err("Only local folders and files can be shown in Explorer.".into());
    }
    if !p.exists() {
        return Err("The file or folder does not exist.".into());
    }
    Ok(())
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    validate_reveal_path(&path)?;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let p = Path::new(&path);
        let arg = if p.is_file() {
            format!("/select,\"{}\"", path)
        } else {
            format!("\"{}\"", path)
        };
        Command::new("explorer")
            .raw_arg(arg)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
    }
    Ok(())
}

#[tauri::command]
fn move_database_location(target_folder: String) -> Result<DbInfo, String> {
    let trimmed = target_folder.trim();
    if trimmed.is_empty() {
        return Err("Target folder path cannot be empty.".into());
    }

    let target_input = require_user_path(trimmed)?;
    let target_db_path = if target_input.extension().and_then(|s| s.to_str()) == Some("db") {
        target_input
    } else {
        target_input.join("koban.db")
    };

    if let Some(parent) = target_db_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create destination folder: {}", e))?;
    }

    {
        let _guard = lock_db_file();
        let current_db_path = get_active_db_path();
        if current_db_path == target_db_path {
            drop(_guard);
            return get_db_info();
        }

        if current_db_path.exists() {
            let tmp_dest = sidecar_path(&target_db_path, ".move-tmp");
            fs::copy(&current_db_path, &tmp_dest)
                .map_err(|e| format!("Failed to copy active SQLite database: {}", e))?;
            fs::rename(&tmp_dest, &target_db_path)
                .map_err(|e| format!("Failed to commit relocated database: {}", e))?;
            remove_sqlite_sidecars(&target_db_path);
            copy_webdav_sync_state(&current_db_path, &target_db_path);
        } else {
            let conn = Connection::open(&target_db_path)
                .map_err(|e| format!("Failed to create new SQLite database: {}", e))?;
            init_v2_schema(&conn)?;
        }

        let pointer = db_pointer_path();
        fs::write(&pointer, target_db_path.to_string_lossy().as_bytes())
            .map_err(|e| format!("Failed to save location pointer: {}", e))?;
    }

    get_db_info()
}

#[tauri::command]
fn reset_database_location() -> Result<DbInfo, String> {
    {
        let _guard = lock_db_file();
        let current_db_path = get_active_db_path();
        let default_path = default_db_path();

        if current_db_path != default_path && current_db_path.exists() {
            if let Some(parent) = default_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let tmp_dest = sidecar_path(&default_path, ".move-tmp");
            if fs::copy(&current_db_path, &tmp_dest).is_ok() {
                let _ = fs::rename(&tmp_dest, &default_path);
                remove_sqlite_sidecars(&default_path);
            }
            copy_webdav_sync_state(&current_db_path, &default_path);
        }

        let pointer = db_pointer_path();
        if pointer.exists() {
            let _ = fs::remove_file(pointer);
        }
    }

    get_db_info()
}

// ===================== WebDAV (backup copy / primary storage) =====================

const WEBDAV_DEFAULT_FILE: &str = "koban-vault.db";
const WEBDAV_HEAD_TIMEOUT_SECS: u64 = 30;
const WEBDAV_TRANSFER_TIMEOUT_SECS: u64 = 120;
const WEBDAV_CONNECT_TIMEOUT_SECS: u64 = 15;
const WEBDAV_CONFLICT_PREFIX: &str = "WEBDAV_CONFLICT:";
const WEBDAV_SYNC_STATE_VERSION: u32 = 1;
const WEBDAV_MAX_DOWNLOAD_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct WebDavSyncState {
    version: u32,
    target: String,
    #[serde(default)]
    etag: Option<String>,
    #[serde(default)]
    last_modified: Option<String>,
    #[serde(default)]
    remote_size: Option<u64>,
    local_sha256: String,
    synced_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WebDavCheckResult {
    pub status: String,
    pub message: String,
    pub remote_etag: Option<String>,
    pub remote_last_modified: Option<String>,
    pub remote_size: Option<u64>,
    pub first_link: bool,
    pub local_modified: Option<u64>,
    pub target: String,
}

#[derive(Clone, Debug, Default)]
struct WebDavRemoteMeta {
    etag: Option<String>,
    last_modified: Option<String>,
    size: Option<u64>,
}

enum WebDavHeadOutcome {
    Found(WebDavRemoteMeta),
    Missing,
}

enum WebDavFailure {
    Offline(String),
    Auth(String),
    Http(String),
}

impl WebDavFailure {
    fn message(&self) -> String {
        match self {
            WebDavFailure::Offline(m) | WebDavFailure::Auth(m) | WebDavFailure::Http(m) => {
                m.clone()
            }
        }
    }
}

const WEBDAV_AUTH_FAILED_MSG: &str =
    "Authentication failed. Please verify your WebDAV username and password / app token.";

fn webdav_agent(timeout_secs: u64) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(WEBDAV_CONNECT_TIMEOUT_SECS.min(timeout_secs)))
        .timeout_read(Duration::from_secs(timeout_secs))
        .timeout_write(Duration::from_secs(timeout_secs))
        .build()
}

async fn run_blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("Background task failed: {}", e))?
}

fn webdav_auth_header(user: &str, pass: &str) -> String {
    let auth = format!("{}:{}", user, pass);
    format!("Basic {}", BASE64_STANDARD.encode(auth.as_bytes()))
}

fn webdav_target_url(base_url: &str, filename: Option<&str>) -> String {
    let mut url = base_url.trim().to_string();
    let fname = filename.unwrap_or(WEBDAV_DEFAULT_FILE).trim();
    let fname = if fname.is_empty() { WEBDAV_DEFAULT_FILE } else { fname };

    if !url.ends_with('/') {
        if url.ends_with(".db") || url.ends_with(".sqlite") {
            return url;
        }
        url.push('/');
    }
    format!("{}{}", url, fname)
}

fn webdav_sync_state_path(db_path: &Path) -> PathBuf {
    sidecar_path(db_path, ".webdav-sync.json")
}

fn read_webdav_sync_state(db_path: &Path, target: &str) -> Option<WebDavSyncState> {
    let raw = fs::read_to_string(webdav_sync_state_path(db_path)).ok()?;
    let parsed: WebDavSyncState = serde_json::from_str(raw.trim_start_matches('\u{feff}')).ok()?;
    if parsed.target == target {
        Some(parsed)
    } else {
        None
    }
}

fn write_webdav_sync_state(
    db_path: &Path,
    target: &str,
    meta: &WebDavRemoteMeta,
    local_sha256: String,
) {
    let state = WebDavSyncState {
        version: WEBDAV_SYNC_STATE_VERSION,
        target: target.to_string(),
        etag: meta.etag.clone(),
        last_modified: meta.last_modified.clone(),
        remote_size: meta.size,
        local_sha256,
        synced_at: now_secs(),
    };
    if let Ok(json) = serde_json::to_string_pretty(&state) {
        let _ = fs::write(webdav_sync_state_path(db_path), json.as_bytes());
    }
}

fn remove_webdav_sync_state(db_path: &Path) {
    let p = webdav_sync_state_path(db_path);
    if p.exists() {
        let _ = fs::remove_file(p);
    }
}

fn copy_webdav_sync_state(from_db: &Path, to_db: &Path) {
    let from = webdav_sync_state_path(from_db);
    if from.exists() {
        let _ = fs::copy(&from, webdav_sync_state_path(to_db));
    }
}

fn header_string(r: &ureq::Response, name: &str) -> Option<String> {
    r.header(name)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn webdav_head(target: &str, auth: &str) -> Result<WebDavHeadOutcome, WebDavFailure> {
    let resp = webdav_agent(WEBDAV_HEAD_TIMEOUT_SECS)
        .head(target)
        .set("Authorization", auth)
        .call();
    match resp {
        Ok(r) => Ok(WebDavHeadOutcome::Found(WebDavRemoteMeta {
            etag: header_string(&r, "ETag"),
            last_modified: header_string(&r, "Last-Modified"),
            size: r
                .header("Content-Length")
                .and_then(|v| v.trim().parse::<u64>().ok()),
        })),
        Err(ureq::Error::Status(404, _)) => Ok(WebDavHeadOutcome::Missing),
        Err(ureq::Error::Status(code, _)) if code == 401 || code == 403 => {
            Err(WebDavFailure::Auth(WEBDAV_AUTH_FAILED_MSG.into()))
        }
        Err(ureq::Error::Status(code, _)) if code >= 500 => Err(WebDavFailure::Offline(format!(
            "WebDAV server is unavailable (HTTP {}).",
            code
        ))),
        Err(ureq::Error::Status(code, _)) => Err(WebDavFailure::Http(format!(
            "WebDAV server returned HTTP {} for the vault file.",
            code
        ))),
        Err(ureq::Error::Transport(t)) => {
            Err(WebDavFailure::Offline(format!("WebDAV connection error: {}", t)))
        }
    }
}

fn etag_opaque(tag: &str) -> &str {
    let t = tag.trim();
    t.strip_prefix("W/").unwrap_or(t)
}

fn webdav_remote_changed(remote: &WebDavRemoteMeta, state: Option<&WebDavSyncState>) -> bool {
    match state {
        None => true,
        Some(s) => match (&s.etag, &remote.etag) {
            (Some(saved), Some(current)) => etag_opaque(saved) != etag_opaque(current),
            _ => remote.last_modified != s.last_modified || remote.size != s.remote_size,
        },
    }
}

fn webdav_check_impl(
    url: String,
    username: String,
    password: String,
    filename: Option<String>,
) -> Result<WebDavCheckResult, String> {
    if url.trim().is_empty() {
        return Err("WebDAV URL cannot be empty.".into());
    }
    let target = webdav_target_url(&url, filename.as_deref());
    let auth = webdav_auth_header(username.trim(), password.trim());
    let local_db = get_active_db_path();
    let state = read_webdav_sync_state(&local_db, &target);

    let local_sha = {
        let _guard = lock_db_file();
        if local_db.exists() {
            fs::read(&local_db).ok().map(|bytes| sha256_hex(&bytes))
        } else {
            None
        }
    };
    let local_modified = file_mtime_secs(&local_db);
    let local_dirty = match (&state, &local_sha) {
        (Some(s), Some(sha)) => &s.local_sha256 != sha,
        _ => true,
    };

    let mut result = WebDavCheckResult {
        status: String::new(),
        message: String::new(),
        remote_etag: None,
        remote_last_modified: None,
        remote_size: None,
        first_link: state.is_none(),
        local_modified,
        target: target.clone(),
    };

    match webdav_head(&target, &auth) {
        Err(WebDavFailure::Offline(m)) => {
            result.status = "offline".into();
            result.message = m;
        }
        Err(WebDavFailure::Auth(m)) | Err(WebDavFailure::Http(m)) => {
            result.status = "error".into();
            result.message = m;
        }
        Ok(WebDavHeadOutcome::Missing) => {
            result.status = "remote_missing".into();
            result.message = "No vault file exists at this WebDAV location yet.".into();
        }
        Ok(WebDavHeadOutcome::Found(meta)) => {
            let remote_changed = webdav_remote_changed(&meta, state.as_ref());
            let (status, message) = match (remote_changed, local_dirty) {
                (false, false) => ("in_sync", "The cloud vault and this device are in sync."),
                (false, true) => ("local_ahead", "This device has changes that are not uploaded yet."),
                (true, false) => ("remote_ahead", "The cloud vault has newer changes."),
                (true, true) => (
                    "conflict",
                    "Both the cloud vault and this device changed since the last sync.",
                ),
            };
            result.status = status.into();
            result.message = message.into();
            result.remote_etag = meta.etag;
            result.remote_last_modified = meta.last_modified;
            result.remote_size = meta.size;
        }
    }
    Ok(result)
}

fn webdav_test_impl(url: String, username: String, password: String) -> Result<String, String> {
    let trimmed_url = url.trim();
    if trimmed_url.is_empty() {
        return Err("WebDAV URL cannot be empty.".into());
    }
    let auth = webdav_auth_header(username.trim(), password.trim());
    let agent = webdav_agent(WEBDAV_HEAD_TIMEOUT_SECS);
    let resp = agent
        .request("PROPFIND", trimmed_url)
        .set("Authorization", &auth)
        .set("Depth", "0")
        .call();

    match resp {
        Ok(r) => {
            let status = r.status();
            if (200..=299).contains(&status) || status == 207 {
                Ok("WebDAV connection verified successfully (HTTP 207/200).".into())
            } else {
                Ok(format!("WebDAV server responded with status: {}", status))
            }
        }
        Err(ureq::Error::Status(status, _)) => {
            if status == 401 || status == 403 {
                Err(WEBDAV_AUTH_FAILED_MSG.into())
            } else if status == 405 {
                let get_resp = agent.get(trimmed_url).set("Authorization", &auth).call();
                match get_resp {
                    Ok(_) => Ok("WebDAV connection verified successfully (HTTP GET).".into()),
                    Err(e) => Err(format!("WebDAV server responded with HTTP {}: {}", status, e)),
                }
            } else if status == 404 {
                Err("WebDAV folder was not found (HTTP 404). Check the remote URL.".into())
            } else {
                Err(format!("WebDAV server returned HTTP error: {}", status))
            }
        }
        Err(ureq::Error::Transport(t)) => Err(format!("Network / TLS connection error: {}", t)),
    }
}

#[tauri::command]
async fn test_webdav_connection(
    url: String,
    username: String,
    password: String,
) -> Result<String, String> {
    run_blocking(move || webdav_test_impl(url, username, password)).await
}

#[tauri::command]
async fn get_webdav_remote_info(
    url: String,
    username: String,
    password: String,
    filename: Option<String>,
) -> Result<WebDavRemoteInfo, String> {
    run_blocking(move || {
        let target = webdav_target_url(&url, filename.as_deref());
        let auth = webdav_auth_header(username.trim(), password.trim());
        match webdav_head(&target, &auth) {
            Ok(WebDavHeadOutcome::Found(meta)) => Ok(WebDavRemoteInfo {
                exists: true,
                size: meta.size,
                last_modified: meta.last_modified,
            }),
            Ok(WebDavHeadOutcome::Missing) => Ok(WebDavRemoteInfo {
                exists: false,
                size: None,
                last_modified: None,
            }),
            Err(f) => Err(f.message()),
        }
    })
    .await
}

#[tauri::command]
async fn webdav_check(
    url: String,
    username: String,
    password: String,
    filename: Option<String>,
) -> Result<WebDavCheckResult, String> {
    run_blocking(move || webdav_check_impl(url, username, password, filename)).await
}

enum WebDavDownloadError {
    Status(u16),
    Transport(String),
}

fn webdav_download_bytes(
    target: &str,
    auth: &str,
) -> Result<(Vec<u8>, Option<String>, Option<String>), WebDavDownloadError> {
    let r = match webdav_agent(WEBDAV_TRANSFER_TIMEOUT_SECS)
        .get(target)
        .set("Authorization", auth)
        .call()
    {
        Ok(r) => r,
        Err(ureq::Error::Status(code, _)) => return Err(WebDavDownloadError::Status(code)),
        Err(ureq::Error::Transport(t)) => {
            return Err(WebDavDownloadError::Transport(t.to_string()));
        }
    };
    let etag = header_string(&r, "ETag");
    let modified = header_string(&r, "Last-Modified");
    let mut data = Vec::new();
    use std::io::Read;
    r.into_reader()
        .take(WEBDAV_MAX_DOWNLOAD_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|e| WebDavDownloadError::Transport(format!("Failed to download WebDAV file content: {}", e)))?;
    if data.len() as u64 > WEBDAV_MAX_DOWNLOAD_BYTES {
        return Err(WebDavDownloadError::Transport(format!(
            "The WebDAV file is larger than {} MB and was not downloaded.",
            WEBDAV_MAX_DOWNLOAD_BYTES / (1024 * 1024)
        )));
    }
    Ok((data, etag, modified))
}

fn webdav_push_impl(
    url: String,
    username: String,
    password: String,
    filename: Option<String>,
    force: bool,
    preserve_remote: bool,
) -> Result<WebDavSyncResult, String> {
    let local_db = get_active_db_path();
    if !local_db.exists() {
        return Err("Local SQLite database does not exist to upload.".into());
    }

    let data = {
        let _guard = lock_db_file();
        fs::read(&local_db).map_err(|e| format!("Failed to read local database: {}", e))?
    };
    let local_sha = sha256_hex(&data);
    let target = webdav_target_url(&url, filename.as_deref());
    let auth = webdav_auth_header(username.trim(), password.trim());
    let state = read_webdav_sync_state(&local_db, &target);

    let mut if_match: Option<String> = None;
    if !force {
        if let Some(ref s) = state {
            match s.etag {
                Some(ref etag) if !etag.trim().starts_with("W/") => {
                    if_match = Some(etag.clone());
                }
                _ => match webdav_head(&target, &auth) {
                    Ok(WebDavHeadOutcome::Found(meta)) => {
                        if webdav_remote_changed(&meta, Some(s)) {
                            return Err(format!(
                                "{} The WebDAV vault was changed on another device since the last sync.",
                                WEBDAV_CONFLICT_PREFIX
                            ));
                        }
                    }
                    Ok(WebDavHeadOutcome::Missing) => {}
                    Err(f) => return Err(f.message()),
                },
            }
        }
    }

    let mut preserved_path: Option<PathBuf> = None;
    if preserve_remote {
        match webdav_download_bytes(&target, &auth) {
            Ok((remote_bytes, _, _)) => {
                if let Some(parent) = local_db.parent() {
                    let conflict_file =
                        parent.join(format!("koban-webdav-conflict-{}.db", now_secs()));
                    fs::write(&conflict_file, &remote_bytes).map_err(|e| {
                        format!("Failed to save a copy of the WebDAV vault before overwriting it: {}", e)
                    })?;
                    preserved_path = Some(conflict_file);
                }
            }
            Err(WebDavDownloadError::Status(404)) => {}
            Err(WebDavDownloadError::Status(code)) => {
                return Err(format!(
                    "Could not back up the WebDAV vault before overwriting it (HTTP {}).",
                    code
                ));
            }
            Err(WebDavDownloadError::Transport(t)) => {
                return Err(format!(
                    "Network transport error while backing up the WebDAV vault: {}",
                    t
                ));
            }
        }
    }

    if let Some(idx) = target.rfind('/') {
        let parent_url = &target[..=idx];
        let _ = webdav_agent(WEBDAV_HEAD_TIMEOUT_SECS)
            .request("MKCOL", parent_url)
            .set("Authorization", &auth)
            .call();
    }

    let mut req = webdav_agent(WEBDAV_TRANSFER_TIMEOUT_SECS)
        .put(&target)
        .set("Authorization", &auth)
        .set("Content-Type", "application/x-sqlite3");
    if let Some(ref etag) = if_match {
        req = req.set("If-Match", etag);
    }

    match req.send_bytes(&data) {
        Ok(r) => {
            let mut meta = WebDavRemoteMeta {
                etag: header_string(&r, "ETag"),
                last_modified: header_string(&r, "Last-Modified"),
                size: Some(data.len() as u64),
            };
            if meta.etag.is_none() || meta.last_modified.is_none() {
                if let Ok(WebDavHeadOutcome::Found(head)) = webdav_head(&target, &auth) {
                    meta = WebDavRemoteMeta {
                        etag: head.etag.or(meta.etag),
                        last_modified: head.last_modified.or(meta.last_modified),
                        size: head.size.or(meta.size),
                    };
                }
            }
            write_webdav_sync_state(&local_db, &target, &meta, local_sha);

            let mut message = format!(
                "Encrypted database ({} KB) uploaded to WebDAV successfully.",
                data.len() / 1024
            );
            if let Some(p) = preserved_path {
                message.push_str(&format!(
                    " The previous cloud copy was kept as {}.",
                    p.to_string_lossy()
                ));
            }
            Ok(WebDavSyncResult {
                success: true,
                message,
                remote_size: meta.size,
                remote_modified: meta.last_modified,
                timestamp: now_secs(),
            })
        }
        Err(ureq::Error::Status(412, _)) => Err(format!(
            "{} The WebDAV vault was changed on another device since the last sync (HTTP 412).",
            WEBDAV_CONFLICT_PREFIX
        )),
        Err(ureq::Error::Status(status, _)) if status == 401 || status == 403 => {
            Err(WEBDAV_AUTH_FAILED_MSG.into())
        }
        Err(ureq::Error::Status(status, _)) => {
            Err(format!("WebDAV upload failed with HTTP status: {}", status))
        }
        Err(ureq::Error::Transport(t)) => {
            Err(format!("Network transport error during WebDAV upload: {}", t))
        }
    }
}

/// Validates a vault downloaded from WebDAV or chosen from disk before opening it:
/// - Rejects SQLite triggers, views, and legacy plaintext tables (`app_state`, etc.)
/// - Rejects unknown future vault format versions (`format_version > 2`)
fn validate_downloaded_vault(path: &Path) -> Result<(), String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Downloaded file is not a readable SQLite database: {}", e))?;
    let suspicious: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master
             WHERE type IN ('trigger', 'view')
                OR (type = 'table' AND name IN ('app_state', 'category_groups', 'categories',
                                                 'monthly_budgets', 'transactions', 'savings_goals'))",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Downloaded file is not a valid Koban vault: {}", e))?;
    if suspicious > 0 {
        return Err("The downloaded file is not a Koban vault in the current format (it contains plaintext tables, triggers or views) and was not used.".into());
    }
    let _ = detect_db_format_version(&conn)?;
    Ok(())
}

fn webdav_pull_impl(
    url: String,
    username: String,
    password: String,
    filename: Option<String>,
) -> Result<WebDavSyncResult, String> {
    if url.trim().is_empty() {
        return Err("WebDAV URL cannot be empty.".into());
    }
    let target = webdav_target_url(&url, filename.as_deref());
    let auth = webdav_auth_header(username.trim(), password.trim());

    let (data, etag, modified) = match webdav_download_bytes(&target, &auth) {
        Ok(v) => v,
        Err(WebDavDownloadError::Status(404)) => {
            return Err("No database found on WebDAV server at this path (HTTP 404). Push your local database first to initialize cloud sync.".into());
        }
        Err(WebDavDownloadError::Status(status)) if status == 401 || status == 403 => {
            return Err(WEBDAV_AUTH_FAILED_MSG.into());
        }
        Err(WebDavDownloadError::Status(status)) => {
            return Err(format!("WebDAV download failed with HTTP status: {}", status));
        }
        Err(WebDavDownloadError::Transport(t)) => {
            return Err(format!("Network transport error during WebDAV download: {}", t));
        }
    };

    if data.len() < 16 || &data[0..16] != b"SQLite format 3\0" {
        return Err("Downloaded remote file is not a valid SQLite database.".into());
    }

    let local_db = get_active_db_path();
    if let Some(parent) = local_db.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let data_sha = sha256_hex(&data);

    {
        let _guard = lock_db_file();
        if local_db.exists() {
            if let Some(parent) = local_db.parent() {
                let backup_file =
                    parent.join(format!("koban-pre-webdav-sync-{}.db", now_secs()));
                let _ = fs::copy(&local_db, &backup_file);
            }
        }
        let tmp = sidecar_path(&local_db, ".download-tmp");
        fs::write(&tmp, &data).map_err(|e| format!("Failed to save downloaded database: {}", e))?;
        if let Err(e) = validate_downloaded_vault(&tmp) {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
        remove_sqlite_sidecars(&local_db);
        fs::rename(&tmp, &local_db).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("Failed to replace the local database: {}", e)
        })?;
    }

    // If the downloaded vault has the same vault_id as the currently unlocked session, update the
    // disk hash tracker; otherwise clear session DEK so the lock screen prompts cleanly for the new vault.
    if let Ok(conn) = Connection::open_with_flags(&local_db, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        let downloaded_vid = get_meta_value(&conn, "vault_id");
        if let Ok(mut guard) = SESSION_KEY.lock() {
            if guard.dek.is_some() && guard.vault_id_b64 == downloaded_vid && downloaded_vid.is_some() {
                guard.last_db_sha256 = Some(data_sha.clone());
            } else {
                guard.clear();
            }
        }
    }

    let meta = WebDavRemoteMeta {
        etag,
        last_modified: modified,
        size: Some(data.len() as u64),
    };
    write_webdav_sync_state(&local_db, &target, &meta, data_sha);

    Ok(WebDavSyncResult {
        success: true,
        message: format!(
            "Encrypted database ({} KB) downloaded and synchronized successfully.",
            data.len() / 1024
        ),
        remote_size: meta.size,
        remote_modified: meta.last_modified,
        timestamp: now_secs(),
    })
}

/// Downloads the remote WebDAV vault into a temporary file, decrypts it with the active session DEK,
/// and returns its JSON so the frontend can run a deterministic record-level merge.
#[tauri::command]
async fn webdav_fetch_decrypted_for_merge(
    url: String,
    username: String,
    password: String,
    filename: Option<String>,
) -> Result<WebDavMergeFetchResult, String> {
    run_blocking(move || {
        let (dek, session_vid_b64, session_vid_bytes) = {
            let guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
            let dek = guard
                .dek
                .clone()
                .ok_or_else(|| "Vault must be unlocked to merge with WebDAV.".to_string())?;
            let vid = guard
                .vault_id_b64
                .clone()
                .ok_or_else(|| "Vault ID missing in session.".to_string())?;
            let vib = guard
                .vault_id_bytes
                .clone()
                .ok_or_else(|| "Vault ID bytes missing in session.".to_string())?;
            (dek, vid, vib)
        };

        let target = webdav_target_url(&url, filename.as_deref());
        let auth = webdav_auth_header(username.trim(), password.trim());
        let (data, _, modified) = match webdav_download_bytes(&target, &auth) {
            Ok(v) => v,
            Err(WebDavDownloadError::Status(code)) => {
                return Err(format!("WebDAV download failed with HTTP status: {}", code));
            }
            Err(WebDavDownloadError::Transport(t)) => {
                return Err(format!("Network transport error during WebDAV download: {}", t));
            }
        };
        if data.len() < 16 || &data[0..16] != b"SQLite format 3\0" {
            return Err("Downloaded remote file is not a valid SQLite database.".into());
        }

        let tmp = env::temp_dir().join(format!(
            "koban-merge-{}-{}.tmp",
            now_secs(),
            vault_crypto::hex_encode(&random_bytes::<4>()?)
        ));
        fs::write(&tmp, &data).map_err(|e| format!("Failed to stage remote vault: {}", e))?;
        let outcome = (|| -> Result<String, String> {
            validate_downloaded_vault(&tmp)?;
            let conn = Connection::open_with_flags(&tmp, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| e.to_string())?;
            if detect_db_format_version(&conn)? != 2 {
                return Err("Smart merge requires both vaults to use Vault Format v2.".into());
            }
            let remote_vid = get_meta_value(&conn, "vault_id").unwrap_or_default();
            if remote_vid != session_vid_b64 {
                return Err("The remote WebDAV vault has a different vault ID (different database or re-keyed). Use 'Use Cloud Version' or 'Keep Local' instead.".into());
            }
            let json = read_v2_ledger_with_dek(&conn, &session_vid_b64, &session_vid_bytes, &dek)?
                .ok_or_else(|| "Remote vault contains no encrypted ledger data.".to_string())?;
            Ok(inject_local_webdav_password(&json))
        })();
        let _ = fs::remove_file(&tmp);
        let remote_json = outcome?;

        Ok(WebDavMergeFetchResult {
            remote_json,
            remote_modified: modified,
            remote_size: Some(data.len() as u64),
        })
    })
    .await
}

#[tauri::command]
async fn push_to_webdav(
    url: String,
    username: String,
    password: String,
    filename: Option<String>,
    force: Option<bool>,
    preserve_remote: Option<bool>,
) -> Result<WebDavSyncResult, String> {
    let force = force.unwrap_or(true);
    let preserve_remote = preserve_remote.unwrap_or(false);
    run_blocking(move || {
        webdav_push_impl(url, username, password, filename, force, preserve_remote)
    })
    .await
}

#[tauri::command]
async fn pull_from_webdav(
    url: String,
    username: String,
    password: String,
    filename: Option<String>,
) -> Result<WebDavSyncResult, String> {
    run_blocking(move || webdav_pull_impl(url, username, password, filename)).await
}

#[tauri::command]
async fn webdav_download_vault(
    url: String,
    username: String,
    password: String,
    filename: Option<String>,
) -> Result<WebDavSyncResult, String> {
    run_blocking(move || webdav_pull_impl(url, username, password, filename)).await
}

#[tauri::command]
fn webdav_forget_sync_state() -> Result<(), String> {
    remove_webdav_sync_state(&get_active_db_path());
    Ok(())
}

#[tauri::command]
async fn check_windows_hello_available() -> Result<bool, String> {
    run_blocking(|| Ok(windows_security::check_windows_hello_available())).await
}

// ===================== Update Checker =====================

const KOBAN_WINDOWS_RELEASES_API: &str =
    "https://api.github.com/repos/duck28/koban-windows/releases/latest";
const KOBAN_WINDOWS_RELEASES_URL: &str =
    "https://github.com/duck28/koban-windows/releases";

fn parse_semver(v: &str) -> Option<(u64, u64, u64)> {
    let trimmed = v.trim().trim_start_matches(|c| c == 'v' || c == 'V');
    let mut parts = trimmed.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next()?.parse::<u64>().ok()?;
    let patch_raw = parts.next()?;
    let patch_num = patch_raw
        .split(|c: char| !c.is_ascii_digit())
        .next()
        .filter(|s| !s.is_empty())?;
    let patch = patch_num.parse::<u64>().ok()?;
    Some((major, minor, patch))
}

fn is_newer_version(current: &str, latest: &str) -> bool {
    match (parse_semver(current), parse_semver(latest)) {
        (Some(c), Some(l)) => l > c,
        _ => false,
    }
}

#[derive(Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct GitHubLatestRelease {
    tag_name: String,
    html_url: String,
    name: Option<String>,
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<GitHubReleaseAsset>,
}

fn check_for_updates_impl() -> Result<UpdateCheckResult, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(8))
        .timeout_read(Duration::from_secs(10))
        .build();

    let resp = agent
        .get(KOBAN_WINDOWS_RELEASES_API)
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", &format!("Koban-Windows/{}", current_version))
        .call();

    match resp {
        Ok(r) => {
            let body = r
                .into_string()
                .map_err(|e| format!("Failed to read release response: {}", e))?;
            let release: GitHubLatestRelease = serde_json::from_str(&body)
                .map_err(|e| format!("Failed to parse release metadata: {}", e))?;
            let latest_version = release
                .tag_name
                .trim()
                .trim_start_matches(|c| c == 'v' || c == 'V')
                .to_string();
            let update_available = is_newer_version(&current_version, &latest_version);
            let download_url = release
                .assets
                .iter()
                .find(|a| a.name.to_ascii_lowercase().ends_with("-setup.exe"))
                .or_else(|| {
                    release
                        .assets
                        .iter()
                        .find(|a| a.name.to_ascii_lowercase().ends_with(".exe"))
                })
                .or_else(|| {
                    release
                        .assets
                        .iter()
                        .find(|a| a.name.to_ascii_lowercase().ends_with(".msi"))
                })
                .map(|a| a.browser_download_url.clone());

            Ok(UpdateCheckResult {
                current_version,
                latest_version,
                update_available,
                release_url: release.html_url,
                download_url,
                release_name: release.name,
                published_at: release.published_at,
            })
        }
        Err(ureq::Error::Status(404, _)) => Ok(UpdateCheckResult {
            current_version: current_version.clone(),
            latest_version: current_version,
            update_available: false,
            release_url: KOBAN_WINDOWS_RELEASES_URL.to_string(),
            download_url: None,
            release_name: None,
            published_at: None,
        }),
        Err(ureq::Error::Status(code, _)) => {
            Err(format!("GitHub Releases returned HTTP {}", code))
        }
        Err(ureq::Error::Transport(t)) => Err(format!("Network error: {}", t)),
    }
}

#[tauri::command]
async fn check_for_updates() -> Result<UpdateCheckResult, String> {
    run_blocking(check_for_updates_impl).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            vault_status,
            vault_create,
            vault_unlock,
            vault_unlock_recovery,
            vault_unlock_device,
            vault_lock,
            vault_unlock_v1_for_migration,
            vault_migrate_v1_to_v2,
            vault_change_credentials,
            vault_generate_recovery_key,
            vault_generate_keyfile,
            vault_enroll_device_unlock,
            vault_remove_device_unlock,
            vault_save_auth_settings,
            vault_set_remembered_keyfile,
            vault_check_external_change,
            vault_open_database_file,
            get_db_info,
            save_ledger_db,
            trigger_manual_backup,
            list_backups,
            list_legacy_v1_backups,
            upgrade_legacy_v1_backup,
            delete_legacy_v1_backup,
            restore_backup_file,
            pick_folder,
            pick_save_file,
            pick_open_file,
            write_binary_file,
            read_binary_file,
            write_text_file,
            copy_db_file,
            reveal_in_explorer,
            check_windows_hello_available,
            move_database_location,
            reset_database_location,
            test_webdav_connection,
            get_webdav_remote_info,
            push_to_webdav,
            pull_from_webdav,
            webdav_check,
            webdav_download_vault,
            webdav_fetch_decrypted_for_merge,
            webdav_forget_sync_state,
            check_for_updates
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use vault_crypto::{derive_composite_ikm, hex_decode, hex_encode};

    #[test]
    fn file_commands_reject_paths_not_chosen_by_the_user() {
        let dir = env::temp_dir().join(format!("koban-path-grant-test-{}", now_secs()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("export.csv");
        let file_str = file.to_string_lossy().to_string();

        assert!(write_text_file(file_str.clone(), "a,b".into(), false).is_err());
        assert!(read_binary_file(file_str.clone()).is_err());
        assert!(!file.exists());

        grant_user_path(&file);
        write_text_file(file_str.clone(), "a,b".into(), false).unwrap();
        assert_eq!(read_binary_file(file_str).unwrap(), BASE64_STANDARD.encode(b"a,b"));

        let other = dir.join("other.csv").to_string_lossy().to_string();
        assert!(write_binary_file(other, BASE64_STANDARD.encode(b"x")).is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn vault_v2_create_passphrase_composite_recovery_and_rekey() {
        let dir = env::temp_dir().join(format!("koban-v2-test-{}", now_secs()));
        fs::create_dir_all(&dir).unwrap();
        let db = dir.join("koban.db");
        let state = r#"{"version":1,"settings":{"setupCompleted":true,"currency":"CHF"},"groups":[{"id":"g1"}]}"#;

        // 1) Create passphrase-only v2 vault (light Argon2 params for fast unit test)
        let (dek, vid_b64, vid_bytes, rec_key, sha1) = create_v2_vault_file(
            &db,
            "correct-horse-battery-staple",
            None,
            true,
            state,
            None,
            1024,
            2,
            2,
        )
        .unwrap();
        let rec_str = rec_key.expect("recovery key should be generated").to_string();

        let conn = Connection::open(&db).unwrap();
        assert_eq!(detect_db_format_version(&conn).unwrap(), 2);
        assert!(!table_exists(&conn, "encrypted_records"));
        let slots = load_key_slots(&conn).unwrap();
        assert_eq!(slots.len(), 2);

        // Wrong passphrase fails
        assert!(unwrap_dek_from_slot_passphrase(&vid_b64, &slots[0], "wrong-passphrase").is_err());

        // Correct passphrase unwraps DEK & decrypts ledger
        let dek2 = unwrap_dek_from_slot_passphrase(&vid_b64, &slots[0], "correct-horse-battery-staple").unwrap();
        assert_eq!(dek.as_ref(), dek2.as_ref());
        let decrypted = read_v2_ledger_with_dek(&conn, &vid_b64, &vid_bytes, &dek2)
            .unwrap()
            .unwrap();
        assert_eq!(decrypted, state);

        // Recovery key unwraps DEK
        let dek_rec = unwrap_dek_from_slot_recovery(&vid_b64, &slots[1], &rec_str).unwrap();
        assert_eq!(dek.as_ref(), dek_rec.as_ref());

        // Zero plaintext leakage on disk
        let raw = fs::read(&db).unwrap();
        assert!(!raw.windows(b"\"groups\"".len()).any(|w| w == b"\"groups\""));
        assert!(!sha1.is_empty());
        drop(conn);

        // 2) Composite Key File vault: requires BOTH passphrase AND keyfile
        let db2 = dir.join("composite.db");
        let (_json, kf_secret, kf_fp) = generate_keyfile_json(1731150000).unwrap();
        let (dek_c, vid_b64_c, vid_bytes_c, _, _) = create_v2_vault_file(
            &db2,
            "my-master-pw-123",
            Some((*kf_secret, kf_fp.clone())),
            false,
            state,
            None,
            1024,
            2,
            2,
        )
        .unwrap();
        let conn2 = Connection::open(&db2).unwrap();
        let slots2 = load_key_slots(&conn2).unwrap();
        assert_eq!(slots2.len(), 1);
        assert_eq!(slots2[0].kind, "composite_keyfile");

        // Wrong passphrase fails even with right keyfile
        assert!(unwrap_dek_from_slot_composite(&vid_b64_c, &slots2[0], "wrong-pw", &kf_secret).is_err());
        // Wrong keyfile fails even with right passphrase
        let wrong_kf = [0x99u8; 32];
        assert!(unwrap_dek_from_slot_composite(&vid_b64_c, &slots2[0], "my-master-pw-123", &wrong_kf).is_err());
        // Correct composite credentials succeed
        let dek_c2 = unwrap_dek_from_slot_composite(&vid_b64_c, &slots2[0], "my-master-pw-123", &kf_secret).unwrap();
        assert_eq!(dek_c.as_ref(), dek_c2.as_ref());
        assert_eq!(
            read_v2_ledger_with_dek(&conn2, &vid_b64_c, &vid_bytes_c, &dek_c2)
                .unwrap()
                .unwrap(),
            state
        );
        drop(conn2);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn v1_to_v2_migration_preserves_state_and_drops_plaintext_metadata() {
        let dir = env::temp_dir().join(format!("koban-v1-mig-test-{}", now_secs()));
        fs::create_dir_all(&dir).unwrap();
        let db = dir.join("legacy.db");
        let state = r#"{"version":1,"settings":{"setupCompleted":true},"transactions":[{"id":"t1"}]}"#;

        // Build a synthetic v1 vault
        {
            use aes_gcm::{
                aead::{Aead, KeyInit},
                Aes256Gcm, Key, Nonce,
            };
            let conn = Connection::open(&db).unwrap();
            conn.execute_batch(
                "
                CREATE TABLE vault_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE encrypted_vault (key TEXT PRIMARY KEY, nonce_b64 TEXT NOT NULL, ciphertext_b64 TEXT NOT NULL, updated_at INTEGER NOT NULL);
                CREATE TABLE encrypted_records (id TEXT PRIMARY KEY, record_kind TEXT NOT NULL, nonce_b64 TEXT NOT NULL, ciphertext_b64 TEXT NOT NULL, updated_at INTEGER NOT NULL);
                ",
            )
            .unwrap();
            let salt = [7u8; 16];
            conn.execute(
                "INSERT INTO vault_meta VALUES ('salt_b64', ?1)",
                params![BASE64_STANDARD.encode(salt)],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO vault_meta VALUES ('kdf', 'SHA256-10000-Salted')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO vault_meta VALUES ('custom_passphrase', 'true')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO vault_meta VALUES ('auth_config', '{\"userDisplayName\":\"Roland\"}')",
                [],
            )
            .unwrap();

            let key_bytes = legacy_v1::derive_key("old-v1-secret", &salt);
            let key = Key::<Aes256Gcm>::try_from(key_bytes.as_slice()).unwrap();
            let nonce_bytes = [3u8; 12];
            let ct = Aes256Gcm::new(&key)
                .encrypt(&Nonce::try_from(nonce_bytes.as_slice()).unwrap(), state.as_bytes())
                .unwrap();
            conn.execute(
                "INSERT INTO encrypted_vault VALUES ('ledger_state', ?1, ?2, 100)",
                params![BASE64_STANDARD.encode(nonce_bytes), BASE64_STANDARD.encode(ct)],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO encrypted_records VALUES ('transaction:t1', 'transaction', 'n', 'c', 100)",
                [],
            )
            .unwrap();
        }

        let conn = Connection::open(&db).unwrap();
        assert_eq!(detect_db_format_version(&conn).unwrap(), 1);
        assert_eq!(legacy_v1::read_display_name(&conn).as_deref(), Some("Roland"));
        assert!(legacy_v1::read_encrypted_state(&conn, Some("wrong")).is_err());
        let dec = legacy_v1::read_encrypted_state(&conn, Some("old-v1-secret"))
            .unwrap()
            .unwrap();
        assert_eq!(dec, state);
        drop(conn);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn shared_test_vectors_check() {
        let raw = include_str!("../../docs/vault-v2-test-vectors.json");
        let v: serde_json::Value = serde_json::from_str(raw).unwrap();

        let dek: [u8; 32] = hex_decode(v["hkdf_ledger"]["dek_hex"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        let vault_id = hex_decode(v["hkdf_ledger"]["vault_id_hex"].as_str().unwrap()).unwrap();
        let vault_id_b64 = v["vault_id_b64"].as_str().unwrap();
        assert_eq!(BASE64_STANDARD.encode(&vault_id), vault_id_b64);

        let ledger_key = derive_ledger_key(&dek, &vault_id).unwrap();
        assert_eq!(
            hex_encode(ledger_key.as_ref()),
            v["hkdf_ledger"]["ledger_key_hex"].as_str().unwrap()
        );

        let def = &v["koban_argon2id_default"];
        let def_salt = hex_decode(def["salt_hex"].as_str().unwrap()).unwrap();
        let def_kek = derive_passphrase_kek(
            def["passphrase_nfc"].as_str().unwrap(),
            &def_salt,
            def["m_kib"].as_u64().unwrap() as u32,
            def["t"].as_u64().unwrap() as u32,
            def["p"].as_u64().unwrap() as u32,
        )
        .unwrap();
        assert_eq!(hex_encode(def_kek.as_ref()), def["kek_hex"].as_str().unwrap());

        let nfc_vec = &v["nfc_normalization"];
        let nfc_salt = hex_decode(nfc_vec["salt_hex"].as_str().unwrap()).unwrap();
        let nfd_kek = derive_passphrase_kek(
            &normalize_nfc(nfc_vec["nfd"].as_str().unwrap()),
            &nfc_salt,
            nfc_vec["m_kib"].as_u64().unwrap() as u32,
            nfc_vec["t"].as_u64().unwrap() as u32,
            nfc_vec["p"].as_u64().unwrap() as u32,
        )
        .unwrap();
        assert_eq!(hex_encode(nfd_kek.as_ref()), nfc_vec["kek_hex"].as_str().unwrap());

        let comp = &v["composite_keyfile"];
        let kf_secret: [u8; 32] = hex_decode(comp["keyfile_secret_hex"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        let comp_salt = hex_decode(comp["salt_hex"].as_str().unwrap()).unwrap();
        let comp_ikm = derive_composite_ikm(comp["passphrase"].as_str().unwrap(), &kf_secret);
        assert_eq!(hex_encode(comp_ikm.as_ref()), comp["ikm_hex"].as_str().unwrap());
        let comp_kek = derive_composite_kek(
            comp["passphrase"].as_str().unwrap(),
            &kf_secret,
            &comp_salt,
            comp["m_kib"].as_u64().unwrap() as u32,
            comp["t"].as_u64().unwrap() as u32,
            comp["p"].as_u64().unwrap() as u32,
        )
        .unwrap();
        assert_eq!(hex_encode(comp_kek.as_ref()), comp["kek_hex"].as_str().unwrap());

        let rec = &v["recovery_key"];
        let rec_bytes = hex_decode(rec["recovery_bytes_hex"].as_str().unwrap()).unwrap();
        assert_eq!(
            encode_crockford_base32(&rec_bytes),
            rec["crockford_grouped"].as_str().unwrap()
        );
        let rec_kek = derive_recovery_kek(&rec_bytes, &vault_id).unwrap();
        assert_eq!(hex_encode(rec_kek.as_ref()), rec["kek_hex"].as_str().unwrap());

        let sw = &v["slot_wrap"];
        let aad_str = slot_aad(
            vault_id_b64,
            sw["slot_id"].as_str().unwrap(),
            sw["kind"].as_str().unwrap(),
        );
        assert_eq!(aad_str, sw["aad"].as_str().unwrap());
        let unwrapped = decrypt_aes256_gcm_aad(
            &nfd_kek,
            sw["nonce_b64"].as_str().unwrap(),
            sw["ciphertext_b64"].as_str().unwrap(),
            aad_str.as_bytes(),
        )
        .unwrap();
        assert_eq!(unwrapped.as_slice(), &dek);

        let le = &v["ledger_encrypt"];
        let l_aad = ledger_aad(vault_id_b64);
        assert_eq!(l_aad, le["aad"].as_str().unwrap());
        let decrypted = decrypt_aes256_gcm_aad(
            &ledger_key,
            le["nonce_b64"].as_str().unwrap(),
            le["ciphertext_b64"].as_str().unwrap(),
            l_aad.as_bytes(),
        )
        .unwrap();
        assert_eq!(
            String::from_utf8(decrypted).unwrap(),
            le["plaintext"].as_str().unwrap()
        );
    }

    #[test]
    fn listed_backups_are_granted_but_only_koban_files() {
        let dir = env::temp_dir().join(format!("koban-backup-grant-test-{}", now_secs()));
        fs::create_dir_all(&dir).unwrap();
        let backup = dir.join("koban-daily-1.db");
        fs::write(&backup, b"not a real db").unwrap();
        let foreign = dir.join("wpndatabase.db");
        fs::write(&foreign, b"someone else's database").unwrap();

        let listed = list_backups(dir.to_string_lossy().to_string()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "koban-daily-1.db");
        assert!(require_user_path(&listed[0].path).is_ok());
        assert!(require_user_path(&foreign.to_string_lossy()).is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn koban_vault_file_names() {
        for ok in [
            "koban.db",
            "koban-latest.db",
            "koban-daily-20400.db",
            "koban-backup-1731.db",
            "koban-encrypted-2026-11-10.db",
            "koban-pre-webdav-sync-1.db",
            "KOBAN-latest.sqlite",
        ] {
            assert!(is_koban_vault_file_name(ok), "{ok}");
        }
        for bad in [
            "wpndatabase.db",
            "kobanx.db",
            "koban-latest.json",
            "koban.db-wal",
            "koban-a b.db",
        ] {
            assert!(!is_koban_vault_file_name(bad), "{bad}");
        }
    }

    #[test]
    fn reveal_rejects_injection_unc_uri_and_relative_paths() {
        let dir = env::temp_dir();
        let existing = dir.to_string_lossy().to_string();
        assert!(validate_reveal_path(&existing).is_ok());
        for bad in [
            format!("{}\" /root,\"C:\\Windows\\System32\\calc.exe", existing),
            "\\\\attacker\\share".to_string(),
            "//attacker/share".to_string(),
            "search-ms:query=x".to_string(),
            "relative\\folder".to_string(),
            String::new(),
        ] {
            assert!(validate_reveal_path(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn downloaded_vault_validation_rejects_legacy_triggers_and_future_versions() {
        let dir = env::temp_dir().join(format!("koban-download-test-{}", now_secs()));
        fs::create_dir_all(&dir).unwrap();

        let good = dir.join("good.db");
        create_v2_vault_file(&good, "strong-pass-1234", None, false, r#"{"groups":[]}"#, None, 1024, 2, 2).unwrap();
        assert!(validate_downloaded_vault(&good).is_ok());

        let future = dir.join("future.db");
        {
            let conn = Connection::open(&future).unwrap();
            init_v2_schema(&conn).unwrap();
            conn.execute(
                "INSERT INTO vault_meta (key, value) VALUES ('format_version', '99')",
                [],
            )
            .unwrap();
        }
        assert!(validate_downloaded_vault(&future).is_err());

        let legacy = dir.join("legacy.db");
        {
            let conn = Connection::open(&legacy).unwrap();
            init_v2_schema(&conn).unwrap();
            conn.execute_batch(
                "CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT);
                 INSERT INTO app_state VALUES ('ledger_state', '{\"groups\":[]}');",
            )
            .unwrap();
        }
        assert!(validate_downloaded_vault(&legacy).is_err());

        let trigger = dir.join("trigger.db");
        {
            let conn = Connection::open(&trigger).unwrap();
            init_v2_schema(&conn).unwrap();
            conn.execute_batch(
                "CREATE TRIGGER keep_old BEFORE UPDATE ON encrypted_vault BEGIN SELECT RAISE(IGNORE); END;",
            )
            .unwrap();
        }
        assert!(validate_downloaded_vault(&trigger).is_err());

        let not_sqlite = dir.join("junk.db");
        fs::write(&not_sqlite, b"SQLite format 3\0 but not really").unwrap();
        assert!(validate_downloaded_vault(&not_sqlite).is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn semver_update_comparison() {
        assert_eq!(parse_semver("v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_semver("0.1.0"), Some((0, 1, 0)));
        assert_eq!(parse_semver("V2.0.1-rc1"), Some((2, 0, 1)));
        assert_eq!(parse_semver("invalid"), None);

        assert!(is_newer_version("0.1.0", "0.2.0"));
        assert!(is_newer_version("0.1.0", "v1.0.0"));
        assert!(is_newer_version("1.2.9", "1.2.10"));
        assert!(!is_newer_version("0.2.0", "0.2.0"));
        assert!(!is_newer_version("0.2.0", "0.1.9"));
        assert!(!is_newer_version("0.1.0", "invalid"));
    }
}
