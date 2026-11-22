use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Key, Nonce,
};
use base64::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

pub const DEFAULT_ARGON2_MEMORY_KIB: u32 = 65_536;
pub const DEFAULT_ARGON2_ITERATIONS: u32 = 3;
pub const DEFAULT_ARGON2_PARALLELISM: u32 = 4;

pub const KOBAN_V2_LEDGER_HKDF_INFO: &[u8] = b"koban/v2/ledger";
pub const KOBAN_V2_RECOVERY_HKDF_INFO: &[u8] = b"koban/v2/recovery-kek";
pub const KOBAN_V2_WINHELLO_HKDF_INFO: &[u8] = b"koban/v2/windows-hello-kek";

pub fn random_bytes<const N: usize>() -> Result<[u8; N], String> {
    let mut buf = [0u8; N];
    getrandom::getrandom(&mut buf).map_err(|e| format!("RNG error: {}", e))?;
    Ok(buf)
}

pub fn sha256_bytes(data: &[u8]) -> [u8; 32] {
    let digest = Sha256::digest(data);
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

pub fn sha256_hex(data: &[u8]) -> String {
    let digest = Sha256::digest(data);
    hex_encode(&digest)
}

pub fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(out, "{:02x}", b);
    }
    out
}

pub fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    let clean = s.trim();
    if clean.len() % 2 != 0 {
        return Err("Invalid hex length".into());
    }
    let mut out = Vec::with_capacity(clean.len() / 2);
    let bytes = clean.as_bytes();
    for i in (0..bytes.len()).step_by(2) {
        let hi = hex_nibble(bytes[i])?;
        let lo = hex_nibble(bytes[i + 1])?;
        out.push((hi << 4) | lo);
    }
    Ok(out)
}

fn hex_nibble(b: u8) -> Result<u8, String> {
    match b {
        b'0'..=b'9' => Ok(b - b'0'),
        b'a'..=b'f' => Ok(b - b'a' + 10),
        b'A'..=b'F' => Ok(b - b'A' + 10),
        _ => Err("Invalid hex character".into()),
    }
}

/// Normalizes a passphrase to Unicode NFC without trimming whitespace.
pub fn normalize_nfc(input: &str) -> String {
    if input.is_ascii() {
        return input.to_string();
    }
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Globalization::{NormalizeString, NormalizationC};
        let utf16: Vec<u16> = input.encode_utf16().collect();
        if utf16.is_empty() {
            return String::new();
        }
        unsafe {
            let cap = NormalizeString(NormalizationC, &utf16, None);
            if cap > 0 {
                let mut buf = vec![0u16; (cap as usize) + 8];
                let written = NormalizeString(NormalizationC, &utf16, Some(&mut buf));
                if written > 0 {
                    buf.truncate(written as usize);
                    if let Ok(s) = String::from_utf16(&buf) {
                        return s;
                    }
                }
            }
        }
    }
    input.to_string()
}

// ===================== RFC 2104 HMAC-SHA256 & RFC 5869 HKDF-SHA256 =====================

pub fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    const BLOCK_SIZE: usize = 64;
    let mut k_pad = [0u8; BLOCK_SIZE];
    if key.len() > BLOCK_SIZE {
        let hashed = sha256_bytes(key);
        k_pad[..32].copy_from_slice(&hashed);
    } else {
        k_pad[..key.len()].copy_from_slice(key);
    }

    let mut ipad = [0x36u8; BLOCK_SIZE];
    let mut opad = [0x5cu8; BLOCK_SIZE];
    for i in 0..BLOCK_SIZE {
        ipad[i] ^= k_pad[i];
        opad[i] ^= k_pad[i];
    }

    let mut inner = Sha256::new();
    inner.update(ipad);
    inner.update(data);
    let inner_digest = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(opad);
    outer.update(inner_digest);
    let outer_digest = outer.finalize();

    k_pad.zeroize();
    ipad.zeroize();
    opad.zeroize();

    let mut out = [0u8; 32];
    out.copy_from_slice(&outer_digest);
    out
}

