import { Timestamp } from "firebase/firestore";

// ─── /platform/{config} ───────────────────────────────────────────────
export interface PlatformConfig {
    totalClubs: number;
    totalMembers: number;
    lastUpdated: Timestamp;
}

// ─── Landing page images ─────────────────────────────────────────────
export interface LandingImage {
    id: string;
    name: string;
    url: string;
    path: string;
    uploadedAt: Timestamp;
}

// ─── /clubs/{clubId} ──────────────────────────────────────────────────
export interface Club {
    id: string;
    name: string;
    currencyName: string;
    domain: string;
    domains?: string[];
    parentClubId: string | null;
    treePath: string;
    theme: string;
    primaryColor: string;
    secondaryColor: string;
    tertiaryColor: string;
    logo: string;
    heroImage: string;
    tagline: string;
    ownerName: string;
    ownerPhone: string;
    ownerEmail?: string;
    ownerUserId: string;
    address?: string;
    phone?: string;
    hours?: string;
    status: "active" | "disabled" | "suspended";
    maintenancePaid: boolean;
    maintenanceDueDate: Timestamp;
    monthlyFee?: number;
    kitchenPin: string;
    receptionPin?: string;
    walletPin?: string;
    tvPin?: string;
    adminPin?: string;
    weighInDays?: string[];
    createdAt: Timestamp;
    createdBy: string;
    referralBonusCoins?: number;
    landingPageUrl: string | null;
    landingPageImages: LandingImage[];
    landingPageHistory?: LandingPageVersion[];
    memberIdPrefix?: string;
    gstNumber?: string;
}

// ─── Landing page version history ─────────────────────────────────────
export interface LandingPageVersion {
    version: number;
    url: string;
    publishedAt: Timestamp;
    publishedBy: string;
}

// ─── /clubs/{clubId}/payments/{paymentId} ─────────────────────────────
export interface PaymentRecord {
    id: string;
    clubId: string;
    amount: number;
    date: Timestamp;
    notes: string;
    recordedBy: string;
    createdAt: Timestamp;
}

// ─── /clubs/{clubId}/usageStats ───────────────────────────────────────
export interface UsageStats {
    reads: number;
    writes: number;
    lastUpdated: Timestamp;
}

// ─── /enquiries/{enquiryId} ───────────────────────────────────────────
export interface Enquiry {
    id: string;
    clubId: string;
    name: string;
    phone: string;
    whatsapp?: string;
    email?: string;
    address?: string;
    dob?: string;
    currentWeight?: number;
    targetWeight?: number;
    healthConditions?: string;
    referredBy?: string;
    referredByMemberId?: string;
    password?: string;
    notes?: string;
    status: "new" | "contacted" | "converted" | "rejected";
    createdAt: Timestamp;
}

// ─── /platform/settings ───────────────────────────────────────────────
export interface PlatformSettings {
    platformName: string;
    logoUrl: string;
    supportEmail: string;
    supportPhone: string;
    defaultMonthlyFee: number;
    updatedAt: Timestamp;
    updatedBy: string;
    receptionEditEnabled?: boolean;
}

// ─── /users/{userId} ──────────────────────────────────────────────────
export type UserRole =
    | "superAdmin"
    | "clubOwner"
    | "staff"
    | "member"
    | "kitchenDisplay";

export type MemberType = string;

