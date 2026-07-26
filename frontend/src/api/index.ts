// frontend/src/api/index.ts
//
// Trimmed from LifeVerse's original api/index.ts. Dropped every API wrapper
// for the LifeVerse-specific modules (posts, diary, goals, schedule, family,
// contacts, community, notifications, social, org finance/comms/meetings/
// events/projects/files) — matches the backend trim (see backend/src/app.ts
// comments). Kept auth, users, system, and a re-shaped orgApi matching the
// trimmed backend org.routes.ts exactly (the original had a few endpoints
// like getLanding/verify that no longer exist here).

import api from "./client.js";
import type { User, Organization } from "../types/index.js";

const d = <T>(res: { data: { data: T } }) => res.data.data;

// ── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  login:      (b: { identity: string; password: string }) =>
    api.post<{ data: { accessToken: string; refreshToken: string; user: User; forcedOtherDevicesLogout: boolean } }>("/auth/login", b),
  refresh:    (refreshToken: string) => api.post("/auth/refresh", { refreshToken }),
  logout:     (refreshToken?: string) => api.post("/auth/logout", { refreshToken }),
  logoutAll:  () => api.post("/auth/logout-all"),
  me:         () => api.get("/auth/me").then(d<User>),
  changePassword: (b: object) => api.put("/auth/change-password", b),
  submitVerification: (b: object) => api.post("/auth/verification", b),
  getVerification:    () => api.get("/auth/verification").then(d<unknown>),
  // Operator/teacher creates a student or parent account (IC becomes username).
  // See backend/src/modules/auth/auth.controller.ts#createManagedUser.
  createManagedUser: (b: {
    ic_number: string;
    password?: string;
    full_name_en?: string;
    full_name_zh?: string;
    role_code: "STUDENT" | "PARENT" | "TEACHER" | "COURSE_DESIGNER" | "OPERATOR";
    organization_id?: string;
    guardian_of_user_id?: string;
  }) => api.post<{ data: { id: string; username: string; ic_type: string; temp_password?: string } }>("/auth/users", b),
};

// ── Users ────────────────────────────────────────────────────────────────────
export const usersApi = {
  listUsers:    (params?: object) => api.get("/users", { params }),
  getUser:      (id: string)      => api.get(`/users/${id}`).then(d<User>),
  getMyProfile: ()                => api.get("/users/me/profile").then(d<User>),
  updateMyProfile: (b: object)    => api.put("/users/me/profile", b),
  listSessions: ()                => api.get("/users/me/sessions").then(d<unknown[]>),
  revokeSession:(id: string)      => api.delete(`/users/me/sessions/${id}`),
};

// ── System (lookups, i18n, global RBAC) ──────────────────────────────────────
export const systemApi = {
  getLookup:      (params?: object) => api.get("/system/lookup", { params }).then(d<{ category: string; code: string; label: string }[]>),
  getProviders:   ()                => api.get("/system/providers").then(d<unknown[]>),
  getTranslations:(lang: string, group?: string) =>
    api.get("/system/i18n", { params: { lang, group } }).then(d<{ key: string; value: string }[]>),
};

// ── LogiVerse Education Taxonomy: Programme → Subject → Topic ─────────────────
export const taxonomyApi = {
  listProgrammes: () => api.get("/programmes").then(d<Array<{ id: string; code: string; name_zh: string; name_en?: string; description?: string }>>),
  createProgramme: (b: { code: string; name_zh: string; name_en?: string; description?: string }) => api.post("/programmes", b),
  updateProgramme: (id: string, b: { name_zh?: string; name_en?: string; description?: string }) => api.patch(`/programmes/${id}`, b),
  deleteProgramme: (id: string) => api.delete(`/programmes/${id}`),
  listSubjects: (programmeId?: string) => api.get("/subjects", { params: programmeId ? { programme_id: programmeId } : {} }).then(d<Array<{ id: string; programme_id: string; code: string; name_zh: string; name_en?: string }>>),
  createSubject: (b: { programme_id: string; code: string; name_zh: string; name_en?: string }) => api.post("/subjects", b),
  updateSubject: (id: string, b: { name_zh?: string; name_en?: string }) => api.patch(`/subjects/${id}`, b),
  deleteSubject: (id: string) => api.delete(`/subjects/${id}`),
};

