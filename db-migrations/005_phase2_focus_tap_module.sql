-- 005_phase2_focus_tap_module.sql
--
-- Phase 2, module 3: 专注力点数字 (focus/attention number tap). This pass
-- covers grid mode only (N×N grid, numbers shuffled to random cells each
-- play). Custom-image mode (mark number positions on an uploaded picture,
-- like the original prototype supported) is a later addition — the schema
-- already has the columns for it (mode/bg_image_url/positions) so adding it
-- won't need another migration, just a new designer UI branch.

BEGIN;

CREATE TABLE IF NOT EXISTS edu.focus_tap_configs (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  mode varchar(20) NOT NULL DEFAULT 'grid',  -- 'grid' | 'custom' (custom not yet implemented in the engine)
  grid_size int NOT NULL DEFAULT 4,          -- N×N grid, numbers 1..N*N
  bg_image_url text,                          -- only used when mode='custom'
  positions jsonb,                            -- only used when mode='custom': [{x,y}] normalized 0..1
  timer_mode varchar(20) NOT NULL DEFAULT 'stopwatch',
  time_limit int,
  created_at timestamptz DEFAULT now()
);

COMMIT;
