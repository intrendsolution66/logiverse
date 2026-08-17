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
      id: string; order_index: number; step_type: "video" | "ppt" | "level" | "quiz";
      media_url?: string; media_title?: string; slide_urls?: string[];
      course_level_id?: string; level_title_i18n?: Record<string,string>; module_type?: string;
      bank_question_id?: string; bank_category?: string; bank_question_type?: string; bank_question_preview?: string;
    }>;
  }>),
  createStep: (lessonId: string, b: { step_type: string; media_url?: string; media_title?: string; slide_urls?: string[]; course_level_id?: string; bank_question_id?: string }) =>
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
  // PPT类别单独设置更长的超时(3分钟)——PPT上传后端要同步跑完LibreOffice
  // 转PDF+poppler转图片整套流程才返回，页数多/图片多的PPT经常超过全局
  // 默认的15秒超时，之前"小PPT能传、大PPT传不了"的规律就是这个——不是
  // 后端真的失败了，是前端自己先等不及放弃了。图片/视频这些走别的路径
  // (视频分片上传本身走另一套进度上报，不受这个超时影响)不受影响，只
  // 有真正触发PPT转换的这条请求需要放宽。
  createAsset: (b: {
    category: string; name?: string; file_data: string; width?: number; height?: number;
    module_type?: string; grade_tier_id?: string; language?: string; tags?: string[];
    usage_contexts?: string[]; parent_preview_enabled?: boolean; parent_preview_seconds?: number;
  }) => api.post<{ data: { id: string; file_data: string } }>("/assets", b, b.category === "ppt" ? { timeout: 200_000 } : undefined),
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
// PPT真实动画版——生成一个短期WOPI会话，拿到之后前端拼出Collabora
// iframe网址（wopiSrc + accessToken + officeUrl三样拼起来）
export const wopiApi = {
  createSession: (assetId: string) =>
    api.post(`/assets/${assetId}/wopi-session`).then(d<{ wopiSrc: string; accessToken: string; officeUrl: string }>),
};

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
      id: string; order_index: number; step_type: "video" | "ppt" | "level" | "quiz";
      media_url?: string; media_title?: string; slide_urls?: string[];
      course_level_id?: string; level_title_i18n?: Record<string, string>; module_type?: string;
      bank_question_id?: string; bank_category?: string; bank_question_type?: string; bank_question_preview?: string;
    }>;
  }>),
};

