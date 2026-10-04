import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import { consumeFederationAssertion, federationDigest, issueFederationAssertion, type FederationAccount, type FederationApp, type FederationConfig, type FederationPair } from "./federation-contract";

type Json = Record<string, unknown>;
export type FederationRuntime = {
  app: FederationApp; enabled: boolean; clubProject: string; growlineProject: string;
  clubOrigin: string; growlineOrigin: string; peerUrl: string; keyId: string; secret: string;
  local: boolean;
};
export const federationObject = (value: unknown): Json => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("FEDERATION_DENIED");
  return value as Json;
};
const denied = (): never => { throw new Error("FEDERATION_DENIED"); };
const text = (value: unknown): string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : denied();
const number = (value: unknown): number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : denied();
const nonce = () => randomBytes(32).toString("hex");
const now = () => Math.floor(Date.now() / 1000);
const peerApp = (app: FederationApp): FederationApp => app === "club" ? "growline" : "club";
const uidOf = (pair: FederationPair, app: FederationApp) => app === "club" ? pair.clubMemberAuthUid : pair.growlineAuthUid;
const scopeOf = (pair: FederationPair, app: FederationApp) => app === "club" ? pair.clubId : pair.workspaceId;
function readPair(raw: unknown): FederationPair {
  const d = federationObject(raw);
  if (d.schemaVersion !== 1 || d.verificationMethod !== "dual_authenticated_accounts" || !["active", "revoked"].includes(String(d.status))) denied();
  return { schemaVersion: 1, verificationMethod: "dual_authenticated_accounts", status: d.status === "active" ? "active" : "revoked",
    pairId: text(d.pairId), linkId: text(d.linkId), clubProject: text(d.clubProject), growlineProject: text(d.growlineProject),
    clubId: text(d.clubId), workspaceId: text(d.workspaceId), clubMemberAuthUid: text(d.clubMemberAuthUid), growlineAuthUid: text(d.growlineAuthUid), epoch: number(d.epoch) };
}
function samePair(a: FederationPair, b: FederationPair) {
  return Object.keys(a).every(key => Reflect.get(a, key) === Reflect.get(b, key));
}
function origins(config: FederationRuntime) {
  for (const raw of [config.clubOrigin, config.growlineOrigin, config.peerUrl]) {
    const url = new URL(raw);
    const demo = config.local && config.clubProject.startsWith("demo-") && config.growlineProject.startsWith("demo-") && url.hostname === "127.0.0.1";
    if ((url.protocol !== "https:" && !(demo && url.protocol === "http:")) || url.username || url.password || url.hash || url.search) denied();
  }
  if (new URL(config.clubOrigin).origin !== config.clubOrigin || new URL(config.growlineOrigin).origin !== config.growlineOrigin || config.clubOrigin === config.growlineOrigin ||
      config.clubProject === config.growlineProject || config.secret.length < 32 || !config.keyId) denied();
}
type PeerCall = (operation: string, payload: Json) => Promise<Json>;

