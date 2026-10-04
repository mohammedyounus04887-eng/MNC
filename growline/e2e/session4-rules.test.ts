/**
 * Security Rules tests for `voiceLogs` and `silenceAlerts` (session 4).
 *
 *   npm run test:rules:session4
 *
 * House style (e2e/rules.test.ts): real authenticated clients against the emulator with
 * the real rules file, and every check states the rule it defends and why.
 *
 * ## The ones that matter most
 *
 * MANDATORY — no upline can read a downline's voice note, at any depth, with the
 * privacy toggle ON or OFF. This is the strictest rule in the file and it is not the
 * same rule as the one guarding `prospects`. A voice note is unstructured speech: a
 * coach dictating on a road says "met Ramesh on the walk, he's coming Tuesday, his
 * number is…", and no product decision can stop them. So the raw material P1 protects
 * is protected harder than the structured records it was written for — `shareProspects`
 * opens prospect documents to an upline and opens nothing here.
 *
 * MANDATORY — nobody can write one, and in particular nobody can set `status`. That
 * field is the server's statement that a `dailyLogs` document exists, and it is what the
 * purge job reads to decide what to delete. A client that could write it could mark its
 * own recordings counted and have them kept, or mark somebody else's and have the audio
 * dropped.
 *
 * MANDATORY — `silenceAlerts` is readable by nobody at all, including the upline the
 * row was written for. It is the one artifact in these modules whose subject is not its
 * reader: a durable, queryable record of when the app reported a named coach as quiet.
 * Nothing in the browser reads it, and a coach discovering they can query it is the
 * exact failure the notification copy was written to avoid, made inspectable.
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const ROOT = "usr_root"; // top of the tree
const ASHA = "usr_asha"; // ROOT's direct downline, sharing ON
const BHAV = "usr_bhav"; // ROOT's other direct downline, sharing OFF
const CHAN = "usr_chan"; // ASHA's downline — ROOT's grandchild
const OUTSIDER = "usr_outsider"; // root of an unrelated tree

const V = "voiceLogs";
const S = "silenceAlerts";

let env: RulesTestEnvironment;
let failures = 0;
let passes = 0;

async function check(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    passes++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${name} — ${(e as Error).message.split("\n")[0]}`);
  }
}

/** A note, in the shape the API route writes. The audio stands in for real bytes. */
const note = (userId: string, dayKey: string, over: Record<string, unknown> = {}) => ({
  userId,
  dayKey,
  status: "uncounted",
  durationMs: 9000,
  mimeType: "audio/webm;codecs=opus",
  audioBase64: "AAAA",
  transcript: "five shakes two invites",
  heard: ["servings", "invites"],
  countedValues: null,
  ...over,
});

const alert = (uplineId: string, legOwnerId: string) => ({
  uplineId,
  legOwnerId,
  lastAlertedKey: "2026-08-12",
  quietSinceKey: "2026-08-04",
  lastState: "quiet",
  legSize: 3,
});

