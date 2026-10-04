const REPOSITORY_ROLE = "club";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const knownTargets = ["magic-nutrition-club", "grow--line", "growline-dev"];
const emulatorNames = ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST", "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST", "NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST", "NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN"];
const audience = "urn:club-growline:staging";

/** Offline configuration check. Never connects to Firebase or prints values. */
export function checkStaging(role, targets, env, ambient = {}, blocked = [], phase = "disabled") {
  const errors = [];
  const fail = (name) => errors.push(name);
  const required = (name) => { if (!env[name]?.trim()) fail("MISSING_" + name); };
  const projectIds = [targets.clubProjectId, targets.growlineProjectId];
  if (targets.environment !== "staging" || targets.appHostingEnvironment !== "staging") fail("STAGING_ENVIRONMENT_REQUIRED");
  for (const [index, value] of projectIds.entries()) {
    if (typeof value !== "string" || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value)) fail(index === 0 ? "CLUB_STAGING_PROJECT_ID_REQUIRED" : "GROWLINE_STAGING_PROJECT_ID_REQUIRED");
    if ([...knownTargets, ...blocked].includes(value) || value?.startsWith("demo-")) fail("EXISTING_OR_EMULATOR_PROJECT_REJECTED");
  }
  if (projectIds[0] === projectIds[1]) fail("DISTINCT_PROJECTS_REQUIRED");
  const expected = role === "club" ? targets.clubProjectId : targets.growlineProjectId;
  for (const name of ["GCLOUD_PROJECT", "GCP_PROJECT"]) {
    if ((env[name] && env[name] !== expected) || (ambient[name] && ambient[name] !== expected)) fail("RUNTIME_PROJECT_MISMATCH_" + name);
  }
  for (const [name, value] of Object.entries(env)) {
    if (ambient[name] && ambient[name] !== value) fail("AMBIENT_OVERRIDE_" + name);
    if (/^(VITE_|NEXT_PUBLIC_).*(SECRET|PRIVATE|PEPPER|SERVICE_ACCOUNT|SERVICE_KEY)/.test(name) && value) fail("PUBLIC_SECRET_NAME_" + name);
  }
  for (const name of emulatorNames) if (env[name] || ambient[name]) fail("STAGING_EMULATOR_OR_DEBUG_SETTING_" + name);
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    try { if (JSON.parse(env.FIREBASE_SERVICE_ACCOUNT).project_id !== expected) fail("SERVICE_ACCOUNT_PROJECT_MISMATCH"); }
    catch { fail("INVALID_FIREBASE_SERVICE_ACCOUNT"); }
  }
  if (ambient.FIREBASE_SERVICE_ACCOUNT && ambient.FIREBASE_SERVICE_ACCOUNT !== env.FIREBASE_SERVICE_ACCOUNT) fail("AMBIENT_SERVICE_ACCOUNT_REJECTED");
  if (ambient.GOOGLE_APPLICATION_CREDENTIALS || env.GOOGLE_APPLICATION_CREDENTIALS) fail("LOCAL_ADC_KEY_FILE_REQUIRES_SEPARATE_PROJECT_REVIEW");
  if (!["disabled", "verification", "sso-verification"].includes(phase)) fail("INVALID_PHASE");
  if (env.INTEGRATION_HANDOFF_ENABLED !== (phase === "verification" ? "true" : "false")) fail("HANDOFF_FLAG_PHASE_MISMATCH");
  for (const [name, value] of [["clubOrigin", targets.clubOrigin], ["growlineOrigin", targets.growlineOrigin]]) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.origin !== value || url.username || url.password ||
          /localhost|127\.0\.0\.1|magicnutritionclub\.com|magic-nutrition-club|grow--line/.test(url.hostname)) fail("ISOLATED_HTTPS_" + name + "_REQUIRED");
    } catch { fail("ISOLATED_HTTPS_" + name + "_REQUIRED"); }
  }
  if (targets.clubOrigin === targets.growlineOrigin) fail("DISTINCT_ORIGINS_REQUIRED");
  if (role === "club") {
    for (const name of ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_STORAGE_BUCKET", "VITE_FIREBASE_MESSAGING_SENDER_ID", "VITE_FIREBASE_APP_ID", "GROWLINE_PROJECT_ID"]) required(name);
    if (env.VITE_FIREBASE_PROJECT_ID !== expected || env.GROWLINE_PROJECT_ID !== targets.growlineProjectId) fail("CLUB_PROJECT_PAIR_MISMATCH");
    if (env.VITE_FIREBASE_AUTH_DOMAIN !== expected + ".firebaseapp.com") fail("CLUB_AUTH_DOMAIN_MISMATCH");
    if (![expected + ".appspot.com", expected + ".firebasestorage.app"].includes(env.VITE_FIREBASE_STORAGE_BUCKET)) fail("CLUB_STORAGE_BUCKET_MISMATCH");
    if (env.VITE_USE_FIREBASE_EMULATORS !== "false") fail("CLUB_EMULATORS_MUST_BE_FALSE");
    if (env.CLUB_INTEGRATION_AUDIENCE !== audience) fail("CLUB_STAGING_AUDIENCE_REQUIRED");
  } else {
    for (const name of ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", "NEXT_PUBLIC_FIREBASE_API_KEY", "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "NEXT_PUBLIC_FIREBASE_APP_ID", "NEXT_PUBLIC_SITE_URL", "CLUB_FIREBASE_PROJECT_ID", "GROWLINE_CLUB_SERVICE_KEY_ID", "DATABASE_URL"]) required(name);
    if (env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== expected || env.CLUB_FIREBASE_PROJECT_ID !== targets.clubProjectId) fail("GROWLINE_PROJECT_PAIR_MISMATCH");
    if (env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN !== expected + ".firebaseapp.com") fail("GROWLINE_AUTH_DOMAIN_MISMATCH");
    if (env.NEXT_PUBLIC_SITE_URL !== targets.growlineOrigin) fail("GROWLINE_ORIGIN_MISMATCH");
    if (env.GROWLINE_CLUB_DESTINATION_AUDIENCE !== audience) fail("GROWLINE_STAGING_AUDIENCE_REQUIRED");
    if (env.DEMO_MODE !== "false") fail("DEMO_MODE_MUST_BE_FALSE");
    if (!targets.growlineBackendId || !/^[a-z][a-z0-9-]*$/.test(targets.growlineBackendId)) fail("GROWLINE_STAGING_BACKEND_REQUIRED");
    const base = "https://us-central1-" + targets.clubProjectId + ".cloudfunctions.net/";
    for (const [name, endpoint] of [["GROWLINE_CLUB_DESTINATION_URL", "growlineHandoff"], ["GROWLINE_CLUB_REDEEM_URL", "redeemGrowlineClubCode"], ["GROWLINE_CLUB_REVOKE_URL", "revokeGrowlineClubLink"]]) {
      if (env[name] !== base + endpoint) fail("STAGING_ENDPOINT_MISMATCH_" + name);
    }
    if (phase === "verification") {
      required("GROWLINE_CLUB_CONSENT_TEXT");
      required("GROWLINE_CLUB_CONSENT_VERSION");
    }
    for (const name of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_PLAN_MONTHLY", "RAZORPAY_PLAN_ANNUAL", "VAPID_PRIVATE_KEY", "NEXT_PUBLIC_VAPID_PUBLIC_KEY", "CRON_SECRET"]) {
      if (env[name] || ambient[name]) fail("ISOLATED_CORE_STAGING_MUST_DISABLE_" + name);
    }
  }
  if (phase === "disabled" && (env.INTEGRATION_ACTIVITY_ENABLED === "true" || ambient.INTEGRATION_ACTIVITY_ENABLED === "true")) fail("ACTIVITY_MUST_BE_DISABLED_DURING_PREPARATION");
  if (env.GROWLINE_JOBS_ENABLED === "true" || ambient.GROWLINE_JOBS_ENABLED === "true") fail("JOBS_REQUIRE_SEPARATE_STAGING_APPROVAL");
  if (phase === "sso-verification") {
    if (env.INTEGRATION_SSO_ENABLED !== "true") fail("SSO_FLAG_PHASE_MISMATCH");
    if (!env.STAGING_SSO_APPROVAL_REFERENCE || env.STAGING_SSO_APPROVAL_REFERENCE.trim().length < 8) fail("SSO_EXPLICIT_STAGING_APPROVAL_REFERENCE_REQUIRED");
    required("FEDERATION_SERVICE_KEY_ID");
    if ([env.GROWLINE_CLUB_SERVICE_KEY_ID, env.CLUB_GROWLINE_SERVICE_KEY_ID].includes(env.FEDERATION_SERVICE_KEY_ID)) fail("SSO_DEDICATED_KEY_ID_REQUIRED");
    if (env.FEDERATION_CLUB_ORIGIN !== targets.clubOrigin || env.FEDERATION_GROWLINE_ORIGIN !== targets.growlineOrigin) fail("SSO_DESTINATION_ORIGIN_MISMATCH");
    const peer = role === "club" ? targets.growlineOrigin + "/api/integration/federation" : "https://us-central1-" + targets.clubProjectId + ".cloudfunctions.net/federation";
    if (env.FEDERATION_PEER_URL !== peer) fail("SSO_PEER_PROJECT_ORIGIN_MISMATCH");
    if (role === "club" && env.VITE_INTEGRATION_SSO_ENABLED !== "true") fail("SSO_BROWSER_SERVER_FLAG_MISMATCH");
    if (env.FEDERATION_SERVICE_KEY || ambient.FEDERATION_SERVICE_KEY) fail("SSO_USE_SECRET_MANAGER_BINDING");
  } else if (env.INTEGRATION_SSO_ENABLED === "true" || ambient.INTEGRATION_SSO_ENABLED === "true" || env.VITE_INTEGRATION_SSO_ENABLED === "true") fail("SSO_REQUIRES_VERIFIED_ACCOUNT_PAIR_AND_AUTH_GATE");
  if (env.INTEGRATION_ACTIVITY_ENABLED === "true") {
    required("GROWLINE_INTEGRATION_AUDIENCE");
    if (role === "club") { required("GROWLINE_ACTIVITY_URL"); required("CLUB_GROWLINE_SERVICE_KEY_ID"); }
  }
  if (role === "club" && env.GROWLINE_ACTIVITY_URL && env.GROWLINE_ACTIVITY_URL !== targets.growlineOrigin + "/api/integration/club-activity") fail("ACTIVITY_ENDPOINT_PROJECT_ORIGIN_MISMATCH");
  if (role === "growline" && env.CLUB_WEB_ORIGIN && env.CLUB_WEB_ORIGIN !== targets.clubOrigin) fail("CLUB_NAVIGATION_ORIGIN_MISMATCH");
  return [...new Set(errors)];
}