/** Each instance has credentials for ONE project only. Peer calls never carry Firebase credentials. */
export class FederationService {
  private readonly peer: PeerCall;
  constructor(private readonly db: Firestore, private readonly auth: Auth, readonly config: FederationRuntime, peer?: PeerCall) {
    this.peer = peer ?? ((operation, payload) => this.httpPeer(operation, payload));
  }
  private enabled() { if (!this.config.enabled) throw new Error("FEDERATION_DISABLED"); origins(this.config); }
  private ownOrigin() { return this.config.app === "club" ? this.config.clubOrigin : this.config.growlineOrigin; }
  private project() { return this.config.app === "club" ? this.config.clubProject : this.config.growlineProject; }
  private pairRef(pairId: string) { return this.db.doc(`integrationFederationPairs/${text(pairId)}`); }
  private identityRef(uid: string) { return this.db.doc(`integrationFederationIdentities/${federationDigest(text(uid))}`); }
  private async pair(pairId: string) {
    const pair = readPair((await this.pairRef(pairId).get()).data());
    if (pair.status !== "active" || pair.clubProject !== this.config.clubProject || pair.growlineProject !== this.config.growlineProject) denied();
    return pair;
  }
  async ownToken(token: string): Promise<DecodedIdToken> {
    const decoded = await this.auth.verifyIdToken(token, true);
    if (decoded.aud !== this.project() || decoded.firebase.sign_in_provider === "anonymous") denied();
    await requireFederationSession(this.db, decoded);
    return decoded;
  }
  private fresh(decoded: DecodedIdToken) {
    if (decoded.firebase.sign_in_provider === "custom" || decoded.auth_time > now() || now() - decoded.auth_time > 300) denied();
  }
  private async account(uid: string, scopeId: string, authenticatedAt = now()): Promise<FederationAccount> {
    const user = await this.auth.getUser(text(uid));
    const validAfter = Math.floor(Date.parse(user.tokensValidAfterTime ?? "1970-01-01") / 1000);
    if (user.disabled || !user.providerData.length || authenticatedAt <= validAfter || authenticatedAt > now()) denied();
    const claims = user.customClaims ?? {};
    if (this.config.app === "club") {
      const [grant, member, platform, club] = await Promise.all([
        this.db.doc(`clubs/${text(scopeId)}/authorizations/${uid}`).get(), this.db.doc(`clubs/${scopeId}/members/${uid}`).get(),
        this.db.doc(`superAdmins/${uid}`).get(), this.db.doc(`clubs/${scopeId}`).get(),
      ]);
      if (platform.exists || claims.role !== "member" || claims.clubId !== scopeId || claims.station === true ||
          !member.exists || member.get("clubId") !== scopeId || member.get("status") !== "active" || club.get("status") !== "active" ||
          grant.get("enabled") !== true || grant.get("uid") !== uid || grant.get("clubId") !== scopeId || grant.get("role") !== "member" || grant.get("station") === true ||
          typeof grant.get("verifiedBy") !== "string" || !grant.get("verifiedBy") || typeof grant.get("verificationReference") !== "string" || grant.get("verificationReference").trim().length < 8) denied();
    } else {
      const [profile, workspace] = await Promise.all([this.db.doc(`users/${uid}`).get(), this.db.doc(`workspaces/${text(scopeId)}`).get()]);
      if (!profile.exists || profile.get("disabled") === true || profile.get("workspaceId") !== scopeId || !workspace.exists || workspace.get("disabled") === true ||
          [claims.role, profile.get("role")].some(role => role !== undefined && role !== "coach") || claims.admin === true || claims.platformAdmin === true ||
          (process.env.ADMIN_UIDS ?? "").split(",").map(x => x.trim()).includes(uid)) denied();
    }
    return { uid, scopeId, project: this.project(), role: this.config.app === "club" ? "member" : "coach", enabled: true, station: false, anonymous: false, authenticatedAt, validAfter };
  }
  private async activeLink(pair: FederationPair, tx?: Transaction) {
    const ref = this.config.app === "club" ? this.db.doc(`clubs/${pair.clubId}/integrationLinks/${pair.linkId}`) : this.db.doc(`integrationLinks/${pair.linkId}`);
    const snap = tx ? await tx.get(ref) : await ref.get();
    if (snap.get("status") !== "active" || snap.get("clubId") !== pair.clubId || snap.get("workspaceId") !== pair.workspaceId ||
        snap.get("growlineAuthUid") !== pair.growlineAuthUid || snap.get("growlineProject") !== pair.growlineProject ||
        (this.config.app === "growline" && (snap.get("clubProject") !== pair.clubProject || snap.get("verificationMethod") !== "dual_authenticated_consent"))) denied();
  }
  private async audit(tx: Transaction, action: string, pairId: string, uid: string, epoch: number) {
    tx.create(this.db.collection("integrationFederationAudit").doc(), { action, pairId, actorUid: uid, epoch, at: FieldValue.serverTimestamp() });
  }
  private async savePair(pair: FederationPair, prepared: boolean, proof?: { club: number; growline: number }) {
    await this.account(uidOf(pair, this.config.app), scopeOf(pair, this.config.app));
    await this.db.runTransaction(async tx => {
      const ref = this.pairRef(pair.pairId), identity = this.identityRef(uidOf(pair, this.config.app));
      const [existing, reserved] = await Promise.all([tx.get(ref), tx.get(identity)]);
      if (this.config.app === "growline") {
        const intent = await tx.get(this.db.doc(`integrationFederationPairingIntents/${pair.pairId}`));
        if (!intent.exists || intent.get("cancelled") === true) denied();
      }
      const otherId = reserved.get("pairId");
      if (otherId && otherId !== pair.pairId) {
        const old = await tx.get(this.pairRef(text(otherId)));
        if (old.get("status") !== "revoked" || old.get("pendingInvalidation") === true) denied();
      }
      await this.activeLink(pair, tx);
      if (existing.exists) {
        if (!samePair(readPair(existing.data()), pair)) denied();
        if (existing.get("prepared") === false || prepared) return;
      }
      const session = await tx.get(this.db.doc(`integrationFederationSessions/${uidOf(pair, this.config.app)}`));
      const verifiedAuthTimes = existing.get("verifiedAuthTimes") ?? proof;
      if (!verifiedAuthTimes) denied();
      tx.set(ref, { ...pair, prepared, localSessionEpoch: number(session.get("epoch") ?? 0), validAfter: number(session.get("validAfter") ?? 0), verifiedAuthTimes, approvedConsentVersion: "dual-account-pairing-v1", confirmedAt: FieldValue.serverTimestamp() });
      tx.set(identity, { pairId: pair.pairId, uid: uidOf(pair, this.config.app) });
      await this.audit(tx, prepared ? "pair-prepared" : "pair-confirmed", pair.pairId, uidOf(pair, this.config.app), pair.epoch);
    });
  }
  private async livePair(pairId: string) {
    const pair = await this.pair(pairId);
    const stored = await this.pairRef(pairId).get();
    if (stored.get("prepared") !== false || stored.get("pendingInvalidation") === true) denied();
    await this.activeLink(pair);
    return pair;
  }
  private async accounts(pair: FederationPair, authenticatedAt?: number) {
    const own = await this.account(uidOf(pair, this.config.app), scopeOf(pair, this.config.app), authenticatedAt);
    const remote = await this.peer("probe", { pairId: pair.pairId });
    if (!samePair(pair, readPair(remote.pair))) denied();
    const a = federationObject(remote.account);
    const other: FederationAccount = { uid: text(a.uid), scopeId: text(a.scopeId), project: text(a.project), role: String(a.role),
      enabled: a.enabled === true, station: a.station === true, anonymous: a.anonymous === true, authenticatedAt: number(a.authenticatedAt), validAfter: number(a.validAfter) };
    return this.config.app === "club" ? { club: own, growline: other } : { club: other, growline: own };
  }
  private assertionConfig(issuer: FederationApp): FederationConfig {
    return { ...this.config, issuer, audience: peerApp(issuer), sourceSessionMaxAgeSeconds: 14 * 86400 };
  }
  async client(operation: string, raw: unknown, token?: string): Promise<Json> {
    const input = federationObject(raw);
    const fields: Record<string, string[]> = { status: [], propose: ["linkId", "confirm"], reviewProposal: ["proposalId"], confirm: ["proposalId", "confirm", "confirmationDigest"], begin: ["stateHash", "codeChallenge", "clubId"],
      issue: ["pairId", "requestId"], finish: ["requestId", "assertion", "state", "verifier"], logout: [], unlink: [], retryLogout: [] };
    if (!fields[operation] || Object.keys(input).some(key => !fields[operation].includes(key))) denied();
    // Revocation remains usable after the feature is disabled; pairing/exchange fail closed.
    if (operation !== "logout" && operation !== "unlink") this.enabled();
    const anonymous = ["begin", "finish"].includes(operation);
    const decoded = anonymous ? null : await this.ownToken(token ?? "");
    if (operation === "status") {
      const links: Json[] = [];
      if (this.config.app === "growline") {
        const profile = await this.db.doc(`users/${decoded!.uid}`).get();
        const found = await this.db.collection("integrationLinks").where("growlineAuthUid", "==", decoded!.uid).where("workspaceId", "==", profile.get("workspaceId") ?? "").where("status", "==", "active").limit(25).get();
        for (const link of found.docs) links.push({ linkId: link.id, clubId: link.get("clubId"), name: typeof link.get("clubName") === "string" ? link.get("clubName") : link.get("clubId") });
      }
      const pointer = await this.identityRef(decoded!.uid).get();
      if (!pointer.exists) return { paired: false, links };
      const pair = (await this.pairRef(text(pointer.get("pairId"))).get()).data();
      // Repair a lost activation acknowledgement without creating a second pair.
      if (this.config.app === "growline" && pair?.status === "active" && pair?.prepared === true) {
        this.fresh(decoded!);
        await this.peerOperation("activate", { pairId: pair.pairId });
        return { paired: true, pairId: pair.pairId, clubId: pair.clubId, pending: false };
      }
      return { paired: pair?.status === "active" && pair?.prepared === false, pairId: pair?.pairId ?? null, clubId: pair?.clubId ?? null, pending: pair?.pendingInvalidation === true, links };
    }
    if (operation === "propose") {
      if (this.config.app !== "growline" || input.confirm !== true) denied();
      this.fresh(decoded!);
      const identity = await this.identityRef(decoded!.uid).get();
      if (identity.get("pairId")) {
        const prior = await this.pairRef(text(identity.get("pairId"))).get();
        if (prior.get("status") !== "revoked" || prior.get("pendingInvalidation") === true) denied();
      }
      const linkId = text(input.linkId), link = await this.db.doc(`integrationLinks/${linkId}`).get();
      const account = await this.account(decoded!.uid, text(link.get("workspaceId")), decoded!.auth_time);
      const sourceUser = await this.auth.getUser(decoded!.uid);
      const accountLabel = `${sourceUser.displayName?.slice(0, 80) ?? "GrowLine account"} (${sourceUser.email ? sourceUser.email.slice(0, 2) + "***@" + sourceUser.email.split("@")[1] : "phone account"})`;
      const proposalId = nonce(), proposal = { proposalId, linkId, clubId: text(link.get("clubId")), workspaceId: account.scopeId,
        growlineAuthUid: account.uid, growlineProject: this.config.growlineProject, clubProject: this.config.clubProject,
        authenticatedAt: decoded!.auth_time, expiresAt: now() + 300, confirmed: true, accountLabel };
      const probePair: FederationPair = { ...proposal, schemaVersion: 1, verificationMethod: "dual_authenticated_accounts", status: "active", pairId: proposalId, clubMemberAuthUid: "not-yet-paired", epoch: 1 };
      await this.activeLink(probePair);
      const batch = this.db.batch();
      batch.create(this.db.doc(`integrationFederationProposals/${proposalId}`), { ...proposal, expireAt: Timestamp.fromMillis(proposal.expiresAt * 1000) });
      // Minimal durable proof permits cancellation/recovery after transient proposal TTL deletion.
      const { accountLabel: temporaryLabel, ...intent } = proposal;
      void temporaryLabel;
      batch.create(this.db.doc(`integrationFederationPairingIntents/${proposalId}`), intent);
      await batch.commit();
      await this.peer("proposal", proposal);
      return { proposalId, destination: `${this.config.clubOrigin}/federation?proposal=${proposalId}` };
    }
    if (operation === "confirm" || operation === "reviewProposal") {
      if (this.config.app !== "club" || (operation === "confirm" && input.confirm !== true)) denied();
      this.fresh(decoded!);
      const proposalId = text(input.proposalId), snap = await this.db.doc(`integrationFederationProposals/${proposalId}`).get();
      const p = federationObject(snap.data());
      if (number(p.expiresAt) <= now() || p.confirmed !== true || p.clubProject !== this.config.clubProject || p.growlineProject !== this.config.growlineProject) denied();
      await this.account(decoded!.uid, text(p.clubId), decoded!.auth_time);
      const pair: FederationPair = { schemaVersion: 1, verificationMethod: "dual_authenticated_accounts", status: "active", pairId: proposalId,
        linkId: text(p.linkId), clubId: text(p.clubId), workspaceId: text(p.workspaceId), clubProject: this.config.clubProject, growlineProject: this.config.growlineProject,
        clubMemberAuthUid: decoded!.uid, growlineAuthUid: text(p.growlineAuthUid), epoch: 1 };
      const confirmationDigest = federationDigest(`${proposalId}:${pair.clubMemberAuthUid}:${pair.growlineAuthUid}:${pair.clubId}:${pair.workspaceId}`);
      if (operation === "reviewProposal") return { confirmationDigest, sourceUid: pair.growlineAuthUid, sourceLabel: p.accountLabel, clubId: pair.clubId, destinationUid: pair.clubMemberAuthUid };
      if (input.confirmationDigest !== confirmationDigest) denied();
      const proof = { club: decoded!.auth_time, growline: number(p.authenticatedAt) };
      await this.savePair(pair, true, proof);
      await this.peer("prepare", { pair, proposalId, proof });
      await this.savePair(pair, false);
      await this.peer("activate", { pairId: pair.pairId });
      return { paired: true, pairId: pair.pairId };
    }
    if (operation === "begin") {
      const state = input.stateHash, challenge = input.codeChallenge;
      if (typeof state !== "string" || typeof challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) denied();
      const clubId = this.config.app === "club" ? text(input.clubId) : null;
      if (clubId && (await this.db.doc(`clubs/${clubId}`).get()).get("status") !== "active") denied();
      const requestId = nonce();
      await this.db.doc(`integrationFederationRequests/${requestId}`).create({ requestId, audience: this.config.app, clubId, stateHash: state, codeChallenge: challenge, expiresAt: now() + 300, expireAt: Timestamp.fromMillis((now() + 300) * 1000), used: false });
      const origin = this.config.app === "club" ? this.config.growlineOrigin : this.config.clubOrigin;
      return { requestId, sourceOrigin: origin, sourceUrl: `${origin}/federation?request=${requestId}` };
    }
    if (operation === "issue") {
      // Existing independently valid sessions may switch apps; fresh provider sign-in is mandatory for pairing only.
      const pair = await this.livePair(text(input.pairId));
      if (uidOf(pair, this.config.app) !== decoded!.uid) denied();
      const challenge = await this.peer("challenge", { requestId: text(input.requestId) });
      if (challenge.audience !== peerApp(this.config.app) || (challenge.clubId !== null && challenge.clubId !== pair.clubId)) denied();
      const accounts = await this.accounts(pair, decoded!.auth_time);
      const assertion = issueFederationAssertion(this.assertionConfig(this.config.app), pair, accounts, true, String(challenge.stateHash), String(challenge.codeChallenge));
      // Assertion is never sent in a URL. Browser messages carry this one-time, request-bound assertion only.
      return { assertion, requestId: text(input.requestId), destinationOrigin: this.config.app === "club" ? this.config.growlineOrigin : this.config.clubOrigin };
    }
    if (operation === "finish") {
      const assertion = typeof input.assertion === "string" ? input.assertion : denied();
      const state = typeof input.state === "string" ? input.state : denied();
      const verifier = typeof input.verifier === "string" ? input.verifier : denied();
      const requestId = text(input.requestId), ref = this.db.doc(`integrationFederationRequests/${requestId}`);
      const request = federationObject((await ref.get()).data());
      if (request.used !== false || number(request.expiresAt) <= now() || request.audience !== this.config.app || typeof input.assertion !== "string" || typeof input.state !== "string" || typeof input.verifier !== "string" ||
          federationDigest(input.state) !== request.stateHash || federationDigest(input.verifier) !== request.codeChallenge) denied();
      // The signature verifier checks the exact shape, subject and projects; this decode selects a record only.
      let pairId: string;
      try { pairId = text(federationObject(JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString())).pairId); } catch { return denied(); }
      const pair = await this.livePair(pairId);
      if (request.clubId !== null && request.clubId !== pair.clubId) denied();
      const accounts = await this.accounts(pair);
      const config = this.assertionConfig(peerApp(this.config.app));
      const result = await consumeFederationAssertion({ token: assertion, config, pair, accounts, activeLink: true, state, verifier,
        replayStore: { consumeOnce: async (id, claims) => {
          await this.db.runTransaction(async tx => {
            const [used, currentPair, currentRequest] = await Promise.all([tx.get(this.db.doc(`integrationFederationExchanges/${id}`)), tx.get(this.pairRef(pairId)), tx.get(ref)]);
            await this.activeLink(pair, tx);
            if (used.exists || currentRequest.get("used") !== false || !samePair(pair, readPair(currentPair.data())) || currentPair.get("prepared") !== false || currentPair.get("pendingInvalidation") === true || claims.exp <= now()) denied();
            tx.create(this.db.doc(`integrationFederationExchanges/${id}`), { pairId, epoch: pair.epoch, consumedAt: FieldValue.serverTimestamp(), requestId });
            tx.update(ref, { used: true });
            await this.audit(tx, "exchange-consumed", pairId, claims.destinationUid, pair.epoch);
          });
        } } });
      // Recheck local Auth and grants after consumption; a failed mint never makes the assertion reusable.
      await this.account(result.uid, scopeOf(pair, this.config.app));
      const finalPeer = await this.peer("probe", { pairId });
      if (!samePair(pair, readPair(finalPeer.pair))) denied();
      const current = await this.livePair(pairId);
      if (!samePair(pair, current)) denied();
      const session = await this.db.doc(`integrationFederationSessions/${result.uid}`).get();
      const sessionEpoch = number(session.get("epoch") ?? 0);
      const claims: Json = { federationPairId: pairId, federationEpoch: pair.epoch, federationSessionEpoch: sessionEpoch };
      if (this.config.app === "club") Object.assign(claims, { role: "member", clubId: pair.clubId, station: false });
      return { customToken: await this.auth.createCustomToken(result.uid, claims), uid: result.uid };
    }
    if (operation === "logout" || operation === "unlink") return this.invalidate(decoded!.uid, operation);
    if (operation === "retryLogout") return this.flush(decoded!.uid);
    return denied();
  }
  async invalidate(uid: string, action: "logout" | "unlink"): Promise<Json> {
    const pointer = await this.identityRef(uid).get();
    if (!pointer.exists) return { paired: false, propagated: true };
    const pairId = text(pointer.get("pairId")), operationId = nonce(), ref = this.pairRef(pairId);
    await this.db.runTransaction(async tx => {
      const pair = readPair((await tx.get(ref)).data());
      if (uidOf(pair, this.config.app) !== uid) denied();
      const sessionRef = this.db.doc(`integrationFederationSessions/${uid}`), session = await tx.get(sessionRef);
      const sessionEpoch = number(session.get("epoch") ?? 0) + 1, validAfter = now();
      tx.update(ref, { status: action === "unlink" ? "revoked" : pair.status, pendingInvalidation: true, epoch: pair.epoch + 1, localSessionEpoch: sessionEpoch, validAfter });
      tx.set(sessionRef, { epoch: sessionEpoch, validAfter });
      tx.create(this.db.doc(`integrationFederationOutbox/${operationId}`), { operationId, pairId, action, uid, acknowledged: false, localAuthRevoked: false, createdAt: FieldValue.serverTimestamp() });
      await this.audit(tx, action, pairId, uid, pair.epoch + 1);
    });
    await this.revokeAuth(uid);
    await this.db.doc(`integrationFederationOutbox/${operationId}`).update({ localAuthRevoked: true });
    return this.flush(uid);
  }
  async flush(uid: string): Promise<Json> {
    // Fail closed while delivery is pending. No global-logout success is claimed before acknowledgement.
    const pending = await this.db.collection("integrationFederationOutbox").where("uid", "==", uid).where("acknowledged", "==", false).limit(100).get();
    let propagated = true;
    for (const item of pending.docs.filter(x => x.get("acknowledged") !== true)) {
      try {
        if (item.get("localAuthRevoked") === false) {
          await this.revokeAuth(uid);
          await item.ref.update({ localAuthRevoked: true });
        }
        origins(this.config);
        const pair = readPair((await this.pairRef(text(item.get("pairId"))).get()).data());
        const response = await this.peer("invalidate", { operationId: item.id, pairId: pair.pairId, action: item.get("action"), epoch: pair.epoch });
        const epoch = number(response.epoch);
        await this.db.runTransaction(async tx => {
          const ref = this.pairRef(pair.pairId), current = await tx.get(ref);
          const outbox = await tx.get(item.ref);
          if (outbox.get("acknowledged") === true) return;
          // Keep a newer concurrent mutation suspended until its own delivery is acknowledged.
          tx.update(item.ref, { acknowledged: true, acknowledgedAt: FieldValue.serverTimestamp() });
          if (current.get("epoch") === pair.epoch) tx.update(ref, { epoch: Math.max(pair.epoch, epoch), pendingInvalidation: false });
        });
      } catch { propagated = false; }
    }
    const remaining = await this.db.collection("integrationFederationOutbox").where("uid", "==", uid).where("acknowledged", "==", false).limit(1).get();
    return { paired: true, propagated: propagated && remaining.empty };
  }
  async peerOperation(operation: string, input: Json): Promise<Json> {
    if (operation !== "invalidate") this.enabled();
    if (operation === "proposal") {
      if (this.config.app !== "club" || input.confirmed !== true || input.clubProject !== this.config.clubProject || input.growlineProject !== this.config.growlineProject ||
          number(input.expiresAt) <= now() || number(input.expiresAt) > now() + 300 || now() - number(input.authenticatedAt) > 300) denied();
      const allowed = ["proposalId", "linkId", "clubId", "workspaceId", "growlineAuthUid", "growlineProject", "clubProject", "authenticatedAt", "expiresAt", "confirmed", "accountLabel"];
      if (Object.keys(input).some(k => !allowed.includes(k))) denied();
      if (typeof input.accountLabel !== "string" || input.accountLabel.length > 256) denied();
      for (const key of ["proposalId", "linkId", "clubId", "workspaceId", "growlineAuthUid"]) text(input[key]);
      await this.db.doc(`integrationFederationProposals/${text(input.proposalId)}`).create({ ...input, expireAt: Timestamp.fromMillis(number(input.expiresAt) * 1000) });
      return { accepted: true };
    }
    if (operation === "prepare") {
      if (this.config.app !== "growline") denied();
      const pair = readPair(input.pair), proposal = await this.db.doc(`integrationFederationProposals/${text(input.proposalId)}`).get();
      const proof = federationObject(input.proof);
      if (number(proof.growline) !== proposal.get("authenticatedAt") || number(proof.club) > now() || now() - number(proof.club) > 300) denied();
      if (pair.pairId !== input.proposalId || pair.epoch !== 1 || proposal.get("confirmed") !== true || proposal.get("cancelled") === true || number(proposal.get("expiresAt")) <= now() ||
          ["linkId", "clubId", "workspaceId", "growlineAuthUid", "clubProject", "growlineProject"].some(k => Reflect.get(pair, k) !== proposal.get(k))) denied();
      await this.account(pair.growlineAuthUid, pair.workspaceId, number(proposal.get("authenticatedAt")));
      await this.savePair(pair, true, { club: number(proof.club), growline: number(proof.growline) });
      return { prepared: true };
    }
    if (operation === "activate") {
      if (this.config.app !== "growline") denied();
      const pair = await this.pair(text(input.pairId)), remote = await this.peer("probe", { pairId: pair.pairId });
      if (!samePair(pair, readPair(remote.pair))) denied();
      await this.savePair(pair, false);
      return { active: true };
    }
    if (operation === "probe") {
      const pair = await this.livePair(text(input.pairId));
      if ((await this.pairRef(pair.pairId).get()).get("pendingInvalidation") === true) denied();
      return { pair, account: await this.account(uidOf(pair, this.config.app), scopeOf(pair, this.config.app)) };
    }
    if (operation === "challenge") {
      const challenge = federationObject((await this.db.doc(`integrationFederationRequests/${text(input.requestId)}`).get()).data());
      if (challenge.used !== false || number(challenge.expiresAt) <= now() || challenge.audience !== this.config.app) denied();
      return challenge;
    }
    if (operation === "invalidate") {
      const operationId = text(input.operationId), pairId = text(input.pairId), requestedEpoch = number(input.epoch);
      if (input.action !== "logout" && input.action !== "unlink") denied();
      const receipt = this.db.doc(`integrationFederationInvalidations/${operationId}`);
      const result = await this.db.runTransaction(async tx => {
        const ref = this.pairRef(pairId), [prior, record] = await Promise.all([tx.get(receipt), tx.get(ref)]);
        if (!record.exists) {
          // Cancelling an interrupted Club-side prepare must not leave either identity permanently reserved.
          const proposal = await tx.get(this.db.doc(`integrationFederationPairingIntents/${pairId}`));
          if (this.config.app !== "growline" || input.action !== "unlink" || !proposal.exists || proposal.get("confirmed") !== true || proposal.get("proposalId") !== pairId || proposal.get("clubProject") !== this.config.clubProject || proposal.get("growlineProject") !== this.config.growlineProject) denied();
          const uid = text(proposal.get("growlineAuthUid"));
          if (prior.exists) return { epoch: number(prior.get("epoch")), uid, revoke: false };
          tx.update(proposal.ref, { cancelled: true });
          tx.create(receipt, { pairId, epoch: requestedEpoch, action: "unlink", at: FieldValue.serverTimestamp() });
          await this.audit(tx, "pairing-cancelled", pairId, uid, requestedEpoch);
          return { epoch: requestedEpoch, uid, revoke: false };
        }
        const pair = readPair(record.data()), uid = uidOf(pair, this.config.app);
        if (prior.exists) {
          if (prior.get("pairId") !== pairId || prior.get("action") !== input.action) denied();
          return { epoch: number(prior.get("epoch")), uid, revoke: true };
        }
        const sessionRef = this.db.doc(`integrationFederationSessions/${uid}`), session = await tx.get(sessionRef);
        const epoch = Math.max(pair.epoch + 1, requestedEpoch);
        const sessionEpoch = number(session.get("epoch") ?? 0) + 1, validAfter = now();
        tx.update(ref, { epoch, status: input.action === "unlink" ? "revoked" : pair.status, pendingInvalidation: false, localSessionEpoch: sessionEpoch, validAfter });
        tx.set(sessionRef, { epoch: sessionEpoch, validAfter });
        tx.create(receipt, { pairId, epoch, action: input.action, at: FieldValue.serverTimestamp() });
        await this.audit(tx, `peer-${input.action}`, pairId, uid, epoch);
        return { epoch, uid, revoke: true };
      });
      // Re-run revocation on retries if Auth failed after the database commit.
      if (result.revoke) await this.revokeAuth(result.uid);
      return { epoch: result.epoch };
    }
    return denied();
  }
  private signature(body: string) { return createHmac("sha256", this.config.secret).update(body).digest("base64url"); }
  private async revokeAuth(uid: string) {
    try { await this.auth.revokeRefreshTokens(uid); }
    catch (error) {
      // An account that no longer exists cannot authenticate; permission/network failures remain pending.
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "auth/user-not-found") throw error;
    }
  }
  private authenticatedEnvelope(raw: unknown, source: FederationApp, audience: FederationApp, correlation?: string) {
    const envelope = federationObject(raw), body = typeof envelope.body === "string" ? envelope.body : denied();
    if (body.length > 16384 || typeof envelope.signature !== "string") denied();
    const signature = typeof envelope.signature === "string" ? envelope.signature : denied();
    const expected = Buffer.from(this.signature(body)), supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) denied();
    const d = federationObject(JSON.parse(body));
    if (d.purpose !== "federation-rpc-v1" || d.issuer !== source || d.audience !== audience || d.keyId !== this.config.keyId ||
        d.clubProject !== this.config.clubProject || d.growlineProject !== this.config.growlineProject || number(d.exp) <= now() ||
        number(d.exp) - number(d.iat) !== 30 || number(d.iat) > now() || (correlation && d.correlation !== correlation)) denied();
    text(d.requestId);
    return d;
  }
  private envelope(payload: Json, requestId: string, correlation?: string) {
    const body = JSON.stringify({ purpose: "federation-rpc-v1", issuer: this.config.app, audience: peerApp(this.config.app), keyId: this.config.keyId,
      clubProject: this.config.clubProject, growlineProject: this.config.growlineProject, requestId, correlation: correlation ?? null, iat: now(), exp: now() + 30, ...payload });
    return { body, signature: this.signature(body) };
  }
  async rpc(raw: unknown) {
    origins(this.config);
    const d = this.authenticatedEnvelope(raw, peerApp(this.config.app), this.config.app);
    const receipt = this.db.doc(`integrationFederationRpc/${text(d.requestId)}`);
    await receipt.create({ at: FieldValue.serverTimestamp(), expireAt: Timestamp.fromMillis((now() + 86400) * 1000) });
    const result = await this.peerOperation(text(d.operation), federationObject(d.payload));
    return this.envelope({ result }, nonce(), String(d.requestId));
  }
  private async httpPeer(operation: string, payload: Json) {
    origins(this.config);
    const requestId = nonce();
    const response = await fetch(this.config.peerUrl, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(this.envelope({ operation, payload }, requestId)), redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("FEDERATION_PEER_UNAVAILABLE");
    const result = this.authenticatedEnvelope(await response.json(), peerApp(this.config.app), this.config.app, requestId);
    return federationObject(result.result);
  }
  async handle(body: unknown, origin: string | undefined, token: string | undefined): Promise<Json> {
    const input = federationObject(body);
    if (typeof input.body === "string") return this.rpc(input);
    if (!this.config.enabled && input.operation !== "logout" && input.operation !== "unlink") throw new Error("FEDERATION_DISABLED");
    if (origin !== this.ownOrigin() || typeof input.operation !== "string" || Object.keys(input).some(k => !["operation", "payload"].includes(k))) denied();
    return this.client(typeof input.operation === "string" ? input.operation : denied(), input.payload ?? {}, token);
  }
}

