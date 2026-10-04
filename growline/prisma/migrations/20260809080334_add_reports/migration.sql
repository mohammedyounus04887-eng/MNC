-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prospect_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "metrics_json" TEXT NOT NULL,
    "sent_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reports_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "prospects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "reports_token_key" ON "reports"("token");

-- CreateIndex
CREATE INDEX "reports_prospect_id_idx" ON "reports"("prospect_id");
