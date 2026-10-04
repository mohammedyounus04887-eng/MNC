import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { FederationClaims, FederationReplayStore } from "./federation-contract";

/** Prepared destination adapter. No route invokes it or issues a login token. */
export function growlineFederationReplayStore(db: Firestore): FederationReplayStore {
  return {
    async consumeOnce(id, claims: FederationClaims) {
      if (claims.audience !== "growline" || !/^[A-Za-z0-9_-]{43}$/.test(id)) throw new Error("FEDERATION_DENIED");
      const receipt = db.doc(`integrationFederationExchanges/${id}`);
      await db.runTransaction(async (tx) => {
        const [used, pair, link, user, workspace] = await Promise.all([
          tx.get(receipt), tx.get(db.doc(`integrationFederationPairs/${claims.pairId}`)),
          tx.get(db.doc(`integrationLinks/${claims.linkId}`)), tx.get(db.doc(`users/${claims.destinationUid}`)),
          tx.get(db.doc(`workspaces/${claims.workspaceId}`)),
        ]);
        if (used.exists) throw new Error("FEDERATION_ALREADY_CONSUMED");
        const record = pair.data();
        if (!record || record.status !== "active" || record.epoch !== claims.epoch || record.schemaVersion !== 1 ||
            record.verificationMethod !== "dual_authenticated_accounts" || record.clubMemberAuthUid !== claims.subject ||
            record.growlineAuthUid !== claims.destinationUid || record.clubId !== claims.clubId || record.workspaceId !== claims.workspaceId ||
            record.clubProject !== claims.clubProject || record.growlineProject !== claims.growlineProject || record.linkId !== claims.linkId ||
            link.get("status") !== "active" || link.get("clubId") !== claims.clubId || link.get("workspaceId") !== claims.workspaceId ||
            link.get("growlineAuthUid") !== claims.destinationUid || link.get("clubProject") !== claims.clubProject ||
            link.get("growlineProject") !== claims.growlineProject || link.get("verificationMethod") !== "dual_authenticated_consent" ||
            !user.exists || user.get("disabled") === true || user.get("workspaceId") !== claims.workspaceId || !workspace.exists ||
            claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("FEDERATION_DENIED");
        tx.create(receipt, {
          schemaVersion: 1, pairId: claims.pairId, epoch: claims.epoch, issuer: claims.issuer, audience: claims.audience,
          destinationUid: claims.destinationUid, consumedAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(claims.exp * 1000),
        });
      });
    },
  };
}
