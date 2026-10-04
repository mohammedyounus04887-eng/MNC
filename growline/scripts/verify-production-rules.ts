/**
 * Asks production, from outside, whether the Security Rules are actually protecting it.
 *
 * Run: `npm run verify:rules` — no credentials, no login, no service account.
 *
 * ## Why a script with no credentials is the right shape
 *
 * The rules are the ONLY thing standing between a coach's prospects — names, phone
 * numbers, heights, weights — and anybody who has the public project id. That id is
 * in the client bundle of every page, so "anybody" is the honest word.
 *
 * And the app is structurally unable to tell you whether they are working. Every
 * server path goes through the Admin SDK, which bypasses rules entirely, so a green
 * app, a green `/status`, and a green test suite are all equally consistent with a
 * database that is wide open. Only a request that arrives with no privilege can
 * answer the question, which is exactly what this makes.
 *
 * It cost this project a real scare: `.github/workflows/deploy-rules.yml` had zero
 * recorded runs and nobody could say whether `firestore.rules` had ever been pushed.
 * That question should never again need an investigation — it needs a command.
 *
 * ## What a PASS does and does not mean
 *
 * PASS means an anonymous client is refused. That rules out the catastrophic state —
 * a database left in test mode, readable by the world.
 *
 * It does NOT distinguish our deployed rules from Firestore's default locked ruleset,
 * because both deny anonymous reads identically. That difference is invisible from
 * outside and very visible to a coach: under the default lock every client listener
 * fails, so QR captures never appear without a refresh and thread counters never tick,
 * while the server-rendered screens carry on looking perfect.
 *
 * To settle THAT, pass a Firebase ID token for any signed-in coach:
 *
 *     npm run verify:rules -- --id-token="$TOKEN"
 *
 * Get one from the browser devtools console on the live site while signed in:
 *
 *     await firebase.auth().currentUser.getIdToken()   // or, in this app's client:
 *     // Application tab → IndexedDB → firebaseLocalStorageDb → the stsTokenManager
 *
 * The token is yours, lasts an hour, and carries no more privilege than the coach it
 * belongs to. The probe it enables reads only that coach's own prospects.
 */

// This file imports nothing, which would make TypeScript treat it as a global script
// and collide its top-level names with every other script in this folder. One empty
// export makes it a module.
export {};

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID_PROD ?? "grow--line";
const BUCKET = `${PROJECT}.firebasestorage.app`;
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const idToken = process.argv
  .find((a) => a.startsWith("--id-token="))
  ?.slice("--id-token=".length);

type Verdict = { name: string; ok: boolean; detail: string };
const verdicts: Verdict[] = [];

function record(name: string, ok: boolean, detail: string) {
  verdicts.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}\n        ${detail}`);
}

/**
 * The collections worth probing anonymously.
 *
 * Health data first, because that is the one with a legal duty attached (DPDP, and
 * RULES P5's retention promise). `users` is included because it carries every coach's
 * phone number, and `reports` because a report document holds the derived metrics.
 */
const ANONYMOUS_TARGETS = ["prospects", "users", "reports", "dailyLogs", "goalSheets"];

async function anonymousRead(collection: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${FS}/${collection}?pageSize=1`);
  } catch (e) {
    record(`anonymous read of ${collection}`, false, `could not reach Firestore: ${e}`);
    return;
  }
  const body = (await res.json().catch(() => ({}))) as {
    documents?: unknown[];
    error?: { status?: string; message?: string };
  };

  if (res.status === 403 && body.error?.status === "PERMISSION_DENIED") {
    record(`anonymous read of ${collection}`, true, "refused: PERMISSION_DENIED");
    return;
  }
  if (res.ok) {
    // The bad one. An empty page still means the READ was allowed — Firestore
    // returns 200 with no `documents` key for an allowed query over an empty
    // collection — so an empty result is a failure here, not a reprieve.
    const n = body.documents?.length ?? 0;
    record(
      `anonymous read of ${collection}`,
      false,
      n > 0
        ? `READABLE BY ANYONE — returned ${n} document(s). The database is open.`
        : "READABLE BY ANYONE — allowed, though this collection is empty right now."
    );
    return;
  }
  record(
    `anonymous read of ${collection}`,
    false,
    `unexpected ${res.status}: ${body.error?.message ?? "(no message)"}`
  );
}

async function anonymousStorageList(): Promise<void> {
  const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    record("anonymous list of Storage", false, `could not reach Storage: ${e}`);
    return;
  }
  if (res.status === 403) {
    record("anonymous list of Storage", true, `refused on ${BUCKET}`);
    return;
  }
  if (res.status === 404) {
    // Not a pass and not a failure of the rules: the bucket named here does not
    // exist. Say so plainly rather than reporting a protection that is really an
    // absence, which is how a wrong bucket name turns into false comfort.
    record("anonymous list of Storage", false, `no bucket named ${BUCKET} — check the name`);
    return;
  }
  if (res.ok) {
    record("anonymous list of Storage", false, `LISTABLE BY ANYONE on ${BUCKET}`);
    return;
  }
  record("anonymous list of Storage", false, `unexpected ${res.status}`);
}

/**
 * The discriminator. Our rules allow a coach to read their own prospects through the
 * ownership branch, which short-circuits before any document lookup — so this works
 * for a signed-in account even with no profile document yet. Firestore's default
 * locked ruleset allows nothing at all, so the two states finally separate here.
 */
async function ownPropectsRead(token: string): Promise<void> {
  const uid = readUid(token);
  if (!uid) {
    record("signed-in read of own prospects", false, "could not read a uid from the token");
    return;
  }
  const res = await fetch(`${FS.replace(/\/documents$/, "/documents:runQuery")}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "prospects" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "coachId" },
            op: "EQUAL",
            value: { stringValue: uid },
          },
        },
        limit: 1,
      },
    }),
  });
  const text = await res.text();

  if (res.ok) {
    record(
      "signed-in read of own prospects",
      true,
      "allowed — this is our ruleset, not the default lock. Client listeners will work."
    );
    return;
  }
  if (res.status === 403) {
    record(
      "signed-in read of own prospects",
      false,
      "REFUSED for the owner. Our rules allow this, so the database is almost certainly " +
        "on the DEFAULT LOCKED ruleset — deploy firestore.rules. Every client listener " +
        "is failing right now (QR captures need a refresh; thread counters do not tick)."
    );
    return;
  }
  record("signed-in read of own prospects", false, `unexpected ${res.status}: ${text.slice(0, 200)}`);
}

/** The uid out of a Firebase ID token, without verifying it — we are not trusting it,
 *  only using it to address the query. Firestore verifies it for real. */
function readUid(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload, "base64url").toString("utf8");
    return (JSON.parse(json) as { user_id?: string; sub?: string }).user_id ?? null;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`\nSecurity Rules, as seen from outside — project ${PROJECT}\n`);

  for (const c of ANONYMOUS_TARGETS) await anonymousRead(c);
  await anonymousStorageList();

  if (idToken) {
    console.log("");
    await ownPropectsRead(idToken);
  }

  const failed = verdicts.filter((v) => !v.ok);
  console.log("");
  if (failed.length === 0) {
    console.log(`  ${verdicts.length}/${verdicts.length} checks passed.`);
    if (!idToken) {
      console.log(
        "\n  Anonymous access is refused, which rules out the worst case.\n" +
          "  It does NOT prove our ruleset is the one deployed — the default lock looks\n" +
          "  identical from here. Re-run with --id-token=... to settle that."
      );
    }
    return;
  }
  console.log(`  ${failed.length} of ${verdicts.length} checks FAILED.`);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
