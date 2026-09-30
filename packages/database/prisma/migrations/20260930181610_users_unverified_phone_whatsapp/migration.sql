-- AlterTable
ALTER TABLE "users" ADD COLUMN     "unverified_phone_encrypted" TEXT,
ADD COLUMN     "unverified_phone_hash" CHAR(64),
ADD COLUMN     "whatsapp_opt_in_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "users_unverified_phone_hash_idx" ON "users"("unverified_phone_hash");

-- Hand-written: same format guarantee as the other blind-index columns.
ALTER TABLE "users"
  ADD CONSTRAINT "chk_users_unverified_phone_hash_hex" CHECK ("unverified_phone_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "chk_users_unverified_phone_pair" CHECK (("unverified_phone_encrypted" IS NULL) = ("unverified_phone_hash" IS NULL));
