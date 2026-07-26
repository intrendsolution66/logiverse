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
  listCourses, createCourse,
  listLevels, createLevel, getLevel, getLevelForEdit, updateLevel, deleteLevel, checkSudoku, checkWordProblem, checkLineMatch, checkColoring, listAllActivities,
  submitProgress, listMyProgress,
  listGradeTiers, createGradeTier, updateGradeTier, deleteGradeTier,
} from "./courses.controller.js";
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
import { listAssets, getAsset, createAsset, deleteAsset, listAllTags, convertPptToSlides } from "./assets.controller.js";
import { listLessons, createLesson, getLesson, createStep, moveStep, deleteStep } from "./lessons.controller.js";
import {
  listProgrammes, createProgramme, updateProgramme, deleteProgramme,
  listSubjects, createSubject, updateSubject, deleteSubject,
  listCategories, createCategory, updateCategory, deleteCategory, listGroups, createGroup, updateGroup, deleteGroup, listCurriculumTypes,
} from "./exerciseClassification.controller.js";
import { listStudents, updateStudentEnrollment, listTeachers, listParents, getUserDetail, updateUserProfile, deactivateUser, linkGuardian, unlinkGuardian } from "./adminUsers.controller.js";
import { getSettings, updateSettings } from "./systemSettings.controller.js";

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
router.get   ("/admin/teachers",                     authenticate, authorize("classes.manage"), listTeachers);
router.get   ("/admin/parents",                      authenticate, authorize("classes.manage"), listParents);
router.get   ("/admin/users/:userId",                authenticate, authorize("classes.manage"), getUserDetail);
router.patch ("/admin/users/:userId",                authenticate, authorize("classes.manage"), updateUserProfile);
router.delete("/admin/users/:userId",                authenticate, authorize("classes.manage"), deactivateUser);
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
router.get ("/levels/:levelId",            authenticate, getLevel);
router.get ("/levels/:levelId/edit",       authenticate, authorize("courses.manage"), getLevelForEdit);
router.patch("/levels/:levelId",           authenticate, authorize("courses.manage"), updateLevel);
router.delete("/levels/:levelId",          authenticate, authorize("courses.manage"), deleteLevel);
router.post("/levels/:levelId/sudoku-check", authenticate, checkSudoku);
router.post("/levels/:levelId/line-match-check", authenticate, checkLineMatch);
router.post("/levels/:levelId/coloring-check", authenticate, checkColoring);
router.post("/levels/:levelId/word-problem-check", authenticate, checkWordProblem);
router.post("/levels/:levelId/progress",   authenticate, submitProgress);

router.get ("/progress/me",                authenticate, listMyProgress);

router.get  ("/settings", authenticate, authorize("courses.manage"), getSettings);
router.patch("/settings", authenticate, authorize("courses.manage"), updateSettings);

export default router;
