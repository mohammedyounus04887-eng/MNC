/**
 * Club Network — member hierarchy.
 *
 *   • Tree view: a top-down family tree on a pan / zoom / drag canvas
 *     (custom — no extra dependency). Each node = a member or a placeholder.
 *   • Grid view: photo / name / mobile / member-ID cards.
 *   • Per-node actions: Add existing member, Add placeholder, Move, Delete.
 *
 * Placeholders represent historical people not in the system. Re-parenting a
 * real member is an owner edit guarded against cycles; "Delete" on a real
 * member only DETACHES them from the network (never deletes the account).
 */

import { useMemo, useRef, useState } from "react";
import { useClubContext } from "@/lib/clubDetection";
import {
    useMemberHierarchy, reparentMember, detachMember,
    addPlaceholder, movePlaceholder, deletePlaceholder, descendantIds,
    type HierNode, type HierMember,
} from "@/hooks/owner/useMemberHierarchy";

const FONT = "Nunito, sans-serif";
const GREEN = "#2d9653";
const NODE_W = 168, NODE_H = 86, H_GAP = 22, V_GAP = 64;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type Action =
    | { kind: "add-existing"; node: HierNode }
    | { kind: "add-placeholder"; node: HierNode | null }
    | { kind: "move"; node: HierNode }
    | { kind: "delete"; node: HierNode };

export default function ClubNetworkPage() {
    const { club } = useClubContext();
    const clubId = club?.id || null;
    const hierarchy = useMemberHierarchy(clubId);
    const { roots, byId, count, orphanCount, loading } = hierarchy;
    const [view, setView] = useState<"tree" | "grid">("tree");
    const [action, setAction] = useState<Action | null>(null);
    const [menuFor, setMenuFor] = useState<HierNode | null>(null);

    if (!clubId) return null;

    return (
        <div style={{ padding: "16px 20px", fontFamily: FONT, background: "#f8fafc", minHeight: "100vh" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                <div>
                    <h1 style={{ fontSize: 22, fontWeight: 900, color: GREEN, margin: 0 }}>🌳 Club Network</h1>
                    <p style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                        {count} nodes · who referred whom{orphanCount > 0 && <span style={{ color: "#d97706", fontWeight: 700 }}> · {orphanCount} unlinked</span>}
                    </p>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setView("tree")} style={{ ...toggleBtn, ...(view === "tree" ? toggleActive : {}) }}>🌳 Tree</button>
                    <button onClick={() => setView("grid")} style={{ ...toggleBtn, ...(view === "grid" ? toggleActive : {}) }}>▦ Grid</button>
                    <button onClick={() => setAction({ kind: "add-placeholder", node: null })} style={{ ...toggleBtn, color: "white", background: GREEN, border: `1.5px solid ${GREEN}` }}>+ Placeholder</button>
                </div>
            </div>

            {loading && <div style={{ color: "#9ca3af", padding: 40, textAlign: "center" }}>Loading network…</div>}

            {!loading && view === "tree" && (
                <TreeCanvas roots={roots} onMenu={setMenuFor} />
            )}

            {!loading && view === "grid" && (
                <GridView byId={byId} onMenu={setMenuFor} />
            )}

            {/* Node action menu */}
            {menuFor && (
                <div onClick={() => setMenuFor(null)} style={overlay}>
                    <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: 14, padding: 16, maxWidth: 320, width: "100%" }}>
                        <div style={{ fontSize: 15, fontWeight: 900, color: "#0f172a", marginBottom: 2 }}>{menuFor.member.name}</div>
                        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 12 }}>{menuFor.member.memberId || (menuFor.member.isPlaceholder ? "Placeholder" : "")} {menuFor.member.phone ? `· ${menuFor.member.phone}` : ""}</div>
                        <div style={{ display: "grid", gap: 6 }}>
                            <button style={actBtn} onClick={() => { setAction({ kind: "add-existing", node: menuFor }); setMenuFor(null); }}>➕ Add existing member under this</button>
                            <button style={actBtn} onClick={() => { setAction({ kind: "add-placeholder", node: menuFor }); setMenuFor(null); }}>👤 Add placeholder under this</button>
                            <button style={actBtn} onClick={() => { setAction({ kind: "move", node: menuFor }); setMenuFor(null); }}>↕ Move this node…</button>
                            <button style={{ ...actBtn, color: "#dc2626", borderColor: "#fecaca" }} onClick={() => { setAction({ kind: "delete", node: menuFor }); setMenuFor(null); }}>
                                🗑 {menuFor.member.isPlaceholder ? "Delete placeholder" : "Remove from network"}
                            </button>
                        </div>
                        <button onClick={() => setMenuFor(null)} style={{ ...actBtn, marginTop: 10, textAlign: "center", justifyContent: "center", color: "#64748b" }}>Close</button>
                    </div>
                </div>
            )}

            {action && clubId && (
                <ActionModal clubId={clubId} action={action} hierarchy={hierarchy} onClose={() => setAction(null)} />
            )}
        </div>
    );
}

