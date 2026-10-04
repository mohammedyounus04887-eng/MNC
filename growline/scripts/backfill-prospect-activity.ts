import "dotenv/config";
import { Timestamp } from "firebase-admin/firestore";
import { prospects } from "@/lib/collections";

/**
 * Gives every existing prospect a `lastActivityAt`, so the 180-day health purge can see
 * them.
 *
 *     npm run backfill:prospect-activity            # write it
 *     npm run backfill:prospect-activity -- --check # report only, non-zero if any remain
 *
 * ## Why this has to exist, and why it is safe to run late
 *
 * The purge now keys off `lastActivityAt` (RULES P5) rather than `createdAt`, which
 * measured record age and destroyed live data. Rows written before that change have no
 * such field, and the purge deliberately ignores them: a missing value must never be read
 * as "nobody has touched this in six months", because the action it triggers cannot be
 * undone.
 *
 * The consequence is that until this runs, those prospects' health data is retained past
 * the window the privacy notice promises. That is the safer of the two failures and it is
 * not an acceptable resting state — hence `--check`, which is what makes "run the
 * backfill" enforceable rather than remembered.
 *
 * ## Seeded from `createdAt`, and what that costs
 *
 * There is no history to recover: nothing recorded stage moves or report views before the
 * field existed, so capture time is the only honest thing available. For a prospect
 * captured 200 days ago and worked yesterday, this seeds a value already past the window
 * and their health data is purged on the next run — the exact case the fix was written to
 * prevent, happening once, to the backlog.
 *
 * Seeding "now" instead was rejected: it would grant every dormant prospect in the
 * database a fresh 180 days, which is the retention obligation quietly reset for
 * everybody, and unlike the other direction it is invisible.
 *
 * Prospects with no health data on them are given the field anyway. They are outside the
 * purge either way (it requires `heightCm != null`), and a collection where every row has
 * the field is one where a missing value is unambiguously a bug.
 */

const CHECK_ONLY = process.argv.includes("--check");
const PAGE = 400;

async function main() {
  let scanned = 0;
  let missing = 0;
  let written = 0;

  // Paged by document id rather than a query on the absent field: Firestore cannot ask
  // for "documents where lastActivityAt does not exist", so the only way to find them is
  // to walk the collection.
  let cursor: string | null = null;
  for (;;) {
    let q = prospects().orderBy("__name__").limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = prospects().firestore.batch();
    let inBatch = 0;

    for (const doc of snap.docs) {
      scanned++;
      const d = doc.data();
      if (d.lastActivityAt instanceof Timestamp) continue;
      missing++;
      if (CHECK_ONLY) continue;

      const seed =
        d.createdAt instanceof Timestamp ? d.createdAt : Timestamp.now();
      batch.update(doc.ref, { lastActivityAt: seed });
      inBatch++;
    }

    if (inBatch > 0) {
      await batch.commit();
      written += inBatch;
    }

    cursor = snap.docs[snap.docs.length - 1].id;
    if (snap.size < PAGE) break;
  }

  console.log(
    `\nprospects scanned: ${scanned}\nmissing lastActivityAt: ${missing}\n${
      CHECK_ONLY ? "(check only — nothing written)" : `written: ${written}`
    }\n`
  );

  if (CHECK_ONLY && missing > 0) {
    console.log(
      "Run `npm run backfill:prospect-activity` — until then these prospects are\n" +
        "invisible to the retention purge and their health data is kept past the window.\n"
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(`\nbackfill-prospect-activity failed: ${(e as Error).message}\n`);
  process.exit(1);
});
