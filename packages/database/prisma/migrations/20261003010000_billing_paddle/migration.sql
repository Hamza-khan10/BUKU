-- 2.5 part 3, Paddle: a plan's product id there, and out-of-order protection for store events.

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "external_product_id" VARCHAR(200);

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "provider_updated_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE UNIQUE INDEX "plans_external_product_id_key" ON "plans"("external_product_id");

