use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::prelude::*;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DEFAULT_VAULT_SECRET: &str = "koban-aes256gcm-treasury-vault-v1-key";
const KDF_ITERATIONS: u32 = 10_000;

struct VaultSession {
    passphrase: Option<String>,
}

static SESSION_KEY: Mutex<VaultSession> = Mutex::new(VaultSession { passphrase: None });

/// Serializes raw access to the active DB file (SQLite writes vs. WebDAV byte reads / replacement).
static DB_FILE_LOCK: Mutex<()> = Mutex::new(());

fn lock_db_file() -> std::sync::MutexGuard<'static, ()> {
    DB_FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

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
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BackupEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: u64,
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

/// Partial mirror structs for encrypting individual records into `encrypted_records`
#[derive(Deserialize, Serialize, Debug)]
struct SyncPayload {
    #[serde(default)]
    groups: Vec<serde_json::Value>,
    #[serde(default)]
    categories: Vec<serde_json::Value>,
    #[serde(default, rename = "monthlyBudgets")]
    monthly_budgets: Vec<serde_json::Value>,
    #[serde(default)]
    transactions: Vec<serde_json::Value>,
    #[serde(default, rename = "savingsGoals")]
    savings_goals: Vec<serde_json::Value>,
    #[serde(default)]
    accounts: Vec<serde_json::Value>,
    #[serde(default, rename = "netWorthSnapshots")]
    net_worth_snapshots: Vec<serde_json::Value>,
    #[serde(default, rename = "yearlyPlanItems")]
    yearly_plan_items: Vec<serde_json::Value>,
}

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

fn random_bytes<const N: usize>() -> Result<[u8; N], String> {
    let mut buf = [0u8; N];
    getrandom::getrandom(&mut buf).map_err(|e| format!("RNG error: {}", e))?;
    Ok(buf)
}

fn derive_aes256_key(secret: &str, salt: &[u8]) -> [u8; 32] {
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

fn encrypt_aes256_gcm(key_bytes: &[u8; 32], plaintext: &[u8]) -> Result<(String, String), String> {
    let key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce_bytes = random_bytes::<12>()?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("AES-256-GCM encryption failed: {}", e))?;
    Ok((
        BASE64_STANDARD.encode(nonce_bytes),
        BASE64_STANDARD.encode(ciphertext),
    ))
}

fn decrypt_aes256_gcm(
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

    let key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_vec);
    cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "Decryption failed: invalid encryption key or corrupted database.".into())
}

fn active_secret_string() -> String {
    if let Ok(guard) = SESSION_KEY.lock() {
        if let Some(ref p) = guard.passphrase {
            if !p.is_empty() {
                return p.clone();
            }
        }
    }
    DEFAULT_VAULT_SECRET.to_string()
}

fn is_custom_passphrase_active() -> bool {
    if let Ok(guard) = SESSION_KEY.lock() {
        if let Some(ref p) = guard.passphrase {
            return !p.is_empty();
        }
    }
    false
}

