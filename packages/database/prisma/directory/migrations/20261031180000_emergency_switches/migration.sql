-- Emergency switches (D-129): parts of BUKU an operator can turn off at once — under attack, or
-- when one part misbehaves — and back on. One row per switch, all present from the start (off =
-- false); every service reads them every few seconds. Only the admin endpoints change them (the
-- auth service's role may update these columns, nothing else), and each change is audited.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ops";

-- CreateTable
CREATE TABLE "ops"."switches" (
    "key" TEXT NOT NULL,
    "off" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "changed_by" BIGINT,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "switches_pkey" PRIMARY KEY ("key")
);

-- The switches there are; a new one is a migration (and the code that obeys it).
ALTER TABLE "ops"."switches" ADD CONSTRAINT "switches_key_known" CHECK (
  "key" IN ('signups', 'signin', 'bookings', 'queue', 'payments', 'uploads', 'reviews', 'business_signup')
);
-- Turned off says why.
ALTER TABLE "ops"."switches" ADD CONSTRAINT "switches_off_has_reason" CHECK (
  NOT "off" OR ("reason" IS NOT NULL AND char_length("reason") BETWEEN 3 AND 500)
);

INSERT INTO "ops"."switches" ("key") VALUES
  ('signups'), ('signin'), ('bookings'), ('queue'), ('payments'), ('uploads'), ('reviews'), ('business_signup');
