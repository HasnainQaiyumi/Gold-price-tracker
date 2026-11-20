/**
 * Soft password gate. This site is static (GitHub Pages), so this keeps casual visitors out
 * but is NOT real access control: anyone able to read/modify the page code can bypass it.
 * Only a salted PBKDF2-SHA256 hash is shipped (never the password itself).
 */
export interface GateConfig {
  salt: string; // base64
  hash: string; // base64, 32 bytes
  iterations: number;
}

export const GATE: GateConfig = {
  salt: 'bPw6OQ5IYzrvYmM126FI6w==',
  hash: 'U16llG3tyXVDT6ChOoE0svqQBPJ1EeH722EGAs64PRw=',
  iterations: 600000,
};

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function derive(password: string, saltB64: string, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64(saltB64) as BufferSource, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

/** Constant-time comparison of the derived hash. */
export async function verifyPassword(password: string, cfg: GateConfig = GATE): Promise<boolean> {
  if (!password) return false;
  const got = await derive(password, cfg.salt, cfg.iterations);
  const want = b64(cfg.hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}
