import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { eachDayOfInterval, endOfMonth, format, getDay, isSameDay, startOfMonth } from "date-fns";

const GREEN = "#2d9653";

interface Props {
    clubId: string;
    member: any;
    memberPlan: any;
}

const tsToDate = (t: any): Date | null => {
    if (!t) return null;
    try { return t?.toDate ? t.toDate() : new Date(t); } catch { return null; }
};

const fmtDate = (d: Date | null) => d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtDateShort = (d: Date | null) => d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";
const fmtTime = (d: Date | null) => d ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "—";

const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86400000);
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

const relativeTime = (d: Date | null) => {
    if (!d) return "—";
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return fmtDateShort(d);
};

// ─── Section wrapper (collapsible) ──────────────────────────────────────
function Section({
    title, icon, summary, defaultOpen = false, children,
}: {
    title: string; icon: string; summary?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div style={{ background: "white", borderRadius: 16, marginBottom: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.04)", overflow: "hidden" }}>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    width: "100%", padding: "14px 18px", background: "transparent", border: "none",
                    display: "flex", alignItems: "center", gap: 12, cursor: "pointer", fontFamily: "Nunito, sans-serif",
                    textAlign: "left",
                }}
            >
                <span style={{ fontSize: 22 }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: "#1a3a2a" }}>{title}</div>
                    {summary && (
                        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {summary}
                        </div>
                    )}
                </div>
                <span style={{ fontSize: 14, color: "#9ca3af", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▾</span>
            </button>
            {open && (
                <div style={{ padding: "0 18px 18px", borderTop: "1px solid #f1f5f9" }}>
                    <div style={{ paddingTop: 14 }}>{children}</div>
                </div>
            )}
        </div>
    );
}

