-- 025_counting_scene_texts.sql
--
-- 点点数数自定义场景现在支持加文字（装饰用，字体/颜色/旋转都能调，不算进
-- 答案里——答案还是 positions 阵列的长度）。跟 positions 分开存一个独立的
-- texts jsonb 栏位，不是混进 positions 里——一个是"要数的东西"，一个是
-- "纯装饰的文字"，语意上是两件不同的事，混在一起以后要分辨"这个元素算不算
-- 数量"会很别扭。

BEGIN;

ALTER TABLE edu.counting_configs ADD COLUMN IF NOT EXISTS texts jsonb;

COMMIT;
