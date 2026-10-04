/**
 * Seed script for local development.
 *
 * Uses the Firebase CLIENT SDK (not Admin SDK) with the same
 * VITE_ environment variables. Run via:
 *   npx tsx scripts/seedFirestore.ts
 *
 * Prerequisites:
 *   1. .env.local has valid Firebase credentials
 *   2. Firebase Auth has the seeded user accounts created manually
 *      (or via Firebase Console → Authentication → Add User)
 *   3. Firestore rules must allow writes from authenticated users
 *      or temporarily set to open for seeding
 */

import { initializeApp } from "firebase/app";
import {
    getFirestore,
    doc,
    setDoc,
    Timestamp,
} from "firebase/firestore";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load environment variables from .env.local ──────────────────────────

function loadEnv() {
    try {
        const envPath = resolve(process.cwd(), ".env.local");
        const content = readFileSync(envPath, "utf-8");
        const vars: Record<string, string> = {};

        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIndex = trimmed.indexOf("=");
            if (eqIndex === -1) continue;
            const key = trimmed.slice(0, eqIndex).trim();
            const value = trimmed.slice(eqIndex + 1).trim();
            vars[key] = value;
        }

        return vars;
    } catch {
        console.error("❌ Could not read .env.local — make sure it exists with valid Firebase credentials.");
        process.exit(1);
    }
}

const env = loadEnv();

// ── Initialize Firebase ─────────────────────────────────────────────────

const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
});

const db = getFirestore(app);

// ── Helpers ─────────────────────────────────────────────────────────────

const now = Timestamp.now();

function futureDate(days: number): Timestamp {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return Timestamp.fromDate(d);
}

// ── Seed Data ───────────────────────────────────────────────────────────