// ── 系统设置 (Settings) ─────────────────────────────────────────────────────────
export const settingsApi = {
  get: () => api.get("/settings").then(d<{ asset_base_url: string }>),
  update: (b: { asset_base_url?: string }) => api.patch("/settings", b).then(d<{ asset_base_url: string }>),
};

// ── 习题分类 (exercise classification) ─────────────────────────────────────────
export const exerciseClassificationApi = {
  listCategories: (subjectId?: string) => api.get("/exercise-categories", { params: subjectId ? { subject_id: subjectId } : {} }).then(d<Array<{ id: string; code: string; name_zh: string; name_en?: string; prefix: string; subject_id?: string }>>),
  createCategory: (b: { code: string; name_zh: string; name_en?: string; prefix: string; subject_id?: string }) => api.post("/exercise-categories", b),
  updateCategory: (id: string, b: { name_zh?: string; name_en?: string; prefix?: string; subject_id?: string }) => api.patch(`/exercise-categories/${id}`, b),
  deleteCategory: (id: string) => api.delete(`/exercise-categories/${id}`),
  listGroups: (categoryId?: string) => api.get("/exercise-groups", { params: categoryId ? { category_id: categoryId } : {} }).then(d<Array<{ id: string; category_id: string; code: string; name_zh: string; name_en?: string }>>),
  createGroup: (b: { category_id: string; code: string; name_zh: string; name_en?: string }) => api.post("/exercise-groups", b),
  updateGroup: (id: string, b: { name_zh?: string; name_en?: string; code?: string }) => api.patch(`/exercise-groups/${id}`, b),
  deleteGroup: (id: string) => api.delete(`/exercise-groups/${id}`),
  listCurriculumTypes: () => api.get("/exercise-curriculum-types").then(d<Array<{ id: string; code: string; name_zh: string; name_en?: string }>>),
};

// ── Lessons (课程编排流程) ──────────────────────────────────────────────────────
export const lessonsApi = {
  listLessons: (courseId: string) => api.get(`/courses/${courseId}/lessons`).then(d<Array<{
    id: string; title_i18n: Record<string,string>; order_index: number; created_at: string; step_count: number;
  }>>),
  createLesson: (courseId: string, b: { title_i18n: Record<string,string>; order_index?: number }) =>
    api.post(`/courses/${courseId}/lessons`, b),
  getLesson: (lessonId: string) => api.get(`/lessons/${lessonId}`).then(d<{
    id: string; course_id: string; title_i18n: Record<string,string>; order_index: number;
    steps: Array<{
      id: string; order_index: number; step_type: "video" | "ppt" | "level";
      media_url?: string; media_title?: string;
      course_level_id?: string; level_title_i18n?: Record<string,string>; module_type?: string;
    }>;
  }>),
  createStep: (lessonId: string, b: { step_type: string; media_url?: string; media_title?: string; course_level_id?: string }) =>
    api.post(`/lessons/${lessonId}/steps`, b),
  moveStep: (stepId: string, direction: "up" | "down") => api.patch(`/lesson-steps/${stepId}/move`, { direction }),
  deleteStep: (stepId: string) => api.delete(`/lesson-steps/${stepId}`),
};

