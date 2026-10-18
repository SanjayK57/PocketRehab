/**
 * Encryption at rest for PocketRehab accounts, built only on the browser's WebCrypto.
 *
 *   password ──PBKDF2-SHA-256 (1,000,000 iterations, 16-byte random salt)──▶ key-encryption key (KEK)
 *   random AES-256-GCM data key ──wrapped by the KEK (AES-GCM, AAD = account id)──▶ stored with the account
 *   every record ──AES-256-GCM, fresh 96-bit IV, AAD = account | store | key──▶ stored
 *
 * Why a wrapped data key: changing the password only re-wraps 60 bytes instead of
 * re-encrypting every record, and the iteration count can rise later per account.
 * Why AAD: a ciphertext copied to another store, key or account fails to decrypt,
 * so records can't be swapped around on disk.
 * Keys used after sign-in are non-extractable: page script can use them but never
 * read their bytes, and they live only in memory (dropped on lock).
 */

/**
 * OWASP's 2023 floor for PBKDF2-HMAC-SHA256 is 600,000. Measured in Chromium on an
 * Apple M5 Pro: 600k ≈ 40 ms, 1M ≈ 60 ms, so 1M stays well under the ~1.5 s
 * sign-in budget even on laptops 15–20× slower. Stored per account, so it can rise.
 */
export const KDF_ITERATIONS = 1_000_000;
export const SALT_BYTES = 16;
const IV_BYTES = 12;

export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class CryptoUnavailableError extends Error {
  constructor() {
    super('This browser does not provide WebCrypto here. Open PocketRehab over HTTPS (or on localhost) in an up-to-date browser.');
    this.name = 'CryptoUnavailableError';
  }
}

export function cryptoAvailable(): boolean {
  return typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.subtle !== 'undefined';
}

function subtle(): SubtleCrypto {
  if (!cryptoAvailable()) throw new CryptoUnavailableError();
  return globalThis.crypto.subtle;
}

export function randomBytes(length: number): Bytes {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/** Additional authenticated data: binds a ciphertext to where it is allowed to live. */
export function aad(...parts: Array<string | number>): Bytes {
  return encoder.encode(['pocketrehab:v1', ...parts.map(String)].join('\u001f'));
}

/** Slow on purpose: this cost is what makes guessing a stolen database impractical. */
export async function deriveKek(password: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const s = subtle();
  // NFKC so the same password typed on another keyboard or OS still matches.
  const base = await s.importKey('raw', encoder.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return s.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

/** A fresh data key. Extractable only so it can be wrapped once; callers keep the non-extractable unwrapped copy. */
export function generateDataKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** A non-extractable key for the password-less demo account (the browser stores the key object itself). */
export function generateDeviceKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export interface WrappedKey {
  iv: Bytes;
  key: ArrayBuffer;
}

export async function wrapDataKey(dataKey: CryptoKey, kek: CryptoKey, additionalData: Bytes): Promise<WrappedKey> {
  const iv = randomBytes(IV_BYTES);
  const key = await subtle().wrapKey('raw', dataKey, kek, { name: 'AES-GCM', iv, additionalData });
  return { iv, key };
}

/** Throws (OperationError) when the KEK is wrong: the GCM tag doubles as the password check. */
export function unwrapDataKey(wrapped: WrappedKey, kek: CryptoKey, additionalData: Bytes, extractable = false): Promise<CryptoKey> {
  return subtle().unwrapKey('raw', wrapped.key, kek, { name: 'AES-GCM', iv: wrapped.iv, additionalData }, { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
}

export interface Sealed {
  iv: Bytes;
  ct: ArrayBuffer;
}

export async function sealJson(key: CryptoKey, value: unknown, additionalData: Bytes): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData }, key, encoder.encode(JSON.stringify(value)));
  return { iv, ct };
}

/** Throws when the key, the AAD or the bytes do not match what was sealed. */
export async function openJson(key: CryptoKey, sealed: Sealed, additionalData: Bytes): Promise<unknown> {
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: sealed.iv, additionalData }, key, sealed.ct);
  return JSON.parse(decoder.decode(plain)) as unknown;
}

/** Base64 for binary fields in files that leave the device (encrypted backups). Chunked: large spreads overflow the call stack. */
export function toBase64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Throws on anything that isn't base64. */
export function fromBase64(text: string): Bytes {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
