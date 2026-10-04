import test from "node:test";
import assert from "node:assert/strict";
import { checkStaging, compareProfile, checkAppHosting } from "./verify.mjs";

const targets = { environment: "staging", appHostingEnvironment: "staging", clubProjectId: "staging-club-test", growlineProjectId: "staging-growline-test", clubOrigin: "https://staging-club-test.web.app", growlineOrigin: "https://staging-growline-test.example.test", growlineBackendId: "staging-growline-test" };
const club = { INTEGRATION_HANDOFF_ENABLED: "false", VITE_FIREBASE_API_KEY: "test-public-config", VITE_FIREBASE_AUTH_DOMAIN: "staging-club-test.firebaseapp.com", VITE_FIREBASE_PROJECT_ID: "staging-club-test", VITE_FIREBASE_STORAGE_BUCKET: "staging-club-test.firebasestorage.app", VITE_FIREBASE_MESSAGING_SENDER_ID: "test-public-config", VITE_FIREBASE_APP_ID: "test-public-config", VITE_USE_FIREBASE_EMULATORS: "false", GROWLINE_PROJECT_ID: "staging-growline-test", CLUB_INTEGRATION_AUDIENCE: "urn:club-growline:staging" };
const growline = { INTEGRATION_HANDOFF_ENABLED: "false", DEMO_MODE: "false", NEXT_PUBLIC_FIREBASE_PROJECT_ID: "staging-growline-test", NEXT_PUBLIC_FIREBASE_API_KEY: "test-public-config", NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "staging-growline-test.firebaseapp.com", NEXT_PUBLIC_FIREBASE_APP_ID: "test-public-config", NEXT_PUBLIC_SITE_URL: targets.growlineOrigin, CLUB_FIREBASE_PROJECT_ID: targets.clubProjectId, GROWLINE_CLUB_SERVICE_KEY_ID: "staging-test-key-id", GROWLINE_CLUB_DESTINATION_AUDIENCE: "urn:club-growline:staging", GROWLINE_CLUB_DESTINATION_URL: "https://us-central1-staging-club-test.cloudfunctions.net/growlineHandoff", GROWLINE_CLUB_REDEEM_URL: "https://us-central1-staging-club-test.cloudfunctions.net/redeemGrowlineClubCode", GROWLINE_CLUB_REVOKE_URL: "https://us-central1-staging-club-test.cloudfunctions.net/revokeGrowlineClubLink", DATABASE_URL: "file:./staging-build.db" };

test("ambient flags cannot enable activity or SSO and activity activation requires its peer configuration", () => {
  assert.ok(checkStaging("club", targets, club, { INTEGRATION_ACTIVITY_ENABLED: "true" }).includes("ACTIVITY_MUST_BE_DISABLED_DURING_PREPARATION"));
  assert.ok(checkStaging("growline", targets, growline, { INTEGRATION_SSO_ENABLED: "true" }).includes("SSO_REQUIRES_VERIFIED_ACCOUNT_PAIR_AND_AUTH_GATE"));
  assert.ok(checkStaging("club", targets, { ...club, INTEGRATION_HANDOFF_ENABLED: "true", INTEGRATION_ACTIVITY_ENABLED: "true" }, {}, [], "verification").includes("MISSING_GROWLINE_ACTIVITY_URL"));
});

