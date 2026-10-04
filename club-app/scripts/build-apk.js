import { execSync } from "child_process";
import { copyFileSync, writeFileSync } from "fs";
import { join } from "path";

const MODE_NAMES = {
  reception: "MNC Reception",
  kitchen:   "MNC Kitchen",
  admin:     "MNC Admin",
  member:    "MNC Members Dashboard",
  landing:   "Magic Nutrition Club",
};

const mode = process.argv[2];

if (!mode || !MODE_NAMES[mode]) {
  console.error("Usage: node scripts/build-apk.js <reception|kitchen|admin|member|landing>");
  console.error("Available:", Object.keys(MODE_NAMES).join(", "));
  process.exit(1);
}

const appName = MODE_NAMES[mode];
console.log(`\n🔨 Building APK: ${appName} (mode=${mode})\n`);

// 1. Update app name in strings.xml
const stringsXml = `<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">${appName}</string>
    <string name="title_activity_main">${appName}</string>
    <string name="package_name">com.magicnutrition.hub</string>
    <string name="custom_url_scheme">com.magicnutrition.hub</string>
</resources>`;
writeFileSync("android/app/src/main/res/values/strings.xml", stringsXml);
console.log(`✓ App name → ${appName}`);

// 2. Copy PWA icon to all mipmap folders (Android scales as needed)
const iconSrc = "public/pwa-512x512.png";
const mipmaps = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
for (const size of mipmaps) {
  const dir = `android/app/src/main/res/mipmap-${size}`;
  copyFileSync(iconSrc, join(dir, "ic_launcher.png"));
  copyFileSync(iconSrc, join(dir, "ic_launcher_round.png"));
  copyFileSync(iconSrc, join(dir, "ic_launcher_foreground.png"));
}
console.log("✓ Icons updated from pwa-512x512.png");

// 3. Build Vite frontend with the mode
console.log(`\n⚙️  Building frontend (mode=${mode})...`);
execSync(`npx vite build --mode ${mode}`, { stdio: "inherit" });

// 4. Sync to Android
console.log("\n📱 Syncing to Android...");
execSync("npx cap sync android", { stdio: "inherit" });

// 5. Build APK via Gradle
console.log("\n🏗️  Running Gradle assembleDebug...");
const gradlew = process.platform === "win32" ? ".\\gradlew.bat" : "./gradlew";
execSync(`${gradlew} assembleDebug`, { stdio: "inherit", shell: true, cwd: "android" });

// 6. Copy and rename APK
const apkDest = `${mode}.apk`;
copyFileSync("android/app/build/outputs/apk/debug/app-debug.apk", apkDest);
console.log(`\n✅ Done! APK saved as: ${apkDest}\n`);
