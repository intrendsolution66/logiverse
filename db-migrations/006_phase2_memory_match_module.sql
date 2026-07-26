-- 006_phase2_memory_match_module.sql
--
-- Phase 2, module 4: Memory 翻牌配对. Theme presets (animal/fruit/number/
-- shape) are emoji sets baked into the frontend engine, same approach as
-- counting's theme icons — custom_icons is there for a future "upload your
-- own pictures" designer option, not required for this pass.

BEGIN;

CREATE TABLE IF NOT EXISTS edu.memory_configs (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  theme varchar(30) NOT NULL DEFAULT 'animal',  -- 'animal' | 'fruit' | 'number' | 'shape' | 'custom'
  custom_icons jsonb,                            -- array of image URLs, only used when theme='custom'
  pairs_count int NOT NULL DEFAULT 6,            -- board has pairs_count * 2 cards
  preview_seconds int NOT NULL DEFAULT 3,        -- cards shown face-up this long before flipping down
  timer_mode varchar(20) NOT NULL DEFAULT 'stopwatch',
  time_limit int,
  created_at timestamptz DEFAULT now()
);

COMMIT;