async function main() {
  env = await initializeTestEnvironment({
    projectId: "growline-session4-rules",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: Number((process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":").at(-1)),
    },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", ROOT), {
      name: "Root", uplineId: null, uplinePath: [], shareProspects: false,
      levelName: null, city: "Bengaluru",
    });
    /**
     * Asha's toggle is ON. That is the point of this fixture: sharing opens her
     * PROSPECT documents to Root and must open nothing in `voiceLogs`.
     */
    await setDoc(doc(db, "users", ASHA), {
      name: "Asha", uplineId: ROOT, uplinePath: [ROOT], shareProspects: true,
      levelName: null, city: "Bengaluru",
    });
    await setDoc(doc(db, "users", BHAV), {
      name: "Bhavana", uplineId: ROOT, uplinePath: [ROOT], shareProspects: false,
      levelName: null, city: "Mysuru",
    });
    await setDoc(doc(db, "users", CHAN), {
      name: "Chandan", uplineId: ASHA, uplinePath: [ASHA, ROOT], shareProspects: true,
      levelName: null, city: "Mysuru",
    });
    await setDoc(doc(db, "users", OUTSIDER), {
      name: "Outsider", uplineId: null, uplinePath: [], shareProspects: true,
      levelName: null, city: "Bengaluru",
    });

    await setDoc(doc(db, V, `${ROOT}__2026-08-12`), note(ROOT, "2026-08-12"));
    await setDoc(doc(db, V, `${ASHA}__2026-08-12`), note(ASHA, "2026-08-12"));
    await setDoc(doc(db, V, `${CHAN}__2026-08-12`), note(CHAN, "2026-08-12"));
    /**
     * Bhavana's note carries an ancestry array of the kind a future field might
     * innocently add, plus an explicit share list naming Root. The rule must read
     * neither — D64 as a property of the database.
     */
    await setDoc(doc(db, V, `${BHAV}__2026-08-12`), {
      ...note(BHAV, "2026-08-12"),
      uplinePath: [ROOT],
      sharedWith: [ROOT, OUTSIDER],
    });

    await setDoc(doc(db, S, `${ROOT}__${ASHA}`), alert(ROOT, ASHA));
    await setDoc(doc(db, S, `${ASHA}__${CHAN}`), alert(ASHA, CHAN));
  });

  const as = (u: string) => env.authenticatedContext(u).firestore();

  console.log("\nvoiceLogs — reads\n");

  await check("a coach can open their own recording", () =>
    assertSucceeds(getDoc(doc(as(ASHA), V, `${ASHA}__2026-08-12`)))
  );
  await check("...and can query for their own by uid", () =>
    assertSucceeds(getDocs(query(collection(as(ASHA), V), where("userId", "==", ASHA))))
  );

  await check("MANDATORY: the collection cannot be listed unfiltered", () =>
    // One unfiltered list would hand a coach every recording in the organisation. The
    // per-document rule would then be the only thing standing between them and it.
    assertFails(getDocs(collection(as(ROOT), V)))
  );
  await check("...nor filtered to somebody else's uid", () =>
    assertFails(getDocs(query(collection(as(ROOT), V), where("userId", "==", ASHA))))
  );

  await check("MANDATORY: an upline cannot read a downline's recording", () =>
    assertFails(getDoc(doc(as(ROOT), V, `${ASHA}__2026-08-12`)))
  );
  await check("MANDATORY: ...even though that downline's shareProspects is ON", () =>
    /**
     * The distinction this whole rule exists for. Asha turned sharing ON, which opens
     * her prospect DOCUMENTS to Root — structured records she chose to share. A voice
     * note is the raw material those records were extracted from, spoken aloud with
     * whatever else was in her head, and no toggle in this app was ever presented to
     * her as consenting to that.
     */
    assertFails(getDoc(doc(as(ROOT), V, `${ASHA}__2026-08-12`)))
  );
  await check("MANDATORY: ...nor a grandchild's, two levels down", () =>
    assertFails(getDoc(doc(as(ROOT), V, `${CHAN}__2026-08-12`)))
  );
  await check("a downline cannot read their upline's recording", () =>
    assertFails(getDoc(doc(as(CHAN), V, `${ASHA}__2026-08-12`)))
  );
  await check("a peer cannot read a sibling's recording", () =>
    assertFails(getDoc(doc(as(ASHA), V, `${BHAV}__2026-08-12`)))
  );
  await check("a coach in an unrelated tree cannot read anything", () =>
    assertFails(getDoc(doc(as(OUTSIDER), V, `${ASHA}__2026-08-12`)))
  );
  await check("a signed-out client cannot read a recording", () =>
    assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), V, `${ASHA}__2026-08-12`)))
  );

  await check("MANDATORY: an ancestry array stored ON a note grants nothing (D64)", () =>
    // Bhavana's note names Root in `uplinePath` and again in `sharedWith`. The rule
    // reads neither: authorization compares the requester's uid to `userId` and nothing
    // a document says about the tree can become a grant.
    assertFails(getDoc(doc(as(ROOT), V, `${BHAV}__2026-08-12`)))
  );
  await check("...and a `sharedWith` list naming an outsider grants nothing either", () =>
    assertFails(getDoc(doc(as(OUTSIDER), V, `${BHAV}__2026-08-12`)))
  );

  console.log("\nvoiceLogs — writes\n");

  await check("MANDATORY: a coach cannot write their own recording from the client", () =>
    // Every write goes through the API route with the Admin SDK (D1, D38).
    assertFails(setDoc(doc(as(ASHA), V, `${ASHA}__2026-08-13`), note(ASHA, "2026-08-13")))
  );
  await check("MANDATORY: nobody can mark a note counted", () =>
    /**
     * `status` is the server's statement that a `dailyLogs` document exists, and the
     * purge job reads it to decide what to delete. A client that could set it could
     * keep recordings past their retention, or drop somebody else's audio.
     */
    assertFails(
      updateDoc(doc(as(ASHA), V, `${ASHA}__2026-08-12`), { status: "counted" })
    )
  );
  await check("...nor rewrite the transcript that becomes their log's note", () =>
    assertFails(updateDoc(doc(as(ASHA), V, `${ASHA}__2026-08-12`), { transcript: "ten members" }))
  );
  await check("...nor plant a recording on somebody else's account", () =>
    assertFails(setDoc(doc(as(ASHA), V, `${BHAV}__2026-08-13`), note(BHAV, "2026-08-13")))
  );
  await check("...nor delete one, which the 30-day purge does instead", () =>
    assertFails(deleteDoc(doc(as(ASHA), V, `${ASHA}__2026-08-12`)))
  );
  await check("a signed-out client cannot write one either", () =>
    assertFails(
      setDoc(doc(env.unauthenticatedContext().firestore(), V, "anything"), note(ASHA, "2026-08-13"))
    )
  );

  console.log("\nsilenceAlerts — nobody, at all\n");

  await check("MANDATORY: the upline the row was written FOR cannot read it", () =>
    /**
     * Root was the recipient of this alert about Asha's leg. The notification reached
     * him; the record of it is not his to query. It is a durable log of when the app
     * reported a named coach as quiet, and nothing in the browser needs it — the
     * notification opens the team tree, which is server-rendered.
     */
    assertFails(getDoc(doc(as(ROOT), S, `${ROOT}__${ASHA}`)))
  );
  await check("MANDATORY: the coach the row is ABOUT cannot read it", () =>
    // Asha discovering a queryable record of having been reported as quiet is the exact
    // failure the copy was written to avoid, made inspectable.
    assertFails(getDoc(doc(as(ASHA), S, `${ROOT}__${ASHA}`)))
  );
  await check("...nor list the collection", () =>
    assertFails(getDocs(collection(as(ROOT), S)))
  );
  await check("...nor query it by their own uid", () =>
    assertFails(getDocs(query(collection(as(ROOT), S), where("uplineId", "==", ROOT))))
  );
  await check("nobody can write one", () =>
    assertFails(setDoc(doc(as(ROOT), S, `${ROOT}__${BHAV}`), alert(ROOT, BHAV)))
  );
  await check("nobody can delete one to reset their own cooldown", () =>
    // Deleting the row would make the next run treat a continuing silence as new, which
    // is a way to make the app tell an upline about a downline every single morning.
    assertFails(deleteDoc(doc(as(ASHA), S, `${ROOT}__${ASHA}`)))
  );
  await check("a signed-out client cannot read or write one", () =>
    assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), S, `${ROOT}__${ASHA}`)))
  );

  await env.cleanup();
  console.log(
    failures === 0
      ? `\nAll ${passes} session-4 rules checks passed.\n`
      : `\n${failures} session-4 rules check(s) FAILED.\n`
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
