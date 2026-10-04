import * as admin from "firebase-admin";

admin.initializeApp();

// ─────────────────────────────────────────────────────────────────
// All Cloud Functions previously defined in this file have been
// removed (2026-04). Specifically:
//
//   - biometric / biometricInfo
//       ESSL K90 ADMS webhook endpoints. The biometric integration
//       has been removed from the entire app — face recognition is
//       used at reception instead.
//
//   - resetMemberPassword
//       Critical security vulnerability: no auth check, reset every
//       account to the hardcoded password "123456". Replaced by the
//       client-side Firebase Auth sendPasswordResetEmail() flow which
//       sends a single-use reset link to the member's email.
//
// IMPORTANT: After this change, redeploy Cloud Functions so the old
// endpoints are actually removed from your Firebase project:
//
//   firebase deploy --only functions
//
// Until you redeploy, the old functions remain live in production
// and the dangerous reset endpoint is still exploitable.
// ─────────────────────────────────────────────────────────────────

// admin.firestore() instance is initialized for any future Cloud
// Functions to use; export it so adding new functions doesn't
// require re-initialising admin.
export const db = admin.firestore();

export { getGrowlineOwnerActivity, listGrowlineClubLinks, revokeGrowlineOwnerLinkOrCode } from "./growlineOwnerEndpoints";

// Push notifications (FCM) — fan out to member devices on key Firestore events.
export {
    onOrderStatusChange,
    onTopupRequestUpdate,
    onPurchaseRequestUpdate,
    onAnnouncementCreate,
    onEarlyBirdCreate,
} from "./notifications";

// Body Transformation Challenge — scheduled jobs + meal-upload notification.
export {
    autoRejectMissedWeighIns,
    expireMealPhotos,
    notifyCoordinatorOnMealUpload,
} from "./btc";

export { enrollStation } from "./stationAuth";
export { assignVerifiedClubAdministrator } from "./authorization";

// Local-only destination boundary primitives. They are intentionally not
// exported as a callable function until server credentials, persistence,
// reconciliation, and executable integration tests are available.
export {
  validateDestinationRequest,
  normalizedRequestHash,
  operationDocumentId,
  resolveClubMember,
} from "./integrationHandoff";
export { claimHandoff, readHandoff, transitionHandoff } from "./handoffState";
export { growlineHandoff } from "./growlineHandoff";
export { issueGrowlineClubCode, redeemGrowlineClubCode } from "./clubLinkingEndpoints";
export { revokeGrowlineClubLink } from "./clubLinkingEndpoints";
export { federation } from "./federationEndpoints";
