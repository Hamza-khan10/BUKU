-- CreateEnum
CREATE TYPE "BusinessMemberRole" AS ENUM ('manager', 'front_desk', 'staff');

-- CreateEnum
CREATE TYPE "BusinessMemberStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "BusinessReportReason" AS ENUM ('fake_business', 'wrong_information', 'inappropriate_content', 'scam_or_fraud', 'other');

-- CreateEnum
CREATE TYPE "BusinessReportStatus" AS ENUM ('open', 'reviewed', 'dismissed');

-- AlterTable
-- Hand-written: convert existing full country names to ISO 3166-1 alpha-2
-- BEFORE the type change (any other value makes the migration fail loudly,
-- which is what we want: fix the data, don't truncate it).
UPDATE "businesses" SET "country" = 'PK' WHERE lower("country") = 'pakistan';

ALTER TABLE "businesses" ADD COLUMN     "business_terms_accepted_at" TIMESTAMPTZ(6),
ADD COLUMN     "business_terms_version" VARCHAR(20),
ALTER COLUMN "country" SET DATA TYPE CHAR(2);

-- CreateTable
CREATE TABLE "business_members" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "BusinessMemberRole" NOT NULL,
    "status" "BusinessMemberStatus" NOT NULL DEFAULT 'active',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "business_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_reports" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "reporter_id" UUID,
    "reason" "BusinessReportReason" NOT NULL,
    "details" TEXT,
    "status" "BusinessReportStatus" NOT NULL DEFAULT 'open',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_members_user_id_status_idx" ON "business_members"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "business_members_business_id_user_id_key" ON "business_members"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "business_reports_status_created_at_idx" ON "business_reports"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "business_reports_business_id_reporter_id_key" ON "business_reports"("business_id", "reporter_id");

-- AddForeignKey
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_reports" ADD CONSTRAINT "business_reports_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_reports" ADD CONSTRAINT "business_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_reports" ADD CONSTRAINT "business_reports_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written constraints
ALTER TABLE "businesses"
  ADD CONSTRAINT "chk_businesses_country_iso" CHECK ("country" ~ '^[A-Z]{2}$');

ALTER TABLE "business_reports"
  ADD CONSTRAINT "chk_business_reports_details_len" CHECK ("details" IS NULL OR length("details") <= 1000),
  ADD CONSTRAINT "chk_business_reports_review" CHECK (("status" = 'open') = ("reviewed_at" IS NULL));

CREATE TRIGGER "trg_business_members_updated_at" BEFORE UPDATE ON "business_members"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
