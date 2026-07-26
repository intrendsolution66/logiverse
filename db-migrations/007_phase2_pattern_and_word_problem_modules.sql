-- 007_phase2_pattern_and_word_problem_modules.sql
--
-- Phase 2, modules 5 & 6:
--   - 找规律 (pattern sequence): visual, same emoji-theme approach as the
--     other visual modules.
--   - 应用题 (word problems): text question + numeric answer, starts with
--     两个 categories — 鸡兔同笼 (chicken_rabbit) and 相遇问题
--     (meeting_point). Unlike the visual modules, this ONE module_type
--     supports multiple categories via config.categories (a shuffle bag
--     picks which category each question draws from) — mirrors how the
--     original standalone prototype (word-problems-prototype.html) mixed
--     six categories in one system. Adding a 3rd category later (还原/周期/
--     浓度/工程/牛吃草, all already designed in that prototype) means
--     extending the engine's generator switch, not a new module_type or
--     migration.

BEGIN;

CREATE TABLE IF NOT EXISTS edu.pattern_configs (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  theme varchar(30) NOT NULL DEFAULT 'shape',       -- 'shape' | 'animal' | 'fruit'
  pattern_types jsonb NOT NULL DEFAULT '["AB","ABC","AAB","ABB","AABB"]',
  seq_length int NOT NULL DEFAULT 7,
  num_choices int NOT NULL DEFAULT 3,
  total_questions int NOT NULL DEFAULT 5,
  timer_mode varchar(20) NOT NULL DEFAULT 'stopwatch',
  time_limit int,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edu.word_problem_configs (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  categories jsonb NOT NULL DEFAULT '["chicken_rabbit"]',  -- 'chicken_rabbit' | 'meeting_point'
  answer_mode varchar(20) NOT NULL DEFAULT 'select',        -- 'select' | 'input'
  num_choices int NOT NULL DEFAULT 3,
  total_questions int NOT NULL DEFAULT 5,
  -- 鸡兔同笼 range params
  chicken_min int NOT NULL DEFAULT 1,
  chicken_max int NOT NULL DEFAULT 30,
  -- 相遇问题 range params
  speed_min int NOT NULL DEFAULT 3,
  speed_max int NOT NULL DEFAULT 15,
  meet_time_min int NOT NULL DEFAULT 2,
  meet_time_max int NOT NULL DEFAULT 10,
  timer_mode varchar(20) NOT NULL DEFAULT 'stopwatch',
  time_limit int,
  created_at timestamptz DEFAULT now()
);

COMMIT;