// ── Asset library (素材库) ─────────────────────────────────────────────────────
export const assetsApi = {
  listAssets: (params?: { category?: string; search?: string; module_type?: string; tag?: string; page?: number; limit?: number }) =>
    api.get("/assets", { params }).then((res) => ({
      data: res.data.data as Array<{
        id: string; category: string; name?: string; width?: number; height?: number; created_at: string;
        module_type?: string; grade_tier_id?: string; grade_tier_code?: string; language?: string; tags: string[];
      }>,
      meta: res.data.meta as { page: number; limit: number; total: number; totalPages: number },
    })),
  listAllTags: () => api.get("/assets/tags").then(d<string[]>),
  getAsset: (assetId: string) => api.get(`/assets/${assetId}`).then(d<{
    id: string; category: string; name?: string; file_data: string; width?: number; height?: number;
    module_type?: string; grade_tier_id?: string; language?: string; tags: string[];
  }>),
  createAsset: (b: {
    category: string; name?: string; file_data: string; width?: number; height?: number;
    module_type?: string; grade_tier_id?: string; language?: string; tags?: string[];
  }) => api.post<{ data: { id: string; file_data: string } }>("/assets", b),
  deleteAsset: (assetId: string) => api.delete(`/assets/${assetId}`),
};

// ── 学生小组 (student groups) ──────────────────────────────────────────────────
export const studentGroupsApi = {
  listMyGroups: () => api.get("/groups").then(d<Array<{ id: string; name: string; created_at: string; member_count: number }>>),
  createGroup: (name: string) => api.post("/groups", { name }),
  listGroupMembers: (groupId: string) => api.get(`/groups/${groupId}/students`).then(d<Array<{
    student_id: string; username: string; full_name_zh?: string; full_name_en?: string;
  }>>),
  addGroupMember: (groupId: string, ic_number: string) => api.post(`/groups/${groupId}/students`, { ic_number }),
  removeGroupMember: (groupId: string, studentId: string) => api.delete(`/groups/${groupId}/students/${studentId}`),
};

// ── 日历排课 (polymorphic assignments) ─────────────────────────────────────────
export const scheduleApi = {
  createAssignment: (b: { target_type: "student" | "class" | "group"; target_id: string; course_level_id: string; scheduled_date: string }) =>
    api.post("/assignments", b),
  listMine: (from: string, to: string) => api.get("/assignments/mine", { params: { from, to } }).then(d<Array<{
    id: string; scheduled_date: string; target_type: "student" | "class" | "group";
    class_id?: string; student_id?: string; group_id?: string;
    course_level_id: string; level_title_i18n?: Record<string,string>; module_type: string; target_name: string;
  }>>),
};

// ── 学生/老师/家长管理 (operator admin) ──────────────────────────────────────────
export const adminUsersApi = {
  listStudents: (params?: { search?: string; enrollment_type?: string; sort?: string; order?: "asc"|"desc"; page?: number; limit?: number }) =>
    api.get("/admin/students", { params }).then((res) => ({
      data: res.data.data as Array<{
        id: string; username: string; status: string; created_at: string;
        full_name_zh?: string; full_name_en?: string; enrollment_type: string;
        class_names?: string; guardian_name?: string; subscription_status?: string;
      }>,
      meta: res.data.meta as { page: number; limit: number; total: number; totalPages: number },
    })),
  updateStudentEnrollment: (studentId: string, enrollment_type: string) =>
    api.patch(`/admin/students/${studentId}/enrollment`, { enrollment_type }),
  listTeachers: (params?: { search?: string; sort?: string; order?: "asc"|"desc"; page?: number; limit?: number }) =>
    api.get("/admin/teachers", { params }).then((res) => ({
      data: res.data.data as Array<{
        id: string; username: string; email?: string; status: string; created_at: string;
        full_name_zh?: string; full_name_en?: string; class_count: number; student_count: number;
      }>,
      meta: res.data.meta as { page: number; limit: number; total: number; totalPages: number },
    })),
  listParents: (params?: { search?: string; sort?: string; order?: "asc"|"desc"; page?: number; limit?: number }) =>
    api.get("/admin/parents", { params }).then((res) => ({
      data: res.data.data as Array<{
        id: string; username: string; email?: string; status: string; created_at: string;
        full_name_zh?: string; full_name_en?: string; children_names?: string;
      }>,
      meta: res.data.meta as { page: number; limit: number; total: number; totalPages: number },
    })),
};