// ─── Tree canvas (pan / zoom / drag) ─────────────────────────────────────
function TreeCanvas({ roots, onMenu }: { roots: HierNode[]; onMenu: (n: HierNode) => void }) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const [t, setT] = useState({ scale: 0.85, tx: 40, ty: 24 });
    const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

    // Layout: tidy top-down tree. Leaves get sequential x; parents centred.
    const { pos, lines, width, height } = useMemo(() => {
        const pos = new Map<string, { x: number; y: number }>();
        const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
        let cursor = 0;
        const layout = (node: HierNode): number => {
            const y = node.depth * (NODE_H + V_GAP);
            let x: number;
            if (node.children.length === 0) {
                x = cursor; cursor += NODE_W + H_GAP;
            } else {
                const xs = node.children.map(layout);
                x = (xs[0] + xs[xs.length - 1]) / 2;
            }
            pos.set(node.member.id, { x, y });
            return x;
        };
        for (const r of roots) { layout(r); cursor += H_GAP * 2; }
        // connector lines parent → child
        const walk = (node: HierNode) => {
            const p = pos.get(node.member.id)!;
            for (const c of node.children) {
                const cp = pos.get(c.member.id)!;
                lines.push({ x1: p.x + NODE_W / 2, y1: p.y + NODE_H, x2: cp.x + NODE_W / 2, y2: cp.y });
                walk(c);
            }
        };
        roots.forEach(walk);
        let maxX = 0, maxY = 0;
        pos.forEach(v => { maxX = Math.max(maxX, v.x + NODE_W); maxY = Math.max(maxY, v.y + NODE_H); });
        return { pos, lines, width: maxX + 40, height: maxY + 40 };
    }, [roots]);

    const allNodes = useMemo(() => {
        const out: HierNode[] = [];
        const walk = (n: HierNode) => { out.push(n); n.children.forEach(walk); };
        roots.forEach(walk);
        return out;
    }, [roots]);

    const onWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const rect = viewportRef.current!.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        setT(prev => {
            const scale = clamp(prev.scale * (e.deltaY < 0 ? 1.12 : 0.89), 0.25, 2);
            const k = scale / prev.scale;
            return { scale, tx: mx - k * (mx - prev.tx), ty: my - k * (my - prev.ty) };
        });
    };
    const onDown = (e: React.MouseEvent) => {
        drag.current = { x: e.clientX, y: e.clientY, tx: t.tx, ty: t.ty };
        const move = (ev: MouseEvent) => {
            if (!drag.current) return;
            setT(prev => ({ ...prev, tx: drag.current!.tx + (ev.clientX - drag.current!.x), ty: drag.current!.ty + (ev.clientY - drag.current!.y) }));
        };
        const up = () => { drag.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    };
    const onTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length !== 1) return;
        const tch = e.touches[0];
        drag.current = { x: tch.clientX, y: tch.clientY, tx: t.tx, ty: t.ty };
    };
    const onTouchMove = (e: React.TouchEvent) => {
        if (!drag.current || e.touches.length !== 1) return;
        const tch = e.touches[0];
        setT(prev => ({ ...prev, tx: drag.current!.tx + (tch.clientX - drag.current!.x), ty: drag.current!.ty + (tch.clientY - drag.current!.y) }));
    };
    const zoom = (f: number) => setT(prev => ({ ...prev, scale: clamp(prev.scale * f, 0.25, 2) }));
    const reset = () => setT({ scale: 0.85, tx: 40, ty: 24 });

    return (
        <div style={{ position: "relative", background: "white", borderRadius: 14, border: "1px solid #e5e7eb", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 10, right: 10, zIndex: 10, display: "flex", gap: 6 }}>
                <button onClick={() => zoom(1.2)} style={zoomBtn}>＋</button>
                <button onClick={() => zoom(0.83)} style={zoomBtn}>－</button>
                <button onClick={reset} style={{ ...zoomBtn, width: "auto", padding: "0 10px" }}>Reset</button>
            </div>
            <div style={{ position: "absolute", bottom: 8, left: 12, zIndex: 10, fontSize: 10, color: "#94a3b8", fontWeight: 700 }}>Drag to pan · scroll to zoom · tap a node for actions</div>
            <div
                ref={viewportRef}
                onWheel={onWheel}
                onMouseDown={onDown}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                style={{ height: "70vh", overflow: "hidden", cursor: "grab", touchAction: "none" }}
            >
                <div style={{ transformOrigin: "0 0", transform: `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`, width, height, position: "relative" }}>
                    <svg width={width} height={height} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}>
                        {lines.map((l, i) => (
                            <path key={i} d={`M ${l.x1} ${l.y1} C ${l.x1} ${(l.y1 + l.y2) / 2}, ${l.x2} ${(l.y1 + l.y2) / 2}, ${l.x2} ${l.y2}`} stroke="#cbd5e1" strokeWidth={1.5} fill="none" />
                        ))}
                    </svg>
                    {allNodes.map(n => {
                        const p = pos.get(n.member.id)!;
                        return (
                            <div key={n.member.id} onMouseDown={e => e.stopPropagation()} onClick={() => onMenu(n)} style={{ position: "absolute", left: p.x, top: p.y, width: NODE_W, height: NODE_H, ...nodeCard(n.member) }}>
                                <NodeInner m={n.member} count={n.descendantCount} />
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function NodeInner({ m, count }: { m: HierMember; count: number }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, height: "100%" }}>
            {m.photo
                ? <img src={m.photo} alt="" style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                : <div style={{ width: 38, height: 38, borderRadius: "50%", flexShrink: 0, background: m.isPlaceholder ? "#94a3b8" : GREEN, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 15 }}>{(m.name || "?")[0].toUpperCase()}</div>}
            <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</div>
                <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.memberId || (m.isPlaceholder ? "Placeholder" : "")}</div>
                {m.phone ? <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>{m.phone}</div> : null}
            </div>
            {count > 0 && <span style={{ position: "absolute", top: -8, right: -8, fontSize: 9, fontWeight: 900, color: "#4f46e5", background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 100, padding: "1px 6px" }}>{count}</span>}
        </div>
    );
}

