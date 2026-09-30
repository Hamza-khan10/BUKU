-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE 'awaiting_upload';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'tax_certificate';
ALTER TYPE "DocumentType" ADD VALUE 'other';

-- AlterTable
ALTER TABLE "business_documents" DROP COLUMN "url",
ADD COLUMN     "content_type" VARCHAR(100) NOT NULL,
ADD COLUMN     "size_bytes" INTEGER NOT NULL,
ADD COLUMN     "storage_key" VARCHAR(300) NOT NULL,
ADD COLUMN     "uploaded_at" TIMESTAMPTZ(6),
ALTER COLUMN "status" SET DEFAULT 'awaiting_upload';

-- AlterTable
ALTER TABLE "business_photos" DROP COLUMN "url",
ADD COLUMN     "content_type" VARCHAR(100) NOT NULL,
ADD COLUMN     "size_bytes" INTEGER NOT NULL,
ADD COLUMN     "storage_key" VARCHAR(300) NOT NULL,
ADD COLUMN     "uploaded_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "business_legal_profiles" (
    "business_id" UUID NOT NULL,
    "legal_name" VARCHAR(300) NOT NULL,
    "registration_country" CHAR(2) NOT NULL,
    "registration_type" VARCHAR(100) NOT NULL,
    "registration_number_encrypted" TEXT NOT NULL,
    "registration_number_hash" CHAR(64) NOT NULL,
    "tax_id_encrypted" TEXT,
    "registered_address" TEXT NOT NULL,
    "responsible_name" VARCHAR(200) NOT NULL,
    "responsible_role" VARCHAR(100) NOT NULL,
    "responsible_email_encrypted" TEXT,
    "responsible_phone_encrypted" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "business_legal_profiles_pkey" PRIMARY KEY ("business_id")
);

-- CreateIndex
CREATE INDEX "business_legal_profiles_registration_number_hash_idx" ON "business_legal_profiles"("registration_number_hash");

-- CreateIndex
CREATE INDEX "business_legal_profiles_registration_country_idx" ON "business_legal_profiles"("registration_country");

-- CreateIndex
CREATE UNIQUE INDEX "business_documents_storage_key_key" ON "business_documents"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "business_photos_storage_key_key" ON "business_photos"("storage_key");

-- AddForeignKey
ALTER TABLE "business_legal_profiles" ADD CONSTRAINT "business_legal_profiles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written constraints
ALTER TABLE "business_legal_profiles"
  ADD CONSTRAINT "chk_legal_country_iso" CHECK ("registration_country" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "chk_legal_regnum_hash_hex" CHECK ("registration_number_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "chk_legal_regnum_encrypted" CHECK ("registration_number_encrypted" LIKE 'enc:1:%'),
  ADD CONSTRAINT "chk_legal_taxid_encrypted" CHECK ("tax_id_encrypted" IS NULL OR "tax_id_encrypted" LIKE 'enc:1:%');

-- Documents: max 25 MB; photos: max 10 MB. A document under review must have been uploaded.
ALTER TABLE "business_documents"
  ADD CONSTRAINT "chk_documents_size" CHECK ("size_bytes" BETWEEN 1 AND 26214400),
  ADD CONSTRAINT "chk_documents_uploaded" CHECK ("status" = 'awaiting_upload' OR "uploaded_at" IS NOT NULL);
ALTER TABLE "business_photos"
  ADD CONSTRAINT "chk_photos_size" CHECK ("size_bytes" BETWEEN 1 AND 10485760),
  ADD CONSTRAINT "chk_photos_primary_uploaded" CHECK (NOT "is_primary" OR "uploaded_at" IS NOT NULL);

CREATE TRIGGER "trg_business_legal_profiles_updated_at" BEFORE UPDATE ON "business_legal_profiles"
  FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