pub fn hkdf_sha256(ikm: &[u8], salt: &[u8], info: &[u8], out_len: usize) -> Result<Zeroizing<Vec<u8>>, String> {
    if out_len == 0 || out_len > 255 * 32 {
        return Err("Invalid HKDF output length".into());
    }
    let zero_salt = [0u8; 32];
    let effective_salt = if salt.is_empty() { &zero_salt[..] } else { salt };
    let prk = hmac_sha256(effective_salt, ikm);

    let mut okm = Zeroizing::new(Vec::with_capacity(out_len));
    let mut prev: Vec<u8> = Vec::new();
    let mut counter: u8 = 1;
    while okm.len() < out_len {
        let mut msg = Vec::with_capacity(prev.len() + info.len() + 1);
        msg.extend_from_slice(&prev);
        msg.extend_from_slice(info);
        msg.push(counter);
        let t = hmac_sha256(&prk, &msg);
        msg.zeroize();
        let take = (out_len - okm.len()).min(32);
        okm.extend_from_slice(&t[..take]);
        prev.zeroize();
        prev = t.to_vec();
        counter = counter.checked_add(1).ok_or("HKDF counter overflow")?;
    }
    prev.zeroize();
    Ok(okm)
}

pub fn derive_ledger_key(dek: &[u8; 32], vault_id_bytes: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    let okm = hkdf_sha256(dek, vault_id_bytes, KOBAN_V2_LEDGER_HKDF_INFO, 32)?;
    let mut out = Zeroizing::new([0u8; 32]);
    out.copy_from_slice(&okm);
    Ok(out)
}

pub fn derive_recovery_kek(recovery_bytes: &[u8], salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    let okm = hkdf_sha256(recovery_bytes, salt, KOBAN_V2_RECOVERY_HKDF_INFO, 32)?;
    let mut out = Zeroizing::new([0u8; 32]);
    out.copy_from_slice(&okm);
    Ok(out)
}

pub fn derive_windows_hello_kek(signature: &[u8], challenge: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    let okm = hkdf_sha256(signature, challenge, KOBAN_V2_WINHELLO_HKDF_INFO, 32)?;
    let mut out = Zeroizing::new([0u8; 32]);
    out.copy_from_slice(&okm);
    Ok(out)
}

// ===================== AES-256-GCM with AAD =====================