// ─── Grid view ───────────────────────────────────────────────────────────
function GridView({ byId, onMenu }: { byId: Map<string, HierMember>; onMenu: (n: HierNode) => void }) {
    const [q, setQ] = useState("");
    const members = useMemo(() => {
        const t = q.trim().toLowerCase();
        return [...byId.values()].filter(m => !t || m.name.toLowerCase().includes(t) || m.phone.includes(t) || m.memberId.toLowerCase().includes(t)).sort((a, b) => a.name.localeCompare(b.name));
    }, [byId, q]);
    return (
        <div>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name / mobile / MNC ID…" style={{ width: "100%", padding: 12, borderRadius: 10, border: "1.5px solid #e0f0e9", fontSize: 14, fontFamily: FONT, marginBottom: 12, boxSizing: "border-box" }} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                {members.map(m => (
                    <button key={m.id} onClick={() => onMenu({ member: m, children: [], depth: 0, descendantCount: 0 })} style={{ display: "flex", alignItems: "center", gap: 10, background: "white", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, cursor: "pointer", textAlign: "left", fontFamily: FONT }}>
                        {m.photo
                            ? <img src={m.photo} alt="" style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover" }} />
                            : <div style={{ width: 42, height: 42, borderRadius: "50%", background: m.isPlaceholder ? "#94a3b8" : GREEN, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900 }}>{(m.name || "?")[0].toUpperCase()}</div>}
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{m.name}{m.isPlaceholder && <span style={{ fontSize: 9, fontWeight: 900, color: "#64748b", marginLeft: 5 }}>·PLACEHOLDER</span>}</div>
                            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600 }}>{m.memberId || "—"}</div>
                            {m.phone ? <div style={{ fontSize: 11, color: "#0891b2", fontWeight: 600 }}>{m.phone}</div> : null}
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}