test("isolated non-secret profiles pass with handoff disabled", () => {
  assert.deepEqual(checkStaging("club", targets, club), []);
  assert.deepEqual(checkStaging("growline", targets, growline), []);
});
test("unknown IDs do not fall back to existing project aliases", () => {
  assert.ok(checkStaging("club", { ...targets, clubProjectId: "" }, club).includes("CLUB_STAGING_PROJECT_ID_REQUIRED"));
});
test("both configured production targets and existing dev aliases are rejected", () => {
  for (const projectId of ["magic-nutrition-club", "grow--line", "growline-dev"]) assert.ok(checkStaging("club", { ...targets, clubProjectId: projectId }, club).includes("EXISTING_OR_EMULATOR_PROJECT_REJECTED"));
  assert.ok(checkStaging("club", targets, club, {}, [targets.clubProjectId]).includes("EXISTING_OR_EMULATOR_PROJECT_REJECTED"));
});
test("repositories must use independent staging projects", () => {
  assert.ok(checkStaging("club", { ...targets, growlineProjectId: targets.clubProjectId }, club).includes("DISTINCT_PROJECTS_REQUIRED"));
});
test("wrong browser project and Storage bucket are rejected", () => {
  assert.ok(checkStaging("club", targets, { ...club, VITE_FIREBASE_PROJECT_ID: "grow--line" }).includes("CLUB_PROJECT_PAIR_MISMATCH"));
  assert.ok(checkStaging("club", targets, { ...club, VITE_FIREBASE_STORAGE_BUCKET: "magic-nutrition-club.appspot.com" }).includes("CLUB_STORAGE_BUCKET_MISMATCH"));
});
test("server and browser source/destination identity must agree", () => {
  assert.ok(checkStaging("growline", targets, { ...growline, CLUB_FIREBASE_PROJECT_ID: "magic-nutrition-club" }).includes("GROWLINE_PROJECT_PAIR_MISMATCH"));
});
test("wrong function endpoint and production origin are rejected", () => {
  assert.ok(checkStaging("growline", targets, { ...growline, GROWLINE_CLUB_REDEEM_URL: "https://us-central1-magic-nutrition-club.cloudfunctions.net/redeemGrowlineClubCode" }).includes("STAGING_ENDPOINT_MISMATCH_GROWLINE_CLUB_REDEEM_URL"));
  assert.ok(checkStaging("club", { ...targets, clubOrigin: "https://magicnutritionclub.com" }, club).includes("ISOLATED_HTTPS_clubOrigin_REQUIRED"));
});
test("handoff must be false during preparation", () => {
  assert.ok(checkStaging("club", targets, { ...club, INTEGRATION_HANDOFF_ENABLED: "true" }).includes("HANDOFF_FLAG_PHASE_MISMATCH"));
});
test("verification phase requires deliberately enabled flag and supplied consent", () => {
  const result = checkStaging("growline", targets, { ...growline, INTEGRATION_HANDOFF_ENABLED: "true" }, {}, [], "verification");
  assert.ok(result.includes("MISSING_GROWLINE_CLUB_CONSENT_TEXT"));
  assert.ok(result.includes("MISSING_GROWLINE_CLUB_CONSENT_VERSION"));
});
test("real staging never accepts emulator routing or debug tokens", () => {
  assert.ok(checkStaging("growline", targets, { ...growline, FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }).includes("STAGING_EMULATOR_OR_DEBUG_SETTING_FIREBASE_AUTH_EMULATOR_HOST"));
});
test("credential metadata must belong to the expected project", () => {
  assert.ok(checkStaging("growline", targets, { ...growline, FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: "grow--line" }) }).includes("SERVICE_ACCOUNT_PROJECT_MISMATCH"));
});
test("ambient shell overrides and CLI deploy project cannot redirect staging", () => {
  assert.ok(checkStaging("club", targets, club, { VITE_FIREBASE_PROJECT_ID: "magic-nutrition-club" }).includes("AMBIENT_OVERRIDE_VITE_FIREBASE_PROJECT_ID"));
  assert.ok(checkStaging("club", targets, club, { GCLOUD_PROJECT: "magic-nutrition-club" }).includes("RUNTIME_PROJECT_MISMATCH_GCLOUD_PROJECT"));
});
test("secret names may never be published to either browser", () => {
  assert.ok(checkStaging("growline", targets, { ...growline, NEXT_PUBLIC_GROWLINE_CLUB_SERVICE_KEY: "non-secret-test-marker" }).includes("PUBLIC_SECRET_NAME_NEXT_PUBLIC_GROWLINE_CLUB_SERVICE_KEY"));
});
test("isolated integration staging keeps payments, demo and jobs disabled", () => {
  assert.ok(checkStaging("growline", targets, { ...growline, DEMO_MODE: "true" }).includes("DEMO_MODE_MUST_BE_FALSE"));
  assert.ok(checkStaging("growline", targets, { ...growline, RAZORPAY_KEY_ID: "test-public-config" }).includes("ISOLATED_CORE_STAGING_MUST_DISABLE_RAZORPAY_KEY_ID"));
});

