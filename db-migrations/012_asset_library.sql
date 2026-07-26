-- 012_asset_library.sql
--
-- 素材库 — the foundation the other pieces (image editing tool, lesson
-- sequencing, custom question authoring across modules) build on. Right
-- now every module that takes an uploaded image (spot_diff, maze,
-- focus_tap custom) stores it as a one-off base64 blob embedded directly
-- in THAT level's config — upload once, use once, gone. This table makes
-- uploads first-class, reusable, browsable objects: upload once, tag it,
-- reuse it across any level in any course.
--
-- Storage note: still base64-in-a-TEXT-column (file_data), same as every
-- image this project has stored so far — consistent with the rest of the
-- codebase, and doesn't require standing up a new file-storage subsystem
-- (S3/local disk + static serving) to get the REUSE win, which is the
-- actual point of this table. That said, base64-in-Postgres doesn't scale
-- to a large media library long-term; swapping file_data for a real
-- object-storage URL later is a contained change (this table's shape
-- barely changes, just what file_url actually points to).

BEGIN;

CREATE TABLE IF NOT EXISTS edu.assets (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  category varchar(30) NOT NULL DEFAULT 'other',  -- 'background' | 'object' | 'icon' | 'other'
  name varchar(200),
  file_data text NOT NULL,  -- base64 data URL
  width int,
  height int,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assets_uploader ON edu.assets(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_assets_category ON edu.assets(category);

COMMIT;
