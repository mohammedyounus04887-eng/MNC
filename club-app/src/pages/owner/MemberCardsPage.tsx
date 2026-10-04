/**
 * Member QR cards — printable membership cards.
 *
 * Each card carries the club name, the member's name, their MNC ID and a QR
 * code. The QR encodes `MNC:<memberDocId>` — the document id, not the
 * human-readable member ID, because the human ID is editable in the member
 * form while the document id never changes. The prefix lets a scanner tell
 * one of our cards apart from any other QR code it might be pointed at.
 *
 * Two print sizes:
 *   - Sheet    — CR80 cards laid 2 x 5 on A4, for plain paper / testing
 *   - Card     — one CR80 card per page, for a PVC card printer
 *
 * Photos are optional: the enrolled photos are 200 x 200, which is soft when
 * printed on PVC, so the card reads well without one.
 *
 * This page only reads. Nothing here writes to Firestore.
 */

import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useClubMembers } from "@/hooks/useOwner";
import { useClubContext } from "@/lib/clubDetection";

/** Value encoded in the QR. Keep in sync with whatever reads the scans. */
export const cardQrValue = (memberDocId: string) => `MNC:${memberDocId}`;

type Layout = "sheet" | "card";

const tsToYear = (t: any): number | null => {
    if (!t) return null;
    try {
        const d = t?.toDate ? t.toDate() : new Date(t);
        const y = d.getFullYear();
        return Number.isFinite(y) && y > 2000 && y < 2100 ? y : null;
    } catch {
        return null;
    }
};

export default function MemberCardsPage() {
    const { club } = useClubContext();
    const { data: members, isLoading } = useClubMembers();

    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [withPhoto, setWithPhoto] = useState(true);
    const [withSince, setWithSince] = useState(false);
    const [layout, setLayout] = useState<Layout>("sheet");

    // Active members first, then by member ID so printed sheets come out in a
    // predictable order that matches the register.
    const sorted = useMemo(() => {
        const list = (members ?? []).slice();
        list.sort((a: any, b: any) =>
            String(a.memberId ?? "").localeCompare(String(b.memberId ?? ""), undefined, { numeric: true }),
        );
        return list;
    }, [members]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return sorted;
        return sorted.filter((m: any) =>
            [m.name, m.memberId, m.phone].filter(Boolean).join(" ").toLowerCase().includes(q),
        );
    }, [sorted, search]);

    const toPrint = useMemo(
        () => sorted.filter((m: any) => selected.has(m.id)),
        [sorted, selected],
    );

    const toggle = (id: string) =>
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const selectAllShown = () =>
        setSelected(prev => {
            const next = new Set(prev);
            filtered.forEach((m: any) => next.add(m.id));
            return next;
        });

    const clearAll = () => setSelected(new Set());

    if (isLoading) {
        return <div className="p-8 text-sm text-slate-500">Loading members…</div>;
    }

    return (
        <div className="p-4 sm:p-6">
            <style>{PRINT_CSS}</style>

            {/* ── Controls (hidden when printing) ───────────────────────── */}
            <div className="no-print">
                <div className="mb-1 text-xl font-black tracking-tight text-slate-900 dark:text-slate-100">
                    Member Cards
                </div>
                <p className="mb-5 max-w-2xl text-sm text-slate-500">
                    Pick the members, then print. Each card carries a QR code that never changes — if a
                    card is lost, print the same one again.
                </p>

                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search name, member ID or phone…"
                        className="min-w-[220px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-300 dark:border-slate-700 dark:bg-slate-900"
                    />
                    <button
                        onClick={selectAllShown}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
                    >
                        Select all {search ? "shown" : `(${sorted.length})`}
                    </button>
                    <button
                        onClick={clearAll}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
                    >
                        Clear
                    </button>
                </div>

                <div className="mb-5 flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                        <input type="checkbox" checked={withPhoto} onChange={e => setWithPhoto(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
                        Include photo
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                        <input type="checkbox" checked={withSince} onChange={e => setWithSince(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
                        Include “member since”
                    </label>

                    <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-1 dark:border-slate-700">
                        <button
                            onClick={() => setLayout("sheet")}
                            className={`rounded-md px-3 py-1 text-xs font-bold ${layout === "sheet" ? "bg-slate-900 text-white" : "text-slate-500"}`}
                        >
                            A4 sheet · 10 per page
                        </button>
                        <button
                            onClick={() => setLayout("card")}
                            className={`rounded-md px-3 py-1 text-xs font-bold ${layout === "card" ? "bg-slate-900 text-white" : "text-slate-500"}`}
                        >
                            PVC card printer · 1 per page
                        </button>
                    </div>

                    <div className="ml-auto flex items-center gap-3">
                        <span className="text-sm font-bold text-slate-600 dark:text-slate-300">
                            {toPrint.length} selected
                        </span>
                        <button
                            onClick={() => window.print()}
                            disabled={toPrint.length === 0}
                            className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-black text-white disabled:opacity-40"
                        >
                            Print
                        </button>
                    </div>
                </div>

                {withPhoto && (
                    <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        Enrolled photos are 200 × 200 pixels. They look fine on screen but can print soft on
                        PVC — print one card each way before doing the whole club.
                    </div>
                )}

                {/* member picker */}
                <div className="mb-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {filtered.map((m: any) => {
                        const on = selected.has(m.id);
                        return (
                            <button
                                key={m.id}
                                onClick={() => toggle(m.id)}
                                className={`flex items-center gap-3 rounded-xl border p-2.5 text-left transition ${
                                    on
                                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950"
                                        : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
                                }`}
                            >
                                <input readOnly type="checkbox" checked={on} className="h-4 w-4 accent-emerald-600" />
                                {m.photoUrl ? (
                                    <img src={m.photoUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                                ) : (
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600 dark:bg-slate-700">
                                        {(m.name || "?").charAt(0).toUpperCase()}
                                    </div>
                                )}
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-bold">{m.name || "Member"}</div>
                                    <div className="truncate text-xs text-slate-500">{m.memberId || "—"}</div>
                                </div>
                            </button>
                        );
                    })}
                    {filtered.length === 0 && (
                        <div className="col-span-full py-10 text-center text-sm text-slate-400">
                            No members match “{search}”.
                        </div>
                    )}
                </div>

                <div className="mb-3 text-sm font-black text-slate-700 dark:text-slate-200">
                    Preview {toPrint.length > 0 && `· ${toPrint.length} card${toPrint.length === 1 ? "" : "s"}`}
                </div>
            </div>

            {/* ── Printable area ────────────────────────────────────────── */}
            <div className={`print-area ${layout === "sheet" ? "as-sheet" : "as-card"}`}>
                {toPrint.map((m: any) => {
                    const since = withSince ? tsToYear(m.joinedAt ?? m.createdAt) : null;
                    return (
                        <div className="mcard" key={m.id}>
                            <div className="mcard-top">
                                <div className="mcard-club">{club?.name || "Magic Nutrition Club"}</div>
                                <div className="mcard-kicker">Member Card</div>
                            </div>

                            <div className="mcard-body">
                                <div className="mcard-left">
                                    {withPhoto &&
                                        (m.photoUrl ? (
                                            <img src={m.photoUrl} alt="" className="mcard-photo" />
                                        ) : (
                                            <div className="mcard-photo mcard-photo-blank">
                                                {(m.name || "?").charAt(0).toUpperCase()}
                                            </div>
                                        ))}
                                    <div className="mcard-name">{m.name || "Member"}</div>
                                    <div className="mcard-id">{m.memberId || "—"}</div>
                                    {since && <div className="mcard-since">Member since {since}</div>}
                                </div>

                                <div className="mcard-qr">
                                    <QRCodeSVG value={cardQrValue(m.id)} size={112} level="M" marginSize={0} />
                                </div>
                            </div>

                            <div className="mcard-foot">Show this card to be marked present and served</div>
                        </div>
                    );
                })}

                {toPrint.length === 0 && (
                    <div className="no-print py-10 text-center text-sm text-slate-400">
                        Select members above to see their cards here.
                    </div>
                )}
            </div>
        </div>
    );
}

