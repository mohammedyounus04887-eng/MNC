/**
 * The club's day.
 *
 * Always local, never UTC. `new Date().toISOString().slice(0,10)` was used all
 * over the app, and because IST is UTC+5:30 that files everything recorded
 * before 05:30 under the previous day — while the reports query on the local
 * date. Early-morning check-ins and sales went missing from today and inflated
 * a day that was already closed.
 */

export function todayLocal(d: Date = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
