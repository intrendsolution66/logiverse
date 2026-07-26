-- 023_hint_bar_and_audio_narration.sql
--
-- Two additions to edu.course_levels, both shared across every module type
-- (same pattern as explanation_text/explanation_image_url/explanation_video_url
-- added in 014/015 — top-level columns, not per-module config, since a hint
-- or a narration clip makes sense regardless of which game engine is
-- rendering):
--
--   hint_text — shown in a HINT BAR while the student is playing (not after,
--   like 讲解 is). "每个游戏都要有一个提示栏" — every game needs a
--   consistent hint bar; this is the content that fills it. Optional: no
--   hint set just means the bar doesn't render, not a placeholder default.
--
--   audio_url — a pre-recorded narration clip (人工朗读, not AI TTS — 不需要
--   对接AI，成本太高 was explicit). Just a URL to an audio file the
--   designer uploads/links, played on demand via a button, not
--   auto-generated.

BEGIN;

ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS hint_text text;
ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS audio_url text;

COMMIT;
