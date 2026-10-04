import { initializeApp } from "firebase/app";
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword
} from "firebase/auth";
import {
    getFirestore,
    doc,
    setDoc,
    Timestamp
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
const auth = getAuth(app);

const now = Timestamp.now();

function futureDate(days: number): Timestamp {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return Timestamp.fromDate(d);
}

// ── Helper to create/login auth user ─────────────────────────────────────

async function getOrCreateUser(email: string, pass: string) {
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        console.log(`✅ Created Auth user for ${email} with UID: ${cred.user.uid}`);
        return cred.user.uid;
    } catch (error: any) {
        if (error.code === 'auth/email-already-in-use') {
            console.log(`⚠️ User ${email} already exists, attempting to log in to get UID...`);
            try {
                const cred = await signInWithEmailAndPassword(auth, email, pass);
                console.log(`✅ Logged in Auth user for ${email} with UID: ${cred.user.uid}`);
                return cred.user.uid;
            } catch (loginError: any) {
                console.error(`❌ Failed to login to existing user ${email}:`, loginError.message);
                throw loginError;
            }
        }
        console.error(`❌ Failed to create user ${email}:`, error.message);
        throw error;
    }
}

// ── Main Seed Script ───────────────────────────────────────────────────

async function setupUsers() {
    console.log("🌱 Setting up real Auth users and matching Firestore records...\n");
    const password = "123456";

    // 1. Super Admin
    const superAdminUid = await getOrCreateUser("superadmin@mnc.com", password);
    await setDoc(doc(db, "users", superAdminUid), {
        id: superAdminUid,
        name: "Super Admin",
        phone: "+91 9000000001",
        email: "superadmin@mnc.com",
        photo: "",
        role: "superAdmin",
        clubId: "dev_club",
        parentUserId: null,
        treePath: superAdminUid,
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
    console.log("  ✅ Added Super Admin to Firestore");

    // 2. Owner
    const ownerUid = await getOrCreateUser("owner@mnc.com", password);
    await setDoc(doc(db, "users", ownerUid), {
        id: ownerUid,
        name: "Dev Owner",
        phone: "+91 9000000002",
        email: "owner@mnc.com",
        photo: "",
        role: "clubOwner",
        clubId: "dev_club",
        parentUserId: superAdminUid,
        treePath: `${superAdminUid}/${ownerUid}`,
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
        referredBy: superAdminUid,
        createdAt: now,
        updatedAt: now,
    });
    console.log("  ✅ Added Owner to Firestore");

    // Create a generic DEV CLUB if it doesn't exist, attached to this owner UID
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
        ownerUserId: ownerUid,
        status: "active",
        maintenancePaid: true,
        maintenanceDueDate: futureDate(30),
        kitchenPin: "1234",
        createdAt: now,
        createdBy: superAdminUid,
    });
    console.log("  ✅ Added generic Dev Club to Firestore");

    // 3. Member
    const memberUid = await getOrCreateUser("member@mnc.com", password);
    await setDoc(doc(db, "users", memberUid), {
        id: memberUid,
        name: "Dev Member One",
        phone: "+91 9000000004",
        email: "member@mnc.com",
        photo: "",
        role: "member",
        clubId: "dev_club",
        parentUserId: ownerUid,
        treePath: `${superAdminUid}/${ownerUid}/${memberUid}`,
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
        referredBy: ownerUid,
        createdAt: now,
        updatedAt: now,
    });
    console.log("  ✅ Added Member to Firestore");

    // Add member wallet
    await setDoc(doc(db, "wallets", memberUid), {
        userId: memberUid,
        clubId: "dev_club",
        currencyName: "MNC Coins",
        balance: 500,
        lastUpdated: now,
    });

    // Add owner wallet
    await setDoc(doc(db, "wallets", ownerUid), {
        userId: ownerUid,
        clubId: "dev_club",
        currencyName: "MNC Coins",
        balance: 500,
        lastUpdated: now,
    });

    console.log("\n🎉 Finished setting up all test users with authentication!");
    console.log("You can now login with:\n - superadmin@mnc.com\n - owner@mnc.com\n - member@mnc.com\nPassword for all: 123456\n");

    process.exit(0);
}

setupUsers().catch(err => {
    console.error("Critical error in setup", err);
    process.exit(1);
});
