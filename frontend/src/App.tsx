// frontend/src/App.tsx
// 加了 /view/ppt 和 /view/video 两条独立预览路由。

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "@/stores/index";
import ParentPreviewPage from "@/pages/edu/ParentPreviewPage";
import AppLayout from "@/components/layout/AppLayout";
import LoginPage from "@/pages/public/LoginPage";
import RegisterPage from "@/pages/public/RegisterPage";
import HomePage  from "@/pages/HomePage";
import ProfilePage from "@/pages/ProfilePage";
import CourseDesignerPage from "@/pages/edu/CourseDesignerPage";
import ExamDesignerPage from "@/pages/edu/ExamDesignerPage";
import MyExamsPage from "@/pages/edu/MyExamsPage";
import ExamTakePage from "@/pages/edu/ExamTakePage";
import ExamResultPage from "@/pages/edu/ExamResultPage";
import ExamPreviewPage from "@/pages/edu/ExamPreviewPage";
import ExamSharePlayPage from "@/pages/edu/ExamSharePlayPage";
import CourseLessonPage from "@/pages/edu/CourseLessonPage";
import GradeTiersPage from "@/pages/edu/GradeTiersPage";
import ProgrammeManagementPage from "@/pages/edu/ProgrammeManagementPage";
import SubjectManagementPage from "@/pages/edu/SubjectManagementPage";
import TopicManagementPage from "@/pages/edu/TopicManagementPage";
import SettingsPage from "@/pages/edu/SettingsPage";
import StudentManagementPage from "@/pages/edu/StudentManagementPage";
import TeacherManagementPage from "@/pages/edu/TeacherManagementPage";
import ParentManagementPage from "@/pages/edu/ParentManagementPage";
import LevelPlayerPage from "@/pages/edu/LevelPlayerPage";
import LessonPlayerPage from "@/pages/edu/LessonPlayerPage";
import LearningHomePage from "@/pages/edu/LearningHomePage";
import DiscoveryPage from "@/pages/edu/DiscoveryPage";
import DiscoveryActivitiesPage from "@/pages/edu/DiscoveryActivitiesPage";
import SelfGuidedCoursesPage from "@/pages/edu/SelfGuidedCoursesPage";
import SelfGuidedLessonsPage from "@/pages/edu/SelfGuidedLessonsPage";
import FamilyDashboardPage from "@/pages/edu/FamilyDashboardPage";
import TeacherClassesPage from "@/pages/edu/TeacherClassesPage";
import TeacherSchedulePage from "@/pages/edu/TeacherSchedulePage";
import AssetLibraryPage from "@/pages/edu/AssetLibraryPage";
import ImageEditorPage from "@/pages/edu/ImageEditorPage";
import ActivityCleanupPage from "@/pages/edu/ActivityCleanupPage";
import ProgressRecordsPage from "@/pages/edu/ProgressRecordsPage";
import PptViewerPage from "@/pages/edu/PptViewerPage";
import VideoViewerPage from "@/pages/edu/VideoViewerPage";

// ── Guards ────────────────────────────────────────────────────────────────────
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireGuest({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  if (isAuthenticated) return <Navigate to="/home" replace />;
  return <>{children}</>;
}

// ── Router ────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<RequireGuest><LoginPage /></RequireGuest>} />
        <Route path="/register" element={<RequireGuest><RegisterPage /></RequireGuest>} />

        {/* 分享出去的公开内容——完全不需要登录，靠URL里的token本身当
            凭证(校验逻辑在后端shareLinks.controller.ts里)。目前只有
            试卷分享(ExamSharePlayPage)接进来了；如果课时/Activity的
            分享页面组件也已经写好但这里没看到对应路由，说明这份
            App.tsx可能是旧快照，缺的那几条要一并补上，不是这次新加的
            疏漏。 */}
        <Route path="/share/exam/:token" element={<ExamSharePlayPage />} />

        {/* 全屏沉浸式页面——需要登录，但不套 AppLayout 的全局侧边栏/顶栏 */}
        <Route path="/play/:levelId" element={<RequireAuth><LevelPlayerPage /></RequireAuth>} />
        <Route path="/exam/:paperId/take" element={<RequireAuth><ExamTakePage /></RequireAuth>} />
        <Route path="/exam-preview/:paperId" element={<RequireAuth><ExamPreviewPage /></RequireAuth>} />
        <Route path="/exam/attempt/:attemptId/result" element={<RequireAuth><ExamResultPage /></RequireAuth>} />
        <Route path="/lesson/:lessonId" element={<RequireAuth><LessonPlayerPage /></RequireAuth>} />
        {/* Discovery——自己的一套视觉设计（浅米色底、IBM Plex字体），跟主
            后台不是同一套语言，属于沉浸式学习体验的一部分，不套AppLayout */}
        <Route path="/discovery" element={<RequireAuth><DiscoveryPage /></RequireAuth>} />
        <Route path="/discovery/topics/:categoryId" element={<RequireAuth><DiscoveryActivitiesPage /></RequireAuth>} />
        {/* SelfGuidedLessonsPage 点进某一课，导去这个路径——底层就是复用
            LessonPlayerPage，同一个播放器组件，不用另外做一个 */}
        <Route path="/self-guided/lessons/:lessonId" element={<RequireAuth><LessonPlayerPage /></RequireAuth>} />
        <Route path="/view/ppt" element={<RequireAuth><PptViewerPage /></RequireAuth>} />
        <Route path="/view/video" element={<RequireAuth><VideoViewerPage /></RequireAuth>} />

        {/* Protected app shell */}
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route path="/home" element={<HomePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/learn" element={<LearningHomePage />} />
          <Route path="/self-guided" element={<SelfGuidedCoursesPage />} />
          <Route path="/self-guided/courses/:courseId" element={<SelfGuidedLessonsPage />} />
          <Route path="/course-designer" element={<CourseDesignerPage />} />
          <Route path="/exam-designer" element={<ExamDesignerPage />} />
          <Route path="/my-exams" element={<MyExamsPage />} />
          <Route path="/courses-manage" element={<CourseLessonPage />} />
          <Route path="/grade-tiers" element={<GradeTiersPage />} />
          <Route path="/programmes" element={<ProgrammeManagementPage />} />
          <Route path="/subjects" element={<SubjectManagementPage />} />
          <Route path="/topics-manage" element={<TopicManagementPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/manage-students" element={<StudentManagementPage />} />
          <Route path="/manage-teachers" element={<TeacherManagementPage />} />
          <Route path="/manage-parents" element={<ParentManagementPage />} />
          <Route path="/family" element={<FamilyDashboardPage />} />
          <Route path="/my-classes" element={<TeacherClassesPage />} />
          <Route path="/schedule" element={<TeacherSchedulePage />} />
          <Route path="/asset-library" element={<AssetLibraryPage />} />
          <Route path="/image-editor" element={<ImageEditorPage />} />
          <Route path="/admin/activity-cleanup" element={<ActivityCleanupPage />} />
          <Route path="/admin/progress-records" element={<ProgressRecordsPage />} />
          <Route path="/parent-preview" element={<ParentPreviewPage />} />
          {/* TODO Phase 2+: operator routes */}
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

