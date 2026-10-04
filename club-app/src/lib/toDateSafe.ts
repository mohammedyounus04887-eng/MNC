/**
 * Turning whatever is in a date field into a Date — one answer, never a crash.
 *
 * `TypeError: r.toDate is not a function` has taken the member app down more
 * than once. It happens because `.toDate()` is called straight on a field that
 * turned out not to be a Firestore Timestamp, and a single bad field kills the
 * whole screen: the error escapes render, the boundary catches it, and the
 * member sees "Something went wrong" instead of their shakes.
 *
 * Firestore does not enforce a schema, so a date field can hold any of these,
 * and in this database it does:
 *
 *   - a real Timestamp          — the normal case
 *   - `{ seconds, nanoseconds }` — a Timestamp that has been through JSON, e.g.
 *                                 anything cached in localStorage or passed in
 *                                 a postMessage
 *   - a Date                    — written by a path that forgot to convert
 *   - a string                  — "2026-09-04", or an ISO string
 *   - a number                  — epoch millis, or epoch seconds
 *   - null / undefined / ""     — never set, or cleared
 *
 * Everything above returns a Date or null. Nothing throws. A field the app
 * cannot make sense of is treated as "no date", which is what every caller
 * already does with null anyway.
 *
 * This is the same shape of rule as `lib/clubDay` and `lib/membership`: the app
 * grew several answers to one question and they disagreed. One function, used
 * everywhere, is the fix.
 */

export function toDateSafe(value: unknown): Date | null {
    // `0` is "no date", not the first of January 1970. A club has no records
    // from then, so a zero in a date field is an unset value or a bad write —
    // and showing somebody "Expires 01/01/1970" is worse than showing nothing.
    if (value == null || value === "" || value === 0) return null;

    // A real Firestore Timestamp, or anything else offering toDate().
    const withToDate = value as { toDate?: () => Date };
    if (typeof withToDate?.toDate === "function") {
        try {
            const d = withToDate.toDate();
            return isValid(d) ? d : null;
        } catch {
            return null;
        }
    }

    if (value instanceof Date) return isValid(value) ? value : null;

    // A Timestamp that has been through JSON.stringify — the method is gone but
    // the numbers survive. This is why a cached copy of a document cannot be
    // handed to code expecting a Timestamp without going through here.
    const asParts = value as { seconds?: unknown; _seconds?: unknown; nanoseconds?: unknown };
    const seconds = typeof asParts?.seconds === "number"
        ? asParts.seconds
        : typeof asParts?._seconds === "number"
            ? asParts._seconds
            : null;
    if (seconds != null) {
        const nanos = typeof asParts?.nanoseconds === "number" ? asParts.nanoseconds : 0;
        const d = new Date(seconds * 1000 + Math.floor(nanos / 1e6));
        return isValid(d) ? d : null;
    }

    if (typeof value === "number") {
        // Seconds and milliseconds are told apart by magnitude: anything below
        // ~1e11 as milliseconds would be 1973, so it is far more likely to be
        // seconds from a Timestamp that lost its wrapper.
        const d = new Date(value < 1e11 ? value * 1000 : value);
        return isValid(d) ? d : null;
    }

    if (typeof value === "string") {
        const d = new Date(value);
        return isValid(d) ? d : null;
    }

    return null;
}

function isValid(d: Date): boolean {
    return d instanceof Date && !Number.isNaN(d.getTime());
}

/** Milliseconds since epoch, or `fallback` when there is no usable date. */
export function toMillisSafe(value: unknown, fallback = 0): number {
    return toDateSafe(value)?.getTime() ?? fallback;
}
