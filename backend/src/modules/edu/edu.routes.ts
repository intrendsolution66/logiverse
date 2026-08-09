// backend/src/modules/edu/edu.routes.ts
//
// Phase 1 routes: course-designer manages courses/levels (gated behind
// courses.manage), any authenticated user can read them (no assignment
// filtering yet — see courses.controller.ts comments), students submit
// progress after playing.
import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import {
  registerParent, addChild, subscribeChild, listMyChildren, getChildProgress, resetChildPassword, getChildStudyTime, getChildTopicBreakdown,
} from "./family.controller.js";
import {
  listMyClasses, createClass,
  listClassStudents, addStudentToClass, removeStudentFromClass,
  listClassAssignments, createAssignment,
  getClassProgress, getClassStudyTime,
  createPolymorphicAssignment, listMyAssignmentsInRange,
} from "./teacher.controller.js";
import {
  listMyGroups, createGroup as createStudentGroup,
  listGroupMembers, addGroupMember, removeGroupMember,
} from "./studentGroups.controller.js";
import {
  listProgrammes, createProgramme, updateProgramme, deleteProgramme,
  listSubjects, createSubject, updateSubject, deleteSubject,
  listCategories, createCategory, updateCategory, deleteCategory, listGroups, createGroup, updateGroup, deleteGroup, listCurriculumTypes,
} from "./exerciseClassification.controller.js";
import { listStudents, updateStudentEnrollment, extendStudentSubscription, expireStudentSubscription, listTeachers, listParents, getUserDetail, updateUserProfile, deactivateUser, blockUser, unblockUser, linkGuardian, unlinkGuardian } from "./adminUsers.controller.js";
import { getSettings, updateSettings } from "./systemSettings.controller.js";
import { initChunkUpload, getChunkUploadStatus, uploadChunk, completeChunkUpload, chunkUploadMiddleware } from "./assetChunkUpload.controller.js";
import { listSelfGuidedCourses, listSelfGuidedLessons, getSelfGuidedLesson } from "./selfGuided.controller.js";
import { getActiveSubscription } from "./subscriptionGate.js";
import { submitMediaProgress, getMediaProgress } from "./mediaProgress.controller.js";
import { listDiscoveryTopics, listDiscoveryActivities } from "./discovery.controller.js";
import {
  listCourses, createCourse, updateCourse, deleteCourse,
  listLevels, createLevel, createActivity, getLevel, getLevelForEdit, updateLevel, deleteLevel, checkSudoku, checkWordProblem, checkLineMatch, checkColoring, listAllActivities,
  submitProgress, listMyProgress, listAllProgressRecords,
  listGradeTiers, createGradeTier, updateGradeTier, deleteGradeTier,
  getLevelLeaderboard, getMyLevelRecords
} from "./courses.controller.js";
 
// lessons.controller.js 那行加 updateLesson/deleteLesson：
import { listLessons, createLesson, updateLesson, deleteLesson, getLesson, createStep, moveStep, deleteStep } from "./lessons.controller.js";
import { listActivitiesWithData, purgeActivity, purgeActivitiesBulk } from "./dataCleanup.controller.js";
import { listAssets, getAsset, createAsset, updateAsset, deleteAsset, listAllTags, convertPptToSlides } from "./assets.controller.js";
import { listParentPreviewCourses, getParentPreviewCourse, listParentPreviewTopics, listParentPreviewActivities } from "./parentPreview.controller.js";
import { getHanziStrokeData } from "./hanzi.controller.js";

const router = Router();

// ── 习题分类 (exercise classification) ─────────────────────────────────────────
// ── LogiVerse Education Taxonomy: Programme → Subject → Topic ─────────────────
router.get   ("/programmes",                 authenticate, listProgrammes);
router.post  ("/programmes",                 authenticate, authorize("courses.manage"), createProgramme);
router.patch ("/programmes/:programmeId",    authenticate, authorize("courses.manage"), updateProgramme);
router.delete("/programmes/:programmeId",    authenticate, authorize("courses.manage"), deleteProgramme);
router.get   ("/subjects",                   authenticate, listSubjects);
router.post  ("/subjects",                   authenticate, authorize("courses.manage"), createSubject);
router.patch ("/subjects/:subjectId",        authenticate, authorize("courses.manage"), updateSubject);
router.delete("/subjects/:subjectId",        authenticate, authorize("courses.manage"), deleteSubject);

