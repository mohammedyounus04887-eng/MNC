import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { User as Member } from "@/types/firestore";
import { useTeams, saveTeam, deleteTeam, type Team } from "./useTeams";

interface Props {
    clubId: string;
    members: Member[];
    onClose: () => void;
}

// ─── TeamsManager ─────────────────────────────────────────────────────
// Modal-friendly admin UI: list + create + edit + delete teams. Mounted
// from Reception's Settings panel via a "Teams" tile.
//
// Couple-synthesized teams appear in the list but are not editable or
// deletable here (those are managed via member couple-linking).

export default function TeamsManager({ clubId, members, onClose }: Props) {
    const { teams, syntheticTeams, loading } = useTeams(clubId, members);
    const [editing, setEditing] = useState<Team | "new" | null>(null);
    const [name, setName] = useState("");
    const [memberIds, setMemberIds] = useState<string[]>([]);
    const [search, setSearch] = useState("");
    const [saving, setSaving] = useState(false);

    const openCreate = () => {
        setEditing("new"); setName(""); setMemberIds([]); setSearch("");
    };
    const openEdit = (t: Team) => {
        if (t.synthesized) return;
        setEditing(t); setName(t.name); setMemberIds(t.memberIds); setSearch("");
    };
    const closeEditor = () => {
        setEditing(null); setName(""); setMemberIds([]); setSearch("");
    };

    const handleSave = async () => {
        if (!name.trim()) { toast.error("Team needs a name"); return; }
        if (memberIds.length === 0) { toast.error("Team needs at least one member"); return; }
        setSaving(true);
        try {
            await saveTeam(clubId, {
                id: editing && editing !== "new" ? editing.id : undefined,
                name: name.trim(), memberIds,
            });
            toast.success(`Team "${name.trim()}" saved`);
            closeEditor();
        } catch (err: any) {
            toast.error(`Save failed: ${err?.message ?? "unknown"}`);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (t: Team) => {
        if (!window.confirm(`Delete team "${t.name}"?`)) return;
        try {
            await deleteTeam(clubId, t.id);
            toast.success(`Team "${t.name}" deleted`);
        } catch (err: any) {
            toast.error(`Delete failed: ${err?.message ?? "unknown"}`);
        }
    };

    const filteredMembers = useMemo(() => {
        const q = search.toLowerCase().trim();
        const eligible = members.filter((m) => m.status === "active" || (m as any).isActiveMember === true || !!m.memberId);
        if (!q) return eligible.slice(0, 50);
        return eligible.filter((m) =>
            (m.name || "").toLowerCase().includes(q) || (m.memberId || "").toLowerCase().includes(q)
        ).slice(0, 50);
    }, [members, search]);

    const toggleMember = (id: string) => {
        setMemberIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    };

    const stored = teams.filter((t) => !t.synthesized);

    return (
        <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 20, width: "100%", maxWidth: 720, maxHeight: "88vh", overflowY: "auto", padding: 22, fontFamily: "Nunito, sans-serif" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                    <div>
                        <div style={{ fontSize: 20, fontWeight: 900, color: "#1a3a2a" }}>👥 Teams</div>
                        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                            Group members so Magician can check them in together — *"Team A has arrived"*.
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>✕</button>
                </div>

                {!editing && (
                    <>
                        <button
                            onClick={openCreate}
                            style={{ width: "100%", padding: "14px", background: "linear-gradient(135deg,#7c3aed,#06b6d4)", color: "white", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", marginBottom: 16 }}
                        >+ Create New Team</button>

                        {loading ? (
                            <div style={{ textAlign: "center", color: "#9ca3af", padding: 30, fontSize: 13 }}>Loading…</div>
                        ) : (
                            <>
                                {syntheticTeams.length > 0 && (
                                    <div style={{ marginBottom: 14 }}>
                                        <div style={{ fontSize: 11, fontWeight: 800, color: "#7c3aed", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                                            Couples (auto)
                                        </div>
                                        {syntheticTeams.map((t) => (
                                            <TeamRow key={t.id} team={t} members={members} onEdit={() => {}} onDelete={() => {}} />
                                        ))}
                                    </div>
                                )}

                                <div style={{ fontSize: 11, fontWeight: 800, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                                    Your Teams ({stored.length})
                                </div>
                                {stored.length === 0 ? (
                                    <div style={{ textAlign: "center", color: "#9ca3af", padding: 30, fontSize: 13 }}>
                                        No teams yet. Tap "Create New Team" to make one.
                                    </div>
                                ) : (
                                    stored.map((t) => (
                                        <TeamRow key={t.id} team={t} members={members}
                                            onEdit={() => openEdit(t)} onDelete={() => handleDelete(t)} />
                                    ))
                                )}
                            </>
                        )}
                    </>
                )}

                {editing && (
                    <div>
                        <input
                            placeholder="Team name (e.g. Morning Batch, Office Crew)"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            style={{ width: "100%", padding: "12px 14px", border: "1.5px solid #d1d5db", borderRadius: 10, fontSize: 15, fontFamily: "inherit", marginBottom: 12, boxSizing: "border-box" }}
                        />

                        <div style={{ background: "#faf5ff", borderRadius: 12, padding: 12, marginBottom: 14 }}>
                            <div style={{ fontSize: 11, fontWeight: 800, color: "#7c3aed", textTransform: "uppercase", marginBottom: 6 }}>
                                Selected ({memberIds.length})
                            </div>
                            {memberIds.length === 0 ? (
                                <div style={{ fontSize: 12, color: "#9ca3af" }}>None yet — pick members below.</div>
                            ) : (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {memberIds.map((id) => {
                                        const m = members.find((x) => x.id === id);
                                        return (
                                            <button key={id} onClick={() => toggleMember(id)}
                                                style={{ padding: "4px 10px", background: "white", border: "1px solid #d8b4fe", borderRadius: 999, fontSize: 12, fontWeight: 700, color: "#6b21a8", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4 }}>
                                                {m?.name || id} <span style={{ opacity: 0.5 }}>✕</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <input
                            placeholder="Search members to add..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #d1d5db", borderRadius: 10, fontSize: 14, fontFamily: "inherit", marginBottom: 10, boxSizing: "border-box" }}
                        />

                        <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid #f1f5f9", borderRadius: 10, marginBottom: 14 }}>
                            {filteredMembers.map((m) => {
                                const checked = memberIds.includes(m.id);
                                return (
                                    <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid #f8fafc", cursor: "pointer", background: checked ? "#faf5ff" : "white" }}>
                                        <input type="checkbox" checked={checked} onChange={() => toggleMember(m.id)} style={{ cursor: "pointer" }} />
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: 13, fontWeight: 700, color: "#1f2937" }}>{m.name}</div>
                                            <div style={{ fontSize: 11, color: "#6b7280" }}>{m.memberId} {m.phone ? `· ${m.phone}` : ""}</div>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>

                        <div style={{ display: "flex", gap: 10 }}>
                            <button onClick={closeEditor} disabled={saving}
                                style={{ flex: 1, padding: "12px", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}>
                                Cancel
                            </button>
                            <button onClick={handleSave} disabled={saving}
                                style={{ flex: 2, padding: "12px", background: saving ? "#d1d5db" : "linear-gradient(135deg,#7c3aed,#06b6d4)", color: "white", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}>
                                {saving ? "Saving…" : "✓ Save Team"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function TeamRow({ team, members, onEdit, onDelete }: { team: Team; members: Member[]; onEdit: () => void; onDelete: () => void }) {
    const memberNames = team.memberIds
        .map((id) => members.find((m) => m.id === id)?.name)
        .filter(Boolean);
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid #f1f5f9", borderRadius: 10, marginBottom: 6, background: team.synthesized ? "#faf5ff" : "white" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#1f2937", display: "flex", alignItems: "center", gap: 6 }}>
                    {team.synthesized ? "💑" : "👥"} {team.name}
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {memberNames.length} member{memberNames.length === 1 ? "" : "s"}: {memberNames.join(", ")}
                </div>
            </div>
            {!team.synthesized && (
                <>
                    <button onClick={onEdit} style={{ padding: "6px 10px", border: "1px solid #d1d5db", background: "white", color: "#374151", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Edit</button>
                    <button onClick={onDelete} style={{ padding: "6px 10px", border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Delete</button>
                </>
            )}
        </div>
    );
}
