import { randomBytes } from "crypto";

/**
 * The report link travels over WhatsApp to a prospect who has no account, so the
 * token is the only thing protecting it. ~130 bits of randomness, URL-safe, no
 * lookalike characters — never sequential or derived from the prospect.
 */
const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";
const TOKEN_LENGTH = 26; // 26 * log2(33) ≈ 131 bits
// Largest multiple of the alphabet size that fits in a byte; bytes at or above
// it are rejected so every character is drawn uniformly (no modulo bias).
const UNBIASED_LIMIT = 256 - (256 % ALPHABET.length);

export function newReportToken(): string {
  let out = "";
  while (out.length < TOKEN_LENGTH) {
    for (const byte of randomBytes(TOKEN_LENGTH)) {
      if (byte >= UNBIASED_LIMIT) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === TOKEN_LENGTH) break;
    }
  }
  return out;
}

export function isValidReportToken(token: string): boolean {
  return (
    token.length === TOKEN_LENGTH && [...token].every((ch) => ALPHABET.includes(ch))
  );
}