// ── Lesson步骤进度 (只服务 lesson_steps 里没有 course_level_id 的 video/ppt 步骤；
//    Discovery 和 Lesson里的 level 步骤走的是下面 eduApi.submitProgress，跟这里无关) ──
export const mediaProgressApi = {
  submit: (b: {
    lesson_step_id: string; media_type: "video" | "ppt" | "quiz";
    seconds_watched?: number; duration_seconds?: number;
    last_slide_index?: number; total_slides?: number;
    is_correct?: boolean; marks_earned?: number; marks_total?: number;
    completed?: boolean;
  }) => api.post("/media-progress", b).then(d<{ id: string; completed: boolean; seconds_watched?: number; last_slide_index?: number; is_correct?: boolean; marks_earned?: number; marks_total?: number; view_count: number }>),
  get: (lessonStepId: string) =>
    api.get("/media-progress", { params: { lessonStepId } }).then(d<{
      id: string; completed: boolean; seconds_watched?: number; duration_seconds?: number;
      last_slide_index?: number; total_slides?: number; is_correct?: boolean; marks_earned?: number; marks_total?: number; view_count: number;
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
  // 排行榜——全平台，每个学生只取自己的历史最佳一次参与排名（分数高
  // 优先，同分比用时短优先）。my_rank 是当前登录者在这个 Activity 的
  // 名次，即使名次不在 entries（top N）范围内也会算出来，不用另外再查。
  getLevelLeaderboard: (levelId: string, limit?: number) =>
    api.get(`/levels/${levelId}/leaderboard`, { params: limit ? { limit } : {} }).then(d<{
      entries: Array<{
        student_id: string; username: string; full_name_zh?: string; full_name_en?: string;
        score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
        played_at: string; rank: number;
      }>;
      my_rank: number | null;
      total_players: number;
    }>),
  // 自己的记录——历史最佳一次 + 最近20次的完整历史列表
  getMyLevelRecords: (levelId: string) =>
    api.get(`/levels/${levelId}/my-records`).then(d<{
      best: { score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean; attempt_number: number; played_at: string } | null;
      history: Array<{ id: string; score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean; attempt_number: number; played_at: string }>;
    }>),

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

  // ── 中文字笔顺练习 ──────────────────────────────────────────────────────────
  // 笔顺数据来自后端自己的node_modules(hanzi-writer-data)，不是前端静态
  // 文件——见 ChineseStrokeGame.tsx 的 charDataLoader 怎么用这个方法。
  getHanziStrokeData: (char: string) =>
    api.get(`/hanzi-data/${encodeURIComponent(char)}`).then(d<{ strokes: string[]; medians: number[][][] }>),
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
};// ── 试卷/比赛系统 (Exam Papers) ──────────────────────────────────────────────
// 跟 eduApi 管的 Activity 体系是两套独立的东西，后端也是独立挂在
// /api/v1/exam-papers、/api/v1/exam-question-bank、/api/v1/exam-attempts
// 底下（见 backend/src/modules/edu/exam.routes.ts）。

export interface ExamPaper {
  id: string; title_i18n: Record<string, string>; description?: string;
  instructions_i18n?: Record<string, string>; // 考前须知——学生开始作答前的封面/须知页显示，勾选确认后才能真正开始
  time_limit_minutes: number; opens_at?: string; closes_at?: string;
  status: "draft" | "published" | "closed";
  total_marks: number; allow_retake: boolean; max_attempts: number;
  review_policy: "immediate" | "after_close";
  student_count?: number; attempt_count?: number;
  created_at: string; updated_at: string;
}

export interface ExamPaperQuestion {
  id: string; paper_id: string; order_index: number;
  slot_type: "fixed" | "random_category";
  question_type?: "multiple_choice" | "fill_blank" | "coloring"; // slot_type='fixed' 时才有
  marks: number;
  config?: Record<string, unknown>; // slot_type='fixed' 时才有(含正确答案，仅设计师能看)
  random_category?: string; random_count?: number; // slot_type='random_category' 时才有
}

export interface ExamQuestionBankItem {
  id: string; category: string;
  question_type: "multiple_choice" | "fill_blank" | "coloring" | "sudoku" | "sticker_game";
  config: Record<string, unknown>;
  created_at: string;
}

export const examApi = {
  // ── 试卷本身 ──────────────────────────────────────────────────────────────
  listPapers: (params?: { page?: number; limit?: number }) =>
    api.get("/exam-papers", { params }).then((res) => ({
      data: res.data.data as ExamPaper[],
      meta: res.data.meta as { page: number; limit: number; total: number; totalPages: number },
    })),
  createPaper: (b: {
    title_i18n: { zh: string; en?: string; ms?: string }; description?: string;
    instructions_i18n?: { zh?: string; en?: string; ms?: string }; time_limit_minutes?: number;
    opens_at?: string; closes_at?: string; allow_retake?: boolean; max_attempts?: number;
    review_policy?: "immediate" | "after_close";
  }) => api.post("/exam-papers", b).then(d<ExamPaper>),
  // 设计师编辑视图——带完整题目内容(含正确答案)，只有 courses.manage
  // 权限能调，学生端绝对不能调这个。
  getPaperForEdit: (paperId: string) =>
    api.get(`/exam-papers/${paperId}`).then(d<ExamPaper & { questions: ExamPaperQuestion[] }>),
  updatePaper: (paperId: string, b: Partial<{
    title_i18n: { zh: string; en?: string; ms?: string }; description: string;
    instructions_i18n: { zh?: string; en?: string; ms?: string }; time_limit_minutes: number;
    opens_at: string; closes_at: string; allow_retake: boolean; max_attempts: number;
    review_policy: "immediate" | "after_close";
  }>) => api.patch(`/exam-papers/${paperId}`, b),
  setPaperStatus: (paperId: string, status: "draft" | "published" | "closed") =>
    api.patch(`/exam-papers/${paperId}/status`, { status }),
  deletePaper: (paperId: string) => api.delete(`/exam-papers/${paperId}`),
  // PDF 是二进制内容，axios 要指定 responseType:"blob" 才不会把它当JSON解析
  downloadPaperPdf: (paperId: string, lang: "zh" | "en" | "ms" = "zh") =>
    api.get(`/exam-papers/${paperId}/pdf`, { params: { lang }, responseType: "blob" }).then((res) => res.data as Blob),
  // 运营/设计师"试玩预览"——绕开白名单/发布状态/时间窗口，直接返回含
  // 正确答案的完整题目，判分在前端本地算，不写入任何作答记录。
  getPaperPreview: (paperId: string) =>
    api.get(`/exam-papers/${paperId}/preview`).then(d<{
      title_i18n: Record<string, string>; time_limit_minutes: number; total_marks: number;
      questions: Array<{ id: string; order_index: number; question_type: string; marks: number; config: Record<string, unknown> }>;
    }>),

  // ── 试卷题目槽位 ──────────────────────────────────────────────────────────
  addQuestion: (paperId: string, b: {
    slot_type: "fixed" | "random_category"; marks?: number;
    question_type?: string; config?: Record<string, unknown>; // slot_type='fixed'
    random_category?: string; random_count?: number;           // slot_type='random_category'
  }) => api.post(`/exam-papers/${paperId}/questions`, b).then(d<ExamPaperQuestion>),
  updateQuestion: (paperId: string, questionId: string, b: Partial<{
    slot_type: string; marks: number; question_type: string; config: Record<string, unknown>;
    random_category: string; random_count: number;
  }>) => api.patch(`/exam-papers/${paperId}/questions/${questionId}`, b),
  deleteQuestion: (paperId: string, questionId: string) =>
    api.delete(`/exam-papers/${paperId}/questions/${questionId}`),
  reorderQuestions: (paperId: string, questionIds: string[]) =>
    api.patch(`/exam-papers/${paperId}/questions/reorder`, { question_ids: questionIds }),

  // ── 题库 ─────────────────────────────────────────────────────────────────
  listQuestionBankCategories: () =>
    api.get("/exam-question-bank/categories").then(d<Array<{ category: string; question_count: number }>>),
  listQuestionBank: (params?: { category?: string; page?: number; limit?: number }) =>
    api.get("/exam-question-bank", { params }).then((res) => ({
      data: res.data.data as ExamQuestionBankItem[],
      meta: res.data.meta as { page: number; limit: number; total: number; totalPages: number },
    })),
  createBankQuestion: (b: { category: string; question_type: string; config: Record<string, unknown> }) =>
    api.post("/exam-question-bank", b).then(d<ExamQuestionBankItem>),
  updateBankQuestion: (questionId: string, b: Partial<{ category: string; question_type: string; config: Record<string, unknown> }>) =>
    api.patch(`/exam-question-bank/${questionId}`, b),
  deleteBankQuestion: (questionId: string) => api.delete(`/exam-question-bank/${questionId}`),
  // 从 Activity 库导入——先列出可选的Activity(按题型筛选)，选中后调
  // importFromActivity 真正复制一份进题库。
  listImportableActivities: (moduleType: string, params?: { page?: number; limit?: number }) =>
    api.get("/exam-question-bank/importable", { params: { module_type: moduleType, ...params } }).then((res) => ({
      data: res.data.data as Array<{ id: string; title_i18n: Record<string, string>; module_type: string; config: Record<string, unknown> }>,
      meta: res.data.meta as { page: number; limit: number; total: number; totalPages: number },
    })),
  importFromActivity: (activityId: string, category: string) =>
    api.post("/exam-question-bank/import", { activity_id: activityId, category }).then(d<ExamQuestionBankItem>),

  // ── 受邀学生名单 ──────────────────────────────────────────────────────────
  listPaperStudents: (paperId: string) =>
    api.get(`/exam-papers/${paperId}/students`).then(d<Array<{
      student_id: string; full_name_zh?: string; full_name_en?: string; username: string; email?: string; invited_at: string;
      attempt_status?: string; score?: number; max_score?: number; submitted_at?: string;
    }>>),
  addPaperStudents: (paperId: string, studentIds: string[]) =>
    api.post(`/exam-papers/${paperId}/students`, { student_ids: studentIds }).then(d<{ added: number; requested: number }>),
  removePaperStudent: (paperId: string, studentId: string) =>
    api.delete(`/exam-papers/${paperId}/students/${studentId}`),

  // ── 排行榜(设计师/老师视角) ────────────────────────────────────────────────
  getLeaderboard: (paperId: string) =>
    api.get(`/exam-papers/${paperId}/leaderboard`).then(d<{
      total_marks: number;
      rankings: Array<{ student_id: string; full_name_zh?: string; full_name_en?: string; username: string; best_score: number; best_submitted_at: string }>;
    }>),

  // ── 学生端作答 ────────────────────────────────────────────────────────────
  listMyPapers: () =>
    api.get("/exam-papers/mine").then(d<Array<ExamPaper & {
      attempt_id?: string; attempt_status?: string; score?: number; submitted_at?: string;
    }>>),
  startAttempt: (paperId: string) =>
    api.post(`/exam-papers/${paperId}/start`).then(d<{
      attempt_id: string; started_at: string; title_i18n: Record<string, string>;
      remaining_seconds: number;
      // 这里的 config 已经被后端去掉正确答案了(stripAnswers)——安全，可以放心传给渲染组件
      questions: Array<{ id: string; order_index: number; question_type: string; marks: number; config: Record<string, unknown> }>;
    }>),
  // key 是这次作答返回的题目 id(attempt_question id)，不是考卷槽位id——
  // 随机槽一个槽对应好几道具体题，只有物化后的这份题目才有稳定id可用。
  submitAttempt: (attemptId: string, answers: Record<string, unknown>) =>
    api.post(`/exam-attempts/${attemptId}/submit`, { answers }).then(d<{ score: number; max_score: number; submitted_at: string }>),
  getAttempt: (attemptId: string) =>
    api.get(`/exam-attempts/${attemptId}`).then(d<{ id: string; status: string; score?: number; max_score?: number; submitted_at?: string }>),
  // 逐题详情——可能被试卷的 review_policy/closes_at 挡住，调用方要处理
  // 403(还不能看)这种情况，不要当成普通错误弹窗，应该显示"要等到XX时间"
  getAttemptReview: (attemptId: string) =>
    api.get(`/exam-attempts/${attemptId}/review`).then(d<{
      id: string; score: number; max_score: number; submitted_at: string;
      questions: Array<{
        id: string; order_index: number; question_type: string; marks: number;
        config: Record<string, unknown>; student_answer: unknown; is_correct: boolean;
      }>;
    }>),
  listMyAttempts: (paperId: string) =>
    api.get(`/exam-papers/${paperId}/my-attempts`).then(d<Array<{
      id: string; status: string; score?: number; max_score?: number; started_at: string; submitted_at?: string;
    }>>),

  // ── 题库单题——课时quiz步骤学生端用 ──────────────────────────────────────
  playBankQuestion: (questionId: string) =>
    api.get(`/exam-question-bank/${questionId}/play`).then(d<{ id: string; category: string; question_type: string; config: Record<string, unknown> }>),
  checkBankQuestion: (questionId: string, answer: unknown) =>
    api.post(`/exam-question-bank/${questionId}/check`, { answer }).then(d<{ is_correct: boolean }>),
};

// ── 分享链接 ──────────────────────────────────────────────────────────────────
export interface ShareLink {
  id: string; token: string; resource_type: "lesson" | "exam_paper" | "activity"; resource_id: string;
  title?: string; created_by: string; expires_at?: string; revoked_at?: string; view_count: number; created_at: string;
}

// 设计师管理——需要登录 + courses.manage 权限，跟平常的内容管理接口一样
export const shareLinksApi = {
  create: (b: { resource_type: "lesson" | "exam_paper" | "activity"; resource_id: string; expires_in_days?: number }) =>
    api.post("/share-links", b).then(d<ShareLink>),
  list: (params?: { resource_type?: string; resource_id?: string }) =>
    api.get("/share-links", { params }).then(d<ShareLink[]>),
  revoke: (id: string) => api.post(`/share-links/${id}/revoke`),
};

// 公开访问——不需要登录，token本身就是凭证。用的还是同一个 api 实例，
// 没有token的匿名访客调用这些接口时，request拦截器只是不会附加
// Authorization头，请求照样正常发出去，这些接口本来就没挂authenticate。
export const sharePublicApi = {
  resolve: (token: string) => api.get(`/share/${token}`).then(d<{ resource_type: string; resource_id: string; title?: string }>),
  getLesson: (token: string) => api.get(`/share/${token}/lesson`).then(d<{
    id: string; course_id: string; title_i18n: Record<string,string>; order_index: number;
    steps: Array<{
      id: string; order_index: number; step_type: "video" | "ppt" | "level" | "quiz";
      media_url?: string; media_title?: string; slide_urls?: string[];
      course_level_id?: string; level_title_i18n?: Record<string,string>; module_type?: string;
      bank_question_id?: string; bank_category?: string; bank_question_type?: string; bank_question_preview?: string;
    }>;
  }>),
  playBankQuestion: (token: string, questionId: string) =>
    api.get(`/share/${token}/questions/${questionId}/play`).then(d<{ id: string; category: string; question_type: string; config: Record<string, unknown> }>),
  checkBankQuestion: (token: string, questionId: string, answer: unknown) =>
    api.post(`/share/${token}/questions/${questionId}/check`, { answer }).then(d<{ is_correct: boolean }>),

  // Activity——config 的具体形状因 module_type 而异(跟 eduApi.getLevel 一样，
  // 前端游戏组件自己按 module_type 去解读 config，这里就不细分类型了)
  getActivity: (token: string) => api.get(`/share/${token}/activity`).then(d<{
    id: string; course_id: string; order_index: number; module_type: string;
    title_i18n: Record<string, string>; config: Record<string, unknown> | null;
  }>),
  checkSudoku: (token: string, levelId: string, values: (number | null)[]) =>
    api.post(`/share/${token}/activity/${levelId}/sudoku-check`, { values }).then(d<{ correct: boolean[]; allCorrect: boolean; solution: number[] }>),
  checkColoring: (token: string, levelId: string, fills: Record<string, string>) =>
    api.post(`/share/${token}/activity/${levelId}/coloring-check`, { fills }).then(d<{ results: Array<{ marker_color: string; correct: boolean }>; allCorrect: boolean; totalRegions: number }>),
  checkWordProblem: (token: string, levelId: string, value: number) =>
    api.post(`/share/${token}/activity/${levelId}/word-problem-check`, { value }).then(d<{ correct: boolean; answer: number }>),
};