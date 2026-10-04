// Push notifications via FCM. Helpers for sending, plus Firestore triggers
// that fire on the events the member dashboard cares about.

import * as admin from "firebase-admin";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";

const FN_OPTS = { region: "us-central1", maxInstances: 10 } as const;

interface NotificationPayload {
    title: string;
    body: string;
    /** Path to navigate to when the user taps the notification (e.g. "/member/dashboard"). */
    url?: string;
    /** Used as the notification `tag` so repeat alerts collapse instead of stacking. */
    tag?: string;
}

/**
 * Send a notification to a single member. Fans out to all device tokens
 * stored on `clubs/{clubId}/members/{memberId}.fcmTokens`. Invalid tokens
 * (uninstalled apps, revoked permission) are cleaned up automatically.
 */
async function sendToMember(
    clubId: string,
    memberId: string,
    payload: NotificationPayload,
): Promise<void> {
    const memberRef = admin.firestore().doc(`clubs/${clubId}/members/${memberId}`);
    const snap = await memberRef.get();
    if (!snap.exists) return;
    const data = snap.data() || {};
    if (data.notificationsEnabled === false) return;

    const tokens: string[] = Array.isArray(data.fcmTokens) ? data.fcmTokens : [];
    if (tokens.length === 0) return;

    await sendToTokens(tokens, payload, async (invalid) => {
        if (invalid.length === 0) return;
        await memberRef.update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(...invalid),
        });
    });
}

/**
 * Broadcast to every member of a club who has notifications enabled.
 * Used for announcements + early-bird photo posts.
 */
async function sendToAllClubMembers(
    clubId: string,
    payload: NotificationPayload,
): Promise<void> {
    const membersSnap = await admin
        .firestore()
        .collection(`clubs/${clubId}/members`)
        .where("notificationsEnabled", "==", true)
        .get();

    if (membersSnap.empty) return;

    // Map token → memberId so we can prune invalid tokens from the right doc.
    const tokenToMember = new Map<string, string>();
    for (const memberDoc of membersSnap.docs) {
        const tokens: string[] = (memberDoc.data().fcmTokens ?? []) as string[];
        for (const t of tokens) tokenToMember.set(t, memberDoc.id);
    }
    const allTokens = Array.from(tokenToMember.keys());
    if (allTokens.length === 0) return;

    await sendToTokens(allTokens, payload, async (invalid) => {
        if (invalid.length === 0) return;
        // Group invalid tokens by owning member doc, then arrayRemove in one update each.
        const grouped = new Map<string, string[]>();
        for (const tok of invalid) {
            const mid = tokenToMember.get(tok);
            if (!mid) continue;
            const arr = grouped.get(mid) ?? [];
            arr.push(tok);
            grouped.set(mid, arr);
        }
        await Promise.all(
            Array.from(grouped.entries()).map(([memberId, toks]) =>
                admin.firestore().doc(`clubs/${clubId}/members/${memberId}`).update({
                    fcmTokens: admin.firestore.FieldValue.arrayRemove(...toks),
                }),
            ),
        );
    });
}

/** Low-level: send to a list of tokens, cleaning up failures. */
async function sendToTokens(
    tokens: string[],
    payload: NotificationPayload,
    cleanup: (invalidTokens: string[]) => Promise<void>,
): Promise<void> {
    // FCM caps multicast at 500 tokens per call.
    const CHUNK = 500;
    const invalid: string[] = [];

    for (let i = 0; i < tokens.length; i += CHUNK) {
        const chunk = tokens.slice(i, i + CHUNK);
        try {
            const res = await admin.messaging().sendEachForMulticast({
                tokens: chunk,
                notification: { title: payload.title, body: payload.body },
                data: {
                    ...(payload.url ? { url: payload.url } : {}),
                    ...(payload.tag ? { tag: payload.tag } : {}),
                },
                webpush: {
                    fcmOptions: { link: payload.url || "/member/dashboard" },
                    notification: {
                        icon: "/pwa-192x192.png",
                        badge: "/pwa-192x192.png",
                        tag: payload.tag || "mnc-notification",
                    },
                },
            });
            res.responses.forEach((r, idx) => {
                if (!r.success) {
                    const code = r.error?.code || "";
                    // Tokens that should be removed from Firestore
                    if (
                        code === "messaging/invalid-registration-token" ||
                        code === "messaging/registration-token-not-registered" ||
                        code === "messaging/invalid-argument"
                    ) {
                        invalid.push(chunk[idx]);
                    } else {
                        logger.warn("FCM send error (kept)", { code, error: r.error?.message });
                    }
                }
            });
        } catch (err) {
            logger.error("FCM multicast failed", err);
        }
    }

    try {
        await cleanup(invalid);
    } catch (err) {
        logger.warn("Token cleanup failed", err);
    }
}

// ─────────────────────────────────────────────────────────────────
// TRIGGERS
// ─────────────────────────────────────────────────────────────────

/**
 * A — B — C: shake order status changes.
 * pending → preparing  ⇒ "Your shake is being prepared"
 * preparing → served   ⇒ "Your shake is ready!"
 * any → rejected       ⇒ "Order rejected — credits refunded"
 */
