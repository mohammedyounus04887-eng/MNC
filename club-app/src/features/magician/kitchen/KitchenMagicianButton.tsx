import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Order } from "@/types/firestore";
import { useUpdateOrderStatus, useRejectOrder } from "@/hooks/useOrders";
import { useSpeechRecognition } from "../useSpeechRecognition";
import ListeningView from "../ListeningView";
import { speak } from "../queries/tts";

// ─── KitchenMagicianButton ─────────────────────────────────────────────
// Magician variant for the Kitchen Display. Different intent set,
// different state (orders + status mutations), but same listening UX.
//
// Supported commands:
//   "Mark token 42 served" / "Serve 42" / "Done 42"
//   "Reject token 42" / "Reject 42 out of mango"
//   "How many pending?" / "How many orders?"
//   "What's the oldest pending?" / "Oldest order"
//
// All commands execute directly — no review-gallery review step, since
// kitchen staff want speed and the actions are reversible (reject can
// always be re-rejected, serve is the natural end-state).

interface Props {
    clubId: string;
    orders: Order[];        // active orders (pending + preparing)
}

type KitchenIntent =
    | { kind: "serve"; tokenNumber: string }
    | { kind: "serve_by_name"; name: string }
    | { kind: "reject"; tokenNumber: string; reason: string }
    | { kind: "count_pending" }
    | { kind: "count_by_item"; itemQuery: string }
    | { kind: "oldest_pending" };

