-- 011_maze_module_authored_content.sql
--
-- 迷宫 module — built from scratch as AUTHORED content, not procedural
-- generation, directly responding to the "题库要能真正保存课程设计者做的
-- 内容，不是什么都随机生成" feedback. The course designer uploads a
-- background image and PAINTS the walkable path directly on it (a mask
-- layer, same principle as the original standalone prototype); that mask
-- is saved as real content — every time a student plays this level, it's
-- the SAME hand-designed maze, not a freshly generated one.
--
-- (num_choices-style "random generation" doesn't even make sense for a
-- maze — there's no way to procedurally generate a good maze from a few
-- parameters the way counting/pattern can. Authored content isn't just
-- "nicer", it's the only mode that makes sense here.)

BEGIN;

CREATE TABLE IF NOT EXISTS edu.maze_configs (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  bg_image_url text NOT NULL,     -- the artwork the student sees
  mask_image_url text NOT NULL,   -- painted PNG: non-transparent pixels = walkable path
  start_x numeric NOT NULL,       -- normalized 0..1
  start_y numeric NOT NULL,
  end_x numeric NOT NULL,
  end_y numeric NOT NULL,
  timer_mode varchar(20) NOT NULL DEFAULT 'stopwatch',
  time_limit int,
  created_at timestamptz DEFAULT now()
);

COMMIT;