/* CR80 (credit-card) size is 85.6 x 54 mm — the same as the blank PVC cards,
   so what prints on paper lines up with what prints on card. */
const PRINT_CSS = `
.print-area{display:flex;flex-wrap:wrap;gap:4mm;align-content:flex-start}
.mcard{
  width:85.6mm;height:54mm;box-sizing:border-box;
  border:1px solid #cbd5e1;border-radius:3mm;padding:4mm 4.5mm;
  background:#fff;color:#0f172a;display:flex;flex-direction:column;
  font-family:'Nunito',ui-sans-serif,system-ui,sans-serif;
  break-inside:avoid;page-break-inside:avoid;overflow:hidden;
}
.mcard-top{display:flex;align-items:baseline;justify-content:space-between;gap:2mm;
  border-bottom:0.4mm solid #10b981;padding-bottom:1.4mm}
.mcard-club{font-size:3.4mm;font-weight:800;letter-spacing:-0.02em;line-height:1.1}
.mcard-kicker{font-size:1.9mm;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:#64748b;white-space:nowrap}
.mcard-body{display:flex;gap:3mm;align-items:center;flex:1;min-height:0;padding-top:2mm}
.mcard-left{flex:1;min-width:0;display:flex;flex-direction:column;gap:0.8mm}
.mcard-photo{width:13mm;height:13mm;border-radius:50%;object-fit:cover;border:0.4mm solid #d1d5db;margin-bottom:0.8mm}
.mcard-photo-blank{display:flex;align-items:center;justify-content:center;background:#e2e8f0;color:#475569;font-weight:800;font-size:6mm}
.mcard-name{font-size:4.4mm;font-weight:800;letter-spacing:-0.02em;line-height:1.15;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mcard-id{font-size:3.1mm;font-weight:800;color:#059669;letter-spacing:0.06em}
.mcard-since{font-size:2.3mm;color:#64748b;font-weight:600}
.mcard-qr{flex-shrink:0;display:flex;align-items:center;justify-content:center;
  padding:1.2mm;background:#fff;border-radius:1.5mm}
.mcard-qr svg{width:26mm;height:26mm;display:block}
.mcard-foot{border-top:0.3mm solid #e2e8f0;padding-top:1.2mm;font-size:2.1mm;color:#64748b;
  text-align:center;font-weight:600}

@media print{
  .no-print{display:none !important}
  body{background:#fff !important}
  .print-area{gap:0}
  .mcard{border:0.3mm dashed #94a3b8;border-radius:0;margin:0}
  .as-sheet .mcard{margin:0}
  .as-card .mcard{page-break-after:always;border:none}
  @page{size:A4;margin:6mm}
}
@media print{
  .as-card{display:block}
  .as-card .mcard{width:85.6mm;height:54mm}
}
`;
