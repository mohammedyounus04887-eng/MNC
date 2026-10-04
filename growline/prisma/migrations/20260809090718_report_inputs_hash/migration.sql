/*
  Adds reports.inputs_hash with a UNIQUE (prospect_id, inputs_hash) constraint so
  two concurrent renders converge on one report row instead of minting two live
  bearer tokens to the same person's health data.

  Existing rows are DELETED rather than backfilled. Every row predates
  REPORT_SNAPSHOT_VERSION 3, so parseSnapshot already rejects them and their links
  already 404 — they are dead data, and the coach's screen mints a fresh report on
  next view. If this ever needs to run against real data that IS current, backfill
  the hash instead: it is sha256(JSON.stringify([version, age, gender, heightCm,
  weightKg])) truncated to 32 chars.
*/
DELETE FROM "reports";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prospect_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "metrics_json" TEXT NOT NULL,
    "inputs_hash" TEXT NOT NULL,
    "sent_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reports_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "prospects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_reports" ("created_at", "id", "metrics_json", "prospect_id", "sent_at", "token") SELECT "created_at", "id", "metrics_json", "prospect_id", "sent_at", "token" FROM "reports";
DROP TABLE "reports";
ALTER TABLE "new_reports" RENAME TO "reports";
CREATE UNIQUE INDEX "reports_token_key" ON "reports"("token");
CREATE INDEX "reports_prospect_id_idx" ON "reports"("prospect_id");
CREATE UNIQUE INDEX "reports_prospect_id_inputs_hash_key" ON "reports"("prospect_id", "inputs_hash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
