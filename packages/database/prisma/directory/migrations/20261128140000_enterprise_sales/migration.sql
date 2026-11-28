-- Enterprise's rate card and its deals (D-151). Enterprise is priced for each chain (D-146): a
-- price a branch a month by the chain's size, lower for bigger chains, with discounts for paying
-- ahead and, when a chain asks, a little more, never below the tier's floor. The console works a
-- quote out from these rows and records the deal agreed, so Enterprise's revenue is counted.
--
-- Confidential (the owner's private pricing guide): its own schema, read by billing-service alone
-- (packages/database/src/access.ts), not published to the shards or the catalog. The figures are
-- typed in the console; none is seeded here, as this repository is public.
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "sales";

-- CreateTable
CREATE TABLE "sales"."enterprise_rates" (
    "id" BIGINT NOT NULL,
    "from_branches" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "floor_minor" BIGINT NOT NULL,
    "updated_by_id" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enterprise_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales"."enterprise_terms" (
    "currency" CHAR(3) NOT NULL,
    "cost_per_branch_minor" BIGINT NOT NULL,
    "yearly_discount_percent" DECIMAL(5,2) NOT NULL,
    "two_year_discount_percent" DECIMAL(5,2) NOT NULL,
    "asked_discount_percent" DECIMAL(5,2) NOT NULL,
    "asked_discount_from_branches" INTEGER NOT NULL,
    "withholding_percent" DECIMAL(5,2) NOT NULL,
    "updated_by_id" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enterprise_terms_pkey" PRIMARY KEY ("currency")
);

-- CreateTable
CREATE TABLE "sales"."enterprise_deals" (
    "id" BIGINT NOT NULL,
    "owner_user_id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "term" VARCHAR(10) NOT NULL,
    "price_per_branch_minor" BIGINT NOT NULL,
    "branches_at_signing" INTEGER NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "status" VARCHAR(10) NOT NULL DEFAULT 'active',
    "notes" VARCHAR(500),
    "created_by_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "enterprise_deals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_rates_currency_from_branches_key" ON "sales"."enterprise_rates"("currency", "from_branches");

-- CreateIndex
CREATE INDEX "enterprise_deals_owner_user_id_idx" ON "sales"."enterprise_deals"("owner_user_id");

-- CreateIndex
CREATE INDEX "enterprise_deals_currency_idx" ON "sales"."enterprise_deals"("currency");

-- CreateIndex
CREATE INDEX "enterprise_deals_status_starts_on_idx" ON "sales"."enterprise_deals"("status", "starts_on");

-- AddForeignKey
ALTER TABLE "sales"."enterprise_rates" ADD CONSTRAINT "enterprise_rates_currency_fkey" FOREIGN KEY ("currency") REFERENCES "reference"."currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales"."enterprise_terms" ADD CONSTRAINT "enterprise_terms_currency_fkey" FOREIGN KEY ("currency") REFERENCES "reference"."currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales"."enterprise_deals" ADD CONSTRAINT "enterprise_deals_currency_fkey" FOREIGN KEY ("currency") REFERENCES "reference"."currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;


-- What Prisma can't say.
ALTER TABLE "sales"."enterprise_rates" ADD CONSTRAINT "enterprise_rates_values" CHECK (
  "from_branches" BETWEEN 2 AND 100000 AND "floor_minor" >= 0 AND "floor_minor" <= "price_minor"
);
ALTER TABLE "sales"."enterprise_terms" ADD CONSTRAINT "enterprise_terms_values" CHECK (
  "cost_per_branch_minor" >= 0
  AND "yearly_discount_percent" BETWEEN 0 AND 100
  AND "two_year_discount_percent" BETWEEN 0 AND 100
  AND "asked_discount_percent" BETWEEN 0 AND 100
  AND "asked_discount_from_branches" BETWEEN 2 AND 100000
  AND "withholding_percent" BETWEEN 0 AND 100
);
ALTER TABLE "sales"."enterprise_deals" ADD CONSTRAINT "enterprise_deals_values" CHECK (
  "term" IN ('month', 'year', 'two_years')
  AND "status" IN ('active', 'ended')
  AND "price_per_branch_minor" >= 0
  AND "branches_at_signing" >= 1
  AND char_length("name") BETWEEN 2 AND 160
  AND ("ends_on" IS NULL OR "ends_on" >= "starts_on")
  -- Ended says when; a live deal hasn't.
  AND (("status" = 'ended') = ("ended_at" IS NOT NULL))
);

-- One live deal a chain.
CREATE UNIQUE INDEX "enterprise_deals_one_live" ON "sales"."enterprise_deals" ("owner_user_id")
  WHERE "status" = 'active';
