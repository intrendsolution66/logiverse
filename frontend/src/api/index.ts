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
  // 用户自己更新自己的资料——跟userApi/adminUserDetailApi那些operator改
  // 别人资料的接口不一样，这个不接受userId，只能改当前登录的自己
  updateMe: (b: {
    full_name_zh?: string; full_name_en?: string; preferred_name?: string; avatar_url?: string; bio?: string;
    gender_code?: string; date_of_birth?: string; nationality_code?: string; language_code?: string; timezone?: string;
    email?: string; mobile?: string;
  }) => api.put("/auth/me", b),
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
  listSubjects: (programmeId?: string) => api.get("/subjects", { params: programmeId ? { programme_id: programmeId } : {} }).then(d<Array<{ id: string; programme_id?: string; code: string; name_zh: string; name_en?: string; prefix?: string }>>),
  // programme_id 选填——可以先建 Subject，之后再透过 updateSubject 补上归属；
  // prefix 现在会接进实际的 Activity 编号（Subject前缀-Topic前缀-Group代号-
  // 流水号），新建时必填。
  createSubject: (b: { programme_id?: string; code: string; name_zh: string; name_en?: string; prefix: string }) => api.post("/subjects", b),
  updateSubject: (id: string, b: { name_zh?: string; name_en?: string; programme_id?: string; prefix?: string }) => api.patch(`/subjects/${id}`, b),
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
  // code 不用传了——后端自动生成一个 UUID 当内部唯一键，跟真正会出现在
  // 编号里的 prefix 是两回事。
  createCategory: (b: { name_zh: string; name_en?: string; prefix: string; subject_id?: string }) => api.post("/exercise-categories", b),
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
  updateLesson: (lessonId: string, b: { title_i18n?: Record<string,string>; order_index?: number }) =>
    api.patch(`/lessons/${lessonId}`, b),
  deleteLesson: (lessonId: string) => api.delete(`/lessons/${lessonId}`),
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
  listAssets: (params?: { category?: string; search?: string; module_type?: string; tag?: string; usage_context?: string; parent_preview?: boolean; sort?: "name" | "category" | "created_at"; order?: "asc" | "desc"; page?: number; limit?: number }) =>
    api.get("/assets", { params }).then((res) => ({
      data: res.data.data as Array<{
        id: string; category: string; name?: string; width?: number; height?: number; created_at: string;
        module_type?: string; grade_tier_id?: string; grade_tier_code?: string; language?: string; tags: string[];
        usage_contexts?: string[]; parent_preview_enabled?: boolean; parent_preview_seconds?: number;
      }>,
      meta: res.data.meta as { page: number; limit: number; total: number; totalPages: number },
    })),
  listAllTags: () => api.get("/assets/tags").then(d<string[]>),
  getAsset: (assetId: string) => api.get(`/assets/${assetId}`).then(d<{
    id: string; category: string; name?: string; file_data: string; slide_urls?: string[] | null; width?: number; height?: number;
    module_type?: string; grade_tier_id?: string; language?: string; tags: string[];
    usage_contexts?: string[]; parent_preview_enabled?: boolean; parent_preview_seconds?: number;
  }>),
  createAsset: (b: {
    category: string; name?: string; file_data: string; width?: number; height?: number;
    module_type?: string; grade_tier_id?: string; language?: string; tags?: string[];
    usage_contexts?: string[]; parent_preview_enabled?: boolean; parent_preview_seconds?: number;
  }) => api.post<{ data: { id: string; file_data: string } }>("/assets", b),
  // 编辑已上传素材的元数据——不改文件本身，只改名称/标签/等级/使用场景/
  // 家长预览这几个"标注类"栏位。parent_preview_seconds 传 null 表示"清空
  // 秒数限制"，不传（undefined）表示"不动这个栏位"。
  updateAsset: (assetId: string, b: {
    name?: string; module_type?: string; grade_tier_id?: string; language?: string; tags?: string[];
    usage_contexts?: string[]; parent_preview_enabled?: boolean; parent_preview_seconds?: number | null;
  }) => api.put(`/assets/${assetId}`, b),
  deleteAsset: (assetId: string) => api.delete(`/assets/${assetId}`),
};