test("the deployed Functions flag must match its reviewed disabled profile", () => {
  const expected = { INTEGRATION_HANDOFF_ENABLED: "false", GROWLINE_PROJECT_ID: "staging-growline-test" };
  assert.deepEqual(compareProfile(expected, { ...expected }, "INSTALLED_FUNCTIONS_PROFILE_MISMATCH_"), []);
  assert.ok(compareProfile(expected, { ...expected, INTEGRATION_HANDOFF_ENABLED: "true" }, "INSTALLED_FUNCTIONS_PROFILE_MISMATCH_").includes("INSTALLED_FUNCTIONS_PROFILE_MISMATCH_INTEGRATION_HANDOFF_ENABLED"));
  assert.ok(compareProfile(expected, { ...expected, FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }, "INSTALLED_FUNCTIONS_PROFILE_MISMATCH_").includes("INSTALLED_FUNCTIONS_PROFILE_MISMATCH_UNREVIEWED_FIREBASE_AUTH_EMULATOR_HOST"));
});
test("every App Hosting variable is checked, including emulator/credential and consent fields", () => {
  const env = { NEXT_PUBLIC_FIREBASE_PROJECT_ID: "staging-growline-test", FIREBASE_AUTH_EMULATOR_HOST: "", FIREBASE_SERVICE_ACCOUNT: "", GROWLINE_CLUB_CONSENT_VERSION: "" };
  const yaml = Object.entries(env).map(([name, value]) => "  - variable: " + name + "\n    value: " + JSON.stringify(value) + "\n    availability:\n      - BUILD\n      - RUNTIME\n").join("\n") + "\n  - variable: GROWLINE_CLUB_SERVICE_KEY\n    secret: GROWLINE_CLUB_SERVICE_KEY\n    availability:\n      - RUNTIME\n";
  assert.deepEqual(checkAppHosting(env, yaml), []);
  assert.ok(checkAppHosting(env, yaml.replace('value: ""', 'value: "127.0.0.1:9099"')).includes("APPHOSTING_OVERRIDE_MISMATCH_FIREBASE_AUTH_EMULATOR_HOST"));
  assert.ok(checkAppHosting(env, yaml.replace("secret: GROWLINE_CLUB_SERVICE_KEY", 'value: ""')).includes("STAGING_SERVICE_KEY_SECRET_REFERENCE_REQUIRED"));
  assert.ok(checkAppHosting(env, yaml + "\n  - variable: UNREVIEWED_SETTING\n    value: true\n    availability:\n      - RUNTIME\n").includes("UNREVIEWED_APPHOSTING_VARIABLE_UNREVIEWED_SETTING"));
});
test("App Hosting public Firebase config must be staged at build and runtime", () => {
  const yaml = "  - variable: NEXT_PUBLIC_FIREBASE_PROJECT_ID\n    value: \"staging-growline-test\"\n    availability:\n      - RUNTIME\n\n  - variable: GROWLINE_CLUB_SERVICE_KEY\n    secret: GROWLINE_CLUB_SERVICE_KEY\n    availability:\n      - RUNTIME\n";
  assert.ok(checkAppHosting({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: "staging-growline-test" }, yaml).includes("APPHOSTING_AVAILABILITY_NEXT_PUBLIC_FIREBASE_PROJECT_ID"));
});

test("new capabilities remain off and peer origins stay staging-scoped", () => {
  assert.ok(checkStaging("club", targets, { ...club, INTEGRATION_ACTIVITY_ENABLED: "true" }).includes("ACTIVITY_MUST_BE_DISABLED_DURING_PREPARATION"));
  assert.ok(checkStaging("growline", targets, { ...growline, GROWLINE_JOBS_ENABLED: "true" }).includes("JOBS_REQUIRE_SEPARATE_STAGING_APPROVAL"));
  assert.ok(checkStaging("growline", targets, { ...growline, INTEGRATION_SSO_ENABLED: "true" }).includes("SSO_REQUIRES_VERIFIED_ACCOUNT_PAIR_AND_AUTH_GATE"));
  assert.ok(checkStaging("club", targets, { ...club, GROWLINE_ACTIVITY_URL: "https://production.example.test/api/integration/club-activity" }).includes("ACTIVITY_ENDPOINT_PROJECT_ORIGIN_MISMATCH"));
});


