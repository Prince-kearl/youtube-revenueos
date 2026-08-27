import { requireServerEnv } from "./env";

// AES-256-GCM via the Web Crypto API (available on Cloudflare Workers, Vercel's Node runtime,
// and Vite dev) so this module never depends on a Node-only `node:crypto` import.
async function importKey(): Promise<CryptoKey> {
  const raw = requireServerEnv("TOKEN_ENCRYPTION_KEY");
  const keyBytes = base64ToBytes(raw);
  if (keyBytes.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes");
  }
  return crypto.subtle.importKey("raw", keyBytes.buffer as ArrayBuffer, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("\\x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  return bytes;
}

// Output is a Postgres bytea hex literal ("\\x...") so it round-trips through
// PostgREST/supabase-js without any extra encoding step at the call site.
export async function encryptSecretToBytea(plaintext: string): Promise<string> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const combined = new Uint8Array(iv.length + cipherBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuffer), iv.length);
  return `\\x${bytesToHex(combined)}`;
}

export async function decryptSecretFromBytea(byteaHex: string): Promise<string> {
  const key = await importKey();
  const combined = hexToBytes(byteaHex);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plainBuffer);
}
