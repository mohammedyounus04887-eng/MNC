import { createHash, createHmac, timingSafeEqual, randomBytes } from "node:crypto";

/** Server-only SSO protocol. It grants no role and does not mint Firebase tokens. */
export type FederationApp = "club" | "growline";
export type FederationPair = {
  schemaVersion: 1; pairId: string; linkId: string; status: "active" | "revoked";
  clubProject: string; growlineProject: string; clubId: string; workspaceId: string;
  clubMemberAuthUid: string; growlineAuthUid: string; epoch: number;
  verificationMethod: "dual_authenticated_accounts";
};
export type FederationAccount = {
  uid: string; project: string; role: string; scopeId: string; enabled: boolean;
  anonymous: boolean; station: boolean; authenticatedAt: number; validAfter: number;
};
export type FederationClaims = {
  schemaVersion: 1; purpose: "account-federation"; issuer: FederationApp; audience: FederationApp;
  pairId: string; linkId: string; epoch: number; clubProject: string; growlineProject: string;
  clubId: string; workspaceId: string; subject: string; destinationUid: string;
  jti: string; iat: number; exp: number; authenticatedAt: number; stateHash: string; codeChallenge: string;
};
export type FederationConfig = {
  enabled: boolean; issuer: FederationApp; audience: FederationApp; clubProject: string; growlineProject: string;
  keyId: string; secret: string;
  sourceSessionMaxAgeSeconds?: number;
};
const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const digest = /^[A-Za-z0-9_-]{43}$/;
export const federationDigest = (value: string) => createHash("sha256").update(value).digest("base64url");
const invalid = (): never => { throw new Error("FEDERATION_DENIED"); };

function configured(config: FederationConfig) {
  if (!config.enabled) throw new Error("FEDERATION_DISABLED");
  if (!["club", "growline"].includes(config.issuer) || !["club", "growline"].includes(config.audience) || config.issuer === config.audience ||
      !id.test(config.clubProject) || !id.test(config.growlineProject) || config.clubProject === config.growlineProject ||
      !id.test(config.keyId) || config.secret.length < 32 ||
      !Number.isSafeInteger(config.sourceSessionMaxAgeSeconds ?? 300) || (config.sourceSessionMaxAgeSeconds ?? 300) < 300 || (config.sourceSessionMaxAgeSeconds ?? 300) > 14 * 86400) throw new Error("FEDERATION_CONFIGURATION_UNAVAILABLE");
}

/** Each server resolves these accounts through its OWN Auth SDK and grants. */
export function requireFederationPair(pair: FederationPair, accounts: Record<FederationApp, FederationAccount>, activeLink: boolean, now: number) {
  if (pair.schemaVersion !== 1 || pair.status !== "active" || pair.verificationMethod !== "dual_authenticated_accounts" || !activeLink ||
      !Number.isSafeInteger(pair.epoch) || pair.epoch < 1 ||
      [pair.pairId, pair.linkId, pair.clubId, pair.workspaceId, pair.clubProject, pair.growlineProject, pair.clubMemberAuthUid, pair.growlineAuthUid].some((value) => !id.test(value)) ||
      pair.clubProject === pair.growlineProject) invalid();
  const club = accounts.club, growline = accounts.growline;
  for (const account of [club, growline]) {
    if (!account.enabled || account.anonymous || account.station || !Number.isSafeInteger(account.authenticatedAt) ||
        !Number.isSafeInteger(account.validAfter) || account.authenticatedAt <= account.validAfter || account.authenticatedAt > now) invalid();
  }
  // An integration Club UID is the code issuer. It is NEVER a member-login UID.
  if (club.uid !== pair.clubMemberAuthUid || club.project !== pair.clubProject || club.role !== "member" || club.scopeId !== pair.clubId ||
      growline.uid !== pair.growlineAuthUid || growline.project !== pair.growlineProject || growline.role !== "coach" || growline.scopeId !== pair.workspaceId) invalid();
}

export function issueFederationAssertion(config: FederationConfig, pair: FederationPair, accounts: Record<FederationApp, FederationAccount>,
  activeLink: boolean, stateHash: string, codeChallenge: string, now = Math.floor(Date.now() / 1000)): string {
  configured(config);
  requireFederationPair(pair, accounts, activeLink, now);
  if (pair.clubProject !== config.clubProject || pair.growlineProject !== config.growlineProject || !digest.test(stateHash) || !digest.test(codeChallenge)) invalid();
  const source = accounts[config.issuer];
  // The broker verifies the source's own live Firebase session. Pairing freshness is enforced separately.
  if (now - source.authenticatedAt > (config.sourceSessionMaxAgeSeconds ?? 300)) invalid();
  const claims: FederationClaims = {
    schemaVersion: 1, purpose: "account-federation", issuer: config.issuer, audience: config.audience,
    pairId: pair.pairId, linkId: pair.linkId, epoch: pair.epoch, clubProject: pair.clubProject, growlineProject: pair.growlineProject,
    clubId: pair.clubId, workspaceId: pair.workspaceId, subject: source.uid, destinationUid: accounts[config.audience].uid,
    jti: randomBytes(24).toString("base64url"), iat: now, exp: now + 30, authenticatedAt: source.authenticatedAt, stateHash, codeChallenge,
  };
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT", kid: config.keyId })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.${createHmac("sha256", config.secret).update(`${header}.${payload}`).digest("base64url")}`;
}

