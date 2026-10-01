-- Employee accounts (D-034): a business creates sign-ins for its staff
-- (business + username + password). They live in `users` like every other
-- account, so sessions, revocation, audit and data rights work unchanged.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failed_login_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_until" TIMESTAMPTZ(6),
ADD COLUMN     "managed_by_business_id" UUID,
ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "username" VARCHAR(40);

-- CreateIndex
CREATE UNIQUE INDEX "users_managed_by_business_id_username_key" ON "users"("managed_by_business_id", "username");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_managed_by_business_id_fkey" FOREIGN KEY ("managed_by_business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "users"
  -- Usernames are stored normalized, so "Ali" and "ali" can never both exist.
  ADD CONSTRAINT "chk_users_username_format" CHECK ("username" ~ '^[a-z0-9][a-z0-9._-]{2,39}$'),
  -- A username only means something inside the business that issued it.
  ADD CONSTRAINT "chk_users_username_needs_business" CHECK ("username" IS NULL OR "managed_by_business_id" IS NOT NULL),
  -- A live employee account can always sign in: it has a username and a password.
  ADD CONSTRAINT "chk_users_managed_has_credentials" CHECK (
    "managed_by_business_id" IS NULL OR "deleted_at" IS NOT NULL OR
    ("username" IS NOT NULL AND "password_hash" IS NOT NULL)
  ),
  ADD CONSTRAINT "chk_users_failed_login_count" CHECK ("failed_login_count" >= 0);

-- A username is an identifier too.
ALTER TABLE "users" DROP CONSTRAINT "chk_users_has_identifier",
  ADD CONSTRAINT "chk_users_has_identifier" CHECK (
    "email_hash" IS NOT NULL OR "phone_hash" IS NOT NULL OR "username" IS NOT NULL OR "deleted_at" IS NOT NULL
  );

-- ...and personal data a purge must remove.
ALTER TABLE "users" DROP CONSTRAINT "chk_users_purged_has_no_pii",
  ADD CONSTRAINT "chk_users_purged_has_no_pii" CHECK (
    "purged_at" IS NULL OR (
      "email_encrypted" IS NULL AND "email_hash" IS NULL AND
      "phone_encrypted" IS NULL AND "phone_hash" IS NULL AND
      "unverified_phone_encrypted" IS NULL AND "unverified_phone_hash" IS NULL AND
      "password_hash" IS NULL AND "avatar_url" IS NULL AND "username" IS NULL
    )
  );