// 学生/老师/家长共用的查看/编辑/删除——账号背后的角色不同，但操作是同一套
// 业者/老师后台直接建号——学生/家长在这个平台上不走自助注册，是业者或老师
// 用学生的 IC（或未成年人的出生证字号）帮他们建帐号。跳过一般注册会走的
// 手机OTP验证这一步（因为这个流程本来就预设"创建者是可信的、当面/透过
// 学校行政流程核实过身份"，不是陌生人自助注册），但IC号码本身的格式
// 还是会在后端验证（12位数字），不是完全不检查。密码留空的话后端会自动
//生成一个临时密码，只有这一次API回应里看得到，之后就查不到了——UI上
// 要清楚提示这一点。
export const managedUserApi = {
  create: (b: {
    ic_number: string; password?: string; full_name_zh?: string; full_name_en?: string;
    role_code: "STUDENT" | "PARENT" | "TEACHER"; organization_id?: string; guardian_of_user_id?: string;
  }) => api.post("/auth/users", b).then((res) => res.data.data as {
    id: string; username: string; ic_type: string; temp_password?: string;
  }),
};

export const adminUserDetailApi = {
  get: (userId: string) => api.get(`/admin/users/${userId}`).then(d<{
    id: string; username: string; email?: string; status: string; created_at: string; role_code: string;
    full_name_zh?: string; full_name_en?: string;
    guardians?: Array<{ id: string; username: string; full_name_zh?: string; full_name_en?: string }>;
    children?: Array<{ id: string; username: string; full_name_zh?: string; full_name_en?: string }>;
  }>),
  update: (userId: string, b: { full_name_zh?: string; full_name_en?: string; email?: string }) => api.patch(`/admin/users/${userId}`, b),
  deactivate: (userId: string) => api.delete(`/admin/users/${userId}`),
  linkGuardian: (parentUserId: string, studentUserId: string) =>
    api.post("/admin/guardian-relationships", { parent_user_id: parentUserId, student_user_id: studentUserId }),
  unlinkGuardian: (parentUserId: string, studentUserId: string) =>
    api.delete(`/admin/guardian-relationships/${parentUserId}/${studentUserId}`),
};
// ── Teacher journey (Phase 1+1) ────────────────────────────────────────────────
export const teacherApi = {
  listMyClasses: () => api.get("/classes").then(d<Array<{
    id: string; name: string; organization_id?: string; created_at: string; student_count: number;
  }>>),
  createClass: (b: { name: string; organization_id?: string }) => api.post("/classes", b),
  listClassStudents: (classId: string) => api.get(`/classes/${classId}/students`).then(d<Array<{
    student_id: string; username: string; full_name_zh?: string; full_name_en?: string; added_at: string;
  }>>),
  addStudentToClass: (classId: string, ic_number: string) => api.post(`/classes/${classId}/students`, { ic_number }),
  removeStudentFromClass: (classId: string, studentId: string) => api.delete(`/classes/${classId}/students/${studentId}`),
  listClassAssignments: (classId: string) => api.get(`/classes/${classId}/assignments`).then(d<Array<{
    id: string; course_level_id: string; scheduled_date?: string; created_at: string;
    level_title_i18n?: Record<string,string>; module_type: string;
  }>>),
  createAssignment: (classId: string, b: { course_level_id: string; scheduled_date?: string }) =>
    api.post(`/classes/${classId}/assignments`, b),
  getClassProgress: (classId: string) => api.get(`/classes/${classId}/progress`).then(d<Array<{
    student_id: string; username: string; full_name_zh?: string; full_name_en?: string;
    assignment_id: string; level_title_i18n?: Record<string,string>; module_type: string;
    best_score?: number; max_score?: number; completed?: boolean; played_at?: string; attempts: number;
  }>>),
  getClassStudyTime: (classId: string) => api.get(`/classes/${classId}/study-time`).then(d<Array<{
    student_id: string; username: string; full_name_zh?: string; full_name_en?: string;
    total_seconds_last_14_days: number;
  }>>),
};

