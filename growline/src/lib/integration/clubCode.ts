import { createHash, timingSafeEqual } from "crypto";

export type ClubLinkCode = {
  schemaVersion: 1;
  codeId: string;
  codeHash: string;
  clubId: string;
  issuedByAuthUid: string;
  purpose: "growline_coach_link";
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  revokedAt: string | null;
  createdAt: string;
};

export function hashClubLinkCode(code: string, pepper: string): string {
  return createHash("sha256").update(`${pepper}:${code}`).digest("hex");
}

export function matchesClubLinkCode(code: string, record: ClubLinkCode, pepper: string): boolean {
  if (record.revokedAt || record.usedCount >= record.maxUses || Date.parse(record.expiresAt) <= Date.now()) return false;
  const actual = Buffer.from(hashClubLinkCode(code, pepper), "hex");
  const expected = Buffer.from(record.codeHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A code identifies a destination only; it carries no Club role or privilege. */
export function redeemClubLinkCode(record: ClubLinkCode): ClubLinkCode {
  if (record.revokedAt || record.usedCount >= record.maxUses) throw new Error("CODE_UNAVAILABLE");
  if (Date.parse(record.expiresAt) <= Date.now()) throw new Error("CODE_EXPIRED");
  return { ...record, usedCount: record.usedCount + 1 };
}
