-- Activity 卡片封面图——设计器"Activity 设计管理"列表卡片用来显示缩略图，
-- 单独一个字段，跟 explanation_image_url(讲解图，给学生看的教学说明用)
-- 是两码事，不混用。

BEGIN;

ALTER TABLE edu.course_levels
  ADD COLUMN IF NOT EXISTS cover_image_url text;

COMMIT;