// ── Family journey (Phase 1+1) ────────────────────────────────────────────────
export const familyApi = {
  registerParent: (b: { email?: string; mobile?: string; password: string; full_name_zh?: string; full_name_en?: string }) =>
    api.post<{ data: { id: string; username: string } }>("/register-parent", b),
  addChild: (b: { ic_number: string; grade_tier_id: string; password?: string; full_name_zh?: string; full_name_en?: string }) =>
    api.post<{ data: { student_id: string; username: string; temp_password?: string; subscription: { id:string; status:string; trial_ends_at:string; grade_tier_id:string } } }>("/family/children", b),
  subscribeChild: (studentId: string) =>
    api.post(`/family/children/${studentId}/subscribe`),
  listMyChildren: () => api.get("/family/children").then(d<Array<{
    student_id: string; username: string; full_name_zh?: string; full_name_en?: string;
    subscription_id?: string; subscription_status?: string; trial_ends_at?: string;
    current_period_end?: string; locked_monthly_fee?: string; currency?: string;
    grade_tier_id?: string; grade_tier_code?: string; grade_tier_name_i18n?: Record<string,string>;
  }>>),
  getChildProgress: (studentId: string) => api.get(`/family/children/${studentId}/progress`).then(d<Array<{
    id: string; course_level_id: string; module_type: string; score?: number; max_score?: number;
    time_spent_seconds: number; mistakes: number; completed: boolean; attempt_number: number; played_at: string;
    level_title_i18n?: Record<string,string>; topic_name_zh?: string;
  }>>),
  getChildTopicBreakdown: (studentId: string) => api.get(`/family/children/${studentId}/topic-breakdown`).then(d<Array<{
    topic_id: string | null; topic_name_zh: string | null;
    levels_played: number; total_attempts: number;
    avg_score_pct: string | null; completion_rate_pct: string | null; last_played_at: string;
  }>>),
  getChildStudyTime: (studentId: string) => api.get(`/family/children/${studentId}/study-time`).then(d<{
    sessions: Array<{ session_chain_id: string; login_at: string; ended_at: string; duration_seconds: number }>;
    daily: Array<{ study_date: string; total_seconds: number; session_count: number }>;
  }>),
  resetChildPassword: (studentId: string, password?: string) =>
    api.post<{ data: { temp_password?: string } }>(`/family/children/${studentId}/reset-password`, { password }),
};

