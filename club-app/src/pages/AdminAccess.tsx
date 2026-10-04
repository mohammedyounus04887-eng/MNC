import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import PinGate from "@/components/PinGate";
import { usePinAccess } from "@/hooks/usePinAccess";
import { useClubContext } from "@/lib/clubDetection";
import { useAppVersion } from "@/lib/appVersion";
import OwnerLayout from "@/components/owner/OwnerLayout";
import PageSkeleton from "@/components/PageSkeleton";
import ClubNetworkErrorScreen from "@/components/ClubNetworkErrorScreen";

const OwnerDashboard = lazy(() => import("./owner/OwnerDashboard"));
const Members        = lazy(() => import("./owner/Members"));
const MemberProfile  = lazy(() => import("./owner/MemberProfile"));
const Volunteers     = lazy(() => import("./owner/VolunteersPage"));
const Wallet         = lazy(() => import("./owner/Wallet"));
const Orders         = lazy(() => import("./owner/Orders"));
const Menu           = lazy(() => import("./owner/Menu"));
const Announcements  = lazy(() => import("./owner/Announcements"));
const Enquiries      = lazy(() => import("./owner/Enquiries"));
const Reports        = lazy(() => import("./owner/Reports"));
const Settings       = lazy(() => import("./owner/Settings"));
const ClubNetwork    = lazy(() => import("./owner/ClubNetworkPage"));
const Reviews        = lazy(() => import("./owner/Reviews"));
const MembershipPlans = lazy(() => import("./owner/MembershipPlansPage"));
const Inventory          = lazy(() => import("./owner/Inventory"));
const InventoryHistory   = lazy(() => import("./owner/InventoryHistory"));
const InventoryDeadlines = lazy(() => import("./owner/InventoryDeadlines"));
const BtcPage            = lazy(() => import("./owner/BtcPage"));
const AwardsPage         = lazy(() => import("./owner/AwardsPage"));
const LoyaltyAdmin       = lazy(() => import("./owner/LoyaltyPage"));
const VirtualNumbers     = lazy(() => import("./owner/VirtualNumbersPage"));
const AttendanceRegister = lazy(() => import("./owner/AttendanceRegisterPage"));
const MemberCards        = lazy(() => import("./owner/MemberCardsPage"));
const AppVersion         = lazy(() => import("./owner/AppVersionPage"));
const ScanStation        = lazy(() => import("./owner/ScanStationPage"));
const ScannerTest        = lazy(() => import("./owner/ScannerTestPage"));
const ServeStation       = lazy(() => import("./owner/ServeStationPage"));
const TodayPage          = lazy(() => import("./owner/TodayPage"));
const DataCheckPage      = lazy(() => import("./owner/DataCheckPage"));
const TestingPage        = lazy(() => import("./owner/TestingPage"));

export default function AdminAccess() {
    const { club, loading: clubLoading, errorKind, retry } = useClubContext();
    const { isVerified, isLoading, clubName, clubLogo, verify } = usePinAccess("admin");
    // Switching Admin to "new" lands on Today — the plain-language home — instead
    // of the dense dashboard. Every page stays reachable either way.
    const { version: adminVersion } = useAppVersion("admin");

    // Loading state
    if (isLoading || clubLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
            </div>
        );
    }

    // No club available — distinguish the two cases.
    if (!club) {
        // Network problem: surface the retry UI so the user isn't stuck on
        // a dead-end "Club Not Found" message when their phone was actually
        // offline for a moment.
        if (errorKind === "network") {
            return <ClubNetworkErrorScreen onRetry={retry} />;
        }
        // Genuine no_club for this domain.
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
                <div className="bg-white rounded-2xl shadow-lg border p-8 max-w-sm text-center space-y-4">
                    <div className="h-14 w-14 mx-auto rounded-xl bg-red-100 flex items-center justify-center">
                        <span className="text-2xl">⚠️</span>
                    </div>
                    <h1 className="text-xl font-bold text-gray-900">No Club Found</h1>
                    <p className="text-sm text-gray-500">
                        Admin access must be opened from your club's domain.
                        This page is not available on the platform admin domain.
                    </p>
                    <div className="flex gap-2 justify-center pt-2">
                        <button
                            onClick={retry}
                            className="text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2 rounded-lg"
                        >
                            🔄 Retry
                        </button>
                        <a href="/" className="inline-flex items-center text-sm bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold px-4 py-2 rounded-lg">
                            Go Home
                        </a>
                    </div>
                </div>
            </div>
        );
    }

    // PIN gate
    if (!isVerified) {
        return (
            <PinGate
                type="admin"
                clubName={clubName}
                clubLogo={clubLogo}
                pinLength={8}
                isLoading={false}
                onVerify={verify}
            />
        );
    }

    // Verified — show full owner layout with nested routes
    // Routes are relative to the matched parent path (/login/* or /admin/*)
    return (
        <OwnerLayout>
            <Suspense fallback={<PageSkeleton />}>
                <Routes>
                    <Route index element={<Navigate to={adminVersion === "new" ? "today" : "dashboard"} replace />} />
                    <Route path="dashboard"         element={<OwnerDashboard />} />
                    <Route path="members"           element={<Members />} />
                    <Route path="members/:memberId" element={<MemberProfile />} />
                    <Route path="volunteers"        element={<Volunteers />} />
                    <Route path="wallet"            element={<Wallet />} />
                    <Route path="orders"            element={<Orders />} />
                    <Route path="menu"              element={<Menu />} />
                    <Route path="announcements"     element={<Announcements />} />
                    <Route path="enquiries"         element={<Enquiries />} />
                    <Route path="reports"           element={<Reports />} />
                    <Route path="settings"          element={<Settings />} />
                    <Route path="tree"              element={<ClubNetwork />} />
                    <Route path="downline"          element={<ClubNetwork />} />
                    <Route path="reviews"           element={<Reviews />} />
                    <Route path="membership-plans"  element={<MembershipPlans />} />
                    <Route path="inventory"           element={<Inventory />} />
                    <Route path="inventory/history"   element={<InventoryHistory />} />
                    <Route path="inventory/deadlines" element={<InventoryDeadlines />} />
                    <Route path="btc"                 element={<BtcPage />} />
                    <Route path="awards"            element={<AwardsPage />} />
                    <Route path="loyalty"           element={<LoyaltyAdmin />} />
                    <Route path="virtual-numbers"   element={<VirtualNumbers />} />
                    <Route path="attendance"        element={<AttendanceRegister />} />
                    <Route path="member-cards"      element={<MemberCards />} />
                    <Route path="app-version"       element={<AppVersion />} />
                    <Route path="scan"              element={<ScanStation />} />
                    <Route path="scanner-test"      element={<ScannerTest />} />
                    <Route path="serve"             element={<ServeStation />} />
                    <Route path="today"             element={<TodayPage />} />
                    <Route path="data-check"        element={<DataCheckPage />} />
                    <Route path="testing"           element={<TestingPage />} />
                    <Route path="*"                 element={<Navigate to="dashboard" replace />} />
                </Routes>
            </Suspense>
        </OwnerLayout>
    );
}