router.get   ("/exercise-categories",       authenticate, listCategories);
router.post  ("/exercise-categories",       authenticate, authorize("courses.manage"), createCategory);
router.patch ("/exercise-categories/:categoryId", authenticate, authorize("courses.manage"), updateCategory);
router.delete("/exercise-categories/:categoryId", authenticate, authorize("courses.manage"), deleteCategory);
router.get   ("/exercise-groups",           authenticate, listGroups);
router.post  ("/exercise-groups",           authenticate, authorize("courses.manage"), createGroup);
router.patch ("/exercise-groups/:groupId",  authenticate, authorize("courses.manage"), updateGroup);
router.delete("/exercise-groups/:groupId",  authenticate, authorize("courses.manage"), deleteGroup);
router.get   ("/exercise-curriculum-types", authenticate, listCurriculumTypes);

// ── 学生/老师/家长管理 (admin, operator-only via classes.manage) ───────────────
router.get   ("/admin/students",                     authenticate, authorize("classes.manage"), listStudents);
router.patch ("/admin/students/:studentId/enrollment", authenticate, authorize("classes.manage"), updateStudentEnrollment);
router.post  ("/admin/students/:studentId/extend-subscription", authenticate, authorize("classes.manage"), extendStudentSubscription);
router.post  ("/admin/students/:studentId/expire-subscription", authenticate, authorize("classes.manage"), expireStudentSubscription);
router.get   ("/admin/teachers",                     authenticate, authorize("classes.manage"), listTeachers);
router.get   ("/admin/parents",                      authenticate, authorize("classes.manage"), listParents);
router.get   ("/admin/users/:userId",                authenticate, authorize("classes.manage"), getUserDetail);
router.patch ("/admin/users/:userId",                authenticate, authorize("classes.manage"), updateUserProfile);
router.delete("/admin/users/:userId",                authenticate, authorize("classes.manage"), deactivateUser);
router.post  ("/admin/users/:userId/block",           authenticate, authorize("classes.manage"), blockUser);
router.post  ("/admin/users/:userId/unblock",         authenticate, authorize("classes.manage"), unblockUser);
router.post  ("/admin/guardian-relationships",        authenticate, authorize("classes.manage"), linkGuardian);
router.delete("/admin/guardian-relationships/:parentUserId/:studentUserId", authenticate, authorize("classes.manage"), unlinkGuardian);

// ── Lessons (课程编排流程) ──────────────────────────────────────────────────────
router.get   ("/courses/:courseId/lessons",  authenticate, listLessons);
router.post  ("/courses/:courseId/lessons",  authenticate, authorize("courses.manage"), createLesson);
router.get   ("/lessons/:lessonId",          authenticate, getLesson);
router.post  ("/lessons/:lessonId/steps",    authenticate, authorize("courses.manage"), createStep);
router.patch ("/lesson-steps/:stepId/move",  authenticate, authorize("courses.manage"), moveStep);
router.delete("/lesson-steps/:stepId",       authenticate, authorize("courses.manage"), deleteStep);

// ── Asset library (素材库) ─────────────────────────────────────────────────────
router.get   ("/assets",           authenticate, listAssets);
router.get   ("/assets/tags",      authenticate, listAllTags); // must come before /:assetId or "tags" gets captured as an id
router.get   ("/assets/:assetId",  authenticate, getAsset);
router.post  ("/assets",           authenticate, authorize("courses.manage"), createAsset);
router.delete("/assets/:assetId",  authenticate, authorize("courses.manage"), deleteAsset);
router.post  ("/assets/convert-ppt", authenticate, authorize("courses.manage"), convertPptToSlides);
router.post("/assets/chunk-upload/init",                       authenticate, authorize("courses.manage"), initChunkUpload);
router.get ("/assets/chunk-upload/:uploadId/status",             authenticate, authorize("courses.manage"), getChunkUploadStatus);
router.post("/assets/chunk-upload/:uploadId/chunk/:chunkIndex",  authenticate, authorize("courses.manage"), chunkUploadMiddleware, uploadChunk);
router.post("/assets/chunk-upload/:uploadId/complete",           authenticate, authorize("courses.manage"), completeChunkUpload);
// ── Family journey (public registration + parent dashboard) ──────────────────
router.post("/register-parent",              registerParent); // public, no auth
router.post("/family/children",              authenticate, addChild);
router.post("/family/children/:studentId/subscribe", authenticate, subscribeChild);
router.get ("/family/children",              authenticate, listMyChildren);
router.get ("/family/children/:studentId/progress", authenticate, getChildProgress);
router.get ("/family/children/:studentId/topic-breakdown", authenticate, getChildTopicBreakdown);
router.get ("/family/children/:studentId/study-time", authenticate, getChildStudyTime);
router.post("/family/children/:studentId/reset-password", authenticate, resetChildPassword);