// Order matters — token form FIRST (more specific), then name form.
const SERVE_TOKEN_RE = /\b(?:mark|serve|served|complete|done|finish(?:ed)?)\s+(?:token\s+|order\s+|number\s+)(\d+)\b/i;
const SERVE_NUMBER_ONLY_RE = /\b(?:mark|serve|served|complete|done|finish(?:ed)?)\s+(\d+)\s+(?:served|done|complete)\b/i;
const SERVE_BY_NAME_RE = /\b(?:mark|serve|served|complete|done|finish(?:ed)?)\s+(.+?)(?:\s+served|\s+done|\s+complete|$)/i;
const REJECT_RE = /\breject(?:ed)?\s+(?:token\s+|order\s+|number\s+)?(\d+)\b(?:\s+(?:because\s+|due to\s+|reason\s+)?(.+?))?$/i;
const COUNT_BY_ITEM_RE = /\bhow many\s+(.+?)\s+(?:shakes?\s+)?(?:are\s+)?(?:pending|left|remaining|in queue|to make|to prepare)\b/i;
const COUNT_RE = /\bhow many\s+(?:pending\s+)?orders?\b/i;
const OLDEST_RE = /\b(what(?:'s)?\s+the\s+oldest|oldest\s+(?:pending|order)|next\s+order)\b/i;

function parseKitchenIntent(transcript: string): KitchenIntent | null {
    const t = transcript.trim();
    let m;

    // Reject (must match before serve-by-name eats "reject ...")
    if ((m = t.match(REJECT_RE))) {
        return { kind: "reject", tokenNumber: m[1], reason: (m[2] || "").trim() };
    }

    // Token-based serves (most specific)
    if ((m = t.match(SERVE_TOKEN_RE))) return { kind: "serve", tokenNumber: m[1] };
    if ((m = t.match(SERVE_NUMBER_ONLY_RE))) return { kind: "serve", tokenNumber: m[1] };

    // Counts before name-serve so "how many mango pending" doesn't match
    // "served (mango) (pending)" path.
    if ((m = t.match(COUNT_BY_ITEM_RE))) {
        const q = m[1].trim().replace(/\b(?:the|all|of)\b/gi, "").trim();
        return { kind: "count_by_item", itemQuery: q };
    }
    if (COUNT_RE.test(t)) return { kind: "count_pending" };
    if (OLDEST_RE.test(t)) return { kind: "oldest_pending" };

    // Name-based serve (least specific — fires when no token/digits at all)
    if ((m = t.match(SERVE_BY_NAME_RE))) {
        const name = m[1].trim();
        // Reject pure-digit captures (already handled above) + filler-only
        if (/^\d+$/.test(name) || /^(?:it|that|this|him|her|them)$/i.test(name)) return null;
        return { kind: "serve_by_name", name };
    }

    return null;
}

function matchOrdersByName(orders: Order[], name: string): Order[] {
    const q = name.toLowerCase().trim();
    if (q.length < 2) return [];
    // Score each order's memberName against the spoken name; tier
    // matches like in the reception matchByName helper.
    const scored: { order: Order; score: number }[] = [];
    for (const o of orders) {
        const n = (o.memberName || "").toLowerCase();
        if (!n) continue;
        const nameWords = n.split(/\s+/);
        let score = 0;
        if (n === q) score = 100;
        else if (nameWords.includes(q)) score = 90;
        else if (n.includes(q)) score = 80;
        else if (nameWords.some((w) => w.startsWith(q))) score = 60;
        if (score > 0) scored.push({ order: o, score });
    }
    if (scored.length === 0) return [];
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0].score;
    return scored.filter((s) => s.score >= top - 10).map((s) => s.order);
}

function matchOrdersByItem(orders: Order[], itemQuery: string): Order[] {
    const q = itemQuery.toLowerCase().trim();
    if (!q) return [];
    return orders.filter((o) => {
        return (o.items as any[] | undefined ?? []).some((it) => {
            const name = (it.productName || it.itemName || "").toLowerCase();
            // Match if the item name contains the spoken word
            return name.includes(q) || q.split(/\s+/).some((w) => w.length > 2 && name.includes(w));
        });
    });
}

function announce(text: string) {
    toast.message(text, { duration: 5000 });
    speak(text);
}

function findOrderByToken(orders: Order[], tokenNumber: string): Order | null {
    // Accept exact match first, then last-digits match (since speech can
    // drop leading zeros: "42" should match token "042").
    const exact = orders.find((o) => String((o as any).tokenNumber) === tokenNumber);
    if (exact) return exact;
    const trimmed = tokenNumber.replace(/^0+/, "");
    return orders.find((o) => String((o as any).tokenNumber).replace(/^0+/, "") === trimmed) ?? null;
}

export default function KitchenMagicianButton({ clubId, orders }: Props) {
    const [open, setOpen] = useState(false);
    const speech = useSpeechRecognition("en-IN");
    const updateStatus = useUpdateOrderStatus();
    const rejectOrder = useRejectOrder();

    useEffect(() => {
        if (!open) return;
        if (!speech.supported) return;
        speech.start();
        return () => speech.stop();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const executeIntent = async (intent: KitchenIntent) => {
        switch (intent.kind) {
            case "serve": {
                const order = findOrderByToken(orders, intent.tokenNumber);
                if (!order) {
                    announce(`No pending order for token ${intent.tokenNumber}`);
                    return;
                }
                try {
                    await updateStatus.mutateAsync({ clubId, orderId: order.id, newStatus: "served" });
                    announce(`Token ${intent.tokenNumber}, ${order.memberName || "guest"}, served`);
                } catch (err: any) {
                    announce(`Failed: ${err?.message ?? "unknown"}`);
                }
                return;
            }
            case "reject": {
                const order = findOrderByToken(orders, intent.tokenNumber);
                if (!order) {
                    announce(`No pending order for token ${intent.tokenNumber}`);
                    return;
                }
                try {
                    await rejectOrder.mutateAsync({
                        clubId, orderId: order.id, rejectedBy: "Kitchen (voice)",
                        reason: intent.reason || undefined,
                    });
                    announce(`Token ${intent.tokenNumber} rejected${intent.reason ? `: ${intent.reason}` : ""}. Credits refunded.`);
                } catch (err: any) {
                    announce(`Failed: ${err?.message ?? "unknown"}`);
                }
                return;
            }
            case "serve_by_name": {
                const matches = matchOrdersByName(orders, intent.name);
                if (matches.length === 0) {
                    announce(`No pending order for ${intent.name}`);
                    return;
                }
                // Multiple pending orders for the same person? Serve them
                // all — common when a member ordered two shakes back-to-back.
                let served = 0;
                for (const o of matches) {
                    try {
                        await updateStatus.mutateAsync({ clubId, orderId: o.id, newStatus: "served" });
                        served++;
                    } catch (err: any) {
                        console.warn("[kitchen serve_by_name]", err);
                    }
                }
                const name = matches[0].memberName || intent.name;
                announce(
                    served === 1
                        ? `${name} served`
                        : `${served} orders for ${name} served`
                );
                return;
            }
            case "count_by_item": {
                const matches = matchOrdersByItem(orders, intent.itemQuery);
                announce(
                    matches.length === 0
                        ? `No pending ${intent.itemQuery}`
                        : `${matches.length} pending ${intent.itemQuery}${matches.length === 1 ? "" : "s"}`
                );
                return;
            }
            case "count_pending":
                announce(`${orders.length} pending order${orders.length === 1 ? "" : "s"}`);
                return;
            case "oldest_pending": {
                if (orders.length === 0) { announce("No pending orders"); return; }
                const oldest = [...orders].sort((a, b) => {
                    const at = (a.createdAt as any)?.toMillis?.() ?? 0;
                    const bt = (b.createdAt as any)?.toMillis?.() ?? 0;
                    return at - bt;
                })[0];
                const item = (oldest.items?.[0] as any)?.productName ?? (oldest.items?.[0] as any)?.itemName ?? "order";
                announce(`Oldest is token ${(oldest as any).tokenNumber}, ${oldest.memberName || "guest"}, ${item}`);
                return;
            }
        }
    };

    const handleDone = async () => {
        speech.stop();
        const transcript = speech.transcript || speech.interimTranscript || "";
        const intent = parseKitchenIntent(transcript);
        if (!intent) {
            announce(`Didn't catch that. Try: "serve token 42" or "how many pending"`);
            setOpen(false);
            return;
        }
        await executeIntent(intent);
        setOpen(false);
    };

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                title="Kitchen Magician — voice commands"
                aria-label="Open Kitchen Magician"
                className="fixed bottom-4 left-4 z-50 w-14 h-14 rounded-full text-white flex items-center justify-center"
                style={{
                    background: "linear-gradient(135deg,#f97316,#dc2626)",
                    boxShadow: "0 6px 18px rgba(220,38,38,0.45)",
                    fontSize: 24, cursor: "pointer", border: "none",
                    animation: "kitchenMagPulse 2.4s ease-in-out infinite",
                }}
            >
                🪄
                <style>{`
                    @keyframes kitchenMagPulse {
                        0%, 100% { box-shadow: 0 6px 18px rgba(220,38,38,0.45); }
                        50%      { box-shadow: 0 6px 22px rgba(220,38,38,0.7), 0 0 0 10px rgba(220,38,38,0.12); }
                    }
                `}</style>
            </button>

            {open && (
                <div style={{
                    position: "fixed", inset: 0, zIndex: 10000,
                    background: "rgba(15,23,42,0.85)", backdropFilter: "blur(8px)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    padding: 20,
                }}>
                    {speech.supported ? (
                        <ListeningView
                            transcript={speech.transcript}
                            interim={speech.interimTranscript}
                            onDone={handleDone}
                            onCancel={() => { speech.stop(); setOpen(false); }}
                        />
                    ) : (
                        <div style={{ background: "white", borderRadius: 14, padding: 30, maxWidth: 460, textAlign: "center", fontFamily: "Nunito, sans-serif" }}>
                            <div style={{ fontSize: 18, fontWeight: 800, color: "#dc2626", marginBottom: 8 }}>Voice not supported</div>
                            <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 18 }}>Open this on Chrome or Edge.</div>
                            <button onClick={() => setOpen(false)} style={{ padding: "8px 20px", background: "#dc2626", color: "white", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Close</button>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