/** Enforced on every local server session, including ordinary tokens after an SSO logout. */
export async function requireFederationSession(db: Firestore, decoded: DecodedIdToken) {
  const session = await db.doc(`integrationFederationSessions/${decoded.uid}`).get();
  if (session.exists && decoded.auth_time <= number(session.get("validAfter"))) denied();
  if (decoded.federationPairId !== undefined) {
    const pair = await db.doc(`integrationFederationPairs/${text(decoded.federationPairId)}`).get();
    if (![pair.get("clubProject"), pair.get("growlineProject")].includes(decoded.aud) || pair.get("status") !== "active" || pair.get("prepared") !== false || pair.get("pendingInvalidation") === true ||
        pair.get("epoch") !== decoded.federationEpoch || (session.get("epoch") ?? 0) !== decoded.federationSessionEpoch ||
        (decoded.aud === pair.get("clubProject") ? pair.get("clubMemberAuthUid") : pair.get("growlineAuthUid")) !== decoded.uid) denied();
    if (decoded.aud === pair.get("clubProject")) {
      const clubId = text(pair.get("clubId")), grant = await db.doc(`clubs/${clubId}/authorizations/${decoded.uid}`).get();
      const link = await db.doc(`clubs/${clubId}/integrationLinks/${text(pair.get("linkId"))}`).get();
      if (grant.get("enabled") !== true || grant.get("role") !== "member" || grant.get("station") === true || grant.get("uid") !== decoded.uid || grant.get("clubId") !== clubId || link.get("status") !== "active") denied();
    } else {
      const user = await db.doc(`users/${decoded.uid}`).get(), link = await db.doc(`integrationLinks/${text(pair.get("linkId"))}`).get();
      if (!user.exists || user.get("disabled") === true || user.get("workspaceId") !== pair.get("workspaceId") || link.get("status") !== "active" ||
          (process.env.ADMIN_UIDS ?? "").split(",").map(x => x.trim()).includes(decoded.uid)) denied();
    }
  }
}
