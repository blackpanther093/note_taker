/**
 * Zero-Knowledge Encryption Module
 *
 * All encryption/decryption happens client-side.
 * The server never sees plaintext content.
 *
 * Key Hierarchy:
 *   password → Argon2id(password, salt) → master_key
 *   master_key → HKDF("auth") → auth_key (sent to server for login)
 *   master_key → HKDF("enc")  → encryption_key (NEVER leaves browser)
 *   encryption_key → HKDF(entry_id) → entry_key (per-entry encryption)
 *
 * Encryption: AES-256-GCM with random 12-byte IV per operation
 */

// --- Argon2id Key Derivation (using WebAssembly-based argon2-browser) ---

import { argon2id } from 'hash-wasm';

const ARGON2_TIME_COST = 3;
const ARGON2_MEMORY_COST = 65536; // 64 MB
const ARGON2_PARALLELISM = 4;
const ARGON2_HASH_LENGTH = 32; // 256-bit master key

/**
 * Derive a master key from password + salt using Argon2id.
 * @param {string} password - User's password
 * @param {Uint8Array} salt - 32-byte salt
 * @returns {Promise<Uint8Array>} 32-byte master key
 */
export async function deriveMasterKey(password, salt) {
  const hashHex = await argon2id({
    password,
    salt,
    iterations: ARGON2_TIME_COST,
    memorySize: ARGON2_MEMORY_COST,
    parallelism: ARGON2_PARALLELISM,
    hashLength: ARGON2_HASH_LENGTH,
    outputType: 'hex',
  });
  // Convert hex string to Uint8Array
  const arr = new Uint8Array(ARGON2_HASH_LENGTH);
  for (let i = 0; i < ARGON2_HASH_LENGTH; i++) {
    arr[i] = parseInt(hashHex.substr(i * 2, 2), 16);
  }
  return arr;
}

// --- HKDF Key Derivation ---

/**
 * Import raw bytes as a CryptoKey for HKDF.
 */
async function importHKDFKey(keyMaterial) {
  return crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HKDF' },
    false,
    ['deriveKey', 'deriveBits']
  );
}

/**
 * Derive a sub-key from master key using HKDF with a context string.
 * @param {Uint8Array} masterKey - 32-byte master key
 * @param {string} context - Context string (e.g., "auth", "enc", entry_id)
 * @returns {Promise<Uint8Array>} 32-byte derived key
 */
export async function deriveSubKey(masterKey, context) {
  const hkdfKey = await importHKDFKey(masterKey);
  const encoder = new TextEncoder();
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32), // Empty salt (we use context as info)
      info: encoder.encode(context),
    },
    hkdfKey,
    256
  );
  return new Uint8Array(derivedBits);
}

/**
 * Derive the auth key (sent to server for authentication).
 */
export async function deriveAuthKey(masterKey) {
  const key = await deriveSubKey(masterKey, 'my-journal-auth-v1');
  return arrayToBase64(key);
}

/**
 * Derive the encryption key (never leaves the browser).
 */
export async function deriveEncryptionKey(masterKey) {
  return deriveSubKey(masterKey, 'my-journal-encryption-v1');
}

/**
 * Derive a per-entry encryption key.
 */
export async function deriveEntryKey(encryptionKey, entryId) {
  return deriveSubKey(encryptionKey, `entry-${entryId}`);
}

// --- AES-256-GCM Encryption ---

/**
 * Import raw bytes as an AES-GCM CryptoKey.
 */
async function importAESKey(rawKey) {
  return crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data with AES-256-GCM.
 * @param {Uint8Array} data - Plaintext bytes
 * @param {Uint8Array} keyBytes - 32-byte key
 * @returns {Promise<{ciphertext: Uint8Array, iv: Uint8Array}>}
 */
export async function encrypt(data, keyBytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
  const key = await importAESKey(keyBytes);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    data
  );
  // AES-GCM appends the auth tag to the ciphertext
  return {
    ciphertext: new Uint8Array(encrypted),
    iv,
  };
}

/**
 * Decrypt data with AES-256-GCM.
 * @param {Uint8Array} ciphertext - Ciphertext + auth tag
 * @param {Uint8Array} iv - 12-byte IV
 * @param {Uint8Array} keyBytes - 32-byte key
 * @returns {Promise<Uint8Array>} Decrypted plaintext
 */
export async function decrypt(ciphertext, iv, keyBytes) {
  const key = await importAESKey(keyBytes);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    ciphertext
  );
  return new Uint8Array(decrypted);
}

// --- Entry-level encryption helpers ---

/**
 * Encrypt a journal entry's content.
 * @param {string} content - JSON string of the entry content
 * @param {Uint8Array} encryptionKey - User's encryption key
 * @param {string} entryId - Entry UUID
 * @returns {Promise<{encrypted_content: string, iv: string}>} Base64-encoded
 */
