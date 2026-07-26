-- 021_fix_exercise_counter_null_group.sql
--
-- Bug fix: edu.exercise_number_counters used PRIMARY KEY (category_id,
-- group_id) — but a composite PRIMARY KEY in Postgres implicitly forces
-- EVERY column in it to be NOT NULL. That's fine when a course designer
-- picks a category AND a group, but "选大种类，不选分类" (category set,
-- group left unset — a perfectly valid, explicitly-supported case per
-- family.controller.ts's "不选也可以正常保存" copy) means group_id is
-- NULL, which the old PK straight-up rejects with a constraint violation —
-- exactly the 500 error reported when saving a level with only a category
-- picked.
--
-- Fix: swap the composite PRIMARY KEY for a surrogate `id` PRIMARY KEY, and
-- express the real uniqueness rule (one counter per category+group
-- COMBINATION, including "no group") as a UNIQUE INDEX over
-- (category_id, COALESCE(group_id, a fixed sentinel)) — this is the
-- standard Postgres pattern for "NULL should still count as a specific,
-- reusable value" in a uniqueness rule, since NULL <> NULL in ordinary
-- constraints.

BEGIN;

-- Drop the old composite PK (this doesn't touch any existing data — the
-- rows just no longer have group_id forced NOT NULL)
ALTER TABLE edu.exercise_number_counters DROP CONSTRAINT IF EXISTS exercise_number_counters_pkey;

-- IMPORTANT: dropping a composite PRIMARY KEY does NOT undo the implicit
-- NOT NULL it placed on each column — that NOT NULL is a separate,
-- independent constraint on the column itself, not something tied to the
-- PK constraint. Skipping this line was the actual reason the first pass
-- at this migration still failed with the same error even after the PK
-- was successfully swapped — group_id was still NOT NULL underneath.
ALTER TABLE edu.exercise_number_counters ALTER COLUMN group_id DROP NOT NULL;

ALTER TABLE edu.exercise_number_counters ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_uuid_v7();
UPDATE edu.exercise_number_counters SET id = gen_uuid_v7() WHERE id IS NULL;
ALTER TABLE edu.exercise_number_counters ALTER COLUMN id SET NOT NULL;
ALTER TABLE edu.exercise_number_counters ADD PRIMARY KEY (id);

-- The real uniqueness rule, NULL-safe via COALESCE to a fixed sentinel UUID
-- standing in for "no group" — this is what ON CONFLICT targets now.
CREATE UNIQUE INDEX IF NOT EXISTS idx_exercise_counters_unique
  ON edu.exercise_number_counters (category_id, COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid));

COMMIT;
