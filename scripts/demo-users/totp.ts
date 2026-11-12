/**
 * Minimal RFC 6238 TOTP (SHA-1, 6 digits, 30 s) for the demo-user scripts.
 * Matches what Supabase Auth and authenticator apps use. Dev tooling only.
 */
import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(key: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return bin.toString().padStart(digits, "0");
}

/** Current TOTP code for a base32 secret. `nowMs` is injectable for tests. */
export function totp(secretBase32: string, nowMs = Date.now(), period = 30): string {
  return hotp(base32Decode(secretBase32), Math.floor(nowMs / 1000 / period));
}

/** Seconds until the current code rolls over. */
export function secondsLeft(nowMs = Date.now(), period = 30): number {
  return period - (Math.floor(nowMs / 1000) % period);
}