export async function encryptEntry(content, encryptionKey, entryId) {
  const entryKey = await deriveEntryKey(encryptionKey, entryId);
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const { ciphertext, iv } = await encrypt(data, entryKey);
  return {
    encrypted_content: arrayToBase64(ciphertext),
    iv: arrayToBase64(iv),
  };
}

/**
 * Decrypt a journal entry's content.
 * @param {string} encryptedContentB64 - Base64-encoded ciphertext
 * @param {string} ivB64 - Base64-encoded IV
 * @param {Uint8Array} encryptionKey - User's encryption key
 * @param {string} entryId - Entry UUID
 * @returns {Promise<string>} Decrypted JSON string
 */
export async function decryptEntry(encryptedContentB64, ivB64, encryptionKey, entryId) {
  const entryKey = await deriveEntryKey(encryptionKey, entryId);
  const ciphertext = base64ToArray(encryptedContentB64);
  const iv = base64ToArray(ivB64);
  const decrypted = await decrypt(ciphertext, iv, entryKey);
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

/**
 * Encrypt metadata (title, mood, tags) for an entry.
 */
export async function encryptMetadata(metadata, encryptionKey, entryId) {
  const entryKey = await deriveEntryKey(encryptionKey, `metadata-${entryId}`);
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(metadata));
  const { ciphertext, iv } = await encrypt(data, entryKey);
  return {
    encrypted_metadata: arrayToBase64(ciphertext),
    metadata_iv: arrayToBase64(iv),
  };
}

/**
 * Decrypt metadata for an entry.
 */
export async function decryptMetadata(encryptedB64, ivB64, encryptionKey, entryId) {
  const entryKey = await deriveEntryKey(encryptionKey, `metadata-${entryId}`);
  const ciphertext = base64ToArray(encryptedB64);
  const iv = base64ToArray(ivB64);
  const decrypted = await decrypt(ciphertext, iv, entryKey);
  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(decrypted));
}

/**
 * Encrypt an image/file for upload.
 */
export async function encryptAsset(fileBytes, encryptionKey, entryId, assetId) {
  const assetKey = await deriveEntryKey(encryptionKey, `asset-${entryId}-${assetId}`);
  const { ciphertext, iv } = await encrypt(fileBytes, assetKey);
  return {
    encrypted_data: arrayToBase64(ciphertext),
    iv: arrayToBase64(iv),
  };
}

/**
 * Decrypt an image/file.
 */
export async function decryptAsset(encryptedB64, ivB64, encryptionKey, entryId, assetId) {
  const assetKey = await deriveEntryKey(encryptionKey, `asset-${entryId}-${assetId}`);
  const ciphertext = base64ToArray(encryptedB64);
  const iv = base64ToArray(ivB64);
  return decrypt(ciphertext, iv, assetKey);
}

// --- Utility functions ---

export function generateSalt() {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function generateUUID() {
  return crypto.randomUUID();
}

export function arrayToBase64(arr) {
  let binary = '';
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

export function base64ToArray(b64) {
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}

// --- Share Encryption Functions ---

/**
 * Generate a random 256-bit share key for public sharing
 * This key will be included in the URL fragment (#key)
 * @returns {Uint8Array} 32-byte random key
 */
export function generateShareKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Encrypt entry with share key for public sharing
 * @param {string} content - JSON string of entry content
 * @param {Uint8Array} shareKey - 32-byte share key
 * @returns {Promise<{encrypted_content: string, iv: string}>}
 */
export async function encryptWithShareKey(content, shareKey) {
  const contentBytes = new TextEncoder().encode(content);
  const { ciphertext, iv } = await encrypt(contentBytes, shareKey);
  return {
    encrypted_content: arrayToHex(ciphertext),
    iv: arrayToHex(iv),
  };
}

/**
 * Decrypt shared entry with share key
 * @param {string} encryptedContentHex - Hex-encoded ciphertext
 * @param {string} ivHex - Hex-encoded IV
 * @param {Uint8Array} shareKey - 32-byte share key from URL fragment
 * @returns {Promise<string>} Decrypted content (JSON string)
 */
export async function decryptWithShareKey(encryptedContentHex, ivHex, shareKey) {
  const ciphertext = hexToArray(encryptedContentHex);
  const iv = hexToArray(ivHex);
  const plaintext = await decrypt(ciphertext, iv, shareKey);
  return new TextDecoder().decode(plaintext);
}

/**
 * Convert hex string to Uint8Array
 * @param {string} hex - Hex string
 * @returns {Uint8Array}
 */
function hexToArray(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return arr;
}

/**
 * Convert Uint8Array to hex string
 * @param {Uint8Array} arr - Byte array
 * @returns {string}
 */
function arrayToHex(arr) {
  let hex = '';
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, '0');
  }
  return hex;
}
