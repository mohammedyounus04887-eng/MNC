import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, addDoc, Timestamp } from "firebase/firestore";
import { getStorage, ref, uploadString, getDownloadURL } from "firebase/storage";
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
const storage = getStorage(app);

async function migrate() {
    console.log("🚀 Starting landing page migration...");

    try {
        // 1. Read the updated template
        const templatePath = resolve(process.cwd(), "public/landing-template.html");
        const templateHtml = readFileSync(templatePath, "utf-8");

        // 2. Fetch all clubs
        const clubsSnap = await getDocs(collection(db, "clubs"));
        console.log(`Found ${clubsSnap.size} clubs.\n`);

        for (const clubDoc of clubsSnap.docs) {
            const clubId = clubDoc.id;
            console.log(`⏳ Migrating club: ${clubId}...`);

            // 3. Replace template placeholders with real values
            const finalHtml = templateHtml
                .replace(/\{\{CLUB_ID\}\}/g, clubId)
                .replace(/\{\{FIREBASE_API_KEY\}\}/g, env.VITE_FIREBASE_API_KEY)
                .replace(/\{\{FIREBASE_AUTH_DOMAIN\}\}/g, env.VITE_FIREBASE_AUTH_DOMAIN)
                .replace(/\{\{FIREBASE_PROJECT_ID\}\}/g, env.VITE_FIREBASE_PROJECT_ID)
                .replace(/\{\{FIREBASE_STORAGE_BUCKET\}\}/g, env.VITE_FIREBASE_STORAGE_BUCKET)
                .replace(/\{\{FIREBASE_MESSAGING_SENDER_ID\}\}/g, env.VITE_FIREBASE_MESSAGING_SENDER_ID)
                .replace(/\{\{FIREBASE_APP_ID\}\}/g, env.VITE_FIREBASE_APP_ID);

            // 4. Determine next version number from clubs/{clubId}/landingPages
            const versionsSnap = await getDocs(collection(db, `clubs/${clubId}/landingPages`));
            const nextVersion = versionsSnap.size + 1;

            const versionedPath = `clubs/${clubId}/landing/v${nextVersion}.html`;
            const activePath = `clubs/${clubId}/landing/index.html`;

            // 5. Upload versioned snapshot
            const versionedRef = ref(storage, versionedPath);
            await uploadString(versionedRef, finalHtml, "raw", { contentType: "text/html" });
            const versionedUrl = await getDownloadURL(versionedRef);
            console.log(`   ✅ Versioned copy: ${versionedPath}`);

            // 6. Overwrite active index.html
            const activeRef = ref(storage, activePath);
            await uploadString(activeRef, finalHtml, "raw", { contentType: "text/html" });
            const activeUrl = await getDownloadURL(activeRef);
            console.log(`   ✅ Active page updated: ${activePath}`);

            // 7. Write version record to clubs/{clubId}/landingPages/
            const now = Timestamp.now();
            await addDoc(collection(db, `clubs/${clubId}/landingPages`), {
                version: nextVersion,
                status: "active",
                storagePath: versionedPath,
                activeStoragePath: activePath,
                url: versionedUrl,
                activeUrl,
                publishedAt: now,
                publishedBy: "migration-script",
                sizeBytes: Buffer.byteLength(finalHtml, "utf-8"),
                note: "Auto-migrated to nested clubs/{clubId}/enquiries structure",
            });
            console.log(`   ✅ Version record saved → clubs/${clubId}/landingPages/v${nextVersion}\n`);
        }

        console.log("🎉 Migration complete!");
        process.exit(0);
    } catch (err) {
        console.error("Migration failed:", err);
        process.exit(1);
    }
}

migrate();
