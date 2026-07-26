// frontend/src/App.tsx
//
// Trimmed from LifeVerse's original App.tsx (which routed ~30 LifeVerse/org
// community pages). Kept: the RequireAuth/RequireGuest guard pattern (fully
// generic, unchanged) and the basic public/protected route split. Dropped:
// every LifeVerse page and every community-management org page.
//
// /register (Phase 1+1): parents get public self-registration — see 2.5 in
// the architecture doc. Students/staff still don't; those accounts are
// created by a teacher/operator, or by a parent adding a child via /family.

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "@/stores/index";

import AppLayout from "@/components/layout/AppLayout";
import LoginPage from "@/pages/public/LoginPage";
import RegisterPage from "@/pages/public/RegisterPage";
import HomePage  from "@/pages/HomePage";
import CoursesPage from "@/pages/edu/CoursesPage";
import CourseDesignerPage from "@/pages/edu/CourseDesignerPage";
import CourseLessonPage from "@/pages/edu/CourseLessonPage";
import GradeTiersPage from "@/pages/edu/GradeTiersPage";
import ProgrammeManagementPage from "@/pages/edu/ProgrammeManagementPage";
import SubjectManagementPage from "@/pages/edu/SubjectManagementPage";
import TopicManagementPage from "@/pages/edu/TopicManagementPage";
import TopicBrowserPage from "@/pages/edu/TopicBrowserPage";
import SettingsPage from "@/pages/edu/SettingsPage";
import StudentManagementPage from "@/pages/edu/StudentManagementPage";
import TeacherManagementPage from "@/pages/edu/TeacherManagementPage";
import ParentManagementPage from "@/pages/edu/ParentManagementPage";
import LevelPlayerPage from "@/pages/edu/LevelPlayerPage";
import LessonPlayerPage from "@/pages/edu/LessonPlayerPage";
import FamilyDashboardPage from "@/pages/edu/FamilyDashboardPage";
import TeacherClassesPage from "@/pages/edu/TeacherClassesPage";
import TeacherSchedulePage from "@/pages/edu/TeacherSchedulePage";
import AssetLibraryPage from "@/pages/edu/AssetLibraryPage";
import ImageEditorPage from "@/pages/edu/ImageEditorPage";

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

        {/* Protected app shell */}
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route path="/home" element={<HomePage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/course-designer" element={<CourseDesignerPage />} />
          <Route path="/courses-manage" element={<CourseLessonPage />} />
          <Route path="/grade-tiers" element={<GradeTiersPage />} />
          <Route path="/programmes" element={<ProgrammeManagementPage />} />
          <Route path="/subjects" element={<SubjectManagementPage />} />
          <Route path="/topics-manage" element={<TopicManagementPage />} />
          <Route path="/topics" element={<TopicBrowserPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/manage-students" element={<StudentManagementPage />} />
          <Route path="/manage-teachers" element={<TeacherManagementPage />} />
          <Route path="/manage-parents" element={<ParentManagementPage />} />
          <Route path="/play/:levelId" element={<LevelPlayerPage />} />
          <Route path="/lesson/:lessonId" element={<LessonPlayerPage />} />
          <Route path="/family" element={<FamilyDashboardPage />} />
          <Route path="/my-classes" element={<TeacherClassesPage />} />
          <Route path="/schedule" element={<TeacherSchedulePage />} />
          <Route path="/asset-library" element={<AssetLibraryPage />} />
          <Route path="/image-editor" element={<ImageEditorPage />} />
          {/* TODO Phase 2+: operator routes */}
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

