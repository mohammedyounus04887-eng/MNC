/**
 * Run once to seed global Herbalife menu items into Firestore.
 * Usage: npx tsx src/scripts/seedGlobalMenu.ts
 *        (ensure VITE_* env vars are set or use a service account)
 */

import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, Timestamp } from "firebase/firestore";

const firebaseConfig = {
    // Paste your Firebase config here — same as src/lib/firebase.ts
    apiKey: process.env.VITE_FIREBASE_API_KEY || "",
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.VITE_FIREBASE_PROJECT_ID || "magic-nutrition-club",
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.VITE_FIREBASE_APP_ID || "",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const ITEMS = [
    {
        name: "Formula 1 Shake — Chocolate",
        category: "shake",
        description: "Herbalife's most popular shake. Rich chocolate flavour, high protein, 21 essential vitamins and minerals. Low calorie meal replacement.",
        nutritionInfo: "220 cal | 24g protein | 21 vitamins & minerals",
        ingredients: "Soy protein, cocoa powder, vitamins, minerals",
        isVeg: true,
        isActive: true,
        imageUrl: null,
        sortOrder: 1,
        source: "global",
    },
    {
        name: "Formula 1 Shake — Vanilla",
        category: "shake",
        description: "Smooth and creamy vanilla shake. Classic flavour loved by all members. Perfect meal replacement for weight loss.",
        nutritionInfo: "220 cal | 24g protein | 21 vitamins & minerals",
        isVeg: true,
        isActive: true,
        imageUrl: null,
        sortOrder: 2,
        source: "global",
    },
    {
        name: "Formula 1 Shake — Strawberry",
        category: "shake",
        description: "Fresh and fruity strawberry shake. Light, refreshing and delicious. Great for members who prefer fruity flavours.",
        nutritionInfo: "220 cal | 24g protein | 21 vitamins & minerals",
        isVeg: true,
        isActive: true,
        imageUrl: null,
        sortOrder: 3,
        source: "global",
    },
    {
        name: "Formula 1 Shake — Mango",
        category: "shake",
        description: "Tropical mango flavour shake. A favourite among Indian members. Naturally sweet and filling.",
        nutritionInfo: "220 cal | 24g protein | 21 vitamins & minerals",
        isVeg: true,
        isActive: true,
        imageUrl: null,
        sortOrder: 4,
        source: "global",
    },
    {
        name: "Formula 1 Shake — Coffee",
        category: "shake",
        description: "Rich coffee flavour with a caffeine boost. Perfect for morning energy and weight management.",
        nutritionInfo: "220 cal | 24g protein | 21 vitamins & minerals",
        isVeg: true,
        isActive: true,
        imageUrl: null,
        sortOrder: 5,
        source: "global",
    },
    {
        name: "Formula 1 Shake — Banana",
        category: "shake",
        description: "Creamy banana shake — naturally sweet, potassium-rich, and very filling. A great post-workout option.",
        nutritionInfo: "220 cal | 24g protein | 21 vitamins & minerals",
        isVeg: true,
        isActive: true,
        imageUrl: null,
        sortOrder: 6,
        source: "global",
    },
    {
        name: "Formula 1 Shake — Mixed Berry",
        category: "shake",
        description: "Blend of strawberry, blueberry and raspberry. Antioxidant-rich and refreshing. Members love the colour!",
        nutritionInfo: "220 cal | 24g protein | 21 vitamins & minerals",
        isVeg: true,
        isActive: true,
        imageUrl: null,
        sortOrder: 7,
        source: "global",
    },
    {
        name: "Herbalife Tea — Lemon",
        category: "tea",
        description: "Instant Herbal Beverage. Lemon flavoured energising tea. Boosts metabolism and energy levels. Only 6 calories per serving.",
        nutritionInfo: "6 cal | 85mg caffeine | green tea extract",
        isVeg: true,
        isActive: true,
        imageUrl: null,
        sortOrder: 8,
        source: "global",
    },
    {
        name: "Herbalife Tea — Peach",
        category: "tea",
        description: "Instant Herbal Beverage. Sweet peach flavour energising tea. Thermogenic — helps burn calories. A club favourite add-on.",
        nutritionInfo: "6 cal | 85mg caffeine | green tea extract",
        isVeg: true,
        isActive: true,
        imageUrl: null,
        sortOrder: 9,
        source: "global",
    },
    {
        name: "Herbalife Tea — Raspberry",
        category: "tea",
        description: "Instant Herbal Beverage. Tangy raspberry flavour. Perfect hot or cold. Great metabolism booster.",
        nutritionInfo: "6 cal | 85mg caffeine | green tea extract",
        isVeg: true,
        isActive: true,
        imageUrl: null,
        sortOrder: 10,
        source: "global",
    },
    {
        name: "Protein Shake — Extra Protein",
        category: "shake",
        description: "High protein shake for members with muscle building goals. Made with Formula 1 + Protein Powder. Extra filling and nutritious.",
        nutritionInfo: "280 cal | 40g protein | 21 vitamins & minerals",
        isVeg: true,
        isActive: true,
        imageUrl: null,
        sortOrder: 11,
        source: "global",
    },
    {
        name: "Aloe Vera Drink — Original",
        category: "drink",
        description: "Herbalife Aloe concentrate drink. Supports digestion and gut health. Refreshing, light and calming. Often served alongside the shake.",
        nutritionInfo: "15 cal | aloe vera extract",
        isVeg: true,
        isActive: true,
        imageUrl: null,
        sortOrder: 12,
        source: "global",
    },
];

async function seed() {
    console.log(`Seeding ${ITEMS.length} global menu items...`);
    const now = Timestamp.now();
    for (const item of ITEMS) {
        const docRef = await addDoc(collection(db, "globalMenu"), {
            ...item,
            createdAt: now,
            updatedAt: now,
        });
        console.log(`✅ Added: ${item.name} (${docRef.id})`);
    }
    console.log("\n🎉 Seed complete!");
    process.exit(0);
}

seed().catch(err => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
});
