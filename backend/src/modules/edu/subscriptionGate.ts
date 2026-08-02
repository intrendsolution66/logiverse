// backend/src/modules/edu/subscriptionGate.ts
//
// 判断"这个学生现在算不算订阅中"，以及解锁了哪个年级(grade_tier)。
//
// 这段逻辑直接照抄 courses.controller.ts#getLevel 里已经在用的那一段
// （trial未过期 / active / past_due但还在宽限期内 三种情况都算有效），
// 保证跟"玩游戏能不能进"用的是同一套标准，不会出现"Discovery列表里能看到
// 这个Activity，点进去玩却被拒绝"这种两边判断不一致的情况。
//
// 注意：跟 getLevel 现有代码一样，这里 status==='active' 没有额外检查
// current_period_end 是否已经过——这是沿用你项目里现有的行为，不是我
// 漏看了，只是先保持跟 getLevel 一致，不在这里悄悄引入不同的判断标准。
// 如果以后要修这个缺口，建议 getLevel 和这里一起改，两边保持同步。

import { query } from "../../config/db.js";

export interface ActiveSubscription {
  gradeTierId: string | null;
}

export async function getActiveSubscription(studentId: string): Promise<ActiveSubscription | null> {
  const { rows } = await query(
    `SELECT status, trial_ends_at, grace_period_ends_at, grade_tier_id
     FROM edu.subscriptions WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [studentId]
  );
  const sub = rows[0] as { status: string; trial_ends_at: Date; grace_period_ends_at: Date | null; grade_tier_id: string | null } | undefined;
  if (!sub) return null;

  const now = new Date();
  const hasActiveSub =
    (sub.status === "trial" && new Date(sub.trial_ends_at) > now) ||
    sub.status === "active" ||
    (sub.status === "past_due" && !!sub.grace_period_ends_at && new Date(sub.grace_period_ends_at) > now);

  if (!hasActiveSub) return null;
  return { gradeTierId: sub.grade_tier_id };
}