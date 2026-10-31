-- Closing an employee account gives its username back (D-034, D3b): the business can give it to
-- someone new, so the closed account keeps its business but no username. A username still
-- belongs only to an employee account, and a live employee account still always has one.
ALTER TABLE "users" DROP CONSTRAINT "users_employee_login";
ALTER TABLE "users"
  ADD CONSTRAINT "users_employee_login" CHECK (
    ("username" IS NULL OR "managed_by_business_id" IS NOT NULL)
    AND ("managed_by_business_id" IS NULL OR "username" IS NOT NULL OR "deleted_at" IS NOT NULL));