// ── Asset chunk upload (大文件分片上传，目前用于视频素材) ──────────────────────
export const assetChunkUploadApi = {
  init: (b: { fileName: string; fileSize: number; totalChunks: number; mimeType: string }) =>
    api.post("/assets/chunk-upload/init", b).then(d<{ uploadId: string }>),
  status: (uploadId: string) =>
    api.get(`/assets/chunk-upload/${uploadId}/status`).then(d<{ receivedChunks: number[] }>),
  uploadChunk: (uploadId: string, chunkIndex: number, chunk: Blob) => {
    const formData = new FormData();
    formData.append("chunk", chunk);
    // 注意：不要手动设置 Content-Type，让浏览器/axios自动带上multipart的boundary
    return api.post(`/assets/chunk-upload/${uploadId}/chunk/${chunkIndex}`, formData, {
      headers: { "Content-Type": undefined },
    });
  },
  complete: (uploadId: string) =>
    api.post(`/assets/chunk-upload/${uploadId}/complete`).then(d<{ url: string; mimeType: string }>),
};

// ── 学生模式选择 / 订阅状态 ──────────────────────────────────────────────────
export const studentModeApi = {
  getModes: () => api.get("/student/modes").then(d<{ hasActiveSubscription: boolean; gradeTierId: string | null }>),
};

// ── Discovery 模式 (Programme → Topic → Activity，数据源是 course_levels) ─────
export const discoveryApi = {
  listTopics: (programmeId: string) => api.get("/discovery/topics", { params: { programme_id: programmeId } }).then(d<Array<{
    id: string; name_zh: string; name_en?: string; subject_name_zh?: string; activity_count: number;
  }>>),
  listActivities: (categoryId: string) => api.get("/discovery/activities", { params: { category_id: categoryId } }).then(d<Array<{
    id: string; exercise_number?: string; title_i18n?: Record<string, string>; module_type: string;
    difficulty?: string; duration_minutes?: number;
    completed?: boolean; score?: number; max_score?: number; played_at?: string;
  }>>),
};

// ── Self Guided Learning (Course → Lesson → 步骤，按序学习) ────────────────────
export const selfGuidedApi = {
  listCourses: () => api.get("/self-guided/courses").then(d<Array<{
    id: string; title_i18n: Record<string, string>; description_i18n?: Record<string, string>; age_group?: string; lesson_count: number;
  }>>),
  listLessons: (courseId: string) => api.get(`/self-guided/courses/${courseId}/lessons`).then(d<Array<{
    id: string; title_i18n: Record<string, string>; order_index: number; step_count: number;
  }>>),
  getLesson: (lessonId: string) => api.get(`/self-guided/lessons/${lessonId}`).then(d<{
    id: string; course_id: string; title_i18n: Record<string, string>; order_index: number;
    steps: Array<{
      id: string; order_index: number; step_type: "video" | "ppt" | "level";
      media_url?: string; media_title?: string;
      course_level_id?: string; level_title_i18n?: Record<string, string>; module_type?: string;
    }>;
  }>),
};

