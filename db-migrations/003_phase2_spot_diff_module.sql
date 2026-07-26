-- 003_phase2_spot_diff_module.sql
--
-- Phase 2, module 1: 找不同之处 (spot the difference). No new permission
-- needed — courses.manage already gates level creation for every
-- module_type generically (see courses.controller.ts createLevel).

BEGIN;

CREATE TABLE IF NOT EXISTS edu.spot_diff_configs (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  image_a_url text NOT NULL,
  image_b_url text NOT NULL,
  hotspots jsonb NOT NULL DEFAULT '[]',  -- [{x,y,r}, ...] normalized 0..1 relative to each image
  timer_mode varchar(20) DEFAULT 'stopwatch',
  time_limit int,
  created_at timestamptz DEFAULT now()
);

COMMIT;