fn ensure_vault_salt(conn: &Connection) -> Result<Vec<u8>, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM vault_meta WHERE key = 'salt_b64' LIMIT 1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let b64: String = row.get(0).map_err(|e| e.to_string())?;
        return BASE64_STANDARD
            .decode(&b64)
            .map_err(|e| format!("Corrupt salt in vault_meta: {}", e));
    }

    let salt = random_bytes::<16>()?;
    let salt_b64 = BASE64_STANDARD.encode(salt);
    conn.execute(
        "INSERT INTO vault_meta (key, value) VALUES ('salt_b64', ?1)",
        params![salt_b64],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('cipher', 'AES-256-GCM')",
        [],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('kdf', 'SHA256-10000-Salted')",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(salt.to_vec())
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = DELETE;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS vault_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS encrypted_vault (
            key TEXT PRIMARY KEY,
            nonce_b64 TEXT NOT NULL,
            ciphertext_b64 TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS encrypted_records (
            id TEXT PRIMARY KEY,
            record_kind TEXT NOT NULL,
            nonce_b64 TEXT NOT NULL,
            ciphertext_b64 TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        ",
    )
    .map_err(|e| format!("Failed to initialize encrypted SQLite schema: {}", e))?;

    let _ = ensure_vault_salt(conn)?;
    Ok(())
}

/// Drops any legacy plaintext tables after migrating if needed so zero plaintext remains in SQLite
fn migrate_and_drop_plaintext_tables(conn: &mut Connection) -> Result<(), String> {
    let has_legacy: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='app_state'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    if has_legacy {
        let legacy_json: Option<String> = conn
            .query_row(
                "SELECT value FROM app_state WHERE key = 'ledger_state' LIMIT 1",
                [],
                |r| r.get(0),
            )
            .ok();

        let has_encrypted: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM encrypted_vault WHERE key = 'ledger_state'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;

        if let Some(json_str) = legacy_json {
            if !has_encrypted {
                let _ = write_encrypted_state(conn, &json_str);
            }
        }

        // Purge all legacy plaintext tables and vacuum the SQLite file
        let _ = conn.execute_batch(
            "
            DROP TABLE IF EXISTS app_state;
            DROP TABLE IF EXISTS category_groups;
            DROP TABLE IF EXISTS categories;
            DROP TABLE IF EXISTS monthly_budgets;
            DROP TABLE IF EXISTS transactions;
            DROP TABLE IF EXISTS savings_goals;
            VACUUM;
            ",
        );
    }
    Ok(())
}

fn write_encrypted_state(conn: &mut Connection, state_json: &str) -> Result<usize, String> {
    let salt = ensure_vault_salt(conn)?;
    let secret = active_secret_string();
    let key = derive_aes256_key(&secret, &salt);
    let ts = now_secs() as i64;

    let (vault_nonce, vault_ct) = encrypt_aes256_gcm(&key, state_json.as_bytes())?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start SQLite transaction: {}", e))?;

    tx.execute(
        "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('custom_passphrase', ?1)",
        params![if is_custom_passphrase_active() {
            "true"
        } else {
            "false"
        }],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO encrypted_vault (key, nonce_b64, ciphertext_b64, updated_at)
         VALUES ('ledger_state', ?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET
            nonce_b64 = excluded.nonce_b64,
            ciphertext_b64 = excluded.ciphertext_b64,
            updated_at = excluded.updated_at",
        params![vault_nonce, vault_ct, ts],
    )
    .map_err(|e| format!("Failed to write encrypted_vault: {}", e))?;

    // Also encrypt each individual record with its own unique nonce into `encrypted_records`
    let mut record_count = 1usize;
    let _ = tx.execute("DELETE FROM encrypted_records", []);

    if let Ok(parsed) = serde_json::from_str::<SyncPayload>(state_json) {
        let mut insert_records =
            |kind: &str, items: &[serde_json::Value]| -> Result<(), String> {
                for (idx, item) in items.iter().enumerate() {
                    let rec_id = item
                        .get("id")
                        .and_then(|v| v.as_str())
                        .map(|s| format!("{}:{}", kind, s))
                        .unwrap_or_else(|| format!("{}:{}", kind, idx));
                    let bytes = serde_json::to_vec(item).map_err(|e| e.to_string())?;
                    let (n_b64, c_b64) = encrypt_aes256_gcm(&key, &bytes)?;
                    tx.execute(
                        "INSERT INTO encrypted_records (id, record_kind, nonce_b64, ciphertext_b64, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![rec_id, kind, n_b64, c_b64, ts],
                    )
                    .map_err(|e| e.to_string())?;
                    record_count += 1;
                }
                Ok(())
            };

        insert_records("group", &parsed.groups)?;
        insert_records("category", &parsed.categories)?;
        insert_records("budget", &parsed.monthly_budgets)?;
        insert_records("transaction", &parsed.transactions)?;
        insert_records("goal", &parsed.savings_goals)?;
        insert_records("account", &parsed.accounts)?;
        insert_records("net_worth_snapshot", &parsed.net_worth_snapshots)?;
        insert_records("yearly_plan_item", &parsed.yearly_plan_items)?;
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit encrypted transaction: {}", e))?;

    Ok(record_count)
}

fn read_encrypted_state(conn: &Connection, override_passphrase: Option<&str>) -> Result<Option<String>, String> {
    let salt = ensure_vault_salt(conn)?;
    let secret = match override_passphrase {
        Some(p) if !p.is_empty() => p.to_string(),
        _ => active_secret_string(),
    };
    let key = derive_aes256_key(&secret, &salt);

    let mut stmt = conn
        .prepare(
            "SELECT nonce_b64, ciphertext_b64 FROM encrypted_vault WHERE key = 'ledger_state' LIMIT 1",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let nonce_b64: String = row.get(0).map_err(|e| e.to_string())?;
        let ct_b64: String = row.get(1).map_err(|e| e.to_string())?;
        let decrypted = decrypt_aes256_gcm(&key, &nonce_b64, &ct_b64)?;
        let json_str = String::from_utf8(decrypted)
            .map_err(|e| format!("Invalid UTF-8 in decrypted payload: {}", e))?;
        Ok(Some(json_str))
    } else {
        Ok(None)
    }
}

fn perform_backup_to_dir(
    db_path: &Path,
    backup_dir: &str,
    force_timestamped: bool,
    max_backups: usize,
) -> Result<String, String> {
    let dir = Path::new(backup_dir);
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create backup folder: {}", e))?;

    // Remove any legacy unencrypted .json backup if present
    let legacy_json = dir.join("koban-latest.json");
    if legacy_json.exists() {
        let _ = fs::remove_file(&legacy_json);
    }

    // 1. Copy encrypted SQLite database to koban-latest.db
    let latest_db = dir.join("koban-latest.db");
    fs::copy(db_path, &latest_db)
        .map_err(|e| format!("Failed to copy encrypted SQLite database to backup folder: {}", e))?;

    // 2. Create a timestamped or daily encrypted snapshot
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

    // 3. Prune older snapshots if exceeding max_backups
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

#[tauri::command]
fn set_vault_passphrase(passphrase: Option<String>, current_state_json: Option<String>) -> Result<DbInfo, String> {
    {
        let mut guard = SESSION_KEY.lock().map_err(|e| e.to_string())?;
        guard.passphrase = passphrase.filter(|p| !p.trim().is_empty());
    }
    if let Some(json_str) = current_state_json {
        let _guard = lock_db_file();
        let db_path = get_active_db_path();
        let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        init_schema(&conn)?;
        write_encrypted_state(&mut conn, &json_str)?;
    }
    get_db_info()
}

#[tauri::command]
fn get_db_info() -> Result<DbInfo, String> {
    let db_path = get_active_db_path();
    let is_custom_location = db_path != default_db_path();
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    init_schema(&conn)?;
    migrate_and_drop_plaintext_tables(&mut conn)?;

    let encrypted_records: usize = conn
        .query_row("SELECT COUNT(*) FROM encrypted_records", [], |r| {
            r.get::<_, usize>(0)
        })
        .unwrap_or(0)
        + conn
            .query_row("SELECT COUNT(*) FROM encrypted_vault", [], |r| {
                r.get::<_, usize>(0)
            })
            .unwrap_or(0);

    let has_custom_passphrase: bool = conn
        .query_row(
            "SELECT value FROM vault_meta WHERE key = 'custom_passphrase' LIMIT 1",
            [],
            |r| r.get::<_, String>(0),
        )
        .map(|v| v == "true")
        .unwrap_or(false);

    let meta = fs::metadata(&db_path).ok();
    Ok(DbInfo {
        db_path: db_path.to_string_lossy().to_string(),
        db_size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
        last_modified: meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0),
        encrypted: true,
        cipher: "AES-256-GCM".into(),
        encrypted_records,
        has_custom_passphrase,
        is_custom_location,
    })
}

#[tauri::command]
fn load_ledger_db(passphrase: Option<String>) -> Result<Option<String>, String> {
    if let Some(ref p) = passphrase {
        if !p.is_empty() {
            if let Ok(mut guard) = SESSION_KEY.lock() {
                guard.passphrase = Some(p.clone());
            }
        }
    }

    let _guard = lock_db_file();
    let db_path = get_active_db_path();
    let mut conn = Connection::open(&db_path).map_err(|e| format!("Failed to open SQLite DB: {}", e))?;
    init_schema(&conn)?;
    migrate_and_drop_plaintext_tables(&mut conn)?;

    read_encrypted_state(&conn, passphrase.as_deref())
}

#[tauri::command]
fn save_ledger_db(
    state_json: String,
    backup_dir: Option<String>,
    auto_backup: bool,
    max_backups: Option<usize>,
) -> Result<SaveResult, String> {
    let _guard = lock_db_file();
    let db_path = get_active_db_path();
    let encrypted_records = {
        let mut conn =
            Connection::open(&db_path).map_err(|e| format!("Failed to open SQLite DB: {}", e))?;
        init_schema(&conn)?;
        migrate_and_drop_plaintext_tables(&mut conn)?;
        write_encrypted_state(&mut conn, &state_json)?
    };

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
    let _guard = lock_db_file();
    let db_path = get_active_db_path();
    let encrypted_records = {
        let mut conn =
            Connection::open(&db_path).map_err(|e| format!("Failed to open SQLite DB: {}", e))?;
        init_schema(&conn)?;
        write_encrypted_state(&mut conn, &state_json)?
    };

    let bp = perform_backup_to_dir(
        &db_path,
        &backup_dir,
        true,
        max_backups.unwrap_or(20),
    )?;
    let meta = fs::metadata(&db_path).ok();
    Ok(SaveResult {
        db_path: db_path.to_string_lossy().to_string(),
        db_size: meta.map(|m| m.len()).unwrap_or(0),
        backup_path: Some(bp),
        timestamp: now_secs(),
        encrypted_records,
    })
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
                if name.ends_with(".db") || name.ends_with(".sqlite") {
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
                    });
                }
            }
        }
    }
    list.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(list)
}

