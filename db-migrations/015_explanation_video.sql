-- 015_explanation_video.sql
--
-- 答案演示 gets a third content type: video, alongside the existing text +
-- image. Same "just a URL" pattern as lesson_steps' video/ppt fields (see
-- 013) rather than base64-in-Postgres — video files are much larger than
-- the images this project has been storing as data URLs, and that
-- trade-off stops being reasonable at video size.

BEGIN;

ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS explanation_video_url text;

COMMIT;
