-- A business pays for one plan at a time (D3g): at most one live subscription — active, on trial,
-- past due or paused — per business, as v1 had it. Two grants approved at the same moment, or a
-- store payment and a grant, can't both take effect. And a period never ends before it starts.
CREATE UNIQUE INDEX "subscriptions_one_live" ON "subscriptions" ("business_id")
  WHERE "status" IN ('active', 'trialing', 'past_due', 'paused');
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_period" CHECK (
    "current_period_end" IS NULL OR "current_period_start" IS NULL OR "current_period_end" > "current_period_start");
