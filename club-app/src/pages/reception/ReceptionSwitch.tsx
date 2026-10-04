/**
 * Chooses which reception screen to show.
 *
 * `?classic=1` always forces the existing screen, so the new home can offer a
 * way back to it without having to flip the club-wide switch — and so anyone
 * can reach the old screen in a hurry regardless of the setting.
 */

import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { useAppVersion } from "@/lib/appVersion";
import PageSkeleton from "@/components/PageSkeleton";

const ReceptionOld = lazy(() => import("@/pages/Reception"));
const ReceptionHomeNew = lazy(() => import("./ReceptionHomeNew"));

export default function ReceptionSwitch() {
    const [params] = useSearchParams();
    const { version, loading } = useAppVersion("reception");

    const classic = params.get("classic") === "1";
    if (loading) return <PageSkeleton />;

    return (
        <Suspense fallback={<PageSkeleton />}>
            {version === "new" && !classic ? <ReceptionHomeNew /> : <ReceptionOld />}
        </Suspense>
    );
}