export interface User {
    id: string;
    name: string;
    phone: string;
    email: string;
    photo: string;
    photoUrl?: string;
    role: UserRole;
    clubId: string;
    parentUserId: string | null;
    treePath: string;
    status: "active" | "paused" | "expired";
    dob: Timestamp | null;
    anniversary: Timestamp | null;
    qrCode: string;
    isClubOwner: boolean;
    ownedClubId: string | null;
    originalClubId: string;
    referredBy: string | null;
    referredByMemberId?: string | null;
    memberType?: string;
    membershipPlanId?: string;
    membershipEnd?: Timestamp | null;
    membershipEndDate?: Timestamp | null;
    memberId?: string;
    // Weight tracking
    startingWeight?: number;
    currentWeight?: number;
    targetWeight?: number;
    lastWeighIn?: Timestamp | null;
    badges?: string[];
    totalWeighIns?: number;
    height?: number;                    // cm — stored from first weigh-in entry
    // Body composition tracking (from device readings)
    startingBodyFat?: number;          // % body fat at first weigh-in
    currentBodyFat?: number;           // % body fat at latest weigh-in
    startingSkeletalMuscle?: number;   // kg skeletal muscle at first weigh-in
    currentSkeletalMuscle?: number;    // kg skeletal muscle at latest weigh-in
    shakeCredits?: number;          // remaining shake credits from current plan
    shakeCreditsPlanTotal?: number; // total credits granted when plan was purchased
    isVolunteer?: boolean;          // when true, member check-in auto-creates a volunteer session
    fcmTokens?: string[];           // FCM tokens registered by this user across devices
    notificationsEnabled?: boolean; // whether the user has explicitly opted in to push notifications
    // ── BTC (Body Transformation Challenge) ──
    isBTCParticipant?: boolean;     // true while enrolled in the current club challenge
    btcJoinedAt?: Timestamp | null; // when they enrolled (anchors their per-week baseline)
    btcGender?: "male" | "female";  // explicit gender for the gender-alternating leaderboard
    btcStartWeight?: number;        // weight on the first measured BTC week
    btcStartFat?: number;           // body fat % on the first measured BTC week
    btcRejected?: boolean;          // auto-set true when they miss a weigh-in / break a rule
    btcRejectedReason?: string;
    btcRejectedAt?: Timestamp;
    btcFinesTotal?: number;         // sum of fines accrued (rupees, tracked, not deducted)
    btcLateChecks?: number;         // count of late check-ins
    // ── BTC fees & penalty breakdown ──
    btcParticipationFeePaid?: number;  // ₹700 by default — collected at enrolment
    btcCautionDepositPaid?: number;    // ₹300 by default — refundable on rules met
    btcEnrolmentPaymentId?: string;    // link back to the payment doc
    btcDepositStatus?: "held" | "refunded" | "forfeited"; // determined at challenge close
    btcLateFinesTotal?: number;        // ₹50/instance
    btcGainFinesTotal?: number;        // ₹50/kg gained
    btcAbsenceFinesTotal?: number;     // ₹100/extra missed session
    btcSessionsAttended?: number[];    // [1, 2, 3] — session numbers attended on-time
    btcSessionsLate?: number[];        // [4] — session numbers attended late
    btcSessionsMissed?: number[];      // [5] — session numbers missed entirely
    btcAwardedPrizePot?: number;       // ₹X awarded if body-fat winner
    btcAwardedAt?: Timestamp;

    // ── Magician shake preferences ──
    // Per-day-of-week default shake. Read on voice check-in to auto-fill
    // the order in the review card. monday = "monday", etc. Day with no
    // entry → fall back to history (most-ordered shake on that weekday
    // in the last 8 weeks) → blank if no history either.
    shakePreferences?: {
        monday?:    { productId: string; productName: string } | null;
        tuesday?:   { productId: string; productName: string } | null;
        wednesday?: { productId: string; productName: string } | null;
        thursday?:  { productId: string; productName: string } | null;
        friday?:    { productId: string; productName: string } | null;
        saturday?:  { productId: string; productName: string } | null;
        sunday?:    { productId: string; productName: string } | null;
    };

    // ── BTC Coach role ──
    // A coach is a member who has been granted the ability to view (and
    // comment on) the meal photos of a small set of customers assigned to
    // them. Assignment itself lives on the participant record per-challenge
    // (see BtcChallengeParticipant.coachId) so coaches can rotate between
    // challenges without losing history.
    isBTCCoach?: boolean;              // true when the owner promotes this member to a coach
    btcCoachSince?: Timestamp;         // when the role was granted

    // ── Couple linking (club-day Couple Attendance award) ──
    // Two members can be linked; when one checks in at reception the
    // tile click prompts "Both / Only A / Only B" so the receptionist
    // can record partial-couple attendance for the day.
    gender?: "male" | "female";        // explicit, set at couple-link time
    couplePartnerId?: string;          // bidirectional — the other member's id
    coupleLinkedAt?: Timestamp;
    coupleId?: string;                 // shared id so we can query "this couple"

    // ── Single-account couple attendance (one membership, two people) ──
    // Set from Edit Member. When true, check-in asks "Who is present today?"
    // (Both / Only Husband / Only Wife) and records the answer on that day's
    // attendance doc (couplePresence) instead of assuming both attended.
    isCouple?: boolean;
    husbandName?: string;
    wifeName?: string;

    // ── One-Day Shake member ──
    // Set from Edit Member. When true, opening this member at check-in offers
    // "Deduct Credits / One-Day Shake" so the receptionist can route them into
    // the one-day-shake purchase flow instead of deducting a credit.
    isOneDayShakeMember?: boolean;

    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// ─── /clubs/{clubId}/btcConfig — single doc per club, current challenge ──
// All amounts are in rupees. The agreement specifies a 28-day challenge
// with 5 Saturday sessions, ₹700 participation + ₹300 refundable caution
// deposit, and three separate penalty rates. Each penalty rate lives as
// its own field so admin can tune them per season without a code release.
export interface BTCConfig {
    isActive: boolean;
    startDate: Timestamp;          // Week 1 begins
    weighInDayOfWeek: number;      // 0=Sunday … 6=Saturday — the official weekly weigh-in day
    weeks: number;                 // 4 by default (28-day challenge, 5 Saturday sessions)
    recognitionDate: Timestamp | null;  // prize / award night

