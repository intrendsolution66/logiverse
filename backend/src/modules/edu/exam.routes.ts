// backend/src/modules/edu/exam.routes.ts
//
// 试卷/比赛系统的路由——独立挂载在 /api/v1 下(路径带 /exam-papers 前缀区
// 分)，不并进 edu.routes.ts 那个已经很长的文件，保持这套跟 Activity 体系
// 平行的新功能自成一体。

import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import {
  listExamPapers, createExamPaper, getExamPaperForEdit, updateExamPaper, setExamPaperStatus, deleteExamPaper,
  addExamPaperQuestion, updateExamPaperQuestion, deleteExamPaperQuestion, reorderExamPaperQuestions,
  listQuestionBankCategories, listQuestionBank, createQuestionBankQuestion, updateQuestionBankQuestion, deleteQuestionBankQuestion,
  listImportableActivities, importFromActivity,
  listExamPaperStudents, addExamPaperStudents, removeExamPaperStudent,
  listMyExamPapers, startExamAttempt, submitExamAttempt, getExamAttempt, getExamAttemptReview,
  listMyAttemptsForPaper, getExamPaperLeaderboard,
  generateExamPaperPdf,
} from "./examPaper.controller.js";

const router = Router();

// ── 试卷本身 (courses.manage) ────────────────────────────────────────────────
router.get   ("/exam-papers",             authenticate, authorize("courses.manage"), listExamPapers);
router.post  ("/exam-papers",             authenticate, authorize("courses.manage"), createExamPaper);
router.get   ("/exam-papers/:paperId",    authenticate, authorize("courses.manage"), getExamPaperForEdit);
router.patch ("/exam-papers/:paperId",    authenticate, authorize("courses.manage"), updateExamPaper);
router.patch ("/exam-papers/:paperId/status", authenticate, authorize("courses.manage"), setExamPaperStatus);
router.delete("/exam-papers/:paperId",    authenticate, authorize("courses.manage"), deleteExamPaper);
router.get   ("/exam-papers/:paperId/pdf", authenticate, authorize("courses.manage"), generateExamPaperPdf);

// ── 试卷题目槽位 (courses.manage) ────────────────────────────────────────────
router.post  ("/exam-papers/:paperId/questions",                authenticate, authorize("courses.manage"), addExamPaperQuestion);
router.patch ("/exam-papers/:paperId/questions/reorder",        authenticate, authorize("courses.manage"), reorderExamPaperQuestions);
router.patch ("/exam-papers/:paperId/questions/:questionId",    authenticate, authorize("courses.manage"), updateExamPaperQuestion);
router.delete("/exam-papers/:paperId/questions/:questionId",    authenticate, authorize("courses.manage"), deleteExamPaperQuestion);

// ── 题库 (courses.manage) —— 随机槽从这里抽题 ────────────────────────────────
router.get   ("/exam-question-bank/categories",     authenticate, authorize("courses.manage"), listQuestionBankCategories);
router.get   ("/exam-question-bank",                authenticate, authorize("courses.manage"), listQuestionBank); // ?category=xxx
router.post  ("/exam-question-bank",                authenticate, authorize("courses.manage"), createQuestionBankQuestion);
router.patch ("/exam-question-bank/:questionId",    authenticate, authorize("courses.manage"), updateQuestionBankQuestion);
router.delete("/exam-question-bank/:questionId",    authenticate, authorize("courses.manage"), deleteQuestionBankQuestion);
router.get   ("/exam-question-bank/importable",     authenticate, authorize("courses.manage"), listImportableActivities); // ?module_type=xxx
router.post  ("/exam-question-bank/import",         authenticate, authorize("courses.manage"), importFromActivity);

// ── 受邀学生名单 (classes.manage) ────────────────────────────────────────────
router.get   ("/exam-papers/:paperId/students",              authenticate, authorize("classes.manage"), listExamPaperStudents);
router.post  ("/exam-papers/:paperId/students",              authenticate, authorize("classes.manage"), addExamPaperStudents);
router.delete("/exam-papers/:paperId/students/:studentId",   authenticate, authorize("classes.manage"), removeExamPaperStudent);

// ── 排行榜 (courses.manage —— 跟其他"查看统计"类接口权限保持一致；学生
//    自己看不到别人的排行榜，只能看自己的历史成绩，见下面
//    listMyAttemptsForPaper) ───────────────────────────────────────────────
router.get("/exam-papers/:paperId/leaderboard", authenticate, authorize("courses.manage"), getExamPaperLeaderboard);

// ── 学生端作答 (authenticate only — 白名单/时间窗口/次数上限检查在 controller 内部做) ──
router.get ("/exam-papers/mine",                    authenticate, listMyExamPapers);
router.post("/exam-papers/:paperId/start",          authenticate, startExamAttempt);
router.get ("/exam-papers/:paperId/my-attempts",    authenticate, listMyAttemptsForPaper);
router.post("/exam-attempts/:attemptId/submit",     authenticate, submitExamAttempt);
router.get ("/exam-attempts/:attemptId",            authenticate, getExamAttempt);
router.get ("/exam-attempts/:attemptId/review",     authenticate, getExamAttemptReview); // 逐题详情，被试卷截止时间挡住

export default router;