test("SSO activation has a separate explicit approval gate and cannot change existing preparation phases", () => {
  const sso = { ...club, INTEGRATION_SSO_ENABLED: "true", VITE_INTEGRATION_SSO_ENABLED: "true", FEDERATION_SERVICE_KEY_ID: "dedicated-sso-test-key", FEDERATION_CLUB_ORIGIN: targets.clubOrigin, FEDERATION_GROWLINE_ORIGIN: targets.growlineOrigin, FEDERATION_PEER_URL: targets.growlineOrigin + "/api/integration/federation", STAGING_SSO_APPROVAL_REFERENCE: "synthetic-approval-for-test-only" };
  assert.deepEqual(checkStaging("club", targets, sso, {}, [], "sso-verification"), []);
  assert.ok(checkStaging("club", targets, sso).includes("SSO_REQUIRES_VERIFIED_ACCOUNT_PAIR_AND_AUTH_GATE"));
  for (const [name, value, error] of [["STAGING_SSO_APPROVAL_REFERENCE", "", "SSO_EXPLICIT_STAGING_APPROVAL_REFERENCE_REQUIRED"], ["FEDERATION_PEER_URL", "https://production.example.test", "SSO_PEER_PROJECT_ORIGIN_MISMATCH"], ["VITE_INTEGRATION_SSO_ENABLED", "false", "SSO_BROWSER_SERVER_FLAG_MISMATCH"], ["FEDERATION_SERVICE_KEY", "synthetic-material-must-not-be-in-profile", "SSO_USE_SECRET_MANAGER_BINDING"]]) {
    assert.ok(checkStaging("club", targets, { ...sso, [name]: value }, {}, [], "sso-verification").includes(error));
  }
});
test("SSO App Hosting requires a dedicated secret reference, never a literal or missing binding", () => {
  const env = { INTEGRATION_SSO_ENABLED: "true" };
  const yaml = '  - variable: INTEGRATION_SSO_ENABLED\n    value: "true"\n    availability:\n      - RUNTIME\n\n  - variable: GROWLINE_CLUB_SERVICE_KEY\n    secret: GROWLINE_CLUB_SERVICE_KEY\n    availability:\n      - RUNTIME\n';
  assert.ok(checkAppHosting(env, yaml).includes("SSO_SECRET_REFERENCE_REQUIRED"));
  const bound = yaml + '\n  - variable: FEDERATION_SERVICE_KEY\n    secret: FEDERATION_SERVICE_KEY\n    availability:\n      - RUNTIME\n';
  assert.deepEqual(checkAppHosting(env, bound), []);
  assert.ok(checkAppHosting(env, bound.replace('secret: FEDERATION_SERVICE_KEY', 'value: "synthetic-bad-literal"')).includes("SSO_SECRET_REFERENCE_REQUIRED"));
});

test("real GrowLine preflight validates its profile and rejects a mismatched backend", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const root = mkdtempSync(join(tmpdir(), "growline-staging-preflight-"));
  const script = new URL("./verify.mjs", import.meta.url).href;
  const childEnv = { ...process.env };
  for (const name of ["GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_SERVICE_ACCOUNT", "GCLOUD_PROJECT", "GCP_PROJECT", "STAGING_VERIFICATION_PHASE", "FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST", "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST", "NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST", "NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN", ...Object.keys(growline)]) delete childEnv[name];
  function run() { return spawnSync(process.execPath, ["--input-type=module", "-e", "import { runPreflight } from " + JSON.stringify(script) + "; runPreflight('growline', ['disabled']);"], { cwd: root, env: childEnv, encoding: "utf8" }); }
  try {
    mkdirSync(join(root,"staging"));
    writeFileSync(join(root,"staging/targets.local.json"), JSON.stringify(targets));
    writeFileSync(join(root,".firebaserc"), JSON.stringify({ projects:{} }));
    writeFileSync(join(root,"staging/server.env.local"), Object.entries(growline).map(([name,value]) => name + "=" + JSON.stringify(value)).join("\n") + "\n");
    const backend = { apphosting:[{backendId:targets.growlineBackendId}] };
    writeFileSync(join(root,"firebase.staging.json"), JSON.stringify(backend));
    const yaml = Object.entries(growline).map(([name,value]) => "  - variable: " + name + "\n    value: " + JSON.stringify(value) + "\n    availability:\n" + ((name.startsWith("NEXT_PUBLIC_") || name === "DATABASE_URL") ? "      - BUILD\n" : "") + "      - RUNTIME\n").join("\n") + "\n  - variable: GROWLINE_CLUB_SERVICE_KEY\n    secret: GROWLINE_CLUB_SERVICE_KEY\n    availability:\n      - RUNTIME\n";
    writeFileSync(join(root,"apphosting.staging.yaml"), yaml);
    const valid = run(); assert.equal(valid.status, 0, valid.stderr); assert.match(valid.stdout, /preflight passed/);
    backend.apphosting[0].backendId = "wrong-backend";
    writeFileSync(join(root,"firebase.staging.json"), JSON.stringify(backend));
    const wrong = run(); assert.equal(wrong.status, 1); assert.match(wrong.stderr, /APPHOSTING_BACKEND_MISMATCH/); assert.doesNotMatch(wrong.stderr, /STAGING_INPUTS_MISSING_OR_INVALID/);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/")));
    rmSync(root, { recursive: true, force: true });
  }
});