    // ── Fees & deposit (collected upfront at enrolment) ───────────────
    participationFee?: number;     // default 700
    cautionDeposit?: number;       // default 300 (refundable)

    // ── Penalty rates ─────────────────────────────────────────────────
    lateFineAmount?: number;       // default 50  — per late arrival
    gainFinePerKg?: number;        // default 50  — per kg gained between weigh-ins
    absenceFineAmount?: number;    // default 100 — per missed session beyond the 1 allowed
    fineAmount: number;            // LEGACY — kept for backwards compat; new code reads lateFineAmount
    allowedMisses?: number;        // default 1 — sessions a participant can miss before penalty

    // ── Prize pot ─────────────────────────────────────────────────────
    prizePotTotal?: number;        // running sum of all collected fines, awarded to body-fat winner
    prizePotAwarded?: boolean;     // true once admin closes the challenge and credits the winner

    // ── End-of-challenge winners (filled when admin closes) ──────────
    winnerWeightLossMemberId?: string;
    winnerBodyFatMemberId?: string;
    closedAt?: Timestamp;

    notes?: string;
    updatedAt: Timestamp;
}

// ─── /clubs/{clubId}/btcChallenges/{challengeId} — new simplified model ───
// Each named challenge (e.g. "BTC – May") is a stand-alone doc with its
// own participants, weigh-ins, and meal uploads as subcollections.
// Start/end dates are intentionally omitted — participants upload meals
// and log weight whenever the volunteer records them.
export interface BtcWeighInSession {
    index: number;                 // 0-based; index 0 is the baseline / week-1 session
    date: string;                  // "2026-05-24"
    time: string;                  // "07:00" (24h, HH:mm)
    notes?: string;
}

export interface BtcChallenge {
    id: string;
    name: string;                  // "BTC – May"
    instructions: string;          // multi-paragraph notice shown to participants
    weighInSessions: BtcWeighInSession[];
    isActive: boolean;             // only one challenge is typically active at a time
    createdAt: Timestamp;
    archivedAt?: Timestamp | null;
}

// ─── /clubs/{clubId}/btcChallenges/{challengeId}/participants/{memberId} ──
export interface BtcChallengeParticipant {
    id: string;                    // === memberId
    memberId: string;
    memberName: string;
    memberPhone: string;
    memberPhoto: string;
    participantType: "new" | "old";
    gender?: "male" | "female" | null;   // set at add time; used for leaderboard filter
    baselineWeight: number;        // for "new" this is auto-filled from first weigh-in
    baselineBodyFat?: number | null;
    paid: boolean;                 // tracked manually; toggle on participant row
    enrolledAt: Timestamp;
    // Disqualification — admin marks the participant out of the leaderboard
    // with a reason. They CAN still upload meals and weigh-ins; their stats
    // simply move into a separate "Disqualified" section of the leaderboard.
    disqualified?: boolean;
    disqualifiedReason?: string;
    disqualifiedAt?: Timestamp | null;
    disqualifiedBy?: string;
    // ── Coach assignment ──
    // Coaches assigned to this participant for the current challenge. A
    // participant can have MANY coaches — any assigned coach can view (and
    // comment on) their meal photos but cannot approve/reject (that stays
    // with owner + coordinator). `coachIds` is authoritative; `coachId`/
    // `coachName` are legacy single-coach fields kept for back-compat and
    // migrated into `coachIds` on read.
    coachIds?: string[];
    coachId?: string | null;           // legacy (pre many-to-many)
    coachName?: string;                // legacy denormalised name
    coachAssignedAt?: Timestamp | null;
}

// ─── /clubs/{clubId}/btcChallenges/{challengeId}/weighIns/{memberId_sessionIndex}
// Body-composition fields are all optional — volunteers fill what the
// machine reports; missing readings stay `null`. New machines/readings can
// be added without a migration since every field is nullable.
export interface BtcChallengeWeighIn {
    id: string;
    memberId: string;
    sessionIndex: number;          // matches BtcChallenge.weighInSessions[].index
    weight: number;                // kg — only required field
    // Core body comp
    bodyFat?: number | null;       // %
    bmi?: number | null;
    muscleMass?: number | null;    // kg — total muscle mass
    skeletalMuscle?: number | null;// kg
    bmr?: number | null;           // kcal / day
    visceralFat?: number | null;   // visceral fat rating
    waterPct?: number | null;      // body water %
    proteinPct?: number | null;    // protein %
    boneMass?: number | null;      // kg
    metabolicAge?: number | null;  // years
    leanBodyMass?: number | null;  // kg
    fatFreeBodyWeight?: number | null; // kg
    subcutaneousFat?: number | null;   // %
    bodyAge?: number | null;       // years
    calories?: number | null;      // suggested daily intake / TDEE
    height?: number | null;        // cm (when machine reports it)
    // Arrival time — auto-filled from reception attendance for the date,
    // editable by volunteer if the system record is wrong.
    recordedAtTime?: string;       // "HH:mm"
    autoFilledFromAttendance?: boolean;
    notes?: string;
    recordedAt: Timestamp;
}

// ─── /clubs/{clubId}/btcChallenges/{challengeId}/meals/{memberId_date_slot}
// Photo lifecycle:
//   - uploaded → photoUrl + storagePath set, status "pending"
//   - approved → photo deleted from Storage, photoUrl + storagePath cleared
//                (we keep only the approval record for analytics)
//   - rejected → photo kept until the challenge is archived/deleted, then
//                also wiped by the cleanup sweep
export interface BtcChallengeMeal {
    id: string;
    memberId: string;
    memberName: string;
    date: string;                  // "2026-05-24"
    slot: "breakfast" | "lunch" | "dinner";
    photoUrl: string;
    storagePath?: string;          // firebase storage path; cleared once photo deleted
    photoDeleted?: boolean;        // true after approval cleanup
    status: "pending" | "approved" | "rejected";
    rejectionReason?: string;
    uploadedAt: Timestamp;
    reviewedBy?: string;
    reviewedAt?: Timestamp;
}

// ─── /clubs/{clubId}/btcChallenges/{challengeId}/meals/{mealId}/coachComments/{commentId}
// A coach can leave free-form notes on a meal photo of one of their
// assigned customers. Comments are visible to the coach, the owner, and
// the coordinator — NOT to the customer (we don't want to muddy the
// review status the member sees). Comments do not affect meal status.
export interface BtcMealCoachComment {
    id: string;
    coachId: string;                   // memberId of the coach who wrote it
    coachName: string;                 // denormalised
    text: string;
    createdAt: Timestamp;
    editedAt?: Timestamp;
}

// ─── /clubs/{clubId}/btcCoordinators/{id} — like accountants ─────────────
export interface BTCCoordinator {
    id: string;
    name: string;
    photo: string;
    faceDescriptor?: number[];
    pin: string;                   // 4-digit access PIN (hashed if you wish)
    createdAt: Timestamp;
}

// ─── /clubs/{clubId}/btcMeals/{id} — meal photo uploads ─────────────────
export interface BTCMeal {
    id: string;
    memberId: string;
    memberName: string;
    photoUrl: string;              // firebase storage path
    mealType: "shake" | "breakfast" | "lunch" | "refreshment" | "dinner" | "snack" | "other";
    caption?: string;
    status: "pending" | "approved" | "rejected";
    rejectionReason?: string;
    week: number;                  // calculated when uploaded based on btcConfig.startDate
    uploadedAt: Timestamp;
    reviewedBy?: string;           // coordinator id
    reviewedAt?: Timestamp;
    expiresAt: Timestamp;          // 6 months after upload — for retention sweep
}

// ─── /users/{userId}/weightLog/{logId} ────────────────────────────────
export interface WeightLog {
    id: string;
    weight: number;
    date: Timestamp;
    notes: string;
}

// ─── /weighIns/{weighInId} ────────────────────────────────────────────
export interface WeighIn {
    id: string;
    memberId: string;
    clubId: string;
    weight: number;
    date: string;                           // "2026-03-05" ISO date string
    previousWeight: number | null;
    change: number | null;                  // positive = lost weight, negative = gained
    notes: string;
    recordedBy: "owner" | "member";
    createdAt: Timestamp;
    // Body composition (from device readings)
    height?: number;                        // cm
    bmi?: number;                           // auto-calculated
    bodyFat?: number;                       // % body fat
    previousBodyFat?: number | null;
    bodyFatChange?: number | null;          // positive = fat lost
    visceralFat?: number;                   // visceral fat %
    bmr?: number;                           // basal metabolic rate (kcal)
    bodyAge?: number;                       // body age (years)
    trunkSubcutaneousFat?: number;          // trunk subcutaneous fat
    skeletalMuscle?: number;               // skeletal muscle (kg)
    previousSkeletalMuscle?: number | null;
    skeletalMuscleChange?: number | null;  // positive = gained muscle
}

// ─── /wallets/{userId} ────────────────────────────────────────────────
export interface Wallet {
    userId: string;
    clubId: string;
    currencyName: string;
    balance: number;
    lastUpdated: Timestamp;
}

// ─── /walletTransactions/{transactionId} ──────────────────────────────
export interface WalletTransaction {
    id: string;
    userId: string;
    clubId: string;
    type: "credit" | "debit";
    amount: number;
    reason:
    | "topup"
    | "refund"
    | "shake_order"
    | "membership"
    | "product"
    | "shake_credits_added"
    | "referral_bonus"
    | "adjustment"
    | "plan_purchase";
    addedBy?: string | null;
    approvedBy?: string;
    note?: string;
    description?: string;
    paymentMethod?: string;
    reference?: string;
    balanceBefore?: number;
    balanceAfter?: number;
    // Split payment breakdown (when paymentMethod === 'split')
    cashAmount?: number;
    upiAmount?: number;
    upiAccountId?: string;
    upiAccountName?: string;
    upiNumber?: string;
    // Membership-specific
    planName?: string;
    membershipFrom?: Timestamp;
    membershipTo?: Timestamp;
    // Order-specific
    orderId?: string;
    createdAt: Timestamp;
}

/**
 * Unified payment method type. `split` means the customer paid part in
 * cash and part via UPI in the same transaction — `cashAmount` and
 * `upiAmount` carry the breakdown and must sum to the total.
 */
export type PaymentMethod = 'cash' | 'upi' | 'split';

/**
 * Optional split-payment fields layered on top of any existing payment
 * record. `cashAmount` is set for `cash` and `split`; `upiAmount` is set
 * for `upi` and `split`. UPI account fields are populated whenever
 * `upiAmount > 0` and the club has accounts configured.
 */
export interface SplitPaymentFields {
    cashAmount?: number;
    upiAmount?: number;
    upiAccountId?: string;
    upiAccountName?: string;
    upiNumber?: string;
}

// ─── /topupRequests/{requestId} ───────────────────────────────────────
export interface TopupRequest extends SplitPaymentFields {
    id: string;
    memberId: string;
    memberName: string;
    memberPhoto: string;
    clubId: string;
    requestedAmount: number;
    approvedAmount: number | null;
    paymentMethod?: string;
    reference?: string;
    status: "pending" | "approved" | "rejected";
    rejectionReason?: string;
    requestedAt: Timestamp;
    resolvedAt: Timestamp | null;
    resolvedBy: string | null;
}

// ─── /purchaseRequests/{requestId} ────────────────────────────────────
// Member-raised request to buy a membership plan, top up the wallet,
// and/or buy products. Reception sees these in an inbox, takes payment in
// person, face-verifies an accountant, and the system applies all items.
export type PurchaseRequestItem =
    | {
          type: "membership";
          planId: string;
          planName: string;
          planCategory?: string;
          price: number;
          visits: number;        // shake credits granted
          durationDays: number;
      }
    | {
          type: "wallet_topup";
          amount: number;
      }
    | {
          type: "product";
          productId: string;
          productName: string;
          unit: string;
          quantity: number;
          unitPrice: number;
          totalPrice: number;
      };

export interface PurchaseRequest {
    id: string;
    clubId: string;
    memberId: string;
    memberName: string;
    memberPhoto: string;
    items: PurchaseRequestItem[];
    totalAmount: number;
    notes?: string;
    status: "pending" | "fulfilled" | "rejected" | "cancelled";
    createdAt: Timestamp;
    resolvedAt: Timestamp | null;
    resolvedBy: string | null;
    paymentMethod?: "cash" | "upi" | "card";
    accountantVerifiedBy?: string;
    accountantVerifiedById?: string;
    receiptNumber?: string;
    rejectionReason?: string;
}

// ─── /attendance/{attendanceId} ───────────────────────────────────────
export interface Attendance {
    id: string;
    userId: string;
    userName: string;
    userPhoto: string;
    clubId: string;
    type: "member" | "volunteer";
    checkInTime: Timestamp;
    checkOutTime: Timestamp | null;
    hoursWorked: number | null;
    checkInMethod: "qr" | "manual" | "mobile" | "voice" | "face_recognition" | "face";
    date: string;
    couplePresence?: "both" | "husband" | "wife";
}

// ─── /orders/{orderId} ────────────────────────────────────────────────
export interface OrderItem {
    productId: string;
    productName: string;
    quantity: number;
    pricePerUnit: number;
    notes: string;
    itemName?: string;
}

export interface Order {
    id: string;
    memberId: string;
    memberName: string;
    memberPhoto: string;
    clubId: string;
    staffId: string;
    items: OrderItem[];
    totalCost: number;
    status: "pending" | "preparing" | "served" | "cancelled" | "rejected";
    rating: number | null;
    ratingNote: string | null;
    date: string; // YYYY-MM-DD
    notes?: string;
    walletDeducted?: boolean;
    tokenNumber?: string; // sequential per-club, per-day order number ("001", "002", ...)
    createdAt: Timestamp;
    servedAt: Timestamp | null;
    // ── Rejection metadata (set by useRejectOrder) ──
    rejectedAt?: Timestamp;
    rejectedBy?: string;           // who clicked reject (kitchen staff/role label)
    rejectReason?: string;
    // Snapshot of what was refunded so it's auditable from the order alone.
    refund?: {
        shakeCredits: number;
        menuStockRestored: Record<string, number>;
        todaysSpecialRestored: Record<string, number>;
        kitchenStockRestored: boolean;
    };
}

// ─── /products/{productId} ────────────────────────────────────────────
export interface Product {
    id: string;
    clubId: string;
    name: string;
    category: "shake" | "supplement" | "snack" | "other" | string;
    price: number;
    description?: string;
    stock: number;
    lowStockThreshold: number;
    expiryDate: Timestamp | null;
    photo: string;
    isAvailableToday: boolean;
    availableDate?: string | null; // YYYY-MM-DD
    isDeleted?: boolean;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// ─── /memberships/{planId} ────────────────────────────────────────────
export interface MembershipPlan {
    id: string;
    clubId: string;
    name: string;
    price: number;
    durationDays: number;
    visits?: number;         // number of shake credits included
    totalVisits?: number;    // alias for visits (used by PlanForm)
    category?: string;       // e.g. "Universal Membership", "Digestive Health"
    perShakePrice?: number;  // calculated price per shake/visit
    benefits: string[];
    color: string;
    isActive: boolean;
    // Owner-controlled per-plan toggle: when true, renewing this plan while
    // holding ≥1 credit qualifies the member for the Lucky Dip award pool.
    // Default is false — single-shake / trial / one-off plans are excluded
    // unless the owner explicitly opts them in.
    luckyDipEligible?: boolean;
    createdAt: Timestamp;
}

// ─── /announcements/{announcementId} ──────────────────────────────────
export interface Announcement {
    id: string;
    clubId: string;
    isActive?: boolean;
    title: string;
    message: string;
    priority: "normal" | "important" | "urgent";
    sentTo: string;
    isPinned: boolean;
    scheduledFor: Timestamp | null;
    createdAt: Timestamp;
    createdBy: string;
    expiresAt?: Timestamp | null;
    duration?: string;
}

// ─── /referrals/{referralId} ──────────────────────────────────────────
export interface Referral {
    id: string;
    referrerId: string;
    referredId: string;
    clubId: string;
    bonusCoinsAwarded: number;
    status: "pending" | "rewarded";
    createdAt: Timestamp;
    rewardedAt: Timestamp | null;
}

// ─── /billingPrints/{billId} ──────────────────────────────────────────
export interface BillItem {
    name: string;
    quantity: number;
    pricePerUnit: number;
    total: number;
}

export interface BillingPrint {
    id: string;
    memberId: string;
    memberName: string;
    clubId: string;
    items: BillItem[];
    subtotal: number;
    total: number;
    paidFrom: "wallet" | "cash";
    printedAt: Timestamp;
    printedBy: string;
}

// ─── /volunteers/{sessionId} ──────────────────────────────────────────
export interface VolunteerSession {
    id: string;
    memberId: string;
    memberName: string;
    memberPhoto: string;
    clubId: string;
    loginTime: Timestamp;
    logoutTime: Timestamp | null;
    totalMinutes: number | null;
    date: string; // 'YYYY-MM-DD'
    status: 'active' | 'completed';
}

// ─── /globalProducts/{productId} ──────────────────────────────────────
// Universal product catalog shared across all clubs
export interface GlobalProduct {
    id: string;
    name: string;
    category: string;
    unit: string;          // e.g. "g", "kg", "pcs", "ml", "L"
    imageUrl: string;
    createdAt: Timestamp;
    createdBy: string;     // clubId of who first added it
}

// ─── /clubs/{clubId}/inventoryProducts/{productId} ────────────────────
// Club-specific inventory: quantity, pricing, etc.
export interface InventoryProduct {
    id: string;
    clubId: string;
    globalProductId: string;  // references globalProducts
    name: string;
    category: string;
    unit: string;
    imageUrl: string;
    quantity: number;
    price: number;            // sell price (0 if not for sale)
    lowStockThreshold: number;
    isForSale: boolean;       // whether this can be sold to members
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// ─── /clubs/{clubId}/kitchenUsage/{usageId} ───────────────────────────
export interface KitchenUsageItem {
    productId: string;
    productName: string;
    quantity: number;
    unit: string;
}

export interface KitchenUsage {
    id: string;
    clubId: string;
    items: KitchenUsageItem[];
    verifiedBy: string;        // inventory manager name
    verifiedById: string;      // inventory manager member ID
    date: string;              // YYYY-MM-DD
    createdAt: Timestamp;
}

// ─── /clubs/{clubId}/productSales/{saleId} ────────────────────────────
export interface ProductSale {
    id: string;
    clubId: string;
    productId: string;
    productName: string;
    quantity: number;
    unit: string;
    price: number;
    totalAmount: number;
    buyerId: string;
    buyerName: string;
    isGift: boolean;
    paymentMethod: "cash" | "upi" | "wallet" | "split";
    cashAmount?: number;
    upiAmount?: number;
    upiAccountId?: string;
    upiAccountName?: string;
    upiNumber?: string;
    accountantVerifiedBy: string;
    accountantVerifiedById: string;
    inventoryVerifiedBy: string;
    inventoryVerifiedById: string;
    date: string;              // YYYY-MM-DD
    createdAt: Timestamp;
}

// ─── /clubs/{clubId}/virtualProductSets/{setId} ───────────────────────
export interface VirtualProductSetItem {
    productId: string;
    productName: string;
    quantity: number;
    unit: string;
}

export interface VirtualProductSet {
    id: string;
    clubId: string;
    name: string;
    items: VirtualProductSetItem[];
    isActive: boolean;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// ─── /clubs/{clubId}/inventoryLogs/{logId} ────────────────────────────
export interface InventoryLog {
    id: string;
    clubId: string;
    type: "kitchen_usage" | "product_sale" | "manual_update" | "virtual_deduction" | "restock";
    productId: string;
    productName: string;
    quantityChange: number;    // negative = deducted, positive = added
    quantityBefore: number;
    quantityAfter: number;
    referenceId?: string;      // kitchenUsageId / productSaleId / etc.
    performedBy: string;
    date: string;              // YYYY-MM-DD
    createdAt: Timestamp;
}

// ─── /clubs/{clubId}/inventory/{itemId} ────────────────────────────────
// Unified inventory model. One doc per (product, size) variant —
// "Protein 500g" and "Protein 1000g" are two separate items. `quantity`
// counts packets; recipe deductions can leave it fractional.
export interface InventoryItem {
    id: string;
    name: string;               // "Protein 1000g"
    size: number;               // packet size in `unit`
    unit: string;               // "g" | "kg" | "ml" | "L" | "pcs"
    quantity: number;           // packets in admin (can be fractional)
    category?: string;
    price?: number;             // sell price per packet (0/absent if not for sale)
    isForSale?: boolean;
    lowStockThreshold?: number; // packet count
    imageUrl?: string;
    createdAt: Timestamp;
    lastUpdated: Timestamp;
}

// ─── /clubs/{clubId}/recipes/{recipeId} ────────────────────────────────
// Each ingredient pins one inventory item. `amountPerServing` is in the
// item's base unit (grams of that specific Protein 1000g packet, etc.).
export interface RecipeIngredient {
    inventoryItemId: string;    // inventory doc id (pinned variant)
    inventoryItemName: string;
    unit: string;               // inherited from inventory item
    amountPerServing: number;   // amount in `unit` consumed per shake
    /** @deprecated old boxYield-based recipes — wiped during migration. */
    productId?: string;
    /** @deprecated */
    productName?: string;
    /** @deprecated */
    boxYield?: number;
}

export interface Recipe {
    id: string;
    name: string;               // e.g. "Strawberry Shake"
    menuItemId: string;         // links to todaysSpecial / menu item
    menuItemName: string;
    ingredients: RecipeIngredient[];
    isActive: boolean;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// ─── /clubs/{clubId}/kitchenStock/{productId} ──────────────────────────
/**
 * One physical pack/box of an inventory product. Multiple packs of the
 * same item co-exist (e.g. one 33-serving and one 66-serving Protein
 * pack). A pack with `remaining` < `size` is a partial.
 *
 * FIFO rule: when giving stock to the kitchen we deplete the pack with
 * the smallest `remaining` first (use up partials before opening a new
 * full pack).
 */
export interface InventoryPack {
    id: string;                 // unique within the inventory item
    size: number;               // original pack size in the item's base unit
    remaining: number;          // current remaining in the item's base unit
    addedAt: Timestamp;
    source: 'restock' | 'kitchen_return';
    note?: string;
}

export interface KitchenPack {
    id: string;
    inventoryPackId?: string;   // origin pack in the master inventory
    size: number;
    remaining: number;
    receivedAt: Timestamp;
    note?: string;
}

export interface KitchenStockItem {
    /** Doc id matches the source InventoryItem id. */
    inventoryItemId: string;
    name: string;
    size: number;
    unit: string;
    /** Packet count in the kitchen. Goes fractional after recipe deductions. */
    quantity: number;
    lastUpdated: Timestamp;
    /** @deprecated old fields — kept here so legacy reads don't crash. */
    productId?: string;
    productName?: string;
    graceLimit?: number;
    packs?: KitchenPack[];
}

// ─── /clubs/{clubId}/kitchenStockEvents/{eventId} ──────────────────────
// Audit log of every face-verified stock movement. `add` = admin → kitchen,
// `return` = kitchen → admin, `eod_close` = end-of-day snapshot + auto-return.
export interface KitchenStockEventItem {
    inventoryItemId: string;
    name: string;
    size: number;
    unit: string;
    /** Packet count moved (positive integer for add/return, fractional for eod). */
    quantity: number;
}

export interface KitchenStockEvent {
    id: string;
    type: 'add' | 'return' | 'eod_close';
    items: KitchenStockEventItem[];
    /** EOD only — snapshot of how much was used today, derived from served orders. */
    usedSnapshot?: KitchenStockEventItem[];
    verifiedBy: string;
    verifiedById: string;
    date: string;               // YYYY-MM-DD
    createdAt: Timestamp;
}

// ─── /clubs/{clubId}/kitchenRequests/{requestId} ───────────────────────
export interface KitchenRequestItem {
    productId: string;
    productName: string;
    requestedQty: number;
    issuedQty: number | null;   // set by inventory manager on approval
    unit: string;
}

export interface KitchenRequest {
    id: string;
    items: KitchenRequestItem[];
    estimatedShakes: number;
    status: 'pending' | 'approved' | 'rejected';
    isEmergency: boolean;
    requestedBy: string;
    requestedAt: Timestamp;
    resolvedBy: string | null;
    resolvedAt: Timestamp | null;
    date: string;               // YYYY-MM-DD
}

// ─── /clubs/{clubId}/kitchenReturns/{returnId} ─────────────────────────
export interface KitchenReturnItem {
    productId: string;
    productName: string;
    quantity: number;
    unit: string;
}

export interface KitchenReturn {
    id: string;
    items: KitchenReturnItem[];
    verifiedBy: string;
    verifiedById: string;
    date: string;               // YYYY-MM-DD
    createdAt: Timestamp;
}

// ─── /feedback/{feedbackId} ───────────────────────────────────────────
export interface Feedback {
    id: string;
    clubId: string;
    name?: string;
    memberId?: string;
    rating: number; // 1-5
    category: 'Service' | 'Shakes' | 'Cleanliness' | 'Staff' | 'Timing' | 'Other';
    message?: string;
    createdAt: Timestamp;
    source: 'reception' | 'app';
}

// ─── /clubs/{clubId}/guestEntries/{entryId} ───────────────────────────
/**
 * One line item inside a multi-item guest entry. A shake item with qty > 1
 * spawns one kitchen order per shake (each with its own face photo + token).
 */
export interface GuestEntryItem {
    type: 'shake' | 'inventory_product' | 'membership_plan';
    productId: string;
    productName: string;
    qty: number;
    unitPrice: number;
    total: number;
    unit?: string;              // for inventory products
    // Shake-only: parallel arrays, one entry per individual shake (length === qty)
    faceUrls?: string[];
    orderIds?: string[];
    tokenNumbers?: string[];
}

export interface GuestEntry {
    id: string;
    clubId: string;
    guestName: string;
    guestPhone: string;
    guestPhoto?: string;        // primary photo (first face captured, or guest's own)
    type: 'paid' | 'unpaid';
    // ── New multi-item shape (preferred) ─────────────────────────────
    items?: GuestEntryItem[];
    totalAmount?: number;       // sum of all item totals
    orderIds?: string[];        // flattened list of every kitchen order created
    tokenNumbers?: string[];    // flattened list of every token printed
    // ── Legacy single-item fields (still read by older entries) ─────
    itemType?: 'shake' | 'inventory_product' | 'membership_plan';
    shakeProductId?: string;
    shakeProductName?: string;
    orderId?: string;           // reference to clubs/{clubId}/orders
    inventoryProductId?: string;
    inventoryProductName?: string;
    inventoryProductUnit?: string;
    inventoryQuantity?: number;
    membershipPlanId?: string;
    membershipPlanName?: string;
    membershipPlanPrice?: number;
    // Payment fields (paid only)
    amountPaid?: number;
    paymentMethod?: PaymentMethod;
    cashAmount?: number;
    upiAmount?: number;
    upiAccountId?: string;
    upiAccountName?: string;
    upiNumber?: string;
    // Metadata
    date: string;               // YYYY-MM-DD
    recordedBy: string;
    createdAt: Timestamp;
    updatedAt?: Timestamp;
    // ── First Day referral (who brought this guest in) ──
    firstDay?: boolean;
    firstDayCountAtEntry?: number;
    invitedBy?: { memberId: string; name?: string; phone?: string };
    // ── Gift card accountability (New Customer Gift Card Checklist) ──
    giftCardGiven?: boolean;
    giftCardGivenAt?: Timestamp | null;
    giftCardGivenBy?: string;
}

// ─── /clubFeedback/{feedbackId} ───────────────────────────────────────
// Messages / requests FROM club owners TO the super admin platform
export interface ClubFeedback {
    id: string;
    clubId: string;
    clubName: string;
    senderName: string;
    senderEmail: string;
    category: 'general' | 'bug_report' | 'feature_request' | 'billing' | 'support' | 'other';
    subject: string;
    message: string;
    status: 'new' | 'read' | 'resolved';
    reply?: string;
    repliedAt?: Timestamp;
    createdAt: Timestamp;
}
