/**
 * Scanner Test — what is the reader actually sending?
 *
 * When a scan "does nothing" there are four different failures that look
 * identical from the outside, and guessing between them wastes an afternoon:
 *
 *   1. The reader isn't in keyboard mode      -> no characters arrive at all
 *   2. It sends no terminator, or sends Tab   -> characters arrive, never commit
 *   3. The QR isn't one of our cards          -> wrong text arrives
 *   4. The card is fine but the member isn't
 *      in this club                           -> right id, no match
 *
 * This page shows the raw keystrokes as they land, so the failure names
 * itself. Nothing here writes to Firestore — it is safe to leave open.
 */

import { useEffect, useRef, useState } from "react";
import { useClubContext } from "@/lib/clubDetection";
import { useClubMembers } from "@/hooks/useOwner";
import { parseCardCode, CARD_PREFIX } from "@/lib/qrScan";

interface Line {
    at: string;
    raw: string;
    terminator: string;
    parsedId: string | null;
    member: string | null;
    gapMs: number;
}

export default function ScannerTestPage() {
    const { club } = useClubContext();
    const { data: members } = useClubMembers();

    const [lines, setLines] = useState<Line[]>([]);
    const [buf, setBuf] = useState("");
    const [keyCount, setKeyCount] = useState(0);
    const bufRef = useRef("");
    const lastAt = useRef(0);
    const startAt = useRef(0);
    const membersRef = useRef<any[]>([]);
    membersRef.current = members ?? [];

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const now = Date.now();
            setKeyCount(n => n + 1);

            if (now - lastAt.current > 400) {
                bufRef.current = "";
                startAt.current = now;
            }
            lastAt.current = now;

            if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const raw = bufRef.current;
                bufRef.current = "";
                setBuf("");
                if (!raw) return;
                const id = parseCardCode(raw);
                const m = id ? membersRef.current.find((x: any) => x.id === id) : null;
                setLines(prev => [{
                    at: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
                    raw,
                    terminator: e.key,
                    parsedId: id,
                    member: m ? (m.name || "(unnamed)") : null,
                    gapMs: now - startAt.current,
                }, ...prev].slice(0, 12));
                return;
            }

            if (e.key.length === 1) {
                bufRef.current += e.key;
                setBuf(bufRef.current);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    /** Nothing has arrived at all — the most important case to spot. */
    const nothingYet = keyCount === 0;

    const commitBuffer = () => {
        const raw = bufRef.current;
        bufRef.current = "";
        setBuf("");
        if (!raw) return;
        const id = parseCardCode(raw);
        const m = id ? membersRef.current.find((x: any) => x.id === id) : null;
        setLines(prev => [{
            at: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
            raw,
            terminator: "(none — committed by hand)",
            parsedId: id,
            member: m ? (m.name || "(unnamed)") : null,
            gapMs: 0,
        }, ...prev].slice(0, 12));
    };

    return (
        <div className="p-4 sm:p-6 max-w-3xl">
            <h1 className="text-xl font-black tracking-tight">Scanner Test</h1>
            <p className="mt-1 mb-5 text-sm text-muted-foreground">
                Scan a member's QR with the reader. Nothing here is saved — it only shows what arrives.
            </p>

            {/* live buffer */}
            <div className="rounded-2xl border-2 border-dashed p-5">
                <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Characters arriving
                </div>
                <div className="mt-2 min-h-[2.25rem] break-all font-mono text-lg font-black">
                    {buf || <span className="text-muted-foreground/50">— nothing yet —</span>}
                </div>
                {buf && (
                    <button
                        onClick={commitBuffer}
                        className="mt-3 rounded-lg border px-3 py-1.5 text-xs font-bold hover:bg-muted"
                    >
                        Reader sent no Enter? Commit this by hand
                    </button>
                )}
            </div>

            {/* the four failures, named */}
            <div className="mt-4 rounded-xl border p-4 text-sm">
                {nothingYet ? (
                    <div>
                        <div className="font-black text-amber-600">Nothing has arrived yet.</div>
                        <p className="mt-1 text-muted-foreground">
                            Scan now. If the box above stays empty, the reader is not acting as a
                            keyboard — it is in a serial or HID-POS mode. Fix it by scanning the
                            <b> "USB HID Keyboard" </b> barcode in the reader's manual, then try again.
                            Click this page once first so it has focus.
                        </p>
                    </div>
                ) : (
                    <div>
                        <div className="font-black text-emerald-600">
                            The reader is typing — {keyCount} key{keyCount === 1 ? "" : "s"} received.
                        </div>
                        <p className="mt-1 text-muted-foreground">
                            So it is in keyboard mode. Check a row below to see how far it got.
                        </p>
                    </div>
                )}
            </div>

            {/* results */}
            <div className="mt-5 grid gap-2">
                {lines.length === 0 && !nothingYet && (
                    <div className="rounded-xl border border-dashed py-6 text-center text-sm text-muted-foreground">
                        Characters are arriving but no scan has completed — the reader is probably
                        sending no Enter. Use the button above to confirm that is the only problem.
                    </div>
                )}
                {lines.map((l, i) => {
                    const isCard = !!l.parsedId;
                    const found = !!l.member;
                    return (
                        <div
                            key={i}
                            className={`rounded-xl border-l-4 p-3 ${
                                found ? "border-l-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
                                : isCard ? "border-l-amber-500 bg-amber-50 dark:bg-amber-950/40"
                                : "border-l-red-500 bg-red-50 dark:bg-red-950/40"
                            }`}
                        >
                            <div className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                                <span>{l.at}</span>
                                <span>terminator: <b>{l.terminator}</b></span>
                                {l.gapMs > 0 && <span>took {l.gapMs}ms</span>}
                            </div>
                            <div className="mt-1 break-all font-mono text-sm font-bold">{l.raw}</div>
                            <div className="mt-2 text-sm font-bold">
                                {found ? (
                                    <span className="text-emerald-700 dark:text-emerald-300">
                                        ✅ Works — this is {l.member}. Scanning at Reception will open them.
                                    </span>
                                ) : isCard ? (
                                    <span className="text-amber-700 dark:text-amber-300">
                                        ⚠️ Read correctly, but no member with this id is in {club?.name || "this club"}.
                                        The card belongs to another club, or the member was deleted.
                                    </span>
                                ) : (
                                    <span className="text-red-700 dark:text-red-300">
                                        ❌ Not one of our cards — it does not start with <code>{CARD_PREFIX}</code>.
                                        {l.raw.length < 4 && " It is also very short, so the reader may be cutting it off."}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
