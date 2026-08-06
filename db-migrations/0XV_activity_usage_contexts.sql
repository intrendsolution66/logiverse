-- Activity 的"使用场景"——完全复用素材库 edu.assets.usage_contexts 那个
-- 概念（实体课/Self-Guided/公开课，可多选），这次搬到 edu.course_levels
-- 上，多一层 Self-Guided 专用的 Programme 限制。
--
-- self_guided_programme_ids 留空(NULL 或空阵列) = 不限制，所有 Programme
-- 的学生都能在 Self-Guided 模式下看到这个 Activity；填了具体的
-- Programme id，才收窄成只有那几个 Programme 底下的学生看得到——这跟
-- "select audience"这类UI的常见默认值一致（不选=不限，选了才是收窄），
-- 不是"不选就没人看得到"这种反直觉的默认值。
--
-- 用 uuid[] 数组栏位，不用另外开一张关联表——一个 Activity 最多也就限定
-- 给个位数的 Programme，用不上关联表那种规模的数据量，数组栏位加个
-- GIN 索引就够查询效率了，跟 assets.usage_contexts/tags 是同一个既有
-- 模式，不是另起炉灶。

BEGIN;

ALTER TABLE edu.course_levels
  ADD COLUMN IF NOT EXISTS usage_contexts text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS self_guided_programme_ids uuid[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_course_levels_usage_contexts ON edu.course_levels USING GIN (usage_contexts);
CREATE INDEX IF NOT EXISTS idx_course_levels_self_guided_programmes ON edu.course_levels USING GIN (self_guided_programme_ids);

COMMIT;
