-- CreateTable
CREATE TABLE "prospects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coach_id" TEXT NOT NULL,
    "client_id" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "age" INTEGER,
    "gender" TEXT,
    "height_cm" REAL,
    "weight_kg" REAL,
    "stage" TEXT NOT NULL DEFAULT 'spoken',
    "next_followup_at" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prospects_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "prospects_coach_id_created_at_idx" ON "prospects"("coach_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "prospects_coach_id_client_id_key" ON "prospects"("coach_id", "client_id");