// ── Lesson步骤进度 (只服务 lesson_steps 里没有 course_level_id 的 video/ppt 步骤；
//    Discovery 和 Lesson里的 level 步骤走的是下面 eduApi.submitProgress，跟这里无关) ──
export const mediaProgressApi = {
  submit: (b: {
    lesson_step_id: string; media_type: "video" | "ppt";
    seconds_watched?: number; duration_seconds?: number;
    last_slide_index?: number; total_slides?: number;
    completed?: boolean;
  }) => api.post("/media-progress", b).then(d<{ id: string; completed: boolean; seconds_watched?: number; last_slide_index?: number; view_count: number }>),
  get: (lessonStepId: string) =>
    api.get("/media-progress", { params: { lessonStepId } }).then(d<{
      id: string; completed: boolean; seconds_watched?: number; duration_seconds?: number;
      last_slide_index?: number; total_slides?: number; view_count: number;
    } | null>),
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
  // 延长学生订阅——不管原本是试用中/已过期/被取消，统一给N天的使用权限
  extendStudentSubscription: (studentId: string, days: number) =>
    api.post(`/admin/students/${studentId}/extend-subscription`, { days }),
  // operator 专用——全平台学习记录，不受"只能看自己/自己孩子/自己班级"
  // 限制，可以按学生/Activity/模块类型/完成状态/日期区间筛选
  listAllProgressRecords: (params: {
    search?: string; student_id?: string; module_type?: string; completed?: boolean;
    date_from?: string; date_to?: string; page?: number; limit?: number;
  }) => api.get("/admin/progress-records", { params }).then((res) => ({
    data: res.data.data as Array<{
      id: string; played_at: string; module_type: string; score: number; max_score: number;
      time_spent_seconds: number; mistakes: number; completed: boolean; attempt_number?: number;
      student_id: string; username: string; full_name_zh?: string; full_name_en?: string; role_codes: string[];
      course_level_id?: string; level_title_i18n?: Record<string, string>; exercise_number?: string;
    }>,
    meta: res.data.meta as { page: number; limit: number; total: number; totalPages: number },
  })),
  // 跟延长订阅相反——把这个学生正在订阅中的状态直接改成过期
  expireStudentSubscription: (studentId: string) =>
    api.post(`/admin/students/${studentId}/expire-subscription`),
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
  // 封锁/解封——跟deactivate（软删除）不一样，这个是可逆的，账号资料都
  // 还在，只是不能登录。跟"登录失败太多次自动锁定"也不一样，不会自动
  // 解除，只能operator自己解封。
  block: (userId: string) => api.post(`/admin/users/${userId}/block`),
  unblock: (userId: string) => api.post(`/admin/users/${userId}/unblock`),
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
  updateCourse: (courseId: string, b: { title_i18n?: Record<string,string>; description_i18n?: Record<string,string>; age_group?: string; grade_tier_id?: string }) =>
    api.patch(`/courses/${courseId}`, b),
  // force=true：Activity 保留、只解除跟这门课的关联；课时(Lesson)连同
  // 底下的步骤一起级联删掉。不传的话，底下还有 Activity/课时会被拦下来。
  deleteCourse: (courseId: string, force?: boolean) => api.delete(`/courses/${courseId}`, { params: force ? { force: "true" } : {} }),
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
      // 一个 Activity 现在可以同时挂好几个 Topic（多对多），后端回传的
      // 是这个 Activity 挂着的全部 Topic，不再是单一一个。
      topics: Array<{
        category_id: string; topic_name_zh?: string;
        subject_id?: string; subject_name_zh?: string;
        programme_id?: string; programme_name_zh?: string;
      }>;
    }>,
    meta: res.data.meta as { page: number; limit: number; total: number; totalPages: number },
  })),
  createLevel: (courseId: string, b: {
    module_type: string; order_index?: number; title_i18n?: Record<string,string>; config: object;
    explanation_text?: string; explanation_image_url?: string; explanation_video_url?: string;
    // category_id 是旧的单一栏位（向后兼容），category_ids 是新的多选——
    // 一个 Activity 现在可以同时挂好几个 Topic。两个都传的话后端以
    // category_ids 为准。
    category_id?: string; category_ids?: string[]; group_id?: string; curriculum_type_id?: string; hint_text?: string; audio_url?: string;
    activity_type?: string; teaching_modes?: string[]; difficulty?: string;
    age_group_min?: number; age_group_max?: number; duration_minutes?: number;
    learning_outcomes?: string; skills_developed?: string[]; language?: string; tags?: string[];
    parent_preview_enabled?: boolean; usage_contexts?: string[]; self_guided_programme_ids?: string[];
  }) =>
    api.post(`/courses/${courseId}/levels`, b),
  // 独立建 Activity，不需要先有 Course——底层是 POST /activities，跟
  // createLevel 是同一个后端函数，courseId 从这里的可选栏位读（不传就是
  // 完全不挂在任何 Course 底下）。
  createActivity: (b: {
    module_type: string; order_index?: number; title_i18n?: Record<string,string>; config: object;
    explanation_text?: string; explanation_image_url?: string; explanation_video_url?: string;
    category_id?: string; category_ids?: string[]; group_id?: string; curriculum_type_id?: string; hint_text?: string; audio_url?: string;
    activity_type?: string; teaching_modes?: string[]; difficulty?: string;
    age_group_min?: number; age_group_max?: number; duration_minutes?: number;
    learning_outcomes?: string; skills_developed?: string[]; language?: string; tags?: string[];
    parent_preview_enabled?: boolean; usage_contexts?: string[]; self_guided_programme_ids?: string[];
    course_id?: string;
  }) =>
    api.post(`/activities`, b),
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
    category_id?: string; category_ids?: string[]; group_id?: string; curriculum_type_id?: string;
    activity_type?: string; teaching_modes?: string[]; difficulty?: string;
    age_group_min?: number; age_group_max?: number; duration_minutes?: number;
    learning_outcomes?: string; skills_developed?: string[]; language?: string; tags?: string[];
    parent_preview_enabled?: boolean; usage_contexts?: string[]; self_guided_programme_ids?: string[];
  }>),
  updateLevel: (levelId: string, b: {
    title_i18n?: Record<string,string>; config?: object; explanation_text?: string; explanation_image_url?: string; explanation_video_url?: string;
    hint_text?: string; audio_url?: string; category_id?: string; category_ids?: string[]; group_id?: string; curriculum_type_id?: string;
    activity_type?: string; teaching_modes?: string[]; difficulty?: string;
    age_group_min?: number; age_group_max?: number; duration_minutes?: number;
    learning_outcomes?: string; skills_developed?: string[]; language?: string; tags?: string[];
    parent_preview_enabled?: boolean; usage_contexts?: string[]; self_guided_programme_ids?: string[];
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

  // ── 家长预览 (订阅前，按课程分组的版本——目前前端还没接，先留着) ──────────
  listParentPreviewCourses: () => api.get("/parent-preview/courses").then(d<Array<{
    id: string; title_i18n?: Record<string,string>; description_i18n?: Record<string,string>;
    age_group?: string; grade_tier_id?: string; grade_tier_name_i18n?: Record<string,string>;
    preview_assets: Array<{ id: string; category: string; name?: string; file_data: string; slide_urls?: string[]; parent_preview_seconds?: number }>;
    preview_activities: Array<{ id: string; title_i18n?: Record<string,string>; module_type: string; difficulty?: string }>;
  }>>),
  getParentPreviewCourse: (courseId: string) => api.get(`/parent-preview/courses/${courseId}`).then(d<{
    id: string; title_i18n?: Record<string,string>; description_i18n?: Record<string,string>;
    age_group?: string; grade_tier_id?: string; grade_tier_name_i18n?: Record<string,string>;
    preview_assets: Array<{ id: string; category: string; name?: string; file_data: string; slide_urls?: string[]; parent_preview_seconds?: number }>;
    preview_activities: Array<{ id: string; title_i18n?: Record<string,string>; module_type: string; difficulty?: string }>;
  }>),

  // ── 家长预览 (Topic 浏览版——ParentPreviewPage.tsx 实际在用的) ────────────────
  listParentPreviewTopics: (params: { programme_id?: string; subject_id?: string; grade_tier_id?: string }) =>
    api.get("/parent-preview/topics", { params }).then(d<Array<{
      id: string; name_zh: string; name_en?: string;
      subject_id: string; subject_name_zh: string;
      programme_id: string; programme_name_zh: string;
      activity_count: number;
    }>>),
  listParentPreviewActivities: (categoryId: string, params?: { grade_tier_id?: string }) =>
    api.get("/parent-preview/activities", { params: { category_id: categoryId, ...params } }).then(d<Array<{
      id: string; exercise_number?: string; title_i18n?: Record<string,string>;
      module_type: string; difficulty?: string; duration_minutes?: number;
    }>>),
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

export const dataCleanupApi = {
  listPlayedActivities: () => api.get("/admin/cleanup/played-activities").then(d<Array<{
    id: string; module_type: string; title_i18n?: Record<string,string>; exercise_number?: string;
    play_count: number; student_count: number; last_played_at?: string;
    assignment_count: number; lesson_step_count: number; topic_count: number;
  }>>),
  purgeOne: (levelId: string) => api.delete(`/admin/cleanup/activities/${levelId}`),
  purgeBulk: (levelIds: string[]) => api.post("/admin/cleanup/activities/bulk-delete", { level_ids: levelIds }).then(d<{
    deleted: number; failed: string[]; total: number;
  }>),
};