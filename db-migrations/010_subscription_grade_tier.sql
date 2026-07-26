-- 010_subscription_grade_tier.sql
--
-- Subscriptions now bind to a grade tier (L1-L4), not just "active or not".
-- Subscribing to a tier unlocks every course tagged with that grade_tier_id
-- — matches how courses are already classified (see 004's grade_tiers).
--
-- Existing subscriptions (from before this migration) get grade_tier_id =
-- NULL, which the access-control check in courses.controller.ts#getLevel
-- treats as "no tier access" — i.e. old trial/test subscriptions created
-- before this change won't silently keep working; they'll need the
-- grade_tier_id backfilled or the child re-added. Fine for this dev/test
-- dataset; a production migration would want a real backfill plan.

BEGIN;

ALTER TABLE edu.subscriptions ADD COLUMN IF NOT EXISTS grade_tier_id uuid REFERENCES edu.grade_tiers(id);

COMMIT;
