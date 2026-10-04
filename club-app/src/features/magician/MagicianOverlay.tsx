import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { toast } from "sonner";
import { db } from "@/lib/firebase";
import type { User as Member, Product } from "@/types/firestore";
import type { ConfirmedAction, ParsedAction } from "./types";
import { parseMagicianTranscript, parseQueryIntent, __internal as parserInternal } from "./parser";
import { executeQuery } from "./queries/handlers";
import { useSpeechRecognition } from "./useSpeechRecognition";
import ListeningView from "./ListeningView";
import ReviewGalleryView from "./ReviewGalleryView";
import { submitMagicianActions } from "./submitActions";
import { logMagicianSession } from "./auditLog";
import FaceAutoCapture from "@/features/faceCapture/FaceAutoCapture";
import FaceVerification from "@/components/FaceVerification";
import { useAccountants, useMembershipPlansLive, useUpiAccounts, useInventoryProductsLive, useInventoryManagers } from "./payment/useAccountants";
import { executePaymentIntent } from "./payment/handlers";
import { useTeams } from "@/features/teams/useTeams";
import { parseArrivalIntent, parseVolunteerSignOutIntent } from "./arrivalParser";
import { signOutVolunteerVoice } from "./submitActions";
import { getMemberPreference, getHistoryShakeForToday, resolveProduct } from "./arrivals";

interface Props {
    open: boolean;
    onClose: () => void;
    clubId: string;
    receptionistId: string;
    receptionistName: string;
    members: Member[];
    todaysSpecials: Product[];
    // Callbacks for voice queries that need to open something in Reception
    onOpenTodayReport: () => void;
    onOpenMemberProfile: (memberId: string) => void;
    onPrintTodayReport: () => void;
}

type Stage = "listening" | "reviewing" | "submitting" | "verifying_accountant" | "verifying_inventory";

// ─── MagicianOverlay ───────────────────────────────────────────────────
// State machine for one voice session:
//   listening → done → parse → reviewing → submit
//      ├─ if no paid rows: execute → close
//      └─ if paid rows: verifying_accountant → on verify → execute → close
//
// One accountant verify covers ALL paid rows in the batch (matches manual
// flow where the accountant face-verifies once for a session of items).

