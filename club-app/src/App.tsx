import React, { Suspense, lazy } from "react";
import StationAccess from "@/components/StationAccess";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
// Route shells and the birthday popup are lazy: none of them is needed to draw
// a login screen, and every one of them was sitting in the entry bundle that
// each visitor downloads before anything appears.
const Layout = lazy(() => import("./components/Layout"));
const SuperAdminLayout = lazy(() => import("./components/superadmin/SuperAdminLayout"));
import { ProtectedRoute, RoleRoute } from "./components/ProtectedRoute";
import { useAuth, getDashboardPath } from "@/lib/auth";
import { useClubContext, isSuperAdminDomain } from "@/lib/clubDetection";
import { useFirebaseEmulators } from "@/lib/firebase";
import { useDailyScheduleApply } from "@/hooks/useDailySchedule";
import ErrorBoundary from "./components/ErrorBoundary";
import PageSkeleton from "./components/PageSkeleton";
import MemberLayout from "./components/member/MemberLayout";
import OfflineIndicator from "./components/OfflineIndicator";
const LeaveReviewPage = lazy(() => import("./pages/LeaveReviewPage"));

// ─── Lazy Loaded Pages ──────────────────────────────────────────────────
const Landing = lazy(() => import("./pages/Landing"));
const Federation = lazy(() => import("./pages/Federation"));
const Login = lazy(() => import("./pages/Login"));
const KitchenDisplay = lazy(() => import("./pages/KitchenDisplay"));
const BtcWinners = lazy(() => import("./pages/BtcWinners"));
const InventoryStandalone = lazy(() => import("./pages/Inventory"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Members = lazy(() => import("./pages/Members"));
const MemberProfile = lazy(() => import("./pages/MemberProfile"));
const Billing = lazy(() => import("./pages/Billing"));
const BillingReports = lazy(() => import("./pages/BillingReports"));
const Volunteers = lazy(() => import("./pages/Volunteers"));
const LoyaltyRewards = lazy(() => import("./pages/LoyaltyRewards"));
const ExpiryManagement = lazy(() => import("./pages/ExpiryManagement"));
const NFCSettings = lazy(() => import("./pages/NFCSettings"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Super Admin pages
const SuperAdminLogin = lazy(() => import("./pages/superadmin/SuperAdminLogin"));
const SuperAdminDashboard = lazy(() => import("./pages/superadmin/SuperAdminDashboard"));
const ClubsList = lazy(() => import("./pages/superadmin/ClubsList"));
const CreateClub = lazy(() => import("./pages/superadmin/CreateClub"));
const ClubDetail = lazy(() => import("./pages/superadmin/ClubDetail"));
const ConvertToClub = lazy(() => import("./pages/superadmin/ConvertToClub"));
const PlatformTree = lazy(() => import("./pages/superadmin/PlatformTree"));
const SuperAdminSettings = lazy(() => import("./pages/superadmin/SuperAdminSettings"));
const SuperAdminEnquiries = lazy(() => import("./pages/superadmin/Enquiries"));
const PlatformSettings = lazy(() => import("./pages/superadmin/PlatformSettings"));
const UpgradeRequests = lazy(() => import("./pages/superadmin/UpgradeRequests"));
const GlobalMenuPage = lazy(() => import("./pages/superadmin/GlobalMenu"));
const SuperAdminAppVersions = lazy(() => import("./pages/superadmin/AppVersions"));

// PIN-gated pages (club domain only)
const AdminAccess = lazy(() => import("./pages/AdminAccess"));

// Owner pages
const OwnerDashboard = lazy(() => import("./pages/owner/OwnerDashboard"));
const OwnerMembersPage = lazy(() => import("./pages/owner/MembersPage"));
const OwnerMemberProfile = lazy(() => import("./pages/owner/MemberProfile"));
const MembershipPlansPage = lazy(() => import("./pages/owner/MembershipPlansPage"));
const WalletApprovalsPage = lazy(() => import("./pages/owner/WalletApprovalsPage"));
const OwnerVolunteersPage = lazy(() => import("./pages/owner/VolunteersPage"));
const DownlineClubs = lazy(() => import("./pages/owner/DownlineClubs"));
const ClubSettingsPage = lazy(() => import("./pages/owner/ClubSettingsPage"));
const OwnerLeaderboard = lazy(() => import("./pages/owner/Leaderboard"));
const OwnerBtcPage = lazy(() => import("./pages/owner/BtcPage"));
const OwnerAwardsPage = lazy(() => import("./pages/owner/AwardsPage"));
const BTCCoordinatorPage = lazy(() => import("./pages/BTCCoordinator"));
const OwnerReviewsPage = lazy(() => import("./pages/owner/Reviews"));
const OwnerReportsPage = lazy(() => import("./pages/owner/Reports"));
const OwnerMagicianLogsPage = lazy(() => import("./pages/owner/MagicianLogsPage"));
const OwnerAnnouncementsPage = lazy(() => import("./pages/owner/Announcements"));
const OwnerMenuPage = lazy(() => import("./pages/owner/Menu"));
const AttendanceRegisterPage = lazy(() =>
    import("./pages/owner/AttendanceRegisterPage").catch(() => {
        window.location.reload();
        return import("./pages/owner/AttendanceRegisterPage");
    })
);

// Member pages
const MemberLogin = lazy(() => import("./pages/member/MemberLogin"));
const ForgotPasswordPage = lazy(() => import("./pages/member/ForgotPasswordPage"));
const MemberDashboardNew = lazy(() => import("./pages/member/MemberDashboardSwitch"));
const MemberProfilePageNew = lazy(() => import("./pages/member/MemberProfilePage"));
const MemberAnnouncementsPage = lazy(() => import("./pages/member/MemberAnnouncements"));
const MemberNetworkPage = lazy(() => import("./pages/member/MemberNetwork"));
const MemberWalletPage = lazy(() => import("./pages/member/WalletPage"));
const MemberCheckInPage = lazy(() => import("./pages/member/CheckInPage"));
const MemberAttendancePage = lazy(() => import("./pages/member/MemberAttendancePage"));
const MemberLeaderboard = lazy(() => import("./pages/member/LeaderboardPage"));

// Reception
const ReceptionDisplay = lazy(() => import("./pages/ReceptionDisplay"));
const ReceptionPage = lazy(() => import("./pages/reception/ReceptionSwitch"));
const QueuePage = lazy(() => import("./pages/reception/QueuePage"));
const ReceptionCheckInPage = lazy(() => import("./pages/reception/CheckInPage"));
const ReceptionRenewPage = lazy(() => import("./pages/reception/RenewPage"));
const ReceptionSellPage = lazy(() => import("./pages/reception/SellProductPage"));
const ReceptionGuestPage = lazy(() => import("./pages/reception/GuestPage"));
const TVDisplay = lazy(() => import("./pages/TVDisplay"));
const LoyaltyProgram = lazy(() => import("./pages/LoyaltyProgram"));
const JoinPage = lazy(() => import("./pages/Join"));
const StaffDashboard = lazy(() => import("./pages/staff/StaffDashboard"));

// Orders
const OrdersManagementPage = lazy(() => import("./pages/owner/OrdersManagementPage"));
const OrderEntryPage = lazy(() => import("./pages/staff/OrderEntryPage"));
const TodaysMenuPage = lazy(() => import("./pages/member/TodaysMenuPage"));
const MemberOrdersPage = lazy(() => import("./pages/member/MemberOrdersPage"));

// Billing
const OwnerBillingPage = lazy(() => import("./pages/owner/BillingPage"));
const OwnerBillingReportsPage = lazy(() => import("./pages/owner/BillingReportsPage"));

// Inventory
const InventoryPage = lazy(() => import("./pages/owner/Inventory"));
const InventoryHistoryPage = lazy(() => import("./pages/owner/InventoryHistory"));
const InventoryDeadlinesPage = lazy(() => import("./pages/owner/InventoryDeadlines"));
const ExpiryManagementPage = lazy(() => import("./pages/owner/ExpiryManagementPage"));

// MLM & Member Features
const MLMTreePage = lazy(() => import("./pages/member/MLMTreePage"));
const ProgressPage = lazy(() => import("./pages/member/ProgressPage"));
const MemberCardPage = lazy(() => import("./pages/member/MemberCardPage"));
// The birthday popup used to be mounted at the root of the app, which meant it
// ran on every screen a member could open — including the one where they order
// a shake — and finding today's birthdays costs a read of every member document
// in the club. Removed at the owner's request: a popup nobody asked for is not
// worth putting in front of somebody trying to order.
//
// The inline BirthdayWishBanner on the member home is untouched; it takes the
// club id it is given and shows the same information without interrupting
// anyone. To bring the popup back, mount it on one screen, not on all of them.

// ─── Domain flag (evaluated once at module load) ─────────────────────────
const IS_SUPERADMIN_DOMAIN = isSuperAdminDomain();

// ─── HomeRedirect ────────────────────────────────────────────────────────
//
// SUPERADMIN DOMAIN (magic-nutrition-club.web.app)
//   /  → redirect to /superadmin/login (if not logged in)
//   /  → redirect to /superadmin/dashboard (if already logged in as superAdmin)
//
// CLUB DOMAIN (e.g. magicnutritionclub.com)
//   /  → Landing page (iframe)
//   /  → role-based dashboard (if already logged in via Firebase Auth)

// App mode baked in at build time for dedicated APKs
const APP_MODE = import.meta.env.VITE_APP_MODE as string | undefined;

function HomeRedirect() {
  const { firebaseUser, role, loading: authLoading, signOut } = useAuth();
  const { loading: clubLoading } = useClubContext();
  // Auto-apply today's weekly schedule on first page load of the day
  useDailyScheduleApply();

  const loading = authLoading || (!IS_SUPERADMIN_DOMAIN && clubLoading);

  // Dedicated APK mode — skip all domain logic, go straight to the target screen
  if (APP_MODE) {
    if (loading) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      );
    }
    switch (APP_MODE) {
      case "reception":  return <Navigate to="/reception" replace />;
      case "kitchen":    return <Navigate to="/kitchen" replace />;
      case "admin":      return <Navigate to="/login" replace />;
      case "member":     return <Navigate to="/member/login" replace />;
      case "landing":    return <Landing />;
      default:           return <Landing />;
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (useFirebaseEmulators) {
    return <Navigate to={firebaseUser && role ? getDashboardPath(role) : "/login"} replace />;
  }

  if (IS_SUPERADMIN_DOMAIN) {
    if (firebaseUser && role === "superAdmin") {
      return <Navigate to="/superadmin/dashboard" replace />;
    }
    // Logged in as a non-superAdmin on the superadmin domain — sign them out
    // so they can log in with the correct superAdmin account.
    if (firebaseUser && role) {
      signOut();
      return <Navigate to="/superadmin/login" replace />;
    }
    // Not logged in (or just signed out above) → superadmin login page
    return <Navigate to="/superadmin/login" replace />;
  }

  // Club domain — always show landing page regardless of Firebase Auth state.
  // PIN-based access is used here; Firebase Auth roles are irrelevant on club domains.
  return <Landing />;
}

function MemberLayoutOutlet() {
  return <MemberLayout><Outlet /></MemberLayout>;
}

// ─── App ─────────────────────────────────────────────────────────────────
//
// ROUTING SUMMARY
//
// SUPERADMIN DOMAIN (magic-nutrition-club.web.app)
//   /                    → redirect to /superadmin/login
//   /superadmin/login    → email + password login
//   /superadmin/*        → protected superadmin pages
//
// CLUB DOMAIN (e.g. magicnutritionclub.com)
//   /                    → landing page
//   /kitchen             → 6-digit PIN gate → kitchen display
//   /login               → 8-digit PIN gate → owner dashboard
//   /admin               → 8-digit PIN gate → owner dashboard
//   /loyalty-program     → TV PIN gate → loyalty board + leaderboard
//   /superadmin/*        → redirect to /

const App = () => (
  <ErrorBoundary>
    <OfflineIndicator />
    <Toaster />
    <Sonner />
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        {/* ── Root ────────────────────────────────────────────────────── */}
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/federation" element={<Federation />} />

        {/* ── Superadmin login (superadmin domain only) ───────────────── */}
        <Route
          path="/superadmin/login"
          element={IS_SUPERADMIN_DOMAIN ? <SuperAdminLogin /> : <Navigate to="/" replace />}
        />

        {/* ── Club-domain public routes ────────────────────────────────── */}
        {/*    /login + /admin → PIN gate (8-digit) → owner dashboard with sidebar */}
        {/*    Using /* wildcard so nested routes inside AdminAccess resolve correctly */}
        <Route
          path="/login/*"
          element={useFirebaseEmulators ? <Login /> : IS_SUPERADMIN_DOMAIN ? <Navigate to="/superadmin/login" replace /> : <AdminAccess />}
        />
        <Route path="/kitchen" element={<KitchenDisplay />} />
        <Route path="/inventory" element={<InventoryStandalone />} />
        <Route path="/btc" element={<BTCCoordinatorPage />} />
        <Route path="/btc-winners" element={<BtcWinners />} />
        <Route path="/admin/*" element={<AdminAccess />} />
        <Route path="/reception" element={<StationAccess role="reception"><ReceptionPage /></StationAccess>} />
        {/* Rebuilt queue — stands alone so it can run on its own tablet at the
            desk while the existing reception screen carries on unchanged. */}
        <Route path="/queue" element={<StationAccess role="reception"><QueuePage /></StationAccess>} />
        <Route path="/checkin" element={<StationAccess role="reception"><ReceptionCheckInPage /></StationAccess>} />
        <Route path="/renew" element={<StationAccess role="reception"><ReceptionRenewPage /></StationAccess>} />
        <Route path="/sell" element={<StationAccess role="reception"><ReceptionSellPage /></StationAccess>} />
        <Route path="/guest" element={<StationAccess role="reception"><ReceptionGuestPage /></StationAccess>} />
        <Route path="/tv" element={<TVDisplay />} />
        {/* The loyalty board on the club TV. It opens on the TV PIN — same
            television, and one more PIN is one more PIN for the club to lose. */}
        <Route path="/loyalty-program" element={<LoyaltyProgram />} />
        <Route path="/loyalty" element={<Navigate to="/loyalty-program" replace />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/leave-review" element={<LeaveReviewPage />} />

        {/* ── Super Admin routes (superadmin domain only) ─────────────── */}
        <Route
          path="/superadmin/*"
          element={
            IS_SUPERADMIN_DOMAIN ? (
              <ProtectedRoute>
                <RoleRoute roles={["superAdmin"]}>
                  <SuperAdminLayout />
                </RoleRoute>
              </ProtectedRoute>
            ) : (
              // Club owners trying to hit /superadmin/* → bounce to home
              <Navigate to="/" replace />
            )
          }
        >
          <Route path="dashboard" element={<SuperAdminDashboard />} />
          <Route path="clubs" element={<ClubsList />} />
          <Route path="clubs/new" element={<CreateClub />} />
          <Route path="clubs/:clubId" element={<ClubDetail />} />
          <Route path="clubs/:clubId/convert" element={<ConvertToClub />} />
          <Route path="tree" element={<PlatformTree />} />
          <Route path="enquiries" element={<SuperAdminEnquiries />} />
          <Route path="global-menu" element={<GlobalMenuPage />} />
          <Route path="app-versions" element={<SuperAdminAppVersions />} />
          <Route path="settings" element={<PlatformSettings />} />
          <Route path="upgrade-requests" element={<UpgradeRequests />} />
          <Route path="legacy-settings" element={<SuperAdminSettings />} />
        </Route>

        {/* ── Club Owner routes (Firebase Auth) ─────────────────────── */}
        <Route
          path="/owner/*"
          element={
            <ProtectedRoute>
              <RoleRoute roles={["clubOwner"]}>
                <Layout />
              </RoleRoute>
            </ProtectedRoute>
          }
        >
          <Route path="dashboard" element={<OwnerDashboard />} />
          <Route path="members" element={<OwnerMembersPage />} />
          <Route path="attendance" element={<AttendanceRegisterPage />} />
          <Route path="members/:id" element={<OwnerMemberProfile />} />
          <Route path="membership-plans" element={<MembershipPlansPage />} />
          <Route path="wallet-approvals" element={<WalletApprovalsPage />} />
          <Route path="volunteers" element={<OwnerVolunteersPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="inventory/history" element={<InventoryHistoryPage />} />
          <Route path="inventory/deadlines" element={<InventoryDeadlinesPage />} />
          <Route path="expiry-management" element={<ExpiryManagementPage />} />
          <Route path="billing" element={<OwnerBillingPage />} />
          <Route path="billing-reports" element={<OwnerBillingReportsPage />} />
          <Route path="orders" element={<OrdersManagementPage />} />
          <Route path="downline" element={<DownlineClubs />} />
          <Route path="settings" element={<ClubSettingsPage />} />
          <Route path="leaderboard" element={<OwnerLeaderboard />} />
          <Route path="btc" element={<OwnerBtcPage />} />
          <Route path="awards" element={<OwnerAwardsPage />} />
          <Route path="reviews" element={<OwnerReviewsPage />} />
          <Route path="reports" element={<OwnerReportsPage />} />
          <Route path="magician-logs" element={<OwnerMagicianLogsPage />} />
          <Route path="announcements" element={<OwnerAnnouncementsPage />} />
          <Route path="menu" element={<OwnerMenuPage />} />
        </Route>

        {/* ── Staff routes ───────────────────────────────────────────── */}
        <Route
          path="/staff/*"
          element={
            <ProtectedRoute>
              <RoleRoute roles={["staff"]}>
                <Layout />
              </RoleRoute>
            </ProtectedRoute>
          }
        >
          <Route path="dashboard" element={<StaffDashboard />} />
          <Route path="attendance" element={<Volunteers />} />
          <Route path="orders" element={<OrderEntryPage />} />
        </Route>

        {/* ── Member login (public — no auth required) ────────────── */}
        <Route path="/member/login" element={<MemberLogin />} />
        <Route path="/member/forgot-password" element={<ForgotPasswordPage />} />

        {/* ── Member routes (Firebase Auth protected, MemberLayout) ── */}
        <Route
          path="/member/*"
          element={
            <ProtectedRoute>
              <RoleRoute roles={["member"]}>
                <MemberLayoutOutlet />
              </RoleRoute>
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<MemberDashboardNew />} />
          <Route path="profile" element={<MemberProfilePageNew />} />
          <Route path="wallet" element={<MemberWalletPage />} />
          <Route path="checkin" element={<MemberCheckInPage />} />
          <Route path="attendance" element={<MemberAttendancePage />} />
          <Route path="menu" element={<TodaysMenuPage />} />
          <Route path="orders" element={<MemberOrdersPage />} />
          <Route path="card" element={<MemberCardPage />} />
          <Route path="tree" element={<MLMTreePage />} />
          <Route path="network" element={<MemberNetworkPage />} />
          <Route path="progress" element={<ProgressPage />} />
          <Route path="leaderboard" element={<MemberLeaderboard />} />
          <Route path="announcements" element={<MemberAnnouncementsPage />} />
        </Route>

        {/* ── Catch-all ──────────────────────────────────────────────── */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  </ErrorBoundary>
);

export default App;
