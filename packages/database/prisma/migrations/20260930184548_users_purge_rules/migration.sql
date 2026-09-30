-- An account can only be purged after deletion was requested, and a purged
-- account holds no contact details or credentials at all.
ALTER TABLE "users"
  ADD CONSTRAINT "chk_users_purge_requires_deletion" CHECK ("purged_at" IS NULL OR "deleted_at" IS NOT NULL),
  ADD CONSTRAINT "chk_users_purged_has_no_pii" CHECK (
    "purged_at" IS NULL OR (
      "email_encrypted" IS NULL AND "email_hash" IS NULL AND
      "phone_encrypted" IS NULL AND "phone_hash" IS NULL AND
      "unverified_phone_encrypted" IS NULL AND "unverified_phone_hash" IS NULL AND
      "password_hash" IS NULL AND "avatar_url" IS NULL
    )
  );