pub fn encrypt_aes256_gcm_aad(
    key_bytes: &[u8; 32],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<(String, String), String> {
    let nonce_bytes = random_bytes::<12>()?;
    encrypt_aes256_gcm_aad_with_nonce(key_bytes, &nonce_bytes, plaintext, aad)
}

pub fn encrypt_aes256_gcm_aad_with_nonce(
    key_bytes: &[u8; 32],
    nonce_bytes: &[u8; 12],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<(String, String), String> {
    let key = Key::<Aes256Gcm>::try_from(key_bytes.as_slice())
        .map_err(|_| "Invalid AES-256 key length".to_string())?;
    let cipher = Aes256Gcm::new(&key);
    let nonce = Nonce::try_from(nonce_bytes.as_slice())
        .map_err(|_| "Invalid AES-GCM nonce length".to_string())?;
    let ciphertext = cipher
        .encrypt(&nonce, Payload { msg: plaintext, aad })
        .map_err(|e| format!("AES-256-GCM encryption failed: {}", e))?;
    Ok((
        BASE64_STANDARD.encode(nonce_bytes),
        BASE64_STANDARD.encode(ciphertext),
    ))
}

pub fn decrypt_aes256_gcm_aad(
    key_bytes: &[u8; 32],
    nonce_b64: &str,
    ciphertext_b64: &str,
    aad: &[u8],
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
        .decrypt(
            &nonce,
            Payload {
                msg: ciphertext.as_ref(),
                aad,
            },
        )
        .map_err(|_| "Decryption failed: invalid credentials or corrupted database.".into())
}

// ===================== RFC 7693 BLAKE2b =====================

const BLAKE2B_IV: [u64; 8] = [
    0x6a09e667f3bcc908,
    0xbb67ae8584caa73b,
    0x3c6ef372fe94f82b,
    0xa54ff53a5f1d36f1,
    0x510e527fade682d1,
    0x9b05688c2b3e6c1f,
    0x1f83d9abfb41bd6b,
    0x5be0cd19137e2179,
];

const BLAKE2B_SIGMA: [[usize; 16]; 12] = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
    [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
    [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
    [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
    [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
    [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
    [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
    [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
    [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
];

struct Blake2b {
    h: [u64; 8],
    t: [u64; 2],
    buf: [u8; 128],
    buf_len: usize,
    out_len: usize,
}

impl Blake2b {
    fn new(out_len: usize) -> Self {
        assert!((1..=64).contains(&out_len));
        let mut h = BLAKE2B_IV;
        h[0] ^= 0x01010000 ^ (out_len as u64);
        Self {
            h,
            t: [0, 0],
            buf: [0u8; 128],
            buf_len: 0,
            out_len,
        }
    }

    fn update(&mut self, mut data: &[u8]) {
        if data.is_empty() {
            return;
        }
        if self.buf_len > 0 {
            let fill = (128 - self.buf_len).min(data.len());
            self.buf[self.buf_len..self.buf_len + fill].copy_from_slice(&data[..fill]);
            self.buf_len += fill;
            data = &data[fill..];
            if !data.is_empty() && self.buf_len == 128 {
                let block = self.buf;
                self.increment_counter(128);
                self.compress(&block, false);
                self.buf_len = 0;
            }
        }
        while data.len() > 128 {
            let mut block = [0u8; 128];
            block.copy_from_slice(&data[..128]);
            self.increment_counter(128);
            self.compress(&block, false);
            data = &data[128..];
        }
        if !data.is_empty() {
            self.buf[self.buf_len..self.buf_len + data.len()].copy_from_slice(data);
            self.buf_len += data.len();
        }
    }

    fn increment_counter(&mut self, inc: u64) {
        let (new_t0, overflow) = self.t[0].overflowing_add(inc);
        self.t[0] = new_t0;
        if overflow {
            self.t[1] = self.t[1].wrapping_add(1);
        }
    }

    fn compress(&mut self, block: &[u8; 128], last: bool) {
        let mut m = [0u64; 16];
        for (i, chunk) in block.chunks_exact(8).enumerate() {
            m[i] = u64::from_le_bytes(chunk.try_into().unwrap());
        }

        let mut v = [0u64; 16];
        v[..8].copy_from_slice(&self.h);
        v[8..16].copy_from_slice(&BLAKE2B_IV);
        v[12] ^= self.t[0];
        v[13] ^= self.t[1];
        if last {
            v[14] = !v[14];
        }

        #[inline(always)]
        fn g(v: &mut [u64; 16], a: usize, b: usize, c: usize, d: usize, x: u64, y: u64) {
            v[a] = v[a].wrapping_add(v[b]).wrapping_add(x);
            v[d] = (v[d] ^ v[a]).rotate_right(32);
            v[c] = v[c].wrapping_add(v[d]);
            v[b] = (v[b] ^ v[c]).rotate_right(24);
            v[a] = v[a].wrapping_add(v[b]).wrapping_add(y);
            v[d] = (v[d] ^ v[a]).rotate_right(16);
            v[c] = v[c].wrapping_add(v[d]);
            v[b] = (v[b] ^ v[c]).rotate_right(63);
        }

        for r in 0..12 {
            let s = &BLAKE2B_SIGMA[r];
            g(&mut v, 0, 4, 8, 12, m[s[0]], m[s[1]]);
            g(&mut v, 1, 5, 9, 13, m[s[2]], m[s[3]]);
            g(&mut v, 2, 6, 10, 14, m[s[4]], m[s[5]]);
            g(&mut v, 3, 7, 11, 15, m[s[6]], m[s[7]]);
            g(&mut v, 0, 5, 10, 15, m[s[8]], m[s[9]]);
            g(&mut v, 1, 6, 11, 12, m[s[10]], m[s[11]]);
            g(&mut v, 2, 7, 8, 13, m[s[12]], m[s[13]]);
            g(&mut v, 3, 4, 9, 14, m[s[14]], m[s[15]]);
        }

        for i in 0..8 {
            self.h[i] ^= v[i] ^ v[i + 8];
        }
        m.zeroize();
        v.zeroize();
    }

    fn finalize(mut self) -> Vec<u8> {
        let remaining = self.buf_len;
        for b in &mut self.buf[remaining..] {
            *b = 0;
        }
        let block = self.buf;
        self.increment_counter(remaining as u64);
        self.compress(&block, true);

        let mut out = Vec::with_capacity(self.out_len);
        for word in &self.h {
            out.extend_from_slice(&word.to_le_bytes());
        }
        out.truncate(self.out_len);
        self.buf.zeroize();
        self.h.zeroize();
        out
    }
}

pub fn blake2b(out_len: usize, chunks: &[&[u8]]) -> Vec<u8> {
    let mut h = Blake2b::new(out_len);
    for c in chunks {
        h.update(c);
    }
    h.finalize()
}

// ===================== RFC 9106 Argon2id =====================

#[derive(Clone)]
struct Argon2Block {
    v: [u64; 128],
}

impl Default for Argon2Block {
    fn default() -> Self {
        Self { v: [0u64; 128] }
    }
}

impl Drop for Argon2Block {
    fn drop(&mut self) {
        self.v.zeroize();
    }
}

#[inline(always)]
fn f_blamka(x: u64, y: u64) -> u64 {
    let m = 0xffffffffu64;
    let xy = (x & m).wrapping_mul(y & m);
    x.wrapping_add(y).wrapping_add(xy.wrapping_mul(2))
}

#[inline(always)]
fn blamka_g(v: &mut [u64], a: usize, b: usize, c: usize, d: usize) {
    v[a] = f_blamka(v[a], v[b]);
    v[d] = (v[d] ^ v[a]).rotate_right(32);
    v[c] = f_blamka(v[c], v[d]);
    v[b] = (v[b] ^ v[c]).rotate_right(24);
    v[a] = f_blamka(v[a], v[b]);
    v[d] = (v[d] ^ v[a]).rotate_right(16);
    v[c] = f_blamka(v[c], v[d]);
    v[b] = (v[b] ^ v[c]).rotate_right(63);
}

#[inline(always)]
fn blamka_round_p(v: &mut [u64; 16]) {
    blamka_g(v, 0, 4, 8, 12);
    blamka_g(v, 1, 5, 9, 13);
    blamka_g(v, 2, 6, 10, 14);
    blamka_g(v, 3, 7, 11, 15);
    blamka_g(v, 0, 5, 10, 15);
    blamka_g(v, 1, 6, 11, 12);
    blamka_g(v, 2, 7, 8, 13);
    blamka_g(v, 3, 4, 9, 14);
}

fn argon2_compress_block(prev: &Argon2Block, ref_b: &Argon2Block) -> Argon2Block {
    let mut r = [0u64; 128];
    for i in 0..128 {
        r[i] = prev.v[i] ^ ref_b.v[i];
    }
    let mut z = r;

    // Apply P row-wise (8 rows of 16 u64s)
    for row in 0..8 {
        let base = row * 16;
        let mut slice16 = [0u64; 16];
        slice16.copy_from_slice(&z[base..base + 16]);
        blamka_round_p(&mut slice16);
        z[base..base + 16].copy_from_slice(&slice16);
    }

    // Apply P column-wise (8 column pairs across 8 rows)
    for col in 0..8 {
        let mut slice16 = [0u64; 16];
        for row in 0..8 {
            slice16[row * 2] = z[row * 16 + col * 2];
            slice16[row * 2 + 1] = z[row * 16 + col * 2 + 1];
        }
        blamka_round_p(&mut slice16);
        for row in 0..8 {
            z[row * 16 + col * 2] = slice16[row * 2];
            z[row * 16 + col * 2 + 1] = slice16[row * 2 + 1];
        }
    }

    let mut out = Argon2Block::default();
    for i in 0..128 {
        out.v[i] = z[i] ^ r[i];
    }
    r.zeroize();
    z.zeroize();
    out
}

fn argon2_hash_prime(tau: usize, msg: &[u8]) -> Vec<u8> {
    let tau_le = (tau as u32).to_le_bytes();
    if tau <= 64 {
        return blake2b(tau, &[&tau_le, msg]);
    }
    let r = (tau + 31) / 32 - 2;
    let mut out = Vec::with_capacity(tau);
    let mut v_i = blake2b(64, &[&tau_le, msg]);
    out.extend_from_slice(&v_i[..32]);
    for _ in 2..=r {
        v_i = blake2b(64, &[&v_i]);
        out.extend_from_slice(&v_i[..32]);
    }
    let last_len = tau - 32 * r;
    let v_last = blake2b(last_len, &[&v_i]);
    out.extend_from_slice(&v_last);
    out
}

fn block_from_bytes(bytes: &[u8]) -> Argon2Block {
    let mut b = Argon2Block::default();
    for (i, chunk) in bytes.chunks_exact(8).take(128).enumerate() {
        b.v[i] = u64::from_le_bytes(chunk.try_into().unwrap());
    }
    b
}

fn argon2_index_alpha(
    pass: u32,
    slice: u32,
    index: u32,
    segment_length: u32,
    lane_length: u32,
    same_lane: bool,
    j1: u32,
) -> usize {
    let reference_area_size: u64 = if pass == 0 {
        if slice == 0 {
            (index - 1) as u64
        } else if same_lane {
            (slice * segment_length + index - 1) as u64
        } else {
            (slice * segment_length - if index == 0 { 1 } else { 0 }) as u64
        }
    } else if same_lane {
        (lane_length - segment_length + index - 1) as u64
    } else {
        (lane_length - segment_length - if index == 0 { 1 } else { 0 }) as u64
    };

    let mut relative_pos = (j1 as u64).wrapping_mul(j1 as u64) >> 32;
    relative_pos = (reference_area_size.wrapping_mul(relative_pos)) >> 32;
    relative_pos = reference_area_size - 1 - relative_pos;

    let start_position: u64 = if pass != 0 && slice != 3 {
        ((slice + 1) * segment_length) as u64
    } else {
        0
    };
    ((start_position + relative_pos) % (lane_length as u64)) as usize
}

/// RFC 9106 Argon2id (version 0x13 = 19, type = 2).
pub fn argon2id(
    password: &[u8],
    salt: &[u8],
    secret: &[u8],
    associated_data: &[u8],
    m_kib: u32,
    t: u32,
    p: u32,
    tag_len: usize,
) -> Result<Zeroizing<Vec<u8>>, String> {
    if p == 0 || t == 0 || m_kib < 8 * p || tag_len < 4 {
        return Err("Invalid Argon2id parameters".into());
    }
    const ARGON2_VERSION: u32 = 19;
    const ARGON2_TYPE_ID: u32 = 2;

    let mut h0_hasher = Blake2b::new(64);
    h0_hasher.update(&p.to_le_bytes());
    h0_hasher.update(&(tag_len as u32).to_le_bytes());
    h0_hasher.update(&m_kib.to_le_bytes());
    h0_hasher.update(&t.to_le_bytes());
    h0_hasher.update(&ARGON2_VERSION.to_le_bytes());
    h0_hasher.update(&ARGON2_TYPE_ID.to_le_bytes());
    h0_hasher.update(&(password.len() as u32).to_le_bytes());
    h0_hasher.update(password);
    h0_hasher.update(&(salt.len() as u32).to_le_bytes());
    h0_hasher.update(salt);
    h0_hasher.update(&(secret.len() as u32).to_le_bytes());
    h0_hasher.update(secret);
    h0_hasher.update(&(associated_data.len() as u32).to_le_bytes());
    h0_hasher.update(associated_data);
    let mut h0 = h0_hasher.finalize();

    let memory_blocks = 4 * p * (m_kib / (4 * p));
    let lane_length = memory_blocks / p;
    let segment_length = lane_length / 4;

    let mut mem: Vec<Argon2Block> = (0..(memory_blocks as usize))
        .map(|_| Argon2Block::default())
        .collect();

    for lane in 0..p {
        let mut msg0 = Vec::with_capacity(72);
        msg0.extend_from_slice(&h0);
        msg0.extend_from_slice(&0u32.to_le_bytes());
        msg0.extend_from_slice(&lane.to_le_bytes());
        let b0 = argon2_hash_prime(1024, &msg0);
        mem[(lane * lane_length) as usize] = block_from_bytes(&b0);

        let mut msg1 = Vec::with_capacity(72);
        msg1.extend_from_slice(&h0);
        msg1.extend_from_slice(&1u32.to_le_bytes());
        msg1.extend_from_slice(&lane.to_le_bytes());
        let b1 = argon2_hash_prime(1024, &msg1);
        mem[(lane * lane_length + 1) as usize] = block_from_bytes(&b1);
    }
    h0.zeroize();

    let zero_block = Argon2Block::default();

    for pass in 0..t {
        for slice in 0..4u32 {
            let data_independent = pass == 0 && slice < 2;
            let starting_index = if pass == 0 && slice == 0 { 2u32 } else { 0u32 };

            for lane in 0..p {
                let mut input_block = Argon2Block::default();
                let mut address_block = Argon2Block::default();
                if data_independent {
                    input_block.v[0] = pass as u64;
                    input_block.v[1] = lane as u64;
                    input_block.v[2] = slice as u64;
                    input_block.v[3] = memory_blocks as u64;
                    input_block.v[4] = t as u64;
                    input_block.v[5] = ARGON2_TYPE_ID as u64;
                    if pass == 0 && slice == 0 {
                        input_block.v[6] += 1;
                        let tmp = argon2_compress_block(&zero_block, &input_block);
                        address_block = argon2_compress_block(&zero_block, &tmp);
                    }
                }

                let mut curr_offset = (lane * lane_length + slice * segment_length + starting_index) as usize;
                let mut prev_offset = if slice == 0 && starting_index == 0 {
                    (lane * lane_length + lane_length - 1) as usize
                } else {
                    curr_offset - 1
                };

                for i in starting_index..segment_length {
                    if curr_offset % (lane_length as usize) == 0 {
                        prev_offset = curr_offset + (lane_length as usize) - 1;
                    }

                    let pseudo_rand = if data_independent {
                        let addr_idx = (i as usize) % 128;
                        if addr_idx == 0 {
                            input_block.v[6] += 1;
                            let tmp = argon2_compress_block(&zero_block, &input_block);
                            address_block = argon2_compress_block(&zero_block, &tmp);
                        }
                        address_block.v[addr_idx]
                    } else {
                        mem[prev_offset].v[0]
                    };

                    let j1 = (pseudo_rand & 0xffff_ffff) as u32;
                    let j2 = (pseudo_rand >> 32) as u32;

                    let ref_lane = if pass == 0 && slice == 0 {
                        lane
                    } else {
                        j2 % p
                    };

                    let ref_index = argon2_index_alpha(
                        pass,
                        slice,
                        i,
                        segment_length,
                        lane_length,
                        ref_lane == lane,
                        j1,
                    );
                    let ref_offset = (ref_lane * lane_length) as usize + ref_index;

                    let next_block = argon2_compress_block(&mem[prev_offset], &mem[ref_offset]);
                    if pass == 0 {
                        mem[curr_offset] = next_block;
                    } else {
                        for k in 0..128 {
                            mem[curr_offset].v[k] ^= next_block.v[k];
                        }
                    }

                    prev_offset = curr_offset;
                    curr_offset += 1;
                }
            }
        }
    }

    let mut final_block = Argon2Block::default();
    for lane in 0..p {
        let last_idx = ((lane + 1) * lane_length - 1) as usize;
        for k in 0..128 {
            final_block.v[k] ^= mem[last_idx].v[k];
        }
    }

    let mut final_bytes = Vec::with_capacity(1024);
    for w in &final_block.v {
        final_bytes.extend_from_slice(&w.to_le_bytes());
    }
    let out = Zeroizing::new(argon2_hash_prime(tag_len, &final_bytes));
    final_bytes.zeroize();
    Ok(out)
}

pub fn derive_passphrase_kek(
    passphrase_nfc: &str,
    salt: &[u8],
    m_kib: u32,
    t: u32,
    p: u32,
) -> Result<Zeroizing<[u8; 32]>, String> {
    let tag = argon2id(passphrase_nfc.as_bytes(), salt, &[], &[], m_kib, t, p, 32)?;
    let mut kek = Zeroizing::new([0u8; 32]);
    kek.copy_from_slice(&tag);
    Ok(kek)
}

pub fn derive_composite_ikm(
    passphrase_nfc: &str,
    keyfile_secret: &[u8; 32],
) -> Zeroizing<[u8; 32]> {
    let mut pass_hash = sha256_bytes(passphrase_nfc.as_bytes());
    let ikm = hmac_sha256(keyfile_secret, &pass_hash);
    pass_hash.zeroize();
    Zeroizing::new(ikm)
}

pub fn derive_composite_kek(
    passphrase_nfc: &str,
    keyfile_secret: &[u8; 32],
    salt: &[u8],
    m_kib: u32,
    t: u32,
    p: u32,
) -> Result<Zeroizing<[u8; 32]>, String> {
    let ikm = derive_composite_ikm(passphrase_nfc, keyfile_secret);
    let tag = argon2id(ikm.as_ref(), salt, &[], &[], m_kib, t, p, 32)?;
    let mut kek = Zeroizing::new([0u8; 32]);
    kek.copy_from_slice(&tag);
    Ok(kek)
}

// ===================== Crockford Base32 (Recovery Keys) =====================

const CROCKFORD_ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

pub fn encode_crockford_base32(bytes: &[u8]) -> String {
    let mut raw = String::with_capacity((bytes.len() * 8 + 4) / 5);
    let mut buffer: u32 = 0;
    let mut bits: u8 = 0;
    for &b in bytes {
        buffer = (buffer << 8) | (b as u32);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            let idx = ((buffer >> bits) & 0x1f) as usize;
            raw.push(CROCKFORD_ALPHABET[idx] as char);
        }
    }
    if bits > 0 {
        let idx = ((buffer << (5 - bits)) & 0x1f) as usize;
        raw.push(CROCKFORD_ALPHABET[idx] as char);
    }

    let mut grouped = String::with_capacity(raw.len() + raw.len() / 4);
    for (i, ch) in raw.chars().enumerate() {
        if i > 0 && i % 4 == 0 {
            grouped.push('-');
        }
        grouped.push(ch);
    }
    grouped
}

pub fn decode_crockford_base32(input: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut buffer: u32 = 0;
    let mut bits: u8 = 0;

    for ch in input.chars() {
        if ch == '-' || ch.is_whitespace() {
            continue;
        }
        let upper = ch.to_ascii_uppercase();
        let mapped = match upper {
            'O' => '0',
            'I' | 'L' => '1',
            c => c,
        };
        let val = CROCKFORD_ALPHABET
            .iter()
            .position(|&c| (c as char) == mapped)
            .ok_or_else(|| format!("Invalid character '{}' in recovery key.", ch))? as u32;
        buffer = (buffer << 5) | val;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    if out.is_empty() {
        return Err("Recovery key cannot be empty.".into());
    }
    Ok(out)
}

// ===================== Koban Key File (.key) =====================

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KobanKeyFile {
    pub version: u32,
    pub format: String,
    pub key_b64: String,
    pub checksum_sha256: String,
    pub fingerprint: String,
    pub created_at: u64,
}

/// Generates a 256-bit Koban Key File JSON payload, returning `(json, secret_bytes, fingerprint_8hex)`.
pub fn generate_keyfile_json(created_at: u64) -> Result<(String, Zeroizing<[u8; 32]>, String), String> {
    let key_bytes = Zeroizing::new(random_bytes::<32>()?);
    let checksum = sha256_hex(key_bytes.as_ref());
    let fingerprint = checksum[..8].to_string();
    let doc = KobanKeyFile {
        version: 2,
        format: "koban-keyfile".into(),
        key_b64: BASE64_STANDARD.encode(key_bytes.as_ref()),
        checksum_sha256: checksum,
        fingerprint: fingerprint.clone(),
        created_at,
    };
    let json = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    Ok((json, key_bytes, fingerprint))
}

/// Extracts a 32-byte keyfile secret from:
/// 1) Koban Key File v2 JSON (`format == "koban-keyfile"`)
/// 2) Raw 64-character hex file
/// 3) Any arbitrary file (KeePassXC-compatible: SHA-256 of raw file bytes)
pub fn extract_keyfile_secret(raw_bytes: &[u8]) -> Result<(Zeroizing<[u8; 32]>, String), String> {
    if raw_bytes.is_empty() {
        return Err("Selected key file is empty.".into());
    }

    if let Ok(text) = std::str::from_utf8(raw_bytes) {
        let trimmed = text.trim_start_matches('\u{feff}').trim();
        if trimmed.starts_with('{') {
            if let Ok(parsed) = serde_json::from_str::<KobanKeyFile>(trimmed) {
                if parsed.format == "koban-keyfile" {
                    let decoded = BASE64_STANDARD
                        .decode(parsed.key_b64.trim())
                        .map_err(|_| "Corrupt key file: invalid base64 payload.".to_string())?;
                    if decoded.len() != 32 {
                        return Err("Corrupt key file: invalid key length.".into());
                    }
                    let actual_checksum = sha256_hex(&decoded);
                    if !actual_checksum.eq_ignore_ascii_case(parsed.checksum_sha256.trim()) {
                        return Err("Corrupt key file: SHA-256 checksum mismatch.".into());
                    }
                    let mut out = Zeroizing::new([0u8; 32]);
                    out.copy_from_slice(&decoded);
                    let fp = actual_checksum[..8].to_string();
                    return Ok((out, fp));
                }
            }
        }
        if trimmed.len() == 64 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
            let decoded = hex_decode(trimmed)?;
            if decoded.len() == 32 {
                let mut out = Zeroizing::new([0u8; 32]);
                out.copy_from_slice(&decoded);
                let fp = sha256_hex(out.as_ref())[..8].to_string();
                return Ok((out, fp));
            }
        }
    }

    let digest = sha256_bytes(raw_bytes);
    let out = Zeroizing::new(digest);
    let fp = sha256_hex(out.as_ref())[..8].to_string();
    Ok((out, fp))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc9106_argon2id_official_vector() {
        // RFC 9106 Section 5.3: Argon2id test vector
        let password = [0x01u8; 32];
        let salt = [0x02u8; 16];
        let secret = [0x03u8; 8];
        let ad = [0x04u8; 12];
        let tag = argon2id(&password, &salt, &secret, &ad, 32, 3, 4, 32).unwrap();
        assert_eq!(
            hex_encode(&tag),
            "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659"
        );
    }

    #[test]
    fn crockford_base32_roundtrip_and_confusables() {
        let bytes = [
            0x51, 0xA2, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xAA,
            0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x01, 0x23, 0x45, 0x67, 0x89,
        ];
        let encoded = encode_crockford_base32(&bytes);
        assert_eq!(encoded.len(), 32 + 7); // 8 groups of 4 + 7 dashes
        let decoded = decode_crockford_base32(&encoded).unwrap();
        assert_eq!(decoded, bytes);

        // Confusable characters (o/O -> 0, i/I/l/L -> 1, lowercase, extra spaces)
        let noisy = encoded
            .to_lowercase()
            .replace('0', "o")
            .replace('1', "l")
            .replace('-', "  ");
        assert_eq!(decode_crockford_base32(&noisy).unwrap(), bytes);
    }

    #[test]
    fn keyfile_generation_and_arbitrary_file_hashing() {
        let (json, secret, fp) = generate_keyfile_json(1731150000).unwrap();
        let (parsed_secret, parsed_fp) = extract_keyfile_secret(json.as_bytes()).unwrap();
        assert_eq!(secret.as_ref(), parsed_secret.as_ref());
        assert_eq!(fp, parsed_fp);

        // Arbitrary binary file also yields consistent 32B secret
        let (bin_secret, _) = extract_keyfile_secret(b"arbitrary photo or entropy bytes").unwrap();
        assert_eq!(bin_secret.as_ref(), &sha256_bytes(b"arbitrary photo or entropy bytes"));
    }

    #[test]
    fn aes_gcm_aad_rejects_tampered_aad() {
        let key = [0x42u8; 32];
        let nonce = [0x11u8; 12];
        let (n_b64, ct_b64) = encrypt_aes256_gcm_aad_with_nonce(
            &key,
            &nonce,
            b"secret-dek",
            b"koban/v2/slot/v1/s1/passphrase",
        )
        .unwrap();
        let ok = decrypt_aes256_gcm_aad(
            &key,
            &n_b64,
            &ct_b64,
            b"koban/v2/slot/v1/s1/passphrase",
        )
        .unwrap();
        assert_eq!(ok, b"secret-dek");
        assert!(decrypt_aes256_gcm_aad(
            &key,
            &n_b64,
            &ct_b64,
            b"koban/v2/slot/v1/s1/recovery",
        )
        .is_err());
    }

    #[test]
    fn nfc_normalization_combines_decomposed_utf8() {
        // 'e' + U+0301 combining acute accent (NFD) -> U+00E9 (NFC)
        let nfd = "cafe\u{0301}-pass";
        let nfc = "caf\u{00e9}-pass";
        assert_eq!(normalize_nfc(nfd), nfc);
    }
}
