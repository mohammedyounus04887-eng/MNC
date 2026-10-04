import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";

const db = admin.firestore();
const auth = admin.auth();

type StationRole = "reception" | "kitchen" | "tv";

async function isClubAdministrator(uid: string, token: admin.auth.DecodedIdToken, clubId: string): Promise<boolean> {
    if (token.firebase.sign_in_provider === "anonymous") return false;
    const platform = await db.doc(`superAdmins/${uid}`).get();
    if (platform.exists && platform.data()?.enabled !== false) return true;
    if (token.clubId !== clubId || (token.role !== "owner" && token.role !== "admin")) return false;
    const grant = await db.doc(`clubs/${clubId}/authorizations/${uid}`).get();
    const data = grant.data();
    return data?.enabled === true && data.clubId === clubId && data.role === token.role;
}

function validRole(value: unknown): value is StationRole {
    return value === "reception" || value === "kitchen" || value === "tv";
}

export const enrollStation = onCall<{ clubId?: unknown; role?: unknown }>(async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Authentication is required");
    const clubId = typeof request.data?.clubId === "string" ? request.data.clubId.trim() : "";
    const role = request.data?.role;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(clubId) || !validRole(role)) throw new HttpsError("invalid-argument", "clubId and station role are required");
    if (!await isClubAdministrator(request.auth.uid, request.auth.token, clubId)) {
        throw new HttpsError("permission-denied", "Only a club administrator can enroll a station");
    }

    // Each device gets its own revocable principal; never share a role account.
    const stationId = `station_${db.collection("stationIds").doc().id}`;
    const stationUser = await auth.createUser({ uid: stationId, disabled: true });

    await auth.setCustomUserClaims(stationUser.uid, { clubId, role, station: true });
    await db.doc(`clubs/${clubId}/authorizations/${stationUser.uid}`).set({
        uid: stationUser.uid,
        clubId,
        role,
        station: true,
        stationId,
        enabled: true,
        enrolledBy: request.auth.uid,
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const token = await auth.createCustomToken(stationUser.uid, { clubId, role, station: true });
    await auth.updateUser(stationUser.uid, { disabled: false });
    return { stationId, uid: stationUser.uid, token };
});
