// backend/src/modules/edu/shareLinks.routes.ts
//
// 分享链接——管理那几个(生成/查看/撤销)需要 courses.manage 权限；公开
// 访问那几个(/share/:token 打头)故意不挂 authenticate，访问者根本没有
// 账号，token本身就是这条请求的凭证，校验逻辑在 controller 函数内部
// 自己做。

import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import {
  createShareLink, listShareLinks, revokeShareLink,
  resolveShareToken, getSharedLesson, playSharedBankQuestion, checkSharedBankQuestion,
  getSharedActivity, checkSharedSudoku, checkSharedColoring, checkSharedWordProblem,
} from "./shareLinks.controller.js";

const router = Router();

// ── 设计师管理 (courses.manage) ──────────────────────────────────────────────
router.post("/share-links",            authenticate, authorize("courses.manage"), createShareLink);
router.get ("/share-links",            authenticate, authorize("courses.manage"), listShareLinks);
router.post("/share-links/:id/revoke", authenticate, authorize("courses.manage"), revokeShareLink);

// ── 公开访问 (无需登录) ───────────────────────────────────────────────────────
router.get ("/share/:token",                                      resolveShareToken);

// 课时
router.get ("/share/:token/lesson",                                getSharedLesson);
router.get ("/share/:token/questions/:questionId/play",            playSharedBankQuestion);
router.post("/share/:token/questions/:questionId/check",           checkSharedBankQuestion);

// Activity——playSharedBankQuestion/checkSharedBankQuestion 那种服务器端
// 判分只有 sudoku/coloring/word_problem 三种题型需要(其余绝大多数
// module_type 都是client端直接判定，getSharedActivity返回的config里
// 就是完整可玩内容，不需要再调判分接口)。
router.get ("/share/:token/activity",                              getSharedActivity);
router.post("/share/:token/activity/:levelId/sudoku-check",        checkSharedSudoku);
router.post("/share/:token/activity/:levelId/coloring-check",      checkSharedColoring);
router.post("/share/:token/activity/:levelId/word-problem-check",  checkSharedWordProblem);

export default router;