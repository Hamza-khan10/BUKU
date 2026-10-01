-- Part 4, pictures (D-051, D-055): business logo, employee photos (owned by
-- business-service with the rest of the business's media), private customer
-- profile pictures. Every stored picture is a CLEANED copy (metadata removed).


-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "logo_storage_key" VARCHAR(300);

-- AlterTable
ALTER TABLE "staff" DROP COLUMN "photo_url";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_storage_key" VARCHAR(300);

-- CreateTable
CREATE TABLE "staff_photos" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "storage_key" VARCHAR(300) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "consent_confirmed_by_id" UUID,
    "consent_confirmed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_photos_storage_key_key" ON "staff_photos"("storage_key");

-- CreateIndex
CREATE INDEX "staff_photos_business_id_idx" ON "staff_photos"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_photos_staff_id_business_id_key" ON "staff_photos"("staff_id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_logo_storage_key_key" ON "businesses"("logo_storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "staff_id_business_id_key" ON "staff"("id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_avatar_storage_key_key" ON "users"("avatar_storage_key");

-- AddForeignKey
ALTER TABLE "staff_photos" ADD CONSTRAINT "staff_photos_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_photos" ADD CONSTRAINT "staff_photos_staff_id_business_id_fkey" FOREIGN KEY ("staff_id", "business_id") REFERENCES "staff"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_photos" ADD CONSTRAINT "staff_photos_consent_confirmed_by_id_fkey" FOREIGN KEY ("consent_confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Unfinished uploads from the old photo flow (rows are now created only once a
-- picture is uploaded and cleaned).
DELETE FROM "business_photos" WHERE "uploaded_at" IS NULL;

ALTER TABLE "staff_photos"
  ADD CONSTRAINT "chk_staff_photos_size" CHECK ("size_bytes" > 0 AND "size_bytes" <= 10485760),
  -- Each picture lives under its owner's folder: a row can't point at someone else's file.
  ADD CONSTRAINT "chk_staff_photos_key" CHECK ("storage_key" LIKE 'businesses/' || "business_id" || '/staff/%');

ALTER TABLE "businesses"
  ADD CONSTRAINT "chk_businesses_logo_key" CHECK ("logo_storage_key" LIKE 'businesses/' || "id" || '/logo/%');

ALTER TABLE "users"
  ADD CONSTRAINT "chk_users_avatar_key" CHECK ("avatar_storage_key" LIKE 'users/' || "id" || '/avatar/%');

-- A purged account keeps no picture either.
ALTER TABLE "users" DROP CONSTRAINT "chk_users_purged_has_no_pii",
  ADD CONSTRAINT "chk_users_purged_has_no_pii" CHECK (
    "purged_at" IS NULL OR (
      "email_encrypted" IS NULL AND "email_hash" IS NULL AND
      "phone_encrypted" IS NULL AND "phone_hash" IS NULL AND
      "unverified_phone_encrypted" IS NULL AND "unverified_phone_hash" IS NULL AND
      "password_hash" IS NULL AND "avatar_url" IS NULL AND "avatar_storage_key" IS NULL AND
      "username" IS NULL
    )
  );