export function verifyFederationAssertion(token: string, config: FederationConfig, pair: FederationPair,
  accounts: Record<FederationApp, FederationAccount>, activeLink: boolean, state: string, verifier: string, now = Math.floor(Date.now() / 1000)): FederationClaims {
  configured(config);
  requireFederationPair(pair, accounts, activeLink, now);
  if (typeof token !== "string" || token.length > 4096 || !/^[A-Za-z0-9_-]{32,128}$/.test(state) || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) invalid();
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) invalid();
  const supplied = Buffer.from(parts[2], "base64url");
  const expected = createHmac("sha256", config.secret).update(`${parts[0]}.${parts[1]}`).digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) invalid();
  let header: unknown, body: unknown;
  try { header = JSON.parse(Buffer.from(parts[0], "base64url").toString()); body = JSON.parse(Buffer.from(parts[1], "base64url").toString()); }
  catch { return invalid(); }
  if (!header || typeof header !== "object" || Array.isArray(header) ||
      Object.keys(header).sort().join(",") !== "alg,kid,typ" || !("alg" in header) || header.alg !== "HS256" || !("typ" in header) || header.typ !== "JWT" || !("kid" in header) || header.kid !== config.keyId ||
      !body || typeof body !== "object" || Array.isArray(body)) invalid();
  const claims = body as Record<string, unknown>;
  const fields = ["schemaVersion", "purpose", "issuer", "audience", "pairId", "linkId", "epoch", "clubProject", "growlineProject", "clubId", "workspaceId", "subject", "destinationUid", "jti", "iat", "exp", "authenticatedAt", "stateHash", "codeChallenge"];
  if (Object.keys(claims).sort().join(",") !== fields.sort().join(",") || claims.schemaVersion !== 1 || claims.purpose !== "account-federation" ||
      claims.issuer !== config.issuer || claims.audience !== config.audience || claims.clubProject !== config.clubProject || claims.growlineProject !== config.growlineProject ||
      pair.clubProject !== config.clubProject || pair.growlineProject !== config.growlineProject || claims.pairId !== pair.pairId || claims.linkId !== pair.linkId ||
      claims.epoch !== pair.epoch || claims.clubId !== pair.clubId || claims.workspaceId !== pair.workspaceId ||
      claims.subject !== accounts[config.issuer].uid || claims.destinationUid !== accounts[config.audience].uid ||
      typeof claims.jti !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(claims.jti) || typeof claims.iat !== "number" || !Number.isSafeInteger(claims.iat) ||
      typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) || claims.exp - claims.iat !== 30 || claims.iat > now || claims.exp <= now ||
      typeof claims.authenticatedAt !== "number" || !Number.isSafeInteger(claims.authenticatedAt) || claims.authenticatedAt <= accounts[config.issuer].validAfter ||
      claims.authenticatedAt > claims.iat || claims.iat - claims.authenticatedAt > (config.sourceSessionMaxAgeSeconds ?? 300) ||
      claims.stateHash !== federationDigest(state) || claims.codeChallenge !== federationDigest(verifier)) invalid();
  return claims as FederationClaims;
}

/** Must be implemented as an atomic create, never a read followed by an upsert. */
export interface FederationReplayStore {
  consumeOnce(id: string, claims: FederationClaims): Promise<void>;
}

export async function consumeFederationAssertion(params: {
  token: string; config: FederationConfig; pair: FederationPair; accounts: Record<FederationApp, FederationAccount>;
  activeLink: boolean; state: string; verifier: string; replayStore: FederationReplayStore; now?: number;
}): Promise<{ uid: string; pairId: string; epoch: number }> {
  const claims = verifyFederationAssertion(params.token, params.config, params.pair, params.accounts, params.activeLink, params.state, params.verifier, params.now);
  await params.replayStore.consumeOnce(federationDigest(`${claims.issuer}:${claims.clubProject}:${claims.growlineProject}:${claims.jti}`), claims);
  return { uid: claims.destinationUid, pairId: claims.pairId, epoch: claims.epoch };
}