// ── Edu: courses / levels / progress (Phase 1 pilot) ──────────────────────────
export const eduApi = {
  listGradeTiers: () => api.get("/grade-tiers").then(d<Array<{
    id:string; code:string; name_i18n:Record<string,string>; age_min?:number; age_max?:number; order_index:number;
  }>>),
  createGradeTier: (b: { code: string; name_i18n: Record<string,string>; age_min?: number; age_max?: number; order_index?: number }) =>
    api.post("/grade-tiers", b),
  updateGradeTier: (id: string, b: { name_i18n?: Record<string,string>; age_min?: number; age_max?: number; order_index?: number }) =>
    api.patch(`/grade-tiers/${id}`, b),
  deleteGradeTier: (id: string) => api.delete(`/grade-tiers/${id}`),
  listCourses: (params?: { search?: string; grade_tier_id?: string; sort?: "title"|"created_at"|"grade_tier"; order?: "asc"|"desc"; page?: number; limit?: number }) =>
    api.get("/courses", { params }).then((res) => ({
      data: res.data.data as Array<{
        id:string; title_i18n:Record<string,string>; age_group?:string;
        grade_tier_id?:string; grade_tier_code?:string; grade_tier_name_i18n?:Record<string,string>;
      }>,
      meta: res.data.meta as { page:number; limit:number; total:number; totalPages:number },
    })),
  createCourse: (b: { title_i18n: Record<string,string>; description_i18n?: Record<string,string>; age_group?: string; grade_tier_id: string }) =>
    api.post("/courses", b),
  listLevels: (courseId: string) => api.get(`/courses/${courseId}/levels`).then(d<Array<{
    id:string; order_index:number; module_type:string; title_i18n?:Record<string,string>;
    exercise_number?: string; category_id?: string; group_id?: string; curriculum_type_id?: string;
    category_name_zh?: string; group_name_zh?: string; curriculum_type_name_zh?: string;
    subject_name_zh?: string; programme_name_zh?: string;
  }>>),
  listActivitiesByTopic: (categoryId: string) => api.get("/activities", { params: { category_id: categoryId } }).then(d<Array<{
    id: string; course_id: string; module_type: string; title_i18n?: Record<string,string>; exercise_number?: string;
    activity_type: string; difficulty?: string; tags: string[]; created_at: string;
    course_title_i18n?: Record<string,string>; group_name_zh?: string;
  }>>),
  // 全平台的 Activity 管理表格用这个——跟上面那个按单一Topic查的版本不
  // 一样，这个支持搜索/多层筛选/排序/分页，是"Activity 设计管理"这个
  // 页面主表格实际会用到的接口。
  listAllActivities: (params: {
    search?: string; programme_id?: string; subject_id?: string; category_id?: string;
    sort?: string; order?: "asc" | "desc"; page?: number; limit?: number;
  }) => api.get("/activities", { params }).then((res) => ({
    data: res.data.data as Array<{
      id: string; course_id: string; module_type: string; title_i18n?: Record<string,string>;
      exercise_number?: string; created_at: string;
      course_title_i18n?: Record<string,string>;
      programme_id?: string; programme_name_zh?: string;
      subject_id?: string; subject_name_zh?: string;
      category_id?: string; topic_name_zh?: string;
    }>,
    meta: res.data.meta as { page: number; limit: number; total: number; totalPages: number },
  })),
  createLevel: (courseId: string, b: {
    module_type: string; order_index?: number; title_i18n?: Record<string,string>; config: object;
    explanation_text?: string; explanation_image_url?: string; explanation_video_url?: string;
    category_id?: string; group_id?: string; curriculum_type_id?: string; hint_text?: string; audio_url?: string;
    activity_type?: string; teaching_modes?: string[]; difficulty?: string;
    age_group_min?: number; age_group_max?: number; duration_minutes?: number;
    learning_outcomes?: string; skills_developed?: string[]; language?: string; tags?: string[];
  }) =>
    api.post(`/courses/${courseId}/levels`, b),
  getLevel: (levelId: string) => api.get(`/levels/${levelId}`).then(d<{
    id:string; module_type:string; title_i18n?:Record<string,string>; config: Record<string, unknown>;
    explanation_text?: string; explanation_image_url?: string; explanation_video_url?: string;
    hint_text?: string; audio_url?: string; exercise_number?: string;
  }>),
  // designer's own edit view — includes fields getLevel deliberately hides
  // from the play side (sudoku answers). Never call this for a
  // student-facing "play the level" flow — only from the course designer's
  // edit form.
  getLevelForEdit: (levelId: string) => api.get(`/levels/${levelId}/edit`).then(d<{
    id:string; module_type:string; title_i18n?:Record<string,string>; config: Record<string, unknown>;
    explanation_text?: string; explanation_image_url?: string; explanation_video_url?: string;
    hint_text?: string; audio_url?: string; exercise_number?: string;
    category_id?: string; group_id?: string; curriculum_type_id?: string;
    activity_type?: string; teaching_modes?: string[]; difficulty?: string;
    age_group_min?: number; age_group_max?: number; duration_minutes?: number;
    learning_outcomes?: string; skills_developed?: string[]; language?: string; tags?: string[];
  }>),
  updateLevel: (levelId: string, b: {
    title_i18n?: Record<string,string>; config?: object; explanation_text?: string; explanation_image_url?: string; explanation_video_url?: string;
    hint_text?: string; audio_url?: string; category_id?: string; group_id?: string; curriculum_type_id?: string;
    activity_type?: string; teaching_modes?: string[]; difficulty?: string;
    age_group_min?: number; age_group_max?: number; duration_minutes?: number;
    learning_outcomes?: string; skills_developed?: string[]; language?: string; tags?: string[];
  }) =>
    api.patch(`/levels/${levelId}`, b),
  deleteLevel: (levelId: string) => api.delete(`/levels/${levelId}`),
  checkSudoku: (levelId: string, values: (number | null)[]) =>
    api.post(`/levels/${levelId}/sudoku-check`, { values }).then(d<{ correct: boolean[]; allCorrect: boolean; solution: number[] }>),
  checkLineMatch: (levelId: string, matches: Array<{ left_id: number; right_content: string }>) =>
    api.post(`/levels/${levelId}/line-match-check`, { matches }).then(d<{ results: Array<{ left_id: number; correct: boolean }>; allCorrect: boolean; totalPairs: number }>),
  checkColoring: (levelId: string, fills: Record<string, string>) =>
    api.post(`/levels/${levelId}/coloring-check`, { fills }).then(d<{ results: Array<{ marker_color: string; correct: boolean }>; allCorrect: boolean; totalRegions: number }>),
  checkWordProblem: (levelId: string, value: number) =>
    api.post(`/levels/${levelId}/word-problem-check`, { value }).then(d<{ correct: boolean; answer: number }>),
  submitProgress: (levelId: string, b: {
    module_type: string; score: number; max_score: number;
    time_spent_seconds: number; mistakes: number; completed: boolean; extra_data?: object;
  }) => api.post(`/levels/${levelId}/progress`, b),
  myProgress: () => api.get("/progress/me").then(d<unknown[]>),
};