export const onOrderStatusChange = onDocumentUpdated(
    { document: "clubs/{clubId}/orders/{orderId}", ...FN_OPTS },
    async (event) => {
        const before = event.data?.before.data();
        const after = event.data?.after.data();
        if (!before || !after) return;
        if (before.status === after.status) return;
        const memberId: string = after.memberId;
        if (!memberId) return;
        const clubId = event.params.clubId;

        let payload: NotificationPayload | null = null;

        if (after.status === "preparing") {
            payload = {
                title: "🥤 Order accepted",
                body: `${itemSummary(after)} is being prepared.`,
                url: "/member/orders",
                tag: `order-${event.params.orderId}`,
            };
        } else if (after.status === "served") {
            payload = {
                title: "✅ Your shake is ready!",
                body: `${itemSummary(after)} — pick it up at the counter.`,
                url: "/member/orders",
                tag: `order-${event.params.orderId}`,
            };
        } else if (after.status === "rejected") {
            const reason: string | undefined = after.rejectReason;
            payload = {
                title: "Order rejected",
                body: reason ? `Reason: ${reason}. Credits refunded.` : "Credits refunded.",
                url: "/member/orders",
                tag: `order-${event.params.orderId}`,
            };
        }

        if (!payload) return;
        await sendToMember(clubId, memberId, payload);
    },
);

/**
 * D — E: wallet top-up request resolved.
 */
export const onTopupRequestUpdate = onDocumentUpdated(
    { document: "clubs/{clubId}/topupRequests/{requestId}", ...FN_OPTS },
    async (event) => {
        const before = event.data?.before.data();
        const after = event.data?.after.data();
        if (!before || !after) return;
        if (before.status === after.status) return;
        const memberId: string = after.memberId;
        if (!memberId) return;
        const clubId = event.params.clubId;

        if (after.status === "approved") {
            const amount: number = after.approvedAmount ?? after.amount ?? after.requestedAmount ?? 0;
            await sendToMember(clubId, memberId, {
                title: "✅ Top-up approved",
                body: `₹${amount.toLocaleString("en-IN")} added to your wallet.`,
                url: "/member/wallet",
                tag: `topup-${event.params.requestId}`,
            });
        } else if (after.status === "rejected") {
            const reason: string | undefined = after.rejectionReason;
            await sendToMember(clubId, memberId, {
                title: "Top-up rejected",
                body: reason ? `Reason: ${reason}` : "Please ask reception for details.",
                url: "/member/wallet",
                tag: `topup-${event.params.requestId}`,
            });
        }
    },
);

/**
 * F — G: purchase request fulfilled or rejected.
 */
export const onPurchaseRequestUpdate = onDocumentUpdated(
    { document: "clubs/{clubId}/purchaseRequests/{requestId}", ...FN_OPTS },
    async (event) => {
        const before = event.data?.before.data();
        const after = event.data?.after.data();
        if (!before || !after) return;
        if (before.status === after.status) return;
        const memberId: string = after.memberId;
        if (!memberId) return;
        const clubId = event.params.clubId;

        if (after.status === "fulfilled") {
            const total: number = after.totalAmount ?? 0;
            const itemCount: number = Array.isArray(after.items) ? after.items.length : 0;
            await sendToMember(clubId, memberId, {
                title: "✅ Purchase complete",
                body: `₹${total.toLocaleString("en-IN")} paid · ${itemCount} item${itemCount !== 1 ? "s" : ""} applied.`,
                url: "/member/wallet",
                tag: `preq-${event.params.requestId}`,
            });
        } else if (after.status === "rejected") {
            await sendToMember(clubId, memberId, {
                title: "Request rejected",
                body: after.rejectionReason || "Reception rejected your purchase request.",
                url: "/member/dashboard",
                tag: `preq-${event.params.requestId}`,
            });
        }
    },
);

/**
 * K: announcement posted → broadcast to all members.
 */
export const onAnnouncementCreate = onDocumentCreated(
    { document: "clubs/{clubId}/announcements/{announcementId}", ...FN_OPTS },
    async (event) => {
        const data = event.data?.data();
        if (!data) return;
        if (data.isActive === false) return; // skip drafts
        const clubId = event.params.clubId;
        const title = data.title || "📣 Announcement";
        const body = (data.message || "").toString().slice(0, 180);
        await sendToAllClubMembers(clubId, {
            title,
            body,
            url: "/member/announcements",
            tag: `ann-${event.params.announcementId}`,
        });
    },
);

/**
 * L: early-bird photo uploaded → broadcast.
 */
export const onEarlyBirdCreate = onDocumentCreated(
    { document: "clubs/{clubId}/earlyBird/{date}", ...FN_OPTS },
    async (event) => {
        const data = event.data?.data();
        if (!data) return;
        const clubId = event.params.clubId;
        await sendToAllClubMembers(clubId, {
            title: "🐦 Early Birds Today",
            body: "See who showed up first this morning.",
            url: "/member/dashboard",
            tag: `earlyBird-${event.params.date}`,
        });
    },
);

// ─── helpers ─────────────────────────────────────────────────────────

function itemSummary(order: admin.firestore.DocumentData): string {
    const items: any[] = Array.isArray(order.items) ? order.items : [];
    if (items.length === 0) return "Your order";
    const first = items[0]?.productName || items[0]?.name || "Your shake";
    if (items.length === 1) return first;
    return `${first} +${items.length - 1} more`;
}
