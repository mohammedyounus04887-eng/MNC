import {
    addDoc, collection, doc, getDoc, getDocs, increment, query, serverTimestamp,
    setDoc, Timestamp, updateDoc, where, writeBatch,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { getNextOrderNumber } from "@/utils/orderNumber";
import { logInvoice } from "@/utils/invoice";
import type { User as Member, Product } from "@/types/firestore";
import type { ConfirmedAction } from "./types";
import { playBirthdaySong, isBirthdayToday } from "@/features/birthday/birthdaySong";

// ─── Magician submit — mirrors Reception's manual flows ────────────────
// CRITICAL: every write here is a one-for-one copy of what Reception.tsx
// does when a receptionist clicks (attendance: lines 720-767, order:
// lines 798-843 of Reception.tsx). Magician is purely a different input
// surface — the data shape, fields, and side effects MUST match so the
// member dashboard, kitchen display, awards, and TV display all behave
// identically whether the receptionist clicked or spoke.
//
// If Reception's flows change, this file must change in lockstep.

const today = () => new Date().toISOString().slice(0, 10);

// ─── attendance ─────────────────────────────────────────────────────────

async function markAttendanceVoice(args: {
    clubId: string;
    member: Member;
    asVolunteer?: boolean;       // also write a type=volunteer attendance doc
}): Promise<{ already: boolean }> {
    const { clubId, member, asVolunteer } = args;
    const td = today();
    const attRef = doc(db, "clubs", clubId, "members", member.id, "attendance", td);
    const existing = await getDoc(attRef);
    if (existing.exists()) {
        // Even if regular attendance already exists, the volunteer write
        // is still useful (independent doc, different type). Fall through.
        if (!asVolunteer) return { already: true };
    }

    const nowTs = Timestamp.now();
    const photo = (member as any).photoUrl || member.photo || "";

    await Promise.all([
        setDoc(attRef, {
            userId: member.id,
            userName: member.name || "",
            userPhoto: photo,
            clubId,
            type: "member",
            checkInTime: nowTs,
            checkOutTime: null,
            hoursWorked: null,
            checkInMethod: "voice",
            date: td,
        }),
        updateDoc(doc(db, "clubs", clubId, "members", member.id), {
            lastVisit: td,
        }),
        // TV display broadcast — non-fatal
        setDoc(doc(db, "clubs", clubId, "recentCheckin", "latest"), {
            memberId: member.id,
            memberCode: member.memberId || "",
            memberName: member.name || "",
            memberPhoto: photo,
            totalVisits: ((member as any).totalVisits || 0) + 1,
            orderedItems: [],
            isBirthday: isBirthdayToday((member as any).dob),
            checkedInAt: serverTimestamp(),
        }).catch((e) => console.error("[magician] recentCheckin write failed", e)),
    ]);

    if (isBirthdayToday((member as any).dob)) {
        try { playBirthdaySong(); } catch (e) { console.warn("[magician birthday]", e); }
    }

    // Optional volunteer attendance write — mirrors useCheckInVolunteer in
    // src/hooks/useAttendance.ts. Separate doc, type="volunteer", so the
    // volunteer-hours queries pick it up without affecting the regular
    // member attendance doc.
    if (asVolunteer) {
        const volAttId = "att_vol_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
        const photoForVol = (member as any).photoUrl || member.photo || "";
        await setDoc(doc(db, "clubs", clubId, "members", member.id, "attendance", volAttId), {
            id: volAttId,
            userId: member.id,
            userName: member.name || "",
            userPhoto: photoForVol,
            clubId,
            type: "volunteer",
            checkInTime: Timestamp.now(),
            checkOutTime: null,
            hoursWorked: null,
            checkInMethod: "voice",
            date: td,
        });
    }

    return { already: false };
}

// ─── order ──────────────────────────────────────────────────────────────

async function placeOrderVoice(args: {
    clubId: string;
    member: Member;
    item: Product;
}): Promise<{ tokenNumber: string }> {
    const { clubId, member, item } = args;

    const memberRef = doc(db, "clubs", clubId, "members", member.id);
    const [memberSnap, tokenNumber] = await Promise.all([
        getDoc(memberRef),
        getNextOrderNumber(clubId),
    ]);

    const currentCredits: number = (memberSnap.data() as any)?.shakeCredits ?? 0;
    const totalShakes = 1;
    const GRACE_LIMIT = -5;
    if ((currentCredits - totalShakes) < GRACE_LIMIT) {
        throw new Error(
            currentCredits <= GRACE_LIMIT
                ? `${member.name}: no shake credits remaining`
                : `${member.name}: only ${currentCredits - GRACE_LIMIT} credit${currentCredits - GRACE_LIMIT !== 1 ? "s" : ""} left`
        );
    }

    const price = (item as any).price || 0;
    const photo = (member as any).photoUrl || member.photo || "";
    const batch = writeBatch(db);

    batch.update(memberRef, { shakeCredits: increment(-totalShakes) });

    const txRef = doc(collection(db, "clubs", clubId, "members", member.id, "transactions"));
    batch.set(txRef, {
        type: "shake_credit",
        amount: totalShakes,
        reason: "shake_order",
        description: `Voice order: ${item.name}`,
        creditsAfter: currentCredits - totalShakes,
        createdAt: serverTimestamp(),
    });

    const orderRef = doc(collection(db, "clubs", clubId, "orders"));
    batch.set(orderRef, {
        memberId: member.id,
        memberName: member.name || "",
        memberPhoto: photo,
        items: [{
            itemName: item.name,
            productName: item.name,
            qty: 1,
            quantity: 1,
            price,
            pricePerUnit: price,
            notes: "",
            itemId: item.id,
            productId: item.id,
        }],
        totalAmount: price,
        totalCost: price,
        status: "pending",
        source: "reception",
        paymentMethod: "shake_credits",
        creditsUsed: totalShakes,
        tokenNumber,
        date: today(),
        clubId,
        createdAt: serverTimestamp(),
    });

    // Limited specials: decrement remainingStock
    if ((item as any).stockType === "limited") {
        batch.update(doc(db, "clubs", clubId, "todaysSpecial", item.id), {
            remainingStock: increment(-1),
        });
    }

    await batch.commit();

    // Invoice — best-effort, matches Reception's pattern
    try {
        await logInvoice(clubId, member.id, {
            type: "shake_order",
            title: `Shake — ${item.name}`,
            items: [{ description: item.name, qty: 1, rate: price, amount: price }],
            paymentMethod: "wallet",
        } as any);
    } catch (e) { console.warn("[magician] invoice write failed", e); }

    return { tokenNumber };
}

// ─── orchestration ──────────────────────────────────────────────────────
// Given the receptionist-approved actions, expand couple choices into
// concrete (member × action) pairs and execute sequentially. Sequential
// is intentional — order writes touch member.shakeCredits with increment(),
// and back-to-back orders for the same member would race on the read.

// ─── first day (Magician) ──────────────────────────────────────────────
// Mirrors the manual First Day flow in Reception.tsx lines 5722-5754:
// (1) addGuestEntry equivalent — creates kitchen order + guestEntry doc
// (2) update with firstDay flag, count, invitedBy
// We avoid invoking the useAddGuestEntry hook directly because hooks
// can't be called outside React. The submit path here writes the same
// fields directly so the manual + voice flows produce identical docs.

async function submitFirstDayVoice(args: {
    clubId: string;
    name: string;
    phone: string;
    faceFile: File | null;        // null when "mark_again" reuses prior photo
    inviter: Member | null;
    staffId: string;
}): Promise<void> {
    const { clubId, name, phone, faceFile, inviter, staffId } = args;
    const today = new Date().toISOString().slice(0, 10);

    // Existing first-day count for this phone (used to populate the doc's
    // firstDayCountAtEntry — same field the manual form sets).
    const existingSnap = await getDocs(
        query(collection(db, `clubs/${clubId}/guestEntries`),
            where("guestPhone", "==", phone))
    );
    const priorCount = existingSnap.docs.map((d) => d.data() as any).filter((d) => d.firstDay === true).length;

    // Upload the face if we have one (Firebase Storage — same path the
    // manual guest wizard uses so the kitchen / today drawer pick it up).
    const entryId = "guest_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    let photoUrl = "";
    if (faceFile) {
        const storageRef = ref(storage, `clubs/${clubId}/guests/${entryId}_0`);
        await uploadBytes(storageRef, faceFile);
        photoUrl = await getDownloadURL(storageRef);
    }

    // Tokens + order doc — kitchen reads this list
    const tokenNumber = await import("@/utils/orderNumber").then((m) => m.getNextOrderNumber(clubId));
    const orderId = "guest_ord_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);

    const batch = writeBatch(db);

    // Kitchen order
    batch.set(doc(db, `clubs/${clubId}/orders`, orderId), {
        id: orderId,
        memberId: "guest",
        memberName: name,
        memberPhoto: photoUrl,
        clubId,
        staffId,
        items: [{
            productId: "first_day_shake",
            productName: "First Day Shake",
            itemName: "First Day Shake",
            quantity: 1,
            qty: 1,
            pricePerUnit: 0,
            price: 0,
            notes: "First Day complimentary",
        }],
        totalCost: 0,
        totalAmount: 0,
        paymentMethod: "guest_credit",
        orderedFrom: "magician_first_day",
        source: "guest",
        walletDeducted: false,
        creditsUsed: 0,
        status: "pending",
        rating: null,
        ratingNote: null,
        tokenNumber,
        date: today,
        createdAt: Timestamp.now(),
        servedAt: null,
    });

    // Guest entry doc
    const entryData: Record<string, any> = {
        id: entryId,
        clubId,
        guestName: name,
        guestPhone: phone,
        type: "unpaid",
        items: [{
            type: "shake",
            productId: "first_day_shake",
            productName: "First Day Shake",
            qty: 1,
            unitPrice: 0,
            total: 0,
            faceUrls: photoUrl ? [photoUrl] : [],
            orderIds: [orderId],
            tokenNumbers: [tokenNumber],
        }],
        totalAmount: 0,
        orderIds: [orderId],
        tokenNumbers: [tokenNumber],
        date: today,
        recordedBy: "magician_first_day",
        createdAt: Timestamp.now(),
        firstDay: true,
        firstDayCountAtEntry: priorCount + 1,
    };
    if (photoUrl) entryData.guestPhoto = photoUrl;
    if (inviter) {
        entryData.invitedBy = {
            memberId: inviter.memberId || inviter.id,
            name: inviter.name || "",
            phone: inviter.phone || null,
        };
    }
    batch.set(doc(db, `clubs/${clubId}/guestEntries`, entryId), entryData);

    await batch.commit();
}

// ─── volunteer sign-out (Bye X / Sign out X) ──────────────────────────
// Closes today's open volunteer attendance record(s) for the member by
// setting checkOutTime + hoursWorked. Mirrors useCheckOutVolunteer in
// src/hooks/useAttendance.ts. Idempotent.

export async function signOutVolunteerVoice(args: {
    clubId: string;
    member: Member;
}): Promise<{ already: boolean; hoursWorked: number }> {
    const { clubId, member } = args;
    const td = today();
    const { getDocs, query, collection, where, updateDoc } = await import("firebase/firestore");

    const snap = await getDocs(
        query(
            collection(db, `clubs/${clubId}/members/${member.id}/attendance`),
            where("date", "==", td),
            where("type", "==", "volunteer"),
        )
    );
    const openRecords = snap.docs.filter((d) => !(d.data() as any).checkOutTime);
    if (openRecords.length === 0) return { already: true, hoursWorked: 0 };

    let totalHours = 0;
    for (const rec of openRecords) {
        const data = rec.data() as any;
        const checkIn = data.checkInTime?.toDate?.() ?? new Date(data.checkInTime);
        const now = new Date();
        const hours = Math.round(((now.getTime() - checkIn.getTime()) / 3600000) * 100) / 100;
        await updateDoc(rec.ref, {
            checkOutTime: Timestamp.now(),
            hoursWorked: hours,
        });
        totalHours += hours;
    }
    return { already: false, hoursWorked: totalHours };
}

// ─── orchestration ──────────────────────────────────────────────────────
// Given the receptionist-approved actions, expand couple choices into
// concrete (member × action) pairs and execute sequentially. Sequential
// is intentional — order writes touch member.shakeCredits with increment(),
// and back-to-back orders for the same member would race on the read.

export interface SubmitResult {
    successCount: number;
    skippedCount: number;
    failures: { memberName: string; reason: string }[];
}

export async function submitMagicianActions(args: {
    clubId: string;
    confirmed: ConfirmedAction[];
    members: Member[];
    staffId: string;
}): Promise<SubmitResult> {
    const { clubId, confirmed, members, staffId } = args;
    const byId = new Map(members.map((m) => [m.id, m]));

    let successCount = 0;
    let skippedCount = 0;
    const failures: { memberName: string; reason: string }[] = [];

    // Handle first-day rows separately — they bypass the member queue.
    for (const c of confirmed) {
        if (c.action !== "first_day" || !c.firstDay) continue;
        const fd = c.firstDay;
        try {
            await submitFirstDayVoice({
                clubId,
                name: fd.name,
                phone: fd.phoneDigits,
                faceFile: fd.capturedFile ?? null,
                inviter: fd.inviterMatch,
                staffId,
            });
            successCount++;
        } catch (err: any) {
            failures.push({ memberName: fd.name || "guest", reason: err?.message ?? String(err) });
        }
    }

    // Expand couple choices into concrete (member, action) pairs.
    interface Concrete { member: Member; action: "attendance" | "order" | "both"; item: Product | null; asVolunteer?: boolean; }
    const queue: Concrete[] = [];

    for (const c of confirmed) {
        if (c.action === "first_day") continue;  // handled above
        if (!c.memberMatch) continue;
        const targets: Member[] = [];
        if (c.coupleChoice === "partner") {
            const partner = c.memberMatch.couplePartnerId
                ? byId.get(c.memberMatch.couplePartnerId)
                : null;
            if (partner) targets.push(partner);
        } else if (c.coupleChoice === "both") {
            targets.push(c.memberMatch);
            const partner = c.memberMatch.couplePartnerId
                ? byId.get(c.memberMatch.couplePartnerId)
                : null;
            if (partner) targets.push(partner);
        } else {
            // "self" or undefined (no couple)
            targets.push(c.memberMatch);
        }
        for (const t of targets) {
            queue.push({ member: t, action: c.action as any, item: c.itemMatch, asVolunteer: c.asVolunteer });
        }
    }

    for (const job of queue) {
        try {
            if (job.action === "attendance" || job.action === "both") {
                const res = await markAttendanceVoice({ clubId, member: job.member, asVolunteer: job.asVolunteer });
                if (res.already && job.action === "attendance") skippedCount++;
                else if (!res.already) successCount++;
            }
            if (job.action === "order" || job.action === "both") {
                if (!job.item) {
                    failures.push({ memberName: job.member.name || "?", reason: "no shake selected" });
                    continue;
                }
                await placeOrderVoice({ clubId, member: job.member, item: job.item });
                successCount++;
            }
        } catch (err: any) {
            failures.push({ memberName: job.member.name || "?", reason: err?.message ?? String(err) });
        }
    }

    return { successCount, skippedCount, failures };
}
