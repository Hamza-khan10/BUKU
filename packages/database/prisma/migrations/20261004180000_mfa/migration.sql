-- 2.10 SOC 2 review: two-step sign-in with an authenticator app (D-081).

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "mfa" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "user_mfa" (
    "user_id" UUID NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "last_used_step" BIGINT,
    "recovery_code_hashes" CHAR(64)[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_mfa_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "user_mfa" ADD CONSTRAINT "user_mfa_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "user_mfa"
  ADD CONSTRAINT "chk_user_mfa_recovery_codes" CHECK (cardinality("recovery_code_hashes") <= 10);

CREATE TRIGGER "trg_user_mfa_updated_at" BEFORE UPDATE ON "user_mfa"
  FOR EACH ROW EXECUTE FUNCTION public."set_updated_at"();