export function compareProfile(expected, actual, label) {
  return [
    ...Object.keys(expected).filter((name) => actual[name] !== expected[name]).map((name) => label + name),
    ...Object.keys(actual).filter((name) => !Object.hasOwn(expected, name)).map((name) => label + "UNREVIEWED_" + name),
  ];
}

export function checkAppHosting(env, yaml) {
  const errors = [];
  const entries = [...yaml.matchAll(/- variable: (\w+)\r?\n([\s\S]*?)(?=\r?\n\s*- variable: |$)/g)];
  const values = {};
  const names = [];
  for (const [, name, block] of entries) {
    names.push(name);
    const value = block.match(/^\s+value: ("(?:[^"\\]|\\.)*"|[^\r\n]*)/m)?.[1];
    if (value !== undefined) values[name] = value.startsWith('"') ? JSON.parse(value) : value.trim();
    const requiredAvailability = name.startsWith("NEXT_PUBLIC_") || name === "DATABASE_URL" ? ["BUILD", "RUNTIME"] : ["RUNTIME"];
    if (requiredAvailability.some((mode) => !new RegExp("- " + mode + "\\b").test(block))) errors.push("APPHOSTING_AVAILABILITY_" + name);
    if (name === "GROWLINE_CLUB_SERVICE_KEY" && (value !== undefined || !/^\s+secret: GROWLINE_CLUB_SERVICE_KEY(?:@\d+)?\s*$/m.test(block))) errors.push("STAGING_SERVICE_KEY_SECRET_REFERENCE_REQUIRED");
    if (name === "FEDERATION_SERVICE_KEY" && (value !== undefined || !/^\s+secret: FEDERATION_SERVICE_KEY(?:@\d+)?\s*$/m.test(block))) errors.push("SSO_SECRET_REFERENCE_REQUIRED");
    if (!["GROWLINE_CLUB_SERVICE_KEY", "FEDERATION_SERVICE_KEY"].includes(name) && /\n\s+secret:/.test(block)) errors.push("UNREVIEWED_APPHOSTING_SECRET_" + name);
  }
  errors.push(...compareProfile(env, values, "APPHOSTING_OVERRIDE_MISMATCH_"));
  if (env.INTEGRATION_SSO_ENABLED === "true" && !names.includes("FEDERATION_SERVICE_KEY")) errors.push("SSO_SECRET_REFERENCE_REQUIRED");
  if (!names.includes("GROWLINE_CLUB_SERVICE_KEY")) errors.push("STAGING_SERVICE_KEY_SECRET_REFERENCE_REQUIRED");
  for (const name of names) {
    if (names.filter((entry) => entry === name).length !== 1) errors.push("DUPLICATE_APPHOSTING_VARIABLE_" + name);
    if (!(name in env) && !["GROWLINE_CLUB_SERVICE_KEY", "FEDERATION_SERVICE_KEY"].includes(name)) errors.push("UNREVIEWED_APPHOSTING_VARIABLE_" + name);
  }
  return [...new Set(errors)];
}