// ─── Stat tile ───────────────────────────────────────────────────────────
function Stat({ label, value, color = "#1a3a2a", bg = "#f8fafc", sub }: {
    label: string; value: React.ReactNode; color?: string; bg?: string; sub?: string;
}) {
    return (
        <div style={{ background: bg, borderRadius: 12, padding: "10px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 9.5, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 900, color, lineHeight: 1.1 }}>{value}</div>
            {sub && <div style={{ fontSize: 9.5, color: "#9ca3af", fontWeight: 600, marginTop: 3 }}>{sub}</div>}
        </div>
    );
}

// ─── Main ────────────────────────────────────────────────────────────────
export default function MemberDetailsPanel({ clubId, member, memberPlan }: Props) {
    const [attendanceDates, setAttendanceDates] = useState<{ date: string; checkInTime: any }[]>([]);
    const [orders, setOrders] = useState<any[]>([]);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [latestWeighIn, setLatestWeighIn] = useState<any>(null);
    const [coach, setCoach] = useState<any>(null);
    const [showHistory, setShowHistory] = useState(false);

    // Attendance — pull all dates (doc IDs are YYYY-MM-DD)
    useEffect(() => {
        if (!clubId || !member?.id) return;
        getDocs(collection(db, `clubs/${clubId}/members/${member.id}/attendance`))
            .then(snap => {
                const rows = snap.docs.map(d => ({ date: d.id, checkInTime: (d.data() as any).checkInTime }));
                rows.sort((a, b) => (a.date < b.date ? 1 : -1));
                setAttendanceDates(rows);
            }).catch(() => setAttendanceDates([]));
    }, [clubId, member?.id]);

    // Orders — last ~50, used for last shake / favorite / last product / total visits
    useEffect(() => {
        if (!clubId || !member?.id) return;
        getDocs(query(
            collection(db, `clubs/${clubId}/orders`),
            where("memberId", "==", member.id),
            orderBy("createdAt", "desc"),
            limit(50),
        ))
            .then(snap => setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
            .catch(() => setOrders([]));
    }, [clubId, member?.id]);

    // Transactions — full history for the last 12 months (was capped at 30).
    useEffect(() => {
        if (!clubId || !member?.id) return;
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        getDocs(query(
            collection(db, `clubs/${clubId}/members/${member.id}/transactions`),
            where("createdAt", ">=", Timestamp.fromDate(oneYearAgo)),
            orderBy("createdAt", "desc"),
            limit(2000),
        ))
            .then(snap => setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
            .catch(() => setTransactions([]));
    }, [clubId, member?.id]);

    // Latest weigh-in
    useEffect(() => {
        if (!clubId || !member?.id) return;
        getDocs(query(
            collection(db, `clubs/${clubId}/members/${member.id}/weighIns`),
            orderBy("createdAt", "desc"),
            limit(1),
        ))
            .then(snap => setLatestWeighIn(snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() }))
            .catch(() => setLatestWeighIn(null));
    }, [clubId, member?.id]);

    // Coach (parent) lookup
    useEffect(() => {
        const parentId = member?.parentUserId || member?.referredBy;
        if (!clubId || !parentId) { setCoach(null); return; }
        getDoc(doc(db, `clubs/${clubId}/members`, parentId))
            .then(snap => setCoach(snap.exists() ? { id: snap.id, ...snap.data() } : null))
            .catch(() => setCoach(null));
    }, [clubId, member?.parentUserId, member?.referredBy]);

    // ─── Derived: plan info ──────────────────────────────────────────────
    const planStart = tsToDate(member?.membershipStartDate);
    const planEnd = tsToDate(member?.membershipEndDate);
    const today = startOfDay(new Date());
    const daysLeft = planEnd ? Math.max(0, daysBetween(startOfDay(planEnd), today)) : 0;
    const planDuration = (planStart && planEnd) ? daysBetween(startOfDay(planEnd), startOfDay(planStart)) : 0;
    const planUsedDays = (planStart && planDuration > 0) ? Math.max(0, Math.min(planDuration, daysBetween(today, startOfDay(planStart)))) : 0;
    const planPct = planDuration > 0 ? Math.min(100, Math.round((planUsedDays / planDuration) * 100)) : 0;

    // ─── Derived: attendance stats ───────────────────────────────────────
    const stats = useMemo(() => {
        const totalVisits = attendanceDates.length;
        const todayStr = today.toISOString().slice(0, 10);
        const monthPrefix = todayStr.slice(0, 7);
        const visitsThisMonth = attendanceDates.filter(a => a.date.startsWith(monthPrefix)).length;

        const lastVisitDateStr = attendanceDates[0]?.date;
        const lastVisitDate = lastVisitDateStr ? new Date(lastVisitDateStr + "T00:00:00") : null;
        const daysSinceLastVisit = lastVisitDate ? daysBetween(today, startOfDay(lastVisitDate)) : null;

        // Streak (consecutive days ending today or yesterday)
        const dateSet = new Set(attendanceDates.map(a => a.date));
        let streak = 0;
        const cursor = new Date(today);
        if (!dateSet.has(todayStr)) cursor.setDate(cursor.getDate() - 1);
        while (dateSet.has(cursor.toISOString().slice(0, 10))) {
            streak++;
            cursor.setDate(cursor.getDate() - 1);
        }

        return { totalVisits, visitsThisMonth, daysSinceLastVisit, streak, lastVisitDate };
    }, [attendanceDates]);

    // ─── Derived: today's check-in time ──────────────────────────────────
    const todayCheckIn = useMemo(() => {
        const todayStr = today.toISOString().slice(0, 10);
        const row = attendanceDates.find(a => a.date === todayStr);
        return tsToDate(row?.checkInTime);
    }, [attendanceDates]);

    // ─── Derived: activity ───────────────────────────────────────────────
    const activity = useMemo(() => {
        const shakeOrders = orders.filter(o => (o.items || []).some((i: any) => !i.isProduct));
        const productOrders = orders.filter(o => (o.items || []).some((i: any) => i.isProduct));

        const lastShakeOrder = shakeOrders[0];
        const lastShakeName = lastShakeOrder?.items?.[0]?.itemName || lastShakeOrder?.items?.[0]?.productName || lastShakeOrder?.items?.[0]?.name;
        const lastShakeAt = tsToDate(lastShakeOrder?.createdAt);

        // Favorite shake — most-ordered item name across shake orders
        const counts: Record<string, number> = {};
        for (const o of shakeOrders) {
            for (const it of (o.items || [])) {
                if (it.isProduct) continue;
                const n = it.itemName || it.productName || it.name;
                if (!n) continue;
                counts[n] = (counts[n] || 0) + (it.qty || it.quantity || 1);
            }
        }
        let favShake: string | null = null; let favCount = 0;
        for (const [name, c] of Object.entries(counts)) {
            if (c > favCount) { favShake = name; favCount = c; }
        }

        const lastProduct = productOrders[0];
        const lastProductItem = (lastProduct?.items || []).find((i: any) => i.isProduct);
        const lastProductName = lastProductItem?.itemName || lastProductItem?.productName || lastProductItem?.name;
        const lastProductAt = tsToDate(lastProduct?.createdAt);

        return {
            shakeOrders, lastShakeName, lastShakeAt,
            favShake, favCount,
            lastProductName, lastProductAt,
        };
    }, [orders]);

    // ─── Derived: body & health ──────────────────────────────────────────
    const startWeight = member?.startingWeight ?? null;
    const curWeight = member?.currentWeight ?? null;
    const targetWeight = member?.targetWeight ?? null;
    const weightChange = (startWeight != null && curWeight != null) ? +(startWeight - curWeight).toFixed(1) : null;
    const targetTotal = (startWeight != null && targetWeight != null) ? Math.abs(startWeight - targetWeight) : 0;
    const targetProgressPct = (weightChange != null && targetTotal > 0)
        ? Math.max(0, Math.min(100, Math.round((Math.abs(weightChange) / targetTotal) * 100)))
        : 0;
    const height = member?.height ?? latestWeighIn?.height;
    const bmi = latestWeighIn?.bmi ?? (height && curWeight ? +((curWeight / Math.pow(height / 100, 2))).toFixed(1) : null);
    const bodyFat = member?.currentBodyFat ?? latestWeighIn?.bodyFat;
    const startBodyFat = member?.startingBodyFat;
    const bodyFatChange = (startBodyFat != null && bodyFat != null) ? +(startBodyFat - bodyFat).toFixed(1) : null;
    const skMuscle = member?.currentSkeletalMuscle ?? latestWeighIn?.skeletalMuscle;
    const startSkMuscle = member?.startingSkeletalMuscle;
    const skMuscleChange = (startSkMuscle != null && skMuscle != null) ? +(skMuscle - startSkMuscle).toFixed(1) : null;
    const lastWeighInDate = tsToDate(latestWeighIn?.createdAt) || tsToDate(member?.lastWeighIn);

    const hasBodyData = curWeight != null || bmi != null || bodyFat != null || skMuscle != null;

    // ─── DOB / anniversary ───────────────────────────────────────────────
    const dob = tsToDate(member?.dob);
    const anniv = tsToDate(member?.anniversary);
    const todayMD = `${today.getMonth()}-${today.getDate()}`;
    const isBirthdayToday = dob && `${dob.getMonth()}-${dob.getDate()}` === todayMD;
    const isAnnivToday = anniv && `${anniv.getMonth()}-${anniv.getDate()}` === todayMD;
    const age = dob ? Math.floor((Date.now() - dob.getTime()) / (365.25 * 86400000)) : null;

    return (
        <div style={{ marginTop: 14 }}>

            {/* Birthday / anniversary banner */}
            {(isBirthdayToday || isAnnivToday) && (
                <div style={{ background: "linear-gradient(135deg,#fef3c7,#fde68a)", borderRadius: 14, padding: "12px 16px", marginBottom: 12, fontFamily: "Nunito, sans-serif", border: "1.5px solid #fcd34d", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 24 }}>{isBirthdayToday ? "🎂" : "💍"}</span>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#92400e" }}>
                        {isBirthdayToday ? `Happy Birthday, ${member?.name?.split(" ")[0] || ""}!` : `Anniversary today — wish them well!`}
                    </div>
                </div>
            )}

            {/* ════ MEMBERSHIP & PLAN ════ */}
            <div style={{ background: "white", borderRadius: 16, padding: 18, marginBottom: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.04)", fontFamily: "Nunito, sans-serif" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                        <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Active Plan</div>
                        <div style={{ fontSize: 17, fontWeight: 900, color: "#1a3a2a", marginTop: 3 }}>
                            {memberPlan?.name || (member?.isActiveMember ? "Active" : "No active plan")}
                        </div>
                        {member?.memberId && (
                            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3, fontWeight: 700 }}>ID: {member.memberId}</div>
                        )}
                    </div>
                    {planEnd && (
                        <div style={{ background: daysLeft <= 5 ? "#fee2e2" : daysLeft <= 14 ? "#fef3c7" : "#dcfce7", borderRadius: 10, padding: "6px 12px", textAlign: "center" }}>
                            <div style={{ fontSize: 18, fontWeight: 900, color: daysLeft <= 5 ? "#dc2626" : daysLeft <= 14 ? "#d97706" : "#16a34a", lineHeight: 1 }}>{daysLeft}</div>
                            <div style={{ fontSize: 10, color: daysLeft <= 5 ? "#b91c1c" : daysLeft <= 14 ? "#92400e" : "#166534", fontWeight: 700, marginTop: 2 }}>days left</div>
                        </div>
                    )}
                </div>
                {(planStart || planEnd) && (
                    <>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                            <span>{fmtDate(planStart)}</span>
                            <span>{fmtDate(planEnd)}</span>
                        </div>
                        <div style={{ height: 6, background: "#f1f5f9", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${planPct}%`, background: planPct > 80 ? "#ef4444" : "#2d9653", transition: "width 0.3s" }} />
                        </div>
                    </>
                )}
                <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                    {member?.status && (
                        <span style={{ background: member.status === "active" ? "#dcfce7" : "#fee2e2", color: member.status === "active" ? "#166534" : "#991b1b", fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 100, textTransform: "capitalize" }}>{member.status}</span>
                    )}
                    {member?.memberType && (
                        <span style={{ background: "#eff6ff", color: "#1e40af", fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 100, textTransform: "capitalize" }}>{member.memberType}</span>
                    )}
                    {member?.isVolunteer && (
                        <span style={{ background: "#f5f3ff", color: "#6d28d9", fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 100 }}>Volunteer</span>
                    )}
                    {age != null && (
                        <span style={{ background: "#f8fafc", color: "#475569", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 100 }}>{age} yrs</span>
                    )}
                </div>
            </div>

            {/* ════ ATTENDANCE (default-open monthly calendar) ════ */}
            <Section
                title="Attendance"
                icon="📅"
                summary={`${stats.totalVisits} total · ${stats.visitsThisMonth} this month`}
                defaultOpen={true}
            >
                <MonthlyCalendar attendanceDates={new Set(attendanceDates.map(a => a.date))} />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginTop: 12 }}>
                    <Stat label="Last visit" value={stats.daysSinceLastVisit == null ? "—" : stats.daysSinceLastVisit === 0 ? "Today" : `${stats.daysSinceLastVisit}d ago`} sub={stats.lastVisitDate ? fmtDateShort(stats.lastVisitDate) : ""} bg="#fffbeb" color="#d97706" />
                    <Stat label="Today's check-in" value={fmtTime(todayCheckIn) || "—"} bg="#f0fdf4" color="#2d9653" />
                </div>
            </Section>

            {/* ════ TRANSACTIONS (collapsible) ════ */}
            <Section
                title="Transactions"
                icon="💳"
                summary={
                    transactions.length === 0
                        ? "No transactions yet"
                        : `${transactions.length} in last 12 months · last ${relativeTime(tsToDate(transactions[0]?.createdAt))}`
                }
                defaultOpen={false}
            >
                <TransactionList transactions={transactions} currentCredits={Number(member?.shakeCredits) || 0} />
            </Section>

            {/* ════ STATS (always visible) ════ */}
            <div style={{ background: "white", borderRadius: 16, padding: 14, marginBottom: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.04)", fontFamily: "Nunito, sans-serif" }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#1e40af", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>📊 Stats</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                    <Stat label="Total Visits" value={stats.totalVisits} bg="#eff6ff" color="#1e40af" />
                    <Stat label="This Month" value={stats.visitsThisMonth} bg="#f0fdf4" color="#16a34a" />
                    <Stat label="Streak" value={`${stats.streak}d`} bg="#fff7ed" color="#ea580c" />
                    <Stat
                        label="Plan Visits"
                        value={`${(member?.shakeCreditsPlanTotal ?? 0) - (member?.shakeCredits ?? 0)}/${member?.shakeCreditsPlanTotal ?? 0}`}
                        bg="#f5f3ff" color="#6d28d9"
                    />
                </div>
            </div>

            {/* ════ ACTIVITY & ENGAGEMENT (collapsible) ════ */}
            <Section
                title="Activity & Engagement"
                icon="🥤"
                summary={
                    activity.lastShakeName
                        ? `Last: ${activity.lastShakeName} · ${relativeTime(activity.lastShakeAt)}`
                        : "No orders yet"
                }
            >
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <ActivityRow icon="🥤" label="Last shake" value={activity.lastShakeName || "—"} sub={activity.lastShakeAt ? relativeTime(activity.lastShakeAt) : ""} />
                    <ActivityRow icon="⭐" label="Favorite shake" value={activity.favShake || "—"} sub={activity.favCount ? `${activity.favCount}× ordered` : ""} />
                    <ActivityRow icon="🛍️" label="Last product" value={activity.lastProductName || "—"} sub={activity.lastProductAt ? relativeTime(activity.lastProductAt) : ""} />
                    {activity.shakeOrders.length > 0 && (
                        <button
                            onClick={() => setShowHistory(true)}
                            style={{ marginTop: 4, padding: "10px 14px", background: "#eff6ff", color: "#1e40af", border: "1.5px solid #bfdbfe", borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "Nunito, sans-serif" }}
                        >
                            View shake history ({activity.shakeOrders.length}) →
                        </button>
                    )}
                </div>
            </Section>

            {/* ════ BODY & HEALTH (collapsible) ════ */}
            {hasBodyData && (
                <Section
                    title="Body & Health"
                    icon="💪"
                    summary={
                        curWeight != null
                            ? `${curWeight} kg${weightChange != null && weightChange !== 0 ? ` · ${weightChange > 0 ? "▼" : "▲"} ${Math.abs(weightChange)} kg` : ""}`
                            : "No measurements yet"
                    }
                >
                    {curWeight != null && (
                        <div style={{ marginBottom: 14 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                                <div>
                                    <span style={{ fontSize: 24, fontWeight: 900, color: "#1a3a2a" }}>{curWeight}</span>
                                    <span style={{ fontSize: 13, color: "#6b7280", marginLeft: 4 }}>kg</span>
                                </div>
                                {weightChange != null && weightChange !== 0 && (
                                    <span style={{ fontSize: 13, fontWeight: 800, color: weightChange > 0 ? "#16a34a" : "#dc2626" }}>
                                        {weightChange > 0 ? "▼" : "▲"} {Math.abs(weightChange)} kg
                                        <span style={{ color: "#9ca3af", fontWeight: 600, marginLeft: 4 }}>from {startWeight}</span>
                                    </span>
                                )}
                            </div>
                            {targetWeight != null && targetTotal > 0 && (
                                <>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
                                        <span>Target: {targetWeight} kg</span>
                                        <span>{targetProgressPct}% there</span>
                                    </div>
                                    <div style={{ height: 6, background: "#f1f5f9", borderRadius: 3, overflow: "hidden" }}>
                                        <div style={{ height: "100%", width: `${targetProgressPct}%`, background: "linear-gradient(90deg,#22c55e,#16a34a)", transition: "width 0.3s" }} />
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                        {height != null && <Stat label="Height" value={`${height}`} sub="cm" bg="#f8fafc" />}
                        {bmi != null && <Stat label="BMI" value={bmi} bg="#f8fafc" />}
                        {bodyFat != null && (
                            <Stat
                                label="Body fat"
                                value={`${bodyFat}%`}
                                sub={bodyFatChange != null && bodyFatChange !== 0 ? `${bodyFatChange > 0 ? "▼" : "▲"} ${Math.abs(bodyFatChange)}%` : ""}
                                color={bodyFatChange != null && bodyFatChange > 0 ? "#16a34a" : "#1a3a2a"}
                                bg="#f8fafc"
                            />
                        )}
                        {skMuscle != null && (
                            <Stat
                                label="Skeletal Muscle"
                                value={`${skMuscle}`}
                                sub={skMuscleChange != null && skMuscleChange !== 0 ? `${skMuscleChange > 0 ? "▲" : "▼"} ${Math.abs(skMuscleChange)} kg` : "kg"}
                                color={skMuscleChange != null && skMuscleChange > 0 ? "#16a34a" : "#1a3a2a"}
                                bg="#f8fafc"
                            />
                        )}
                        {latestWeighIn?.visceralFat != null && <Stat label="Visceral Fat" value={latestWeighIn.visceralFat} bg="#f8fafc" />}
                        {latestWeighIn?.bmr != null && <Stat label="BMR" value={latestWeighIn.bmr} sub="kcal" bg="#f8fafc" />}
                        {latestWeighIn?.bodyAge != null && <Stat label="Body Age" value={latestWeighIn.bodyAge} sub="yrs" bg="#f8fafc" />}
                    </div>
                    {lastWeighInDate && (
                        <div style={{ marginTop: 10, fontSize: 11, color: "#9ca3af", fontWeight: 600, textAlign: "center" }}>
                            Last weigh-in {relativeTime(lastWeighInDate)} · {member?.totalWeighIns ?? 0} total
                        </div>
                    )}
                </Section>
            )}

            {/* ════ COACH / SPONSOR ════ */}
            {(coach || member?.referredByMemberId) && (
                <div style={{ background: "white", borderRadius: 16, padding: 14, marginBottom: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.04)", fontFamily: "Nunito, sans-serif" }}>
                    <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Coach / Sponsor</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#f0fdf4", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {(coach?.photoUrl || coach?.photo) ? (
                                <img src={coach.photoUrl || coach.photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                            ) : (
                                <span style={{ fontSize: 18, fontWeight: 900, color: "#2d9653" }}>{(coach?.name || "?")[0]}</span>
                            )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 900, color: "#1a3a2a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {coach?.name || "—"}
                            </div>
                            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                                {coach?.memberId ? `ID: ${coach.memberId}` : member?.referredByMemberId ? `Ref: ${member.referredByMemberId}` : "Referred by"}
                                {coach?.phone ? ` · ${coach.phone}` : ""}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ════ Shake history modal ════ */}
            {showHistory && (
                <div
                    onClick={() => setShowHistory(false)}
                    style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 999 }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{ background: "white", borderRadius: "20px 20px 0 0", padding: 20, width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto", fontFamily: "Nunito, sans-serif" }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#1a3a2a" }}>🥤 Shake History</h3>
                            <button onClick={() => setShowHistory(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>✕</button>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {activity.shakeOrders.map((o: any) => {
                                const when = tsToDate(o.createdAt);
                                return (
                                    <div key={o.id} style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 12px" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                            <span style={{ fontSize: 13, fontWeight: 800, color: "#1a3a2a" }}>
                                                {(o.items || []).filter((i: any) => !i.isProduct).map((i: any) => i.itemName || i.productName || i.name).join(", ") || "Shake"}
                                            </span>
                                            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 100, background: o.status === "served" ? "#dcfce7" : o.status === "rejected" ? "#fee2e2" : "#fef3c7", color: o.status === "served" ? "#166534" : o.status === "rejected" ? "#991b1b" : "#92400e", textTransform: "capitalize" }}>
                                                {o.status || "pending"}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: 11, color: "#6b7280" }}>
                                            {when ? `${fmtDateShort(when)} · ${fmtTime(when)}` : "—"}
                                            {o.tokenNumber ? ` · #${o.tokenNumber}` : ""}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Activity row ────────────────────────────────────────────────────────
function ActivityRow({ icon, label, value, sub }: { icon: string; label: string; value: string; sub?: string }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
            <span style={{ fontSize: 20, width: 28, textAlign: "center" }}>{icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#1a3a2a", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
            </div>
            {sub && <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, flexShrink: 0 }}>{sub}</div>}
        </div>
    );
}

// ─── Monthly calendar (matches MemberDashboard style) ───────────────────
// Green = present · Red = absent past · Slate = future · Today = green ring
function MonthlyCalendar({ attendanceDates }: { attendanceDates: Set<string> }) {
    const [cursor, setCursor] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthStart = startOfMonth(cursor);
    const monthEnd = endOfMonth(cursor);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const padding = Array(getDay(monthStart)).fill(0); // leading blanks for Sun-start grid

    const goPrev = () => { const d = new Date(cursor); d.setMonth(d.getMonth() - 1); setCursor(d); };
    const goNext = () => { const d = new Date(cursor); d.setMonth(d.getMonth() + 1); setCursor(d); };

    return (
        <div style={{ maxWidth: 280, margin: "0 auto" }}>
            {/* Month nav */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <button onClick={goPrev} style={{ background: "#f3f4f6", border: "none", borderRadius: 6, width: 22, height: 22, fontSize: 12, fontWeight: 800, color: "#1a3a2a", cursor: "pointer", padding: 0 }}>‹</button>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#1a3a2a" }}>{format(cursor, "MMMM yyyy")}</div>
                <button onClick={goNext} style={{ background: "#f3f4f6", border: "none", borderRadius: 6, width: 22, height: 22, fontSize: 12, fontWeight: 800, color: "#1a3a2a", cursor: "pointer", padding: 0 }}>›</button>
            </div>

            {/* Day-of-week header */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 2 }}>
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                    <div key={i} style={{ textAlign: "center", fontSize: 9, fontWeight: 700, padding: "1px 0", color: i === 0 ? "#fca5a5" : "#94a3b8" }}>{d}</div>
                ))}
            </div>

            {/* Calendar grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
                {padding.map((_, i) => <div key={`pad-${i}`} style={{ aspectRatio: "1" }} />)}
                {days.map(day => {
                    const dateStr = format(day, "yyyy-MM-dd");
                    const isSun = day.getDay() === 0;
                    const isToday = isSameDay(day, today);
                    const isFuture = day > today && !isToday;
                    const present = attendanceDates.has(dateStr);
                    const bg = isSun ? "#fef2f2" : present ? `${GREEN}25` : isFuture ? "#f1f5f9" : "#fee2e2";
                    const numColor = isSun ? "#fca5a5" : isFuture ? "#94a3b8" : present ? "#15803d" : "#dc2626";
                    return (
                        <div
                            key={dateStr}
                            style={{
                                aspectRatio: "1", borderRadius: 4, display: "flex", flexDirection: "column",
                                alignItems: "center", justifyContent: "center", background: bg,
                                ...(isToday ? { boxShadow: `inset 0 0 0 1.5px ${GREEN}` } : {}),
                            }}
                            title={`${dateStr} — ${present ? "Present" : isFuture ? "Upcoming" : isSun ? "Off day" : "Absent"}`}
                        >
                            <span style={{ fontSize: 9, fontWeight: 700, lineHeight: 1, color: numColor }}>{format(day, "d")}</span>
                            {!isFuture && !isSun && present && (
                                <span style={{ fontSize: 6, fontWeight: 900, lineHeight: 1, marginTop: 1, color: GREEN }}>✓</span>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Legend */}
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 6, fontSize: 9, fontWeight: 600, color: "#6b7280", flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    <span style={{ width: 7, height: 7, background: `${GREEN}25`, borderRadius: 1.5 }} /> Present
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    <span style={{ width: 7, height: 7, background: "#fee2e2", borderRadius: 1.5 }} /> Absent
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    <span style={{ width: 7, height: 7, background: "#f1f5f9", borderRadius: 1.5 }} /> Upcoming
                </span>
            </div>
        </div>
    );
}

// ─── Transaction list ────────────────────────────────────────────────────
const REASON_META: Record<string, { icon: string; label: string; color: string; bg: string }> = {
    plan_purchase: { icon: "📋", label: "Plan Purchase", color: "#1e40af", bg: "#eff6ff" },
    membership: { icon: "📋", label: "Membership", color: "#1e40af", bg: "#eff6ff" },
    topup: { icon: "💰", label: "Wallet Top-up", color: "#16a34a", bg: "#f0fdf4" },
    manual_topup: { icon: "💰", label: "Wallet Top-up", color: "#16a34a", bg: "#f0fdf4" },
    product: { icon: "🛍️", label: "Product", color: "#6d28d9", bg: "#f5f3ff" },
    shake_order: { icon: "🥤", label: "Shake", color: "#d97706", bg: "#fffbeb" },
    shake_credit: { icon: "🥤", label: "Shake", color: "#d97706", bg: "#fffbeb" },
    shake_credits_added: { icon: "➕", label: "Credits Added", color: "#d97706", bg: "#fffbeb" },
    referral_bonus: { icon: "🎁", label: "Referral Bonus", color: "#16a34a", bg: "#f0fdf4" },
    adjustment: { icon: "⚖️", label: "Adjustment", color: "#475569", bg: "#f8fafc" },
};

// Does a transaction change the shake-credit balance, and by how much?
//   'add' → credits added (+creditsAdded)   'use' → credits spent (−amount)
function creditDelta(t: any): number | null {
    const r = t.reason;
    if (r === "shake_order" || r === "shake_credit") return -(Number(t.amount) || 1);
    if (r === "plan_purchase" || r === "membership" || r === "shake_credits_added") {
        const added = Number(t.creditsAdded);
        return Number.isFinite(added) ? added : null;
    }
    return null; // money-only (top-up, product, referral, adjustment)
}

function TransactionList({ transactions, currentCredits = 0 }: { transactions: any[]; currentCredits?: number }) {
    if (transactions.length === 0) {
        return <div style={{ textAlign: "center", padding: "20px 0", fontSize: 13, color: "#9ca3af" }}>No transactions yet</div>;
    }

    // Running "credits left AFTER each credit transaction". Walk newest→oldest,
    // anchored on the member's current balance and re-anchored whenever a doc
    // stored its own creditsAfter (self-corrects any drift from gaps).
    let running = Number(currentCredits) || 0;
    const creditsLeftById: Record<string, number> = {};
    for (const t of transactions) {
        const delta = creditDelta(t);
        if (delta == null) continue; // money-only txn — no credit change
        const stored = Number(t.creditsAfter);
        const after = Number.isFinite(stored) ? stored : running;
        creditsLeftById[t.id] = after;
        running = after - delta; // balance before this txn
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {transactions.map(t => {
                const meta = REASON_META[t.reason] || { icon: "•", label: t.reason || "Transaction", color: "#475569", bg: "#f8fafc" };
                const when = tsToDate(t.createdAt);
                const isCredit = t.type === "credit";
                const amountText = t.reason === "shake_order" || t.reason === "shake_credit"
                    ? `${t.amount || 1} credit${(t.amount || 1) !== 1 ? "s" : ""}`
                    : `${isCredit ? "+" : "−"}₹${t.amount || 0}`;
                const creditsLeft = creditsLeftById[t.id];
                return (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "#f8fafc", borderRadius: 10 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: meta.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{meta.icon}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 800, color: "#1a3a2a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {t.planName || meta.label}
                            </div>
                            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {t.description || meta.label}
                            </div>
                            {when && (
                                <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2, fontWeight: 600 }}>
                                    {format(when, "d MMM yyyy · h:mm a")}
                                </div>
                            )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, gap: 2 }}>
                            <div style={{ fontSize: 13, fontWeight: 900, color: meta.color }}>{amountText}</div>
                            {creditsLeft != null && (
                                <div style={{ fontSize: 10, fontWeight: 800, color: creditsLeft < 0 ? "#dc2626" : "#059669", background: creditsLeft < 0 ? "#fef2f2" : "#ecfdf5", padding: "1px 6px", borderRadius: 999, whiteSpace: "nowrap" }}>
                                    {creditsLeft} left
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
