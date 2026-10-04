/**
 * Chooses which member home to render.
 *
 * Keeps the switch out of both screens so neither knows about the other, and so
 * the club (or super admin) can flip it back in seconds without a deploy.
 */

import { lazy, Suspense } from "react";
import { useAppVersion } from "@/lib/appVersion";
import PageSkeleton from "@/components/PageSkeleton";

// MemberDashboard travels in this chunk rather than behind a second round trip.
//
// The route is lazy, and this file was lazy again, so the browser could not even
// learn MemberDashboard.js existed until this 2 KB switch had been downloaded,
// parsed and run — a whole round trip spent on a file that only picks between
// two screens. Now the service worker no longer precaches every chunk, that is a
// real network hop on the member's phone.
//
// MemberHomeNew stays lazy: nothing fetches it while FORCE_CLASSIC is on.
import MemberDashboardOld from "./MemberDashboard";
const MemberHomeNew = lazy(() => import("./MemberHomeNew"));

export default function MemberDashboardSwitch() {
    const { version, loading } = useAppVersion("member");
    if (loading) return <PageSkeleton />;
    return (
        <Suspense fallback={<PageSkeleton />}>
            {version === "new" ? <MemberHomeNew /> : <MemberDashboardOld />}
        </Suspense>
    );
}
