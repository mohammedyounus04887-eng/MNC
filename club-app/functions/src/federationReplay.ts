import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { FederationClaims, FederationReplayStore } from "./federationContract";

/** Prepared destination adapter; not exported as a callable or enabled endpoint. */
export function clubFederationReplayStore(db: Firestore): FederationReplayStore {
  return {
    async consumeOnce(id, claims: FederationClaims) {
      if (claims.audience !== "club" || !/^[A-Za-z0-9_-]{43}$/.test(id)) throw new Error("FEDERATION_DENIED");
      const receipt = db.doc(`integrationFederationExchanges/${id}`);
      await db.runTransaction(async (tx) => {
        const [used, pair, link, grant, member] = await Promise.all([
          tx.get(receipt), tx.get(db.doc(`integrationFederationPairs/${claims.pairId}`)),
          tx.get(db.doc(`clubs/${claims.clubId}/integrationLinks/${claims.linkId}`)),
          tx.get(db.doc(`clubs/${claims.clubId}/authorizations/${claims.destinationUid}`)),
          tx.get(db.doc(`clubs/${claims.clubId}/members/${claims.destinationUid}`)),
        ]);
        if (used.exists) throw new Error("FEDERATION_ALREADY_CONSUMED");
        const record = pair.data();
        if (!record || record.status !== "active" || record.epoch !== claims.epoch || record.schemaVersion !== 1 ||
            record.verificationMethod !== "dual_authenticated_accounts" || record.clubMemberAuthUid !== claims.destinationUid ||
            record.growlineAuthUid !== claims.subject || record.clubId !== claims.clubId || record.workspaceId !== claims.workspaceId ||
            record.clubProject !== claims.clubProject || record.growlineProject !== claims.growlineProject || record.linkId !== claims.linkId ||
            link.get("status") !== "active" || link.get("clubId") !== claims.clubId || link.get("workspaceId") !== claims.workspaceId ||
            link.get("growlineAuthUid") !== claims.subject || link.get("growlineProject") !== claims.growlineProject ||
            grant.get("enabled") !== true || grant.get("uid") !== claims.destinationUid || grant.get("clubId") !== claims.clubId ||
            grant.get("role") !== "member" || grant.get("station") === true || !member.exists || member.get("clubId") !== claims.clubId ||
            member.get("status") !== "active" || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("FEDERATION_DENIED");
        tx.create(receipt, {
          schemaVersion: 1, pairId: claims.pairId, epoch: claims.epoch, issuer: claims.issuer, audience: claims.audience,
          destinationUid: claims.destinationUid, consumedAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(claims.exp * 1000),
        });
      });
    },
  };
}