// ─── Action modal (add existing / add placeholder / move / delete) ───────
function ActionModal({ clubId, action, hierarchy, onClose }: {
    clubId: string; action: Action; hierarchy: ReturnType<typeof useMemberHierarchy>; onClose: () => void;
}) {
    const { byId, parentIdOf } = hierarchy;
    const [q, setQ] = useState("");
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");

    const node = action.node;
    const excluded = useMemo(() => {
        if (!node) return new Set<string>();
        const s = descendantIds(node); s.add(node.member.id); return s;
    }, [node]);

    const candidates = useMemo(() => {
        const t = q.trim().toLowerCase();
        const all = [...byId.values()];
        const pool = action.kind === "move" ? all.filter(m => !excluded.has(m.id)) : all; // add-existing: any member
        return pool.filter(m => !t || m.name.toLowerCase().includes(t) || m.phone.includes(t) || m.memberId.toLowerCase().includes(t)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30);
    }, [byId, q, action.kind, excluded]);

    const run = async (fn: () => Promise<void>) => {
        setBusy(true); setErr("");
        try { await fn(); onClose(); } catch (e: any) { setErr(e?.message || "Failed"); setBusy(false); }
    };

    // Add existing member under node → reparent the picked member under node.id
    if (action.kind === "add-existing") {
        return (
            <Picker title={`Add a member under ${node!.member.name}`} subtitle="Pick an existing member to place under this node." q={q} setQ={setQ} err={err}
                items={candidates.filter(m => !m.isPlaceholder)} onPick={(m) => run(() => reparentMember(clubId, m.id, { id: node!.member.id, treePath: node!.member.treePath, memberId: node!.member.memberId }))} onClose={onClose} busy={busy} />
        );
    }
    if (action.kind === "move") {
        return (
            <Picker title={`Move ${node!.member.name}`} subtitle="Choose the new parent (who referred them)." q={q} setQ={setQ} err={err}
                items={candidates} extraTop={{ label: "↑ Detach to top level", onClick: () => run(() => node!.member.isPlaceholder ? movePlaceholder(clubId, node!.member.id, null) : detachMember(clubId, node!.member.id)) }}
                onPick={(m) => run(() => node!.member.isPlaceholder ? movePlaceholder(clubId, node!.member.id, m.id) : reparentMember(clubId, node!.member.id, { id: m.id, treePath: m.treePath, memberId: m.memberId }))} onClose={onClose} busy={busy} />
        );
    }
    if (action.kind === "add-placeholder") {
        return (
            <div onClick={onClose} style={overlay}>
                <div onClick={e => e.stopPropagation()} style={modalBox}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a", marginBottom: 2 }}>Add placeholder{node ? ` under ${node.member.name}` : " (top level)"}</div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 12 }}>For a historical person who isn't in the system.</div>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" autoFocus style={inpStyle} />
                    <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Mobile (optional)" inputMode="tel" style={{ ...inpStyle, marginTop: 8 }} />
                    {err && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 8 }}>{err}</div>}
                    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                        <button onClick={onClose} style={{ ...ghostBtn, flex: 1 }}>Cancel</button>
                        <button onClick={() => run(() => addPlaceholder(clubId, { name, phone }, node ? node.member.id : null))} disabled={busy} style={{ ...primaryBtn, flex: 1 }}>{busy ? "Saving…" : "Add"}</button>
                    </div>
                </div>
            </div>
        );
    }
    // delete
    const isPh = node!.member.isPlaceholder;
    return (
        <div onClick={onClose} style={overlay}>
            <div onClick={e => e.stopPropagation()} style={modalBox}>
                <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>{isPh ? "Delete placeholder" : "Remove from network"}</div>
                <div style={{ fontSize: 12.5, color: "#475569", marginBottom: 14, lineHeight: 1.5 }}>
                    {isPh
                        ? <>Delete placeholder <b>{node!.member.name}</b>? Anyone under them moves up to their parent.</>
                        : <><b>{node!.member.name}</b> will be detached from the network (moved to the top). This does <b>NOT</b> delete their member account or any data.</>}
                </div>
                {err && <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 8 }}>{err}</div>}
                <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={onClose} style={{ ...ghostBtn, flex: 1 }}>Cancel</button>
                    <button onClick={() => run(() => isPh ? deletePlaceholder(clubId, node!.member.id, parentIdOf.get(node!.member.id) ?? null) : detachMember(clubId, node!.member.id))} disabled={busy} style={{ ...primaryBtn, flex: 1, background: "#dc2626" }}>{busy ? "…" : (isPh ? "Delete" : "Detach")}</button>
                </div>
            </div>
        </div>
    );
}

