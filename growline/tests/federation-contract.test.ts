import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { issueFederationAssertion, verifyFederationAssertion, consumeFederationAssertion, federationDigest, type FederationPair, type FederationConfig, type FederationAccount } from "../src/lib/integration/federation-contract";

const now = 1_800_000_000;
const state = "s".repeat(48), verifier = "v".repeat(64);
const pair: FederationPair = { schemaVersion: 1, pairId: "explicit-account-pair", linkId: "active-club-link", status: "active", clubProject: "demo-club-federation", growlineProject: "demo-growline-federation", clubId: "club-a", workspaceId: "workspace-a", clubMemberAuthUid: "member-auth-uid", growlineAuthUid: "coach-auth-uid", epoch: 1, verificationMethod: "dual_authenticated_accounts" };
const accounts: Record<"club" | "growline", FederationAccount> = {
  club: { uid: pair.clubMemberAuthUid, project: pair.clubProject, scopeId: pair.clubId, role: "member", enabled: true, anonymous: false, station: false, authenticatedAt: now - 10, validAfter: 0 },
  growline: { uid: pair.growlineAuthUid, project: pair.growlineProject, scopeId: pair.workspaceId, role: "coach", enabled: true, anonymous: false, station: false, authenticatedAt: now - 10, validAfter: 0 },
};
const config: FederationConfig = { enabled: true, issuer: "growline", audience: "club", clubProject: pair.clubProject, growlineProject: pair.growlineProject, keyId: "federation-test-key", secret: "synthetic-federation-test-key-more-than-32-characters" };
const issue = (c = config, p = pair, a = accounts) => issueFederationAssertion(c, p, a, true, federationDigest(state), federationDigest(verifier), now);
const token = issue();
const verify = (c = config, p = pair, a = accounts, active = true, at = now + 1) => verifyFederationAssertion(token, c, p, a, active, state, verifier, at);

test("SSO exchanges map explicitly verified member/coach UIDs in both directions", () => {
  assert.equal(verify().destinationUid, pair.clubMemberAuthUid);
  const reverse = { ...config, issuer: "club" as const, audience: "growline" as const };
  const claims = verifyFederationAssertion(issue(reverse), reverse, pair, accounts, true, state, verifier, now + 1);
  assert.equal(claims.destinationUid, pair.growlineAuthUid);
  assert.equal(claims.exp - claims.iat, 30);
});
test("SSO is off unless explicitly configured; wrong project/audience/key/signature denied", () => {
  assert.throws(() => issue({ ...config, enabled: false }), /FEDERATION_DISABLED/);
  assert.throws(() => verify({ ...config, enabled: false }), /FEDERATION_DISABLED/);
  for (const wrong of [{ ...config, audience: "growline" as const }, { ...config, clubProject: "wrong-project" }, { ...config, keyId: "wrong-key" }, { ...config, secret: "different-synthetic-key-more-than-32-characters" }]) assert.throws(() => verify(wrong));
});
test("expiry, state and PKCE are required independently", () => {
  assert.throws(() => verify(config, pair, accounts, true, now + 30));
  assert.throws(() => verify(config, pair, accounts, true, now - 1));
  assert.throws(() => verifyFederationAssertion(token, config, pair, accounts, true, "t".repeat(48), verifier, now + 1));
  assert.throws(() => verifyFederationAssertion(token, config, pair, accounts, true, state, "w".repeat(64), now + 1));
  assert.throws(() => issue(config, pair, { ...accounts, growline: { ...accounts.growline, authenticatedAt: now - 301 } }));
});
test("code-issuer/owner/admin/platform/station accounts can never become member SSO targets", () => {
  for (const role of ["owner", "admin", "superAdmin", "reception", "kitchen", "tv"]) assert.throws(() => verify(config, pair, { ...accounts, club: { ...accounts.club, role } }));
  assert.throws(() => verify(config, pair, { ...accounts, club: { ...accounts.club, uid: "club-code-issuer" } }));
  assert.throws(() => verify(config, pair, { ...accounts, club: { ...accounts.club, station: true } }));
});
test("revoked link/pair, logout epoch, wrong Club/workspace and unlinked accounts deny", () => {
  assert.throws(() => verify(config, pair, accounts, false));
  for (const changed of [{ ...pair, status: "revoked" as const }, { ...pair, epoch: 2 }, { ...pair, clubId: "wrong-club" }, { ...pair, workspaceId: "wrong-workspace" }, { ...pair, clubMemberAuthUid: "unlinked-member" }]) assert.throws(() => verify(config, changed));
  assert.throws(() => verify(config, pair, { ...accounts, growline: { ...accounts.growline, validAfter: now } }));
});
test("disabled or anonymous accounts on either side deny", () => {
  for (const app of ["club", "growline"] as const) {
    for (const change of [{ enabled: false }, { anonymous: true }]) assert.throws(() => verify(config, pair, { ...accounts, [app]: { ...accounts[app], ...change } }));
  }
});
test("private profile fields cannot be smuggled into a validly signed exchange", () => {
  const parts = token.split(".");
  const body = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  for (const key of ["email", "phone", "privateNotes", "bodyComposition", "role", "firebaseToken"]) {
    const payload = Buffer.from(JSON.stringify({ ...body, [key]: "forbidden" })).toString("base64url");
    const signed = `${parts[0]}.${payload}.${createHmac("sha256", config.secret).update(`${parts[0]}.${payload}`).digest("base64url")}`;
    assert.throws(() => verifyFederationAssertion(signed, config, pair, accounts, true, state, verifier, now + 1));
  }
});
test("parallel consumption requires exactly one successful atomic claim; lost response cannot replay login", async () => {
  const used = new Set<string>();
  const replayStore = { async consumeOnce(id: string) { if (used.has(id)) throw new Error("FEDERATION_ALREADY_CONSUMED"); used.add(id); } };
  const args = { token, config, pair, accounts, activeLink: true, state, verifier, now: now + 1, replayStore };
  const results = await Promise.allSettled(Array.from({ length: 16 }, () => consumeFederationAssertion(args)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  await assert.rejects(consumeFederationAssertion(args), /FEDERATION_ALREADY_CONSUMED/);
});

test("one-login exchange accepts a live established source session while retaining a 30-second bound assertion", () => {
  const sessionConfig = { ...config, sourceSessionMaxAgeSeconds: 14 * 86400 };
  const established = { ...accounts, growline: { ...accounts.growline, authenticatedAt: now - 3600 } };
  const signed = issue(sessionConfig, pair, established);
  const claims = verifyFederationAssertion(signed, sessionConfig, pair, established, true, state, verifier, now + 1);
  assert.equal(claims.authenticatedAt, now - 3600);
  assert.equal(claims.exp - claims.iat, 30);
  assert.throws(() => issue(sessionConfig, pair, { ...established, growline: { ...established.growline, authenticatedAt: now - 14 * 86400 - 1 } }));
});
test("source-session lifetime cannot exceed the local 14-day maximum or use invalid numeric configuration", () => {
  for (const age of [0, 299, 14 * 86400 + 1, Infinity, 300.5]) assert.throws(() => issue({ ...config, sourceSessionMaxAgeSeconds: age }));
});