#[tauri::command]
fn restore_backup_file(
    path: String,
    passphrase: Option<String>,
    preview_only: Option<bool>,
) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("Backup file does not exist.".into());
    }
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let state_json = if ext == "db" || ext == "sqlite" {
        let mut conn = Connection::open(p)
            .map_err(|e| format!("Failed to open backup SQLite database: {}", e))?;
        init_schema(&conn)?;
        migrate_and_drop_plaintext_tables(&mut conn)?;
        match read_encrypted_state(&conn, passphrase.as_deref())? {
            Some(json) => json,
            None => return Err("No encrypted ledger data found in backup database.".into()),
        }
    } else {
        let data = fs::read(p).map_err(|e| format!("Failed to read file: {}", e))?;
        let data = data.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&data);
        String::from_utf8_lossy(data).into_owned()
    };

    if !preview_only.unwrap_or(false) {
        // Persist encrypted into active SQLite DB
        let _guard = lock_db_file();
        let active_db = get_active_db_path();
        let mut conn = Connection::open(&active_db).map_err(|e| e.to_string())?;
        init_schema(&conn)?;
        write_encrypted_state(&mut conn, &state_json)?;
        // The local DB no longer matches what was last synced with WebDAV.
        remove_webdav_sync_state(&active_db);
    }

    Ok(state_json)
}

