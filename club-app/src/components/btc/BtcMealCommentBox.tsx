/**
 * Coach-only comment list + input for a single meal photo.
 *
 * - Lists existing comments oldest-first
 * - Lets the signed-in coach add a new comment
 * - Each comment shows author + timestamp; author can delete their own
 *
 * Comments are NEVER shown on the customer's own BTC page — this widget
 * is rendered inside BtcCoachCustomerMeals which only renders inside the
 * coach-only folder view.
 */

import { useState } from "react";
import {
    addCoachComment, deleteCoachComment, tsToDate,
    useMealCoachComments,
} from "@/hooks/useBtcChallenges";

const FONT = "'Nunito', sans-serif";

interface Props {
    clubId: string;
    challengeId: string;
    mealId: string;
    coach: { id: string; name: string };
}

export default function BtcMealCommentBox({ clubId, challengeId, mealId, coach }: Props) {
    const { comments, loading } = useMealCoachComments(clubId, challengeId, mealId);
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");

    const send = async () => {
        const trimmed = text.trim();
        if (!trimmed) return;
        setBusy(true);
        setErr("");
        try {
            await addCoachComment(clubId, challengeId, mealId, coach, trimmed);
            setText("");
        } catch (e: any) {
            setErr(e?.message || "Couldn't send comment");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #e2e8f0" }}>
            {loading && comments.length === 0 && (
                <div style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>Loading notes…</div>
            )}
            {!loading && comments.length === 0 && (
                <div style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic", marginBottom: 6 }}>
                    No notes yet. Add the first one below.
                </div>
            )}

            {comments.length > 0 && (
                <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
                    {comments.map(c => {
                        const isMine = c.coachId === coach.id;
                        const dt = tsToDate(c.createdAt as any);
                        return (
                            <div
                                key={c.id}
                                style={{
                                    padding: "6px 8px", borderRadius: 8,
                                    background: isMine ? "#eff6ff" : "#f1f5f9",
                                    border: isMine ? "1px solid #bfdbfe" : "1px solid #e2e8f0",
                                }}
                            >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                                    <div style={{ fontSize: 10, fontWeight: 800, color: "#1e40af" }}>
                                        {isMine ? "You" : c.coachName || "Coach"}
                                    </div>
                                    <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700 }}>
                                        {dt ? dt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                                    </div>
                                </div>
                                <div style={{ fontSize: 12, color: "#0f172a", marginTop: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                    {c.text}
                                </div>
                                {isMine && (
                                    <button
                                        onClick={() => deleteCoachComment(clubId, challengeId, mealId, c.id)}
                                        style={{
                                            marginTop: 4, padding: "2px 6px", border: "none",
                                            background: "transparent", color: "#dc2626",
                                            fontSize: 9, fontWeight: 800, cursor: "pointer", fontFamily: FONT,
                                        }}
                                    >
                                        Delete
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <div style={{ display: "flex", gap: 6 }}>
                <input
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                    placeholder="Add a note for this meal…"
                    disabled={busy}
                    style={{
                        flex: 1, padding: "6px 8px", fontSize: 11,
                        border: "1.5px solid #e2e8f0", borderRadius: 8,
                        fontFamily: FONT, boxSizing: "border-box",
                    }}
                />
                <button
                    onClick={send}
                    disabled={busy || !text.trim()}
                    style={{
                        padding: "6px 12px",
                        background: text.trim() ? "#1e40af" : "#cbd5e1",
                        color: "white", border: "none", borderRadius: 8,
                        fontSize: 11, fontWeight: 800,
                        cursor: text.trim() && !busy ? "pointer" : "not-allowed",
                        fontFamily: FONT,
                    }}
                >
                    {busy ? "…" : "Send"}
                </button>
            </div>
            {err && <div style={{ fontSize: 10, color: "#dc2626", marginTop: 4 }}>{err}</div>}
        </div>
    );
}
