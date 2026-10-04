-- AlterTable
ALTER TABLE "users" ADD COLUMN "level_name" TEXT;

-- CreateTable
CREATE TABLE "proofs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "target_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "request_note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "media_url" TEXT,
    "submit_note" TEXT,
    "comment" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" DATETIME,
    "reviewed_at" DATETIME,
    CONSTRAINT "proofs_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "targets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "proofs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_targets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coach_id" TEXT NOT NULL,
    "set_by" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "target_points" INTEGER NOT NULL,
    "progress_points" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "targets_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "targets_set_by_fkey" FOREIGN KEY ("set_by") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_targets" ("coach_id", "created_at", "id", "month", "progress_points", "set_by", "status", "target_points") SELECT "coach_id", "created_at", "id", "month", "progress_points", "set_by", "status", "target_points" FROM "targets";
DROP TABLE "targets";
ALTER TABLE "new_targets" RENAME TO "targets";
CREATE INDEX "targets_set_by_idx" ON "targets"("set_by");
CREATE UNIQUE INDEX "targets_coach_id_month_key" ON "targets"("coach_id", "month");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "proofs_target_id_idx" ON "proofs"("target_id");

-- CreateIndex
CREATE INDEX "proofs_requested_by_idx" ON "proofs"("requested_by");