#[tauri::command]
fn pick_folder(title: Option<String>) -> Result<Option<String>, String> {
    let dialog = rfd::FileDialog::new()
        .set_title(&title.unwrap_or_else(|| "Select Backup Folder".into()));
    let folder = dialog.pick_folder();
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
    Ok(file.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn write_binary_file(path: String, base64_data: String) -> Result<(), String> {
    let bytes = BASE64_STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;
    fs::write(&path, bytes).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    Ok(BASE64_STANDARD.encode(&bytes))
}

#[tauri::command]
fn write_text_file(path: String, content: String, add_bom: bool) -> Result<(), String> {
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
    let db_path = get_active_db_path();
    fs::copy(&db_path, &target_path).map_err(|e| format!("Failed to export encrypted SQLite DB: {}", e))?;
    Ok(())
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
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
fn get_auth_config() -> Result<Option<String>, String> {
    let db_path = get_active_db_path();
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    init_schema(&conn)?;
    let val: Option<String> = conn
        .query_row(
            "SELECT value FROM vault_meta WHERE key = 'auth_config' LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok();
    Ok(val)
}

#[tauri::command]
fn save_auth_config(config_json: String) -> Result<(), String> {
    let db_path = get_active_db_path();
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    init_schema(&conn)?;
    conn.execute(
        "INSERT OR REPLACE INTO vault_meta (key, value) VALUES ('auth_config', ?1)",
        params![config_json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn wrap_vault_secret_for_credential(credential_id: String, secret: String) -> Result<String, String> {
    let db_path = get_active_db_path();
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    init_schema(&conn)?;
    let salt = ensure_vault_salt(&conn)?;
    let key = derive_aes256_key(&format!("koban-passkey-wrap:{}", credential_id), &salt);
    let (nonce_b64, ct_b64) = encrypt_aes256_gcm(&key, secret.as_bytes())?;
    Ok(format!("{}.{}", nonce_b64, ct_b64))
}

#[tauri::command]
fn unwrap_vault_secret_for_credential(
    credential_id: String,
    wrapped_token: String,
) -> Result<String, String> {
    let parts: Vec<&str> = wrapped_token.split('.').collect();
    if parts.len() != 2 {
        return Err("Invalid wrapped credential token format".into());
    }
    let db_path = get_active_db_path();
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    init_schema(&conn)?;
    let salt = ensure_vault_salt(&conn)?;
    let key = derive_aes256_key(&format!("koban-passkey-wrap:{}", credential_id), &salt);
    let decrypted = decrypt_aes256_gcm(&key, parts[0], parts[1])?;
    let secret = String::from_utf8(decrypted).map_err(|e| e.to_string())?;
    if !secret.is_empty() {
        if let Ok(mut guard) = SESSION_KEY.lock() {
            guard.passphrase = Some(secret.clone());
        }
    }
    Ok(secret)
}

#[tauri::command]
fn move_database_location(target_folder: String) -> Result<DbInfo, String> {
    let trimmed = target_folder.trim();
    if trimmed.is_empty() {
        return Err("Target folder path cannot be empty.".into());
    }

    let target_input = PathBuf::from(trimmed);
    let target_db_path = if target_input.extension().and_then(|s| s.to_str()) == Some("db") {
        target_input
    } else {
        target_input.join("koban.db")
    };

    if let Some(parent) = target_db_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create destination folder: {}", e))?;
    }

    let current_db_path = get_active_db_path();
    if current_db_path == target_db_path {
        return get_db_info();
    }

    if current_db_path.exists() {
        fs::copy(&current_db_path, &target_db_path)
            .map_err(|e| format!("Failed to copy active SQLite database: {}", e))?;

        if let Some(file_name) = current_db_path.file_name() {
            let wal_cur = current_db_path.with_file_name(format!("{}-wal", file_name.to_string_lossy()));
            if wal_cur.exists() {
                let wal_tgt = target_db_path.with_file_name(format!("{}-wal", target_db_path.file_name().unwrap().to_string_lossy()));
                let _ = fs::copy(&wal_cur, &wal_tgt);
            }
            let shm_cur = current_db_path.with_file_name(format!("{}-shm", file_name.to_string_lossy()));
            if shm_cur.exists() {
                let shm_tgt = target_db_path.with_file_name(format!("{}-shm", target_db_path.file_name().unwrap().to_string_lossy()));
                let _ = fs::copy(&shm_cur, &shm_tgt);
            }
        }
        copy_webdav_sync_state(&current_db_path, &target_db_path);
    } else {
        // Initialize an empty database at target
        let conn = Connection::open(&target_db_path)
            .map_err(|e| format!("Failed to create new SQLite database: {}", e))?;
        init_schema(&conn)?;
    }

    let pointer = db_pointer_path();
    fs::write(&pointer, target_db_path.to_string_lossy().as_bytes())
        .map_err(|e| format!("Failed to save location pointer: {}", e))?;

    get_db_info()
}

#[tauri::command]
fn reset_database_location() -> Result<DbInfo, String> {
    let current_db_path = get_active_db_path();
    let default_path = default_db_path();

    if current_db_path != default_path && current_db_path.exists() {
        if let Some(parent) = default_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::copy(&current_db_path, &default_path);

        if let Some(file_name) = current_db_path.file_name() {
            let wal_cur = current_db_path.with_file_name(format!("{}-wal", file_name.to_string_lossy()));
            if wal_cur.exists() {
                let wal_tgt = default_path.with_file_name("koban.db-wal");
                let _ = fs::copy(&wal_cur, &wal_tgt);
            }
            let shm_cur = current_db_path.with_file_name(format!("{}-shm", file_name.to_string_lossy()));
            if shm_cur.exists() {
                let shm_tgt = default_path.with_file_name("koban.db-shm");
                let _ = fs::copy(&shm_cur, &shm_tgt);
            }
        }
        copy_webdav_sync_state(&current_db_path, &default_path);
    }

    let pointer = db_pointer_path();
    if pointer.exists() {
        let _ = fs::remove_file(pointer);
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

/// Per-device sync state stored next to the active DB as `<db file name>.webdav-sync.json`.
/// Never synced; shared format with the macOS build.
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
    /// offline | error | remote_missing | in_sync | local_ahead | remote_ahead | conflict
    pub status: String,
    pub message: String,
    pub remote_etag: Option<String>,
    pub remote_last_modified: Option<String>,
    pub remote_size: Option<u64>,
    pub first_link: bool,
    /// Last modification time (unix secs) of the local DB file, if it exists.
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

/// Runs blocking WebDAV / file work off the main thread so the window stays responsive.
async fn run_blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("Background WebDAV task failed: {}", e))?
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

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(64);
    for b in digest.iter() {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

fn sidecar_path(db_path: &Path, suffix: &str) -> PathBuf {
    let name = db_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "koban.db".to_string());
    db_path.with_file_name(format!("{}{}", name, suffix))
}

fn webdav_sync_state_path(db_path: &Path) -> PathBuf {
    sidecar_path(db_path, ".webdav-sync.json")
}

/// Reads the sync state; a state recorded for a different target counts as missing.
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
    match serde_json::to_string_pretty(&state) {
        Ok(json) => {
            if let Err(e) = fs::write(webdav_sync_state_path(db_path), json.as_bytes()) {
                eprintln!("Failed to write WebDAV sync state: {}", e);
            }
        }
        Err(e) => eprintln!("Failed to serialize WebDAV sync state: {}", e),
    }
}

fn remove_webdav_sync_state(db_path: &Path) {
    let p = webdav_sync_state_path(db_path);
    if p.exists() {
        let _ = fs::remove_file(p);
    }
}

/// Copies `<db>.webdav-sync.json` along with a relocated database.
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

/// Weak ETag comparison (RFC 9110 §8.8.3.2): `W/"x"` and `"x"` name the same version. Servers such as
/// nginx mark a tag weak on some responses only, so a plain string compare reported a remote change
/// (and a conflict after every local save).
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

fn file_mtime_secs(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

/// Removes leftover SQLite sidecar files so they cannot be applied to a replaced DB file.
fn remove_sqlite_sidecars(db_path: &Path) {
    for suffix in ["-journal", "-wal", "-shm"] {
        let p = sidecar_path(db_path, suffix);
        if p.exists() {
            let _ = fs::remove_file(p);
        }
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

/// Downloads the remote file; returns (bytes, etag, last-modified).
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
        .read_to_end(&mut data)
        .map_err(|e| WebDavDownloadError::Transport(format!("Failed to download WebDAV file content: {}", e)))?;
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

    // Optimistic concurrency: only overwrite the version this device last synced.
    let mut if_match: Option<String> = None;
    if !force {
        if let Some(ref s) = state {
            match s.etag {
                // If-Match uses strong comparison, so a weak tag would never match (412 every time).
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

    // "Keep this device's version": keep the cloud copy as a local file before overwriting it.
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

/// Downloads the remote vault into the active local DB path (works even when no local DB exists).
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
    {
        let _guard = lock_db_file();
        if local_db.exists() {
            if let Some(parent) = local_db.parent() {
                let backup_file =
                    parent.join(format!("koban-pre-webdav-sync-{}.db", now_secs()));
                let _ = fs::copy(&local_db, &backup_file);
            }
        }
        remove_sqlite_sidecars(&local_db);
        fs::write(&local_db, &data)
            .map_err(|e| format!("Failed to save downloaded database: {}", e))?;
    }

    let meta = WebDavRemoteMeta {
        etag,
        last_modified: modified,
        size: Some(data.len() as u64),
    };
    write_webdav_sync_state(&local_db, &target, &meta, sha256_hex(&data));

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

#[tauri::command]
async fn push_to_webdav(
    url: String,
    username: String,
    password: String,
    filename: Option<String>,
    force: Option<bool>,
    preserve_remote: Option<bool>,
) -> Result<WebDavSyncResult, String> {
    // Without an explicit flag the push behaves like before (unconditional overwrite).
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

/// New-device flow: download the cloud vault into the active local DB path.
#[tauri::command]
async fn webdav_download_vault(
    url: String,
    username: String,
    password: String,
    filename: Option<String>,
) -> Result<WebDavSyncResult, String> {
    run_blocking(move || webdav_pull_impl(url, username, password, filename)).await
}

/// Forgets the per-device sync state (the local DB content was replaced by an import / restore).
#[tauri::command]
fn webdav_forget_sync_state() -> Result<(), String> {
    remove_webdav_sync_state(&get_active_db_path());
    Ok(())
}

#[tauri::command]
fn check_windows_hello_available() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let ps_script = r#"
$ErrorActionPreference = 'Stop'
try {
    $null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
    $op = [Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    $task = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerifierAvailability]).Invoke($null, @($op))
    $res = $task.GetAwaiter().GetResult()
    if ($res -eq 'Available') { Write-Output 'AVAILABLE' } else { Write-Output $res }
} catch {
    Write-Output 'AVAILABLE'
}
"#;
        let output = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", ps_script])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        if let Ok(out) = output {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            return Ok(stdout == "AVAILABLE" || stdout != "DeviceNotPresent");
        }
        Ok(true)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

#[tauri::command]
fn verify_windows_hello(message: Option<String>) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let msg = message
            .unwrap_or_else(|| "Unlock Koban Encrypted Budget & Net Worth Vault".into())
            .replace('\'', "''");
        let ps_script = format!(
            r#"
$ErrorActionPreference = 'Stop'
try {{
    $null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $op = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('{msg}')
    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {{ $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' }})[0]
    $task = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerificationResult]).Invoke($null, @($op))
    $res = $task.GetAwaiter().GetResult()
    Write-Output $res.ToString()
}} catch {{
    Write-Output "ERROR:$($_.Exception.Message)"
}}
"#
        );
        let output = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Failed to invoke Windows Hello: {}", e))?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stdout == "Verified" {
            return Ok(true);
        } else if stdout == "Canceled" {
            return Err("Windows Hello verification was canceled.".into());
        } else if stdout == "DeviceNotPresent" || stdout == "NotConfiguredForUser" {
            return Err("Windows Hello is not configured on this Windows account.".into());
        } else {
            return Err(format!("Windows Hello verification result: {}", stdout));
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = message;
        Err("Windows Hello is only supported on Windows.".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            set_vault_passphrase,
            get_db_info,
            load_ledger_db,
            save_ledger_db,
            trigger_manual_backup,
            list_backups,
            restore_backup_file,
            pick_folder,
            pick_save_file,
            pick_open_file,
            write_binary_file,
            read_binary_file,
            write_text_file,
            copy_db_file,
            reveal_in_explorer,
            get_auth_config,
            save_auth_config,
            wrap_vault_secret_for_credential,
            unwrap_vault_secret_for_credential,
            check_windows_hello_available,
            verify_windows_hello,
            move_database_location,
            reset_database_location,
            test_webdav_connection,
            get_webdav_remote_info,
            push_to_webdav,
            pull_from_webdav,
            webdav_check,
            webdav_download_vault,
            webdav_forget_sync_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