// ── Orgs (school/branch) ──────────────────────────────────────────────────────
export const orgApi = {
  list:    (params?: object)          => api.get("/orgs", { params }).then(d<Organization[]>),
  get:     (orgId: string)            => api.get(`/orgs/${orgId}`).then(d<Organization>),
  create:  (b: object)                => api.post("/orgs", b),
  update:  (orgId: string, b: object) => api.put(`/orgs/${orgId}`, b),
  apply:   (orgId: string, b: object) => api.post(`/orgs/${orgId}/apply`, b),
  listMembers: (orgId: string, params?: object) => api.get(`/orgs/${orgId}/members`, { params }),
  getMember:   (orgId: string, userId: string)  => api.get(`/orgs/${orgId}/members/${userId}`),
  reviewApplication: (orgId: string, applicationId: string, b: object) =>
    api.patch(`/orgs/${orgId}/applications/${applicationId}`, b),
  updateMemberRole: (orgId: string, userId: string, b: object) =>
    api.put(`/orgs/${orgId}/members/${userId}/role`, b),
  removeMember: (orgId: string, userId: string) => api.delete(`/orgs/${orgId}/members/${userId}`),
  listRoles:    (orgId: string) => api.get(`/orgs/${orgId}/roles`).then(d<unknown[]>),
  createRole:   (orgId: string, b: object) => api.post(`/orgs/${orgId}/roles`, b),
  listPermissions: (orgId: string) => api.get(`/orgs/${orgId}/permissions`).then(d<unknown[]>),
  getSettings:  (orgId: string) => api.get(`/orgs/${orgId}/settings`).then(d<unknown[]>),
  setSetting:   (orgId: string, key: string, b: object) => api.put(`/orgs/${orgId}/settings/${key}`, b),
  getAuditLogs: (orgId: string, params?: object) => api.get(`/orgs/${orgId}/audit-logs`, { params }),
};
