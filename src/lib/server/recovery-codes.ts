const CODE_COUNT = 10;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const raw = bytesToBase64Url(bytes).slice(0, 16).toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function createRecoveryCodes(): Promise<{ codes: string[]; hashes: string[] }> {
  const codes = Array.from({ length: CODE_COUNT }, randomCode);
  const hashes = await Promise.all(
    codes.map(async (code) => {
      const salt = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
      return `${salt}.${await sha256(`${salt}:${code}`)}`;
    }),
  );
  return { codes, hashes };
}

export async function matchesRecoveryCode(code: string, storedHash: string): Promise<boolean> {
  const [salt, expected] = storedHash.split(".");
  if (!salt || !expected) return false;
  const actual = await sha256(`${salt}:${code.trim().toUpperCase()}`);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export { CODE_COUNT };