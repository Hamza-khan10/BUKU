-- The name a customer booked under (D3d): the business's list shows it and finds visits by it
-- without asking every user shard, like the name on a restaurant reservation. Copied from the
-- person's account when they book; blanked when their account is erased (D-043).
ALTER TABLE "appointments" ADD COLUMN "customer_name" VARCHAR(200);