export default function MagicianOverlay({
    open, onClose, clubId, receptionistId, receptionistName,
    members, todaysSpecials,
    onOpenTodayReport, onOpenMemberProfile, onPrintTodayReport,
}: Props) {
    const speech = useSpeechRecognition("en-IN");
    const [stage, setStage] = useState<Stage>("listening");
    const [actions, setActions] = useState<ParsedAction[]>([]);
    const [frozenTranscript, setFrozenTranscript] = useState("");
    const [captureForRowId, setCaptureForRowId] = useState<string | null>(null);
    const [pendingConfirmed, setPendingConfirmed] = useState<ConfirmedAction[] | null>(null);
    const [accountantVerifier, setAccountantVerifier] = useState<{ id: string; name: string } | null>(null);

    const { accountants } = useAccountants(clubId);
    const { plans } = useMembershipPlansLive(clubId);
    const upiAccounts = useUpiAccounts(clubId);
    const { products: inventory } = useInventoryProductsLive(clubId);
    const inventoryManagers = useInventoryManagers(clubId);
    const { teams } = useTeams(clubId, members);

    // Start listening when the overlay opens
    useEffect(() => {
        if (!open) return;
        if (!speech.supported) return;
        setStage("listening");
        setActions([]);
        setFrozenTranscript("");
        setCaptureForRowId(null);
        setPendingConfirmed(null);
        speech.start();
        return () => speech.stop();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const productsForMatcher = useMemo(() => todaysSpecials.map((p): Product => ({
        id: p.id,
        clubId,
        name: (p as any).name || (p as any).itemName || "",
        category: (p as any).category || "shake",
        price: (p as any).price ?? 0,
        stock: (p as any).stock ?? 0,
        lowStockThreshold: (p as any).lowStockThreshold ?? 0,
    } as Product)), [todaysSpecials, clubId]);

    const membersForMatcher = useMemo(() => members.filter((m) => !!m.memberId), [members]);

    const runDuplicateChecks = async (initialActions: ParsedAction[]): Promise<ParsedAction[]> => {
        const updated = await Promise.all(initialActions.map(async (a) => {
            if (a.action !== "first_day" || !a.firstDay) return a;
            const phone = a.firstDay.phoneDigits;
            if (phone.length < 5) return a;
            try {
                const snap = await getDocs(
                    query(collection(db, `clubs/${clubId}/guestEntries`),
                        where("guestPhone", "==", phone))
                );
                const firstDays = snap.docs.map((d) => d.data() as any).filter((d) => d.firstDay === true);
                if (firstDays.length === 0) return a;
                const lastDate = firstDays.map((d) => d.date).sort().pop() || "";
                const lastEntry = firstDays.find((d) => d.date === lastDate);
                return {
                    ...a,
                    firstDay: {
                        ...a.firstDay,
                        existingMatch: {
                            date: lastDate,
                            entryId: lastEntry?.id || "",
                            count: firstDays.length,
                        },
                    },
                };
            } catch (err) {
                console.warn("[magician] duplicate check failed", err);
                return a;
            }
        }));
        return updated;
    };

    const handleDone = async () => {
        speech.stop();
        const transcript = speech.transcript || speech.interimTranscript || "";
        setFrozenTranscript(transcript);

        // Check for a query FIRST — questions short-circuit the review
        // gallery and execute their read-only handler directly.
        const queryIntent = parseQueryIntent({
            transcript, members: membersForMatcher, products: productsForMatcher, plans,
        });
        if (queryIntent) {
            await executeQuery(queryIntent, {
                clubId,
                callbacks: {
                    onOpenTodayReport,
                    onOpenMemberProfile,
                    onPrintTodayReport,
                },
            });
            onClose();
            return;
        }

        // Volunteer sign-out: "Bye Sujata" / "Sign out Sujata" / "Sujata is leaving"
        // Closes today's open volunteer attendance record. No review card —
        // fires immediately, speaks the hours worked, closes the overlay.
        const signOut = parseVolunteerSignOutIntent({
            transcript,
            members: membersForMatcher,
            teams,
            matchByName: parserInternal.matchByName,
            matchMemberByDigits: (d: string) => parserInternal.matchMember(d, membersForMatcher),
        });
        if (signOut) {
            const lines: string[] = [];
            for (const { member } of signOut) {
                try {
                    const res = await signOutVolunteerVoice({ clubId, member });
                    if (res.already) {
                        lines.push(`${member.name?.split(" ")[0]}: no open volunteer session`);
                    } else {
                        lines.push(`${member.name?.split(" ")[0]} signed out · ${res.hoursWorked}h`);
                    }
                } catch (err: any) {
                    lines.push(`${member.name?.split(" ")[0]}: failed (${err?.message ?? "error"})`);
                }
            }
            toast.success(`👋 ${lines.join(" · ")}`);
            onClose();
            return;
        }

        // Arrival intent: "Vignesh has arrived" / "Team A arrived without X but Y wants Z"
        // Bypasses the regular parser; builds cards from each resolution with
        // preferences (or history fallback) applied.
        const arrival = parseArrivalIntent({
            transcript,
            members: membersForMatcher,
            teams,
            matchByName: parserInternal.matchByName,
            matchMemberByDigits: (d: string) => parserInternal.matchMember(d, membersForMatcher),
        });
        if (arrival) {
            const arrivalCards = await buildArrivalCards(arrival.resolutions, arrival.unresolved);
            setActions(arrivalCards);
            setStage("reviewing");
            return;
        }

        const result = parseMagicianTranscript({
            transcript,
            members: membersForMatcher,
            products: productsForMatcher,
            plans,
            inventory,
        });
        const withDupes = await runDuplicateChecks(result.actions);
        setActions(withDupes);
        setStage("reviewing");
    };

    // Resolve each arrival → ParsedAction. Shake precedence:
    // explicit override > saved preference > history fallback > none (attendance only).
    const buildArrivalCards = async (
        resolutions: { member: Member; overrideShakeName?: string; asVolunteer?: boolean }[],
        unresolved: { spoken: string; candidates: Member[] }[],
    ): Promise<ParsedAction[]> => {
        const out: ParsedAction[] = [];
        for (const [i, r] of resolutions.entries()) {
            const m = r.member;
            let product = null as Product | null;
            if (r.overrideShakeName) {
                // Try to match the override name against today's specials / menu
                product = resolveProduct(
                    { productId: null, productName: r.overrideShakeName },
                    productsForMatcher,
                    productsForMatcher,
                );
            }
            if (!product) {
                const pref = getMemberPreference(m);
                if (pref) product = resolveProduct(pref, productsForMatcher, productsForMatcher);
            }
            if (!product) {
                const hist = await getHistoryShakeForToday(clubId, m.id);
                if (hist) product = resolveProduct(hist, productsForMatcher, productsForMatcher);
            }
            out.push({
                id: `mg_arr_${i}_${m.id}`,
                rawSegment: `arrival: ${m.name}`,
                memberIdSpoken: m.name || m.memberId || "",
                memberMatch: m,
                action: product ? "both" : "attendance",
                itemName: product?.name ?? null,
                itemMatch: product,
                status: m.couplePartnerId ? "needs_couple" : "ready",
                asVolunteer: r.asVolunteer ?? false,
            });
        }
        // Render unresolved (ambiguous name) entries as "needs_member" cards
        for (const [j, u] of unresolved.entries()) {
            out.push({
                id: `mg_arr_un_${j}_${u.spoken}`,
                rawSegment: `arrival (ambiguous): ${u.spoken}`,
                memberIdSpoken: u.spoken,
                memberMatch: null,
                candidates: u.candidates,
                action: "both",
                itemName: null,
                itemMatch: null,
                status: "needs_member",
            });
        }
        return out;
    };

    const handleCancel = () => {
        speech.stop();
        onClose();
    };

    // After verify (or directly if no paid rows), run all handlers.
    const runAllHandlers = async (
        confirmed: ConfirmedAction[],
        verifierName: string,
        inventoryVerifier?: { id: string; name: string },
    ) => {
        setStage("submitting");
        let paidSuccess = 0;
        const paidFailures: { name: string; reason: string }[] = [];

        for (const c of confirmed) {
            if (!c.payment) continue;
            try {
                await executePaymentIntent(c.payment, {
                    clubId, verifierName, upiAccounts,
                }, inventoryVerifier);
                paidSuccess++;
            } catch (err: any) {
                const name = "member" in c.payment.payload ? c.payment.payload.member.name
                    : "buyer" in c.payment.payload ? c.payment.payload.buyer.name : "—";
                paidFailures.push({ name: name || "?", reason: err?.message ?? String(err) });
            }
        }

        // Run non-paid (attendance/order/first_day) via existing submitter
        const nonPaid = confirmed.filter((c) => !c.payment);
        let nonPaidSuccess = 0;
        let nonPaidSkipped = 0;
        const nonPaidFailures: { memberName: string; reason: string }[] = [];
        if (nonPaid.length > 0) {
            try {
                const res = await submitMagicianActions({
                    clubId, confirmed: nonPaid, members: membersForMatcher,
                    staffId: receptionistId,
                });
                nonPaidSuccess = res.successCount;
                nonPaidSkipped = res.skippedCount;
                nonPaidFailures.push(...res.failures);
            } catch (err: any) {
                nonPaidFailures.push({ memberName: "?", reason: err?.message ?? String(err) });
            }
        }

        // Audit
        void logMagicianSession({
            clubId, receptionistId, receptionistName,
            rawTranscript: frozenTranscript, parsed: actions, confirmed,
            skippedCount: nonPaidSkipped,
        });

        const totalSuccess = paidSuccess + nonPaidSuccess;
        const totalFailures = paidFailures.length + nonPaidFailures.length;
        toast.success(`✨ Magician — ${totalSuccess} done${nonPaidSkipped > 0 ? ` · ${nonPaidSkipped} already checked in` : ""}${totalFailures > 0 ? ` · ${totalFailures} failed` : ""}`);
        for (const f of paidFailures.slice(0, 5)) toast.error(`${f.name}: ${f.reason}`);
        for (const f of nonPaidFailures.slice(0, 5)) toast.error(`${f.memberName}: ${f.reason}`);
        onClose();
    };

    const handleSubmit = async (confirmed: ConfirmedAction[]) => {
        const needsVerify = confirmed.some((c) =>
            c.payment && c.payment.payload.kind !== "day_redeem"
        );
        if (!needsVerify) {
            await runAllHandlers(confirmed, receptionistName);
            return;
        }
        if (accountants.length === 0) {
            toast.error("No accountants enrolled — paid actions need one");
            return;
        }
        setPendingConfirmed(confirmed);
        setStage("verifying_accountant");
    };

    // Helper: does the batch include any product_sale rows?
    const batchNeedsInventoryVerify = (rows: ConfirmedAction[]) =>
        rows.some((c) => c.payment?.payload.kind === "product_sale");

    if (!open) return null;

    if (!speech.supported) {
        return (
            <Backdrop>
                <div style={{ background: "white", borderRadius: 14, padding: 30, maxWidth: 460, textAlign: "center", fontFamily: "Nunito, sans-serif" }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#dc2626", marginBottom: 8 }}>
                        Voice not supported
                    </div>
                    <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 18 }}>
                        Magician needs the browser's speech recognition (Chrome or Edge). This browser doesn't expose it.
                    </div>
                    <button
                        onClick={onClose}
                        style={{ padding: "8px 20px", background: "#7c3aed", color: "white", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                    >
                        Close
                    </button>
                </div>
            </Backdrop>
        );
    }

    const captureRow = actions.find((a) => a.id === captureForRowId);

    return (
        <>
            <Backdrop>
                {stage === "listening" && (
                    <ListeningView
                        transcript={speech.transcript}
                        interim={speech.interimTranscript}
                        onDone={handleDone}
                        onCancel={handleCancel}
                    />
                )}
                {(stage === "reviewing" || stage === "submitting") && (
                    <ReviewGalleryView
                        transcript={frozenTranscript}
                        actions={actions}
                        setActions={setActions}
                        members={membersForMatcher}
                        products={productsForMatcher}
                        upiAccounts={upiAccounts}
                        submitting={stage === "submitting"}
                        onCancel={handleCancel}
                        onSubmit={handleSubmit}
                        onCaptureFirstDayFace={(id) => setCaptureForRowId(id)}
                    />
                )}
            </Backdrop>

            <FaceAutoCapture
                open={captureForRowId !== null}
                title={`Capture ${captureRow?.firstDay?.name || "guest"}'s face`}
                subtitle="Hold the camera at face height. Snaps automatically."
                onCapture={(file, dataUrl) => {
                    if (!captureForRowId) return;
                    setActions((prev) => prev.map((a) => a.id === captureForRowId
                        ? { ...a, firstDay: { ...(a.firstDay as any), capturedFile: file, capturedDataUrl: dataUrl } }
                        : a));
                    setCaptureForRowId(null);
                }}
                onCancel={() => setCaptureForRowId(null)}
            />

            {/* Accountant face-verify for paid intents */}
            {stage === "verifying_accountant" && pendingConfirmed && (
                <FaceVerification
                    clubId={clubId}
                    verifiers={accountants.map((a) => ({
                        id: a.id, name: a.name, photo: a.photo,
                        faceDescriptor: a.faceDescriptor, role: a.role,
                    }))}
                    title="Accountant verification"
                    subtitle="Verify to authorize the paid actions below"
                    onVerified={async (verifier) => {
                        // If the batch contains a product sale, chain into
                        // the inventory-manager verify before executing.
                        if (batchNeedsInventoryVerify(pendingConfirmed)) {
                            setAccountantVerifier(verifier);
                            setStage("verifying_inventory");
                        } else {
                            await runAllHandlers(pendingConfirmed, verifier.name);
                            setPendingConfirmed(null);
                        }
                    }}
                    onCancel={() => {
                        setStage("reviewing");
                        setPendingConfirmed(null);
                    }}
                />
            )}

            {/* Inventory-manager verify (chained after accountant for product sales) */}
            {stage === "verifying_inventory" && pendingConfirmed && accountantVerifier && (
                <FaceVerification
                    clubId={clubId}
                    verifiers={(inventoryManagers.length > 0 ? inventoryManagers : accountants).map((a) => ({
                        id: a.id, name: a.name, photo: a.photo,
                        faceDescriptor: a.faceDescriptor, role: a.role,
                    }))}
                    title="Inventory manager verification"
                    subtitle="Second approval needed for product sales"
                    onVerified={async (invVerifier) => {
                        await runAllHandlers(pendingConfirmed, accountantVerifier.name, invVerifier);
                        setPendingConfirmed(null);
                        setAccountantVerifier(null);
                    }}
                    onCancel={() => {
                        setStage("reviewing");
                        setPendingConfirmed(null);
                        setAccountantVerifier(null);
                    }}
                />
            )}
        </>
    );
}

function Backdrop({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(15, 23, 42, 0.78)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20,
        }}>
            {children}
        </div>
    );
}