async function seed() {
    console.log("🌱 Starting Firestore seed…\n");

    // 1. Platform config
    console.log("  📋 Platform config…");
    await setDoc(doc(db, "platform", "config"), {
        totalClubs: 1,
        totalMembers: 3,
        lastUpdated: now,
    });

    // 2. Club
    console.log("  🏠 Club: dev_club…");
    await setDoc(doc(db, "clubs", "dev_club"), {
        id: "dev_club",
        name: "Magic Nutrition Club",
        currencyName: "MNC Coins",
        domain: "localhost",
        parentClubId: null,
        treePath: "dev_club",
        theme: "theme_1",
        primaryColor: "#8B5CF6",
        logo: "",
        heroImage: "",
        tagline: "Your Health, Our Mission",
        ownerName: "Dev Owner",
        ownerPhone: "+91 9999999999",
        ownerUserId: "owner_user_1",
        status: "active",
        maintenancePaid: true,
        maintenanceDueDate: futureDate(30),
        kitchenPin: "1234",
        createdAt: now,
        createdBy: "superadmin_user_1",
    });

    // 3. Users
    // NOTE: These user document IDs must match the UIDs of Firebase Auth users
    //       you create in the Firebase Console.

    console.log("  👤 User: superAdmin…");
    await setDoc(doc(db, "users", "superadmin_user_1"), {
        id: "superadmin_user_1",
        name: "Super Admin",
        phone: "+91 9000000001",
        email: "superadmin@mnc.com",
        photo: "",
        role: "superAdmin",
        clubId: "dev_club",
        parentUserId: null,
        treePath: "superadmin_user_1",
        membershipTier: null,
        membershipStart: null,
        membershipEnd: null,
        membershipPlanId: null,
        status: "active",
        dob: null,
        anniversary: null,
        qrCode: "",
        isClubOwner: false,
        ownedClubId: null,
        originalClubId: "dev_club",
        referredBy: null,
        createdAt: now,
        updatedAt: now,
    });

    console.log("  👤 User: clubOwner…");
    await setDoc(doc(db, "users", "owner_user_1"), {
        id: "owner_user_1",
        name: "Dev Owner",
        phone: "+91 9000000002",
        email: "owner@mnc.com",
        photo: "",
        role: "clubOwner",
        clubId: "dev_club",
        parentUserId: "superadmin_user_1",
        treePath: "superadmin_user_1/owner_user_1",
        membershipTier: null,
        membershipStart: null,
        membershipEnd: null,
        membershipPlanId: null,
        status: "active",
        dob: null,
        anniversary: null,
        qrCode: "",
        isClubOwner: true,
        ownedClubId: "dev_club",
        originalClubId: "dev_club",
        referredBy: "superadmin_user_1",
        createdAt: now,
        updatedAt: now,
    });

    console.log("  👤 User: staff…");
    await setDoc(doc(db, "users", "staff_user_1"), {
        id: "staff_user_1",
        name: "Dev Staff",
        phone: "+91 9000000003",
        email: "staff@mnc.com",
        photo: "",
        role: "staff",
        clubId: "dev_club",
        parentUserId: "owner_user_1",
        treePath: "superadmin_user_1/owner_user_1/staff_user_1",
        membershipTier: null,
        membershipStart: null,
        membershipEnd: null,
        membershipPlanId: null,
        status: "active",
        dob: null,
        anniversary: null,
        qrCode: "",
        isClubOwner: false,
        ownedClubId: null,
        originalClubId: "dev_club",
        referredBy: "owner_user_1",
        createdAt: now,
        updatedAt: now,
    });

    console.log("  👤 User: member1…");
    await setDoc(doc(db, "users", "member_user_1"), {
        id: "member_user_1",
        name: "Dev Member One",
        phone: "+91 9000000004",
        email: "member@mnc.com",
        photo: "",
        role: "member",
        clubId: "dev_club",
        parentUserId: "owner_user_1",
        treePath: "superadmin_user_1/owner_user_1/member_user_1",
        membershipTier: "gold",
        membershipStart: now,
        membershipEnd: futureDate(30),
        membershipPlanId: "gold_plan_1",
        status: "active",
        dob: null,
        anniversary: null,
        qrCode: "",
        isClubOwner: false,
        ownedClubId: null,
        originalClubId: "dev_club",
        referredBy: "owner_user_1",
        createdAt: now,
        updatedAt: now,
    });

    console.log("  👤 User: member2 (referred by member1)…");
    await setDoc(doc(db, "users", "member_user_2"), {
        id: "member_user_2",
        name: "Dev Member Two",
        phone: "+91 9000000005",
        email: "member2@mnc.com",
        photo: "",
        role: "member",
        clubId: "dev_club",
        parentUserId: "member_user_1",
        treePath: "superadmin_user_1/owner_user_1/member_user_1/member_user_2",
        membershipTier: "silver",
        membershipStart: now,
        membershipEnd: futureDate(30),
        membershipPlanId: "gold_plan_1",
        status: "active",
        dob: null,
        anniversary: null,
        qrCode: "",
        isClubOwner: false,
        ownedClubId: null,
        originalClubId: "dev_club",
        referredBy: "member_user_1",
        createdAt: now,
        updatedAt: now,
    });

    // 4. Wallets
    console.log("  💰 Wallets…");
    for (const userId of ["owner_user_1", "member_user_1", "member_user_2"]) {
        await setDoc(doc(db, "wallets", userId), {
            userId,
            clubId: "dev_club",
            currencyName: "MNC Coins",
            balance: 500,
            lastUpdated: now,
        });
    }

    // 5. Products
    console.log("  🥤 Products…");
    await setDoc(doc(db, "products", "product_1"), {
        id: "product_1",
        clubId: "dev_club",
        name: "Mango Shake",
        category: "shake",
        price: 50,
        stock: 100,
        lowStockThreshold: 10,
        expiryDate: futureDate(90),
        photo: "",
        isAvailableToday: true,
        createdAt: now,
        updatedAt: now,
    });

    await setDoc(doc(db, "products", "product_2"), {
        id: "product_2",
        clubId: "dev_club",
        name: "Protein Bar",
        category: "snack",
        price: 30,
        stock: 50,
        lowStockThreshold: 5,
        expiryDate: futureDate(60),
        photo: "",
        isAvailableToday: true,
        createdAt: now,
        updatedAt: now,
    });

    // 6. Membership plan
    console.log("  🏅 Membership plan: Gold…");
    await setDoc(doc(db, "memberships", "gold_plan_1"), {
        id: "gold_plan_1",
        clubId: "dev_club",
        name: "Gold",
        price: 300,
        durationDays: 30,
        benefits: [
            "Unlimited shakes",
            "Priority booking",
            "Exclusive member events",
            "Personal nutrition plan",
        ],
        color: "#FFD700",
        isActive: true,
        createdAt: now,
    });

    // 7. Announcement
    console.log("  📢 Announcement…");
    await setDoc(doc(db, "announcements", "announcement_1"), {
        id: "announcement_1",
        clubId: "dev_club",
        title: "Welcome to Magic Nutrition Club!",
        message:
            "We are thrilled to have you here. Check out our Gold membership for exclusive benefits!",
        postedBy: "owner_user_1",
        createdAt: now,
        expiresAt: futureDate(30),
        isActive: true,
    });

    console.log("\n✅ Seed complete! All documents created in Firestore.");
    console.log("\n📝 Remember to create Firebase Auth users in the Firebase Console:");
    console.log("   • superadmin@mnc.com");
    console.log("   • owner@mnc.com");
    console.log("   • staff@mnc.com");
    console.log("   • member@mnc.com");
    console.log("   • member2@mnc.com");
    console.log("   Match their UIDs to the document IDs above.\n");

    process.exit(0);
}

seed().catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
});