// ── Teacher journey (classes, roster, assignments, class progress) ───────────
router.get   ("/classes",                          authenticate, listMyClasses);
router.post  ("/classes",                          authenticate, authorize("classes.manage"), createClass);
router.get   ("/classes/:classId/students",        authenticate, listClassStudents);
router.post  ("/classes/:classId/students",        authenticate, authorize("classes.manage"), addStudentToClass);
router.delete("/classes/:classId/students/:studentId", authenticate, authorize("classes.manage"), removeStudentFromClass);
router.get   ("/classes/:classId/assignments",     authenticate, listClassAssignments);
router.post  ("/classes/:classId/assignments",     authenticate, authorize("classes.manage"), createAssignment);
router.get   ("/classes/:classId/progress",        authenticate, getClassProgress);
router.get   ("/classes/:classId/study-time",      authenticate, getClassStudyTime);

// ── 学生小组 (student groups) ──────────────────────────────────────────────────
router.get   ("/groups",                           authenticate, listMyGroups);
router.post  ("/groups",                           authenticate, authorize("classes.manage"), createStudentGroup);
router.get   ("/groups/:groupId/students",          authenticate, listGroupMembers);
router.post  ("/groups/:groupId/students",          authenticate, authorize("classes.manage"), addGroupMember);
router.delete("/groups/:groupId/students/:studentId", authenticate, authorize("classes.manage"), removeGroupMember);

// ── 日历排课 (polymorphic assignments: student / class / group) ───────────────
router.post  ("/assignments",                       authenticate, authorize("classes.manage"), createPolymorphicAssignment);
router.get   ("/assignments/mine",                  authenticate, listMyAssignmentsInRange);

router.get ("/grade-tiers",                authenticate, listGradeTiers);
router.post("/grade-tiers",                authenticate, authorize("courses.manage"), createGradeTier);
router.patch ("/grade-tiers/:tierId",       authenticate, authorize("courses.manage"), updateGradeTier);
router.delete("/grade-tiers/:tierId",       authenticate, authorize("courses.manage"), deleteGradeTier);

router.get ("/courses",                    authenticate, listCourses);
router.post("/courses",                    authenticate, authorize("courses.manage"), createCourse);
router.get ("/courses/:courseId/levels",   authenticate, listLevels);
router.post("/courses/:courseId/levels",   authenticate, authorize("courses.manage"), createLevel);

router.get ("/activities",                 authenticate, listAllActivities);
// 独立建 Activity，不挂在任何 Course 底下——跟上面 POST /courses/:courseId/levels
// 底层是同一个 createLevel 函数（course_id 现在是选填的），这里单纯是给
// "先建 Activity，之后再透过 Lesson 引用它"这个新流程一个不用先有 course
// 的入口。权限跟建 Activity 本来就一样，都是 courses.manage。
router.post("/activities",                 authenticate, authorize("courses.manage"), createActivity);
router.get ("/levels/:levelId",            authenticate, getLevel);
router.get ("/levels/:levelId/edit",       authenticate, authorize("courses.manage"), getLevelForEdit);
router.patch("/levels/:levelId",           authenticate, authorize("courses.manage"), updateLevel);
router.delete("/levels/:levelId",          authenticate, authorize("courses.manage"), deleteLevel);
router.post("/levels/:levelId/sudoku-check", authenticate, checkSudoku);
router.post("/levels/:levelId/line-match-check", authenticate, checkLineMatch);
router.post("/levels/:levelId/coloring-check", authenticate, checkColoring);
router.post("/levels/:levelId/word-problem-check", authenticate, checkWordProblem);
router.post("/levels/:levelId/progress",   authenticate, submitProgress);
router.get("/levels/:levelId/leaderboard", authenticate, getLevelLeaderboard);
router.get("/levels/:levelId/my-records", authenticate, getMyLevelRecords);
router.get ("/progress/me",                authenticate, listMyProgress);
router.get ("/admin/progress-records",       authenticate, authorize("classes.manage"), listAllProgressRecords);

