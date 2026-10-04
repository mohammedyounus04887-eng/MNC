import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";

/** Called inside the existing verified link-revocation transaction, before its writes. */
export async function invalidateFederationLink(tx: Transaction, db: Firestore, clubId: string, linkId: string, actorUid: string) {
  const pairs = await tx.get(db.collection("integrationFederationPairs").where("clubId", "==", clubId).where("linkId", "==", linkId).where("status", "==", "active").where("prepared", "==", false).limit(2));
  // Each GrowLine UID has one live pair reservation. Refuse inconsistent server data.
  if (pairs.size > 1) throw new Error("FEDERATION_IDENTITY_CONFLICT");
  for (const pair of pairs.docs) {
    const uid: unknown = pair.get("clubMemberAuthUid"), epoch: unknown = pair.get("epoch"), localEpoch: unknown = pair.get("localSessionEpoch");
    if (typeof uid !== "string" || typeof epoch !== "number" || !Number.isSafeInteger(epoch) || typeof localEpoch !== "number" || !Number.isSafeInteger(localEpoch)) throw new Error("FEDERATION_DENIED");
    tx.update(pair.ref, { status: "revoked", epoch: epoch + 1, localSessionEpoch: localEpoch + 1, validAfter: Math.floor(Date.now() / 1000), pendingInvalidation: true });
    tx.create(db.collection("integrationFederationAudit").doc(), { pairId: pair.id, actorUid, action: "club-link-revoked", epoch: epoch + 1, at: FieldValue.serverTimestamp() });
    const outbox = db.collection("integrationFederationOutbox").doc();
    tx.create(outbox, { operationId: outbox.id, pairId: pair.id, action: "unlink", uid, acknowledged: false, createdAt: FieldValue.serverTimestamp() });
  }
}