export function runPreflight(role, args = process.argv.slice(2)) {
  try {
    const phase = args[0] ?? process.env.STAGING_VERIFICATION_PHASE ?? "disabled";
    const targets = JSON.parse(readFileSync("staging/targets.local.json", "utf8"));
    const files = role === "club" ? ["staging/web.env.local", "staging/functions.env.local"] : ["staging/server.env.local"];
    const env = Object.assign({}, ...files.map((file) => parseEnv(readFileSync(file, "utf8"))));
    const aliases = JSON.parse(readFileSync(".firebaserc", "utf8")).projects ?? {};
    const errors = checkStaging(role, targets, env, process.env, Object.values(aliases), phase);
    if (role === "club" && readFileSync("src/main.tsx", "utf8").includes("seedSuperAdminIfNeeded")) errors.push("LEGACY_CLIENT_ADMIN_BOOTSTRAP_BLOCKS_STAGING");
    if (role === "club") {
      const installed = parseEnv(readFileSync(".env.staging.local", "utf8"));
      const expectedWeb = parseEnv(readFileSync("staging/web.env.local", "utf8"));
      errors.push(...compareProfile(expectedWeb, installed, "INSTALLED_WEB_PROFILE_MISMATCH_"));
      if (existsSync("functions/.env")) errors.push("BASE_FUNCTIONS_ENV_FALLBACK_REJECTED");
      const functionProfile = "functions/.env." + targets.clubProjectId;
      if (!targets.clubProjectId || !existsSync(functionProfile)) errors.push("INSTALLED_FUNCTIONS_PROFILE_REQUIRED");
      else {
        const expectedFunctions = parseEnv(readFileSync("staging/functions.env.local", "utf8"));
        const installedFunctions = parseEnv(readFileSync(functionProfile, "utf8"));
        errors.push(...compareProfile(expectedFunctions, installedFunctions, "INSTALLED_FUNCTIONS_PROFILE_MISMATCH_"));
      }
      if (readFileSync("public/firebase-messaging-sw.js", "utf8").includes("magic-nutrition-club")) errors.push("PRODUCTION_MESSAGING_WORKER_CONFIG_BLOCKS_STAGING");
    }
    if (role === "growline") {
      const config = JSON.parse(readFileSync("firebase.staging.json", "utf8"));
      if (config.apphosting?.[0]?.backendId !== targets.growlineBackendId) errors.push("APPHOSTING_BACKEND_MISMATCH");
      // Only inspect name/value pairs; secret references are never resolved.
      const yaml = readFileSync("apphosting.staging.yaml", "utf8");
      errors.push(...checkAppHosting(env, yaml));
    }
    if (errors.length) {
      for (const error of errors) console.error(error);
      process.exitCode = 1;
      return;
    }
    console.log("Staging configuration preflight passed. This does not verify IAM, secrets, deployment approval, or live resources.");
  } catch {
    console.error("STAGING_INPUTS_MISSING_OR_INVALID: supply staging/targets.local.json and local env profiles; no values printed.");
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) runPreflight(REPOSITORY_ROLE);