router.get  ("/settings", authenticate, authorize("courses.manage"), getSettings);
router.patch("/settings", authenticate, authorize("courses.manage"), updateSettings);
// 2) 路由本体——建议加在文件靠后、跟 "Family journey" 那组相邻的位置
// （这些都是学生自己的账号在用，不需要 courses.manage 权限，只要登录即可，
//  订阅检查在各自 controller 内部做）
 
// ── 学生模式选择 (登录后首页用来判断能否进 Discovery / Self Guided) ─────────────
router.get("/student/modes", authenticate, async (req, res) => {
  const sub = await getActiveSubscription((req as any).user.sub);
  res.json({
    success: true, message: "Success",
    data: { hasActiveSubscription: !!sub, gradeTierId: sub?.gradeTierId ?? null },
  });
});
 
 
// ── Self Guided Learning (按序学习 Course → Lesson → 步骤) ────────────────────
router.get("/self-guided/courses",                  authenticate, listSelfGuidedCourses);
router.get("/self-guided/courses/:courseId/lessons", authenticate, listSelfGuidedLessons);
router.get("/self-guided/lessons/:lessonId",         authenticate, getSelfGuidedLesson);
 
router.get("/discovery/topics",     authenticate, listDiscoveryTopics);    // ?programme_id=xxx
router.get("/discovery/activities", authenticate, listDiscoveryActivities); // ?category_id=xxx
// 备注：router.get("/student/modes", ...) 里为了偷懒直接内联了handler，
// 如果你的项目风格更偏好"所有handler都在controller文件里"，可以把这段
// 挪到 subscriptionGate.ts 或新建一个 studentModes.controller.ts，逻辑不变。
router.post("/media-progress", authenticate, submitMediaProgress);
router.get ("/media-progress", authenticate, getMediaProgress);
// 路由本体——加在现有 "/courses" 那几行附近：
router.patch ("/courses/:courseId", authenticate, authorize("courses.manage"), updateCourse);
router.delete("/courses/:courseId", authenticate, authorize("courses.manage"), deleteCourse);
 
// 加在现有 "/courses/:courseId/lessons" 那几行附近：
router.patch ("/lessons/:lessonId", authenticate, authorize("courses.manage"), updateLesson);
router.delete("/lessons/:lessonId", authenticate, authorize("courses.manage"), deleteLesson);

// 路由——权限用 courses.manage（跟其他Activity管理操作同一个门槛，
// 前端另外再加一层"输入确认文字"的保护，不在后端加额外权限层）：
router.get   ("/admin/cleanup/played-activities",       authenticate, authorize("courses.manage"), listActivitiesWithData);
router.delete("/admin/cleanup/activities/:levelId",     authenticate, authorize("courses.manage"), purgeActivity);
router.post  ("/admin/cleanup/activities/bulk-delete",  authenticate, authorize("courses.manage"), purgeActivitiesBulk);
router.put("/assets/:assetId", authenticate, authorize("courses.manage"), updateAsset); 
router.get("/parent-preview/courses", authenticate, listParentPreviewCourses);
router.get("/parent-preview/courses/:courseId", authenticate, getParentPreviewCourse);
router.get("/parent-preview/topics",     authenticate, listParentPreviewTopics);     // ?programme_id=&subject_id=&grade_tier_id=
router.get("/parent-preview/activities", authenticate, listParentPreviewActivities); // ?category_id=xxx&grade_tier_id=

// ── 中文字笔顺练习 (笔顺数据来自后端node_modules里的hanzi-writer-data，
//    不是前端静态文件——designer在CourseDesignerPage加新字，立刻能用，
//    不需要额外的数据提取/重新部署步骤，见hanzi.controller.ts文件头) ──
router.get("/hanzi-data/:char", authenticate, getHanziStrokeData);

export default router;