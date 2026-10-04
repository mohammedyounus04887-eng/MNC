/**
 * Old / New version switch.
 *
 * Each surface of the app (kitchen, member, reception, admin) can run either
 * the existing screens or the rebuilt ones. Both ship in the same build and
 * read the same Firestore data, so switching is instant, loses nothing, and
 * never needs a deploy.
 *
 * Resolution order, most specific first:
 *   1. Device override  — localStorage, this browser only. Lets one reception
 *                         tablet trial the new screens while the other stays
 *                         on the old ones.
 *   2. Club setting     — `appVersions.<surface>` on the club doc. Applies to
 *                         everyone; propagates in a few seconds because we
 *                         subscribe to the doc.
 *   3. Default          — "old". Nothing changes for anyone until it is
 *                         deliberately switched on.
 */

import { useEffect, useState } from "react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClubContext } from "@/lib/clubDetection";

export type Surface = "kitchen" | "member" | "reception" | "admin";
export type Version = "old" | "new";

export const SURFACES: { key: Surface; label: string; hint: string }[] = [
    { key: "kitchen", label: "Kitchen", hint: "Order screen and serving" },
    { key: "member", label: "Member app", hint: "What members see on their phone" },
    { key: "reception", label: "Reception", hint: "The desk tablet" },
    { key: "admin", label: "Admin", hint: "Owner dashboard and reports" },
];

/**
 * Hard override back to the classic flow.
 *
 * The club runs the original screens while the known defects in them are being
 * fixed. This forces every surface to "old" no matter what the club document or
 * a device override says, so nobody has to remember to flip anything and a
 * stale setting cannot put a rebuilt screen in front of staff mid-service.
 *
 * The rebuilt screens are still in the build and still reachable by their own
 * URLs (/queue, /checkin, /renew, /sell, /guest) for testing. To re-enable the
 * switch, set this to false — that is the only change needed.
 */
export const FORCE_CLASSIC = true;

const deviceKey = (s: Surface) => `mnh_version_${s}`;

export function getDeviceOverride(s: Surface): Version | null {
    try {
        const v = localStorage.getItem(deviceKey(s));
        return v === "old" || v === "new" ? v : null;
    } catch {
        return null;
    }
}

export function setDeviceOverride(s: Surface, v: Version | null) {
    try {
        if (v === null) localStorage.removeItem(deviceKey(s));
        else localStorage.setItem(deviceKey(s), v);
        // Same-tab listeners don't get the storage event, so nudge them.
        window.dispatchEvent(new CustomEvent("mnh-version-change"));
    } catch {
        /* private mode — fall back to the club setting */
    }
}

export async function setClubVersion(clubId: string, s: Surface, v: Version) {
    await updateDoc(doc(db, "clubs", clubId), { [`appVersions.${s}`]: v });
}

type Resolved = {
    version: Version;
    source: "device" | "club" | "default";
    clubVersion: Version;
    loading: boolean;
};

/**
 * Which version this surface should render right now.
 * Subscribes to the club doc so a switch reaches every device without a reload.
 */
export interface UseAppVersionOptions {
    /**
     * Keep watching the club document even while FORCE_CLASSIC stands.
     *
     * Only the admin App Version screen needs this: it shows which version the
     * club has *stored*, so it has to read the real value even though every
     * surface is currently forced to "old". Everywhere else the answer is
     * discarded, and opening the listener would cost a read per screen for
     * nothing.
     */
    watchClub?: boolean;
}

export function useAppVersion(surface: Surface, options: UseAppVersionOptions = {}): Resolved {
    const { watchClub = false } = options;
    const { club } = useClubContext();
    const clubId = club?.id ?? null;

    const [clubVersion, setClubVersion] = useState<Version>("old");
    const [override, setOverride] = useState<Version | null>(() => getDeviceOverride(surface));
    const [loading, setLoading] = useState(true);

    // Device override — react to changes from this tab and from other tabs.
    useEffect(() => {
        const read = () => setOverride(getDeviceOverride(surface));
        window.addEventListener("mnh-version-change", read);
        window.addEventListener("storage", read);
        return () => {
            window.removeEventListener("mnh-version-change", read);
            window.removeEventListener("storage", read);
        };
    }, [surface]);

    // Club setting — live.
    useEffect(() => {
        // While FORCE_CLASSIC stands, the answer below is thrown away: every
        // surface resolves to "old" regardless of what this listener reports.
        // Opening it anyway cost every screen in the app a listener on the club
        // document at boot, for a value nothing reads. The admin App Version
        // screen is the exception — it displays the stored setting, so it asks
        // for the listener explicitly.
        if (FORCE_CLASSIC && !watchClub) {
            setLoading(false);
            return;
        }
        if (!clubId) {
            setLoading(false);
            return;
        }
        const unsub = onSnapshot(
            doc(db, "clubs", clubId),
            snap => {
                const v = (snap.data() as any)?.appVersions?.[surface];
                setClubVersion(v === "new" ? "new" : "old");
                setLoading(false);
            },
            err => {
                // Offline or blocked — stay on the old screens, which is the
                // safe direction to fail in.
                console.error("[appVersion]", err);
                setLoading(false);
            },
        );
        return unsub;
    }, [clubId, surface, watchClub]);

    if (FORCE_CLASSIC) {
        return { version: "old", source: "default", clubVersion, loading: false };
    }
    if (override) return { version: override, source: "device", clubVersion, loading };
    return {
        version: clubVersion,
        source: clubVersion === "new" ? "club" : "default",
        clubVersion,
        loading,
    };
}