function Picker({ title, subtitle, q, setQ, items, onPick, onClose, busy, err, extraTop }: {
    title: string; subtitle: string; q: string; setQ: (s: string) => void; items: HierMember[];
    onPick: (m: HierMember) => void; onClose: () => void; busy: boolean; err: string;
    extraTop?: { label: string; onClick: () => void };
}) {
    return (
        <div onClick={onClose} style={overlay}>
            <div onClick={e => e.stopPropagation()} style={{ ...modalBox, maxHeight: "82vh", display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>{title}</div>
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 10 }}>{subtitle}</div>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search member…" autoFocus style={inpStyle} />
                {err && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 8 }}>{err}</div>}
                <div style={{ flex: 1, overflowY: "auto", display: "grid", gap: 4, marginTop: 10 }}>
                    {extraTop && <button onClick={extraTop.onClick} disabled={busy} style={{ ...candRow, color: "#d97706", fontWeight: 800 }}>{extraTop.label}</button>}
                    {items.map(m => (
                        <button key={m.id} onClick={() => onPick(m)} disabled={busy} style={candRow}>
                            <span style={{ fontWeight: 800, color: "#0f172a" }}>{m.name}</span>
                            <span style={{ color: "#94a3b8", fontSize: 11 }}>· {m.memberId || m.phone || (m.isPlaceholder ? "placeholder" : "")}</span>
                        </button>
                    ))}
                    {items.length === 0 && <div style={{ color: "#9ca3af", padding: 16, textAlign: "center", fontSize: 13 }}>No matches.</div>}
                </div>
                <button onClick={onClose} style={{ ...ghostBtn, marginTop: 10 }}>Close</button>
            </div>
        </div>
    );
}

// ─── styles ─────────────────────────────────────────────────────────────
const toggleBtn: React.CSSProperties = { padding: "8px 14px", borderRadius: 10, border: "1.5px solid #e0f0e9", background: "white", color: "#475569", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT };
const toggleActive: React.CSSProperties = { background: GREEN, color: "white", border: `1.5px solid ${GREEN}` };
const zoomBtn: React.CSSProperties = { width: 34, height: 34, borderRadius: 8, border: "1px solid #e2e8f0", background: "white", color: "#0f172a", fontSize: 16, fontWeight: 900, cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16, fontFamily: FONT };
const modalBox: React.CSSProperties = { background: "white", borderRadius: 14, padding: 18, maxWidth: 440, width: "100%" };
const actBtn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "10px 12px", background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, cursor: "pointer", fontFamily: FONT, fontSize: 13, fontWeight: 700, color: "#0f172a" };
const candRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", padding: "9px 10px", background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, cursor: "pointer", fontFamily: FONT, fontSize: 13 };
const inpStyle: React.CSSProperties = { width: "100%", padding: 10, borderRadius: 8, border: "1.5px solid #e0f0e9", fontSize: 14, fontFamily: FONT, boxSizing: "border-box" };
const ghostBtn: React.CSSProperties = { padding: 11, borderRadius: 10, border: "1px solid #e2e8f0", background: "white", color: "#475569", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT };
const primaryBtn: React.CSSProperties = { padding: 11, borderRadius: 10, border: "none", background: GREEN, color: "white", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT };

function nodeCard(m: HierMember): React.CSSProperties {
    return {
        background: "white",
        border: `1.5px solid ${m.isClubOwner ? GREEN : m.isPlaceholder ? "#cbd5e1" : "#e5e7eb"}`,
        borderRadius: 12, padding: "8px 10px", cursor: "pointer",
        boxShadow: "0 2px 8px rgba(0,0,0,0.06)", boxSizing: "border-box",
    };
}
