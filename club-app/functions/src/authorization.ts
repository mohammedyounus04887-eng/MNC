import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

interface AssignmentInput {
    clubId?: unknown;
    uid?: unknown;
    role?: unknown;
    verificationReference?: unknown;
}

/** An operator verifies ownership outside this endpoint; no contact matching. */
export const assignVerifiedClubAdministrator = onCall<AssignmentInput>(async (request) => {
    if (!request.auth || request.auth.token.firebase.sign_in_provider === "anonymous") {
        throw new HttpsError("unauthenticated", "A platform administrator session is required");
    }
    const { clubId, uid, role, verificationReference } = request.data ?? {};
    if (typeof clubId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(clubId) ||
        typeof uid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) ||
        (role !== "owner" && role !== "admin") ||
        typeof verificationReference !== "string" || verificationReference.trim().length < 8 || verificationReference.length > 256) {
        throw new HttpsError("invalid-argument", "An explicit club, Auth UID, administrator role and verification reference are required");
    }
    const db = admin.firestore();
    const platformRef = db.doc(`superAdmins/${request.auth.uid}`);
    const platform = await platformRef.get();
    if (!platform.exists || platform.data()?.enabled === false) throw new HttpsError("permission-denied", "Platform administrator verification is required");
    const target = await admin.auth().getUser(uid);
    if (target.disabled || target.providerData.length === 0) {
        throw new HttpsError("failed-precondition", "Target must be an active, non-anonymous human Auth account");
    }
    const clubRef = db.doc(`clubs/${clubId}`);
    if (!(await clubRef.get()).exists) throw new HttpsError("not-found", "Club does not exist");
    await admin.auth().setCustomUserClaims(uid, { ...target.customClaims, clubId, role, station: false });
    const auditRef = db.collection(`clubs/${clubId}/authorizationAudit`).doc();
    await db.runTransaction(async (transaction) => {
        const currentPlatform = await transaction.get(platformRef);
        if (!currentPlatform.exists || currentPlatform.data()?.enabled === false) throw new HttpsError("permission-denied", "Platform access was revoked");
        const grantRef = db.doc(`clubs/${clubId}/authorizations/${uid}`);
        const previous = await transaction.get(grantRef);
        transaction.set(grantRef, {
            uid, clubId, role, station: false, enabled: true,
            verifiedBy: request.auth!.uid,
            verificationReference: verificationReference.trim(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.set(auditRef, {
            action: "verified-administrator-assignment", uid, clubId, role,
            previousRole: previous.data()?.role ?? null,
            actorUid: request.auth!.uid,
            verificationReference: verificationReference.trim(),
            createdAt: FieldValue.serverTimestamp(),
        });
    });
    return { uid, clubId, role, auditId: auditRef.id, refreshRequired: true };
});
