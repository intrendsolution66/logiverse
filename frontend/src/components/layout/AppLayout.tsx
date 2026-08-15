// frontend/src/components/layout/AppLayout.tsx
//
// 去掉"课程/Activity"这个菜单项（对应已删除的 CoursesPage/`/courses`
// 路由），顺带去掉不再用到的 canBrowseCourses 变量。

import { useEffect, useState } from "react";
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/stores/index";
import { LanguageSwitcher } from "@/components/shared/LanguageSwitcher";
import { authApi } from "@/api";
import {
  ChevronLeft, ChevronRight, Home, FolderTree, FolderOpen, Tag, SlidersHorizontal,
  BookOpen, Puzzle, Image as ImageIcon, Palette, Baby, Search, School, Calendar,
  Building2, GraduationCap, UserCog, Users, Trash2, Settings, ClipboardList, FileText, Award,
  ChevronDown, User as UserIcon, LogOut, type LucideIcon,
} from "lucide-react";
import toast from "react-hot-toast";

const SIDEBAR_COLLAPSED_KEY = "logiverse-sidebar-collapsed";

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const { user, clearAuth, setUser } = useAuthStore();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");

  useEffect(() => { setMobileNavOpen(false); setUserMenuOpen(false); }, [location.pathname]);
  useEffect(() => { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0"); }, [collapsed]);

  useEffect(() => {
    authApi.me()
      .then((freshUser) => setUser(freshUser))
      .catch(() => { /* if this fails, the user object we already have stays as-is */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    try {
      const refreshToken = localStorage.getItem("refreshToken") ?? undefined;
      await authApi.logout(refreshToken);
    } catch {
      // logout should never block the user from leaving, even if the network call fails
    } finally {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      clearAuth();
      toast.success(t("nav.loggedOut"));
      navigate("/login");
    }
  }

  const roleCodes = user?.roles?.map((r) => r.code) ?? [];
  const hasRole = (...codes: string[]) => codes.some((c) => roleCodes.includes(c));

  const canDesignCourses = hasRole("OPERATOR", "COURSE_DESIGNER");
  const isParent   = hasRole("PARENT");
  const isTeacher  = hasRole("TEACHER");
  const isOperator = hasRole("OPERATOR");
  const isStudent  = hasRole("STUDENT");

  interface NavLink { to: string; label: string; show: boolean; icon: LucideIcon; group: string }

  const navLinks: NavLink[] = [
    { to: "/home", label: t("nav.home"), show: true, icon: Home, group: t("nav.groups.overview") },
    { to: "/my-exams", label: t("nav.myExams"), show: isStudent, icon: Award, group: t("nav.groups.overview") },

    { to: "/programmes", label: t("nav.programmes"), show: canDesignCourses, icon: FolderTree, group: t("nav.groups.taxonomy") },
    { to: "/subjects", label: t("nav.subjects"), show: canDesignCourses, icon: FolderOpen, group: t("nav.groups.taxonomy") },
    { to: "/topics-manage", label: t("nav.topics"), show: canDesignCourses, icon: Tag, group: t("nav.groups.taxonomy") },
    { to: "/grade-tiers", label: t("nav.gradeTiers"), show: canDesignCourses, icon: SlidersHorizontal, group: t("nav.groups.taxonomy") },

    { to: "/courses-manage", label: t("nav.coursesManage"), show: canDesignCourses, icon: BookOpen, group: t("nav.groups.coursesContent") },
    { to: "/course-designer", label: t("nav.courseDesigner"), show: canDesignCourses, icon: Puzzle, group: t("nav.groups.coursesContent") },
    { to: "/exam-designer", label: t("nav.examDesigner"), show: canDesignCourses, icon: FileText, group: t("nav.groups.coursesContent") },

    { to: "/asset-library", label: t("nav.assetLibrary"), show: canDesignCourses, icon: ImageIcon, group: t("nav.groups.contentManagement") },
    { to: "/image-editor", label: t("nav.imageEditor"), show: canDesignCourses, icon: Palette, group: t("nav.groups.contentManagement") },

    { to: "/family", label: t("nav.myChildren"), show: isParent, icon: Baby, group: t("nav.groups.familyClass") },
    { to: "/parent-preview", label: t("nav.parentPreview"), show: isParent, icon: Search, group: t("nav.groups.familyClass") },
    { to: "/my-classes", label: t("nav.myClasses"), show: isTeacher, icon: School, group: t("nav.groups.familyClass") },
    { to: "/schedule", label: t("nav.schedule"), show: isTeacher, icon: Calendar, group: t("nav.groups.familyClass") },

    { to: "/orgs", label: t("nav.orgs"), show: isOperator, icon: Building2, group: t("nav.groups.orgManagement") },
    { to: "/manage-students", label: t("nav.manageStudents"), show: isOperator, icon: GraduationCap, group: t("nav.groups.orgManagement") },
    { to: "/manage-teachers", label: t("nav.manageTeachers"), show: isOperator, icon: UserCog, group: t("nav.groups.orgManagement") },
    { to: "/manage-parents", label: t("nav.manageParents"), show: isOperator, icon: Users, group: t("nav.groups.orgManagement") },
    { to: "/admin/progress-records", label: t("nav.progressRecords"), show: isOperator, icon: ClipboardList, group: t("nav.groups.orgManagement") },
    { to: "/admin/activity-cleanup", label: t("nav.activityCleanup"), show: isOperator, icon: Trash2, group: t("nav.groups.orgManagement") },
    { to: "/settings", label: t("nav.settings"), show: isOperator, icon: Settings, group: t("nav.groups.orgManagement") },
  ];

  const visibleLinks = navLinks.filter((l) => l.show);
  const groups = Array.from(new Set(visibleLinks.map((l) => l.group)));
  const isActive = (to: string) => location.pathname === to;

  return (
    <div className="min-h-screen flex flex-col bg-[#F4F6FA]" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <header className="bg-white border-b border-border flex items-center justify-between px-4 py-3 z-10">
        <div className="flex items-center gap-2">
          <button
            type="button" onClick={() => setMobileNavOpen((v) => !v)}
            className="md:hidden w-9 h-9 -ml-1.5 flex items-center justify-center rounded-md hover:bg-muted"
            aria-label={t("nav.menuAria")}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {mobileNavOpen ? <path d="M18 6 6 18M6 6l12 12" /> : <><path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" /></>}
            </svg>
          </button>
          <Link to="/home" className="flex items-center gap-2 font-bold text-lg text-[#0B1526]">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-teal-500 to-blue-600 flex items-center justify-center text-white text-sm">LG</div>
            LogiVerse
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <div className="relative">
            <button
              type="button" onClick={() => setUserMenuOpen((v) => !v)}
              className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-muted transition-colors"
            >
              <div className="h-7 w-7 rounded-full bg-gradient-to-br from-teal-500 to-blue-600 flex items-center justify-center text-white text-xs font-semibold overflow-hidden shrink-0">
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  (user?.preferred_name || user?.full_name_zh || user?.username || "?").slice(0, 1)
                )}
              </div>
              <span className="text-sm text-muted-foreground hidden sm:inline">
                {user?.preferred_name || user?.full_name_zh || user?.username}
              </span>
              <ChevronDown size={14} className="text-muted-foreground hidden sm:inline" />
            </button>

            {userMenuOpen && (
              <>
                {/* 点空白处关掉菜单——比精确判断"点到菜单外面"简单，透明遮罩铺满全屏，点哪都能关 */}
                <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-52 bg-white rounded-lg border border-border shadow-lg z-20 py-1">
                  <div className="px-3 py-2 border-b border-border">
                    <p className="text-sm font-medium truncate">{user?.preferred_name || user?.full_name_zh || user?.username}</p>
                    {roleCodes.length > 0 && <p className="text-xs text-muted-foreground mt-0.5">{roleCodes.join(i18n.language === "zh" ? "、" : ", ")}</p>}
                  </div>
                  <Link to="/profile" className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors">
                    <UserIcon size={15} /> {t("nav.profile")}
                  </Link>
                  {isOperator && (
                    <Link to="/settings" className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors">
                      <Settings size={15} /> {t("nav.settings")}
                    </Link>
                  )}
                  <button type="button" onClick={handleLogout} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors">
                    <LogOut size={15} /> {t("nav.logout")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {mobileNavOpen && (
        <div className="md:hidden border-b bg-[#0B1526] text-white">
          <nav className="p-3 space-y-0.5 max-h-[70vh] overflow-y-auto">
            {visibleLinks.map((l) => (
              <Link key={l.to} to={l.to} className="flex items-center gap-2 px-3 py-2.5 rounded-md hover:bg-white/10 text-sm">
                <l.icon size={16} strokeWidth={2} />{l.label}
              </Link>
            ))}
            <button type="button" onClick={handleLogout} className="w-full text-left px-3 py-2.5 rounded-md hover:bg-white/10 text-sm text-red-300">{t("nav.logout")}</button>
          </nav>
        </div>
      )}

      <div className="flex-1 flex">
        <aside className={`shrink-0 bg-[#0B1526] text-white hidden md:flex flex-col transition-all duration-200 ${collapsed ? "w-16" : "w-64"}`}>
          <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
            {groups.map((group) => (
              <div key={group}>
                {!collapsed && <p className="px-3 text-[11px] font-medium text-white/40 uppercase tracking-wide mb-1.5">{group}</p>}
                <div className="space-y-0.5">
                  {visibleLinks.filter((l) => l.group === group).map((l) => (
                    <Link
                      key={l.to} to={l.to}
                      title={collapsed ? l.label : undefined}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${collapsed ? "justify-center" : ""} ${
                        isActive(l.to) ? "bg-gradient-to-r from-teal-500 to-blue-600 text-white font-medium" : "text-white/70 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <l.icon size={17} strokeWidth={2} className="shrink-0" />
                      {!collapsed && l.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-white/10 p-3">
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? t("nav.expandMenu") : t("nav.collapseMenu")}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white/60 hover:bg-white/5 hover:text-white transition-colors w-full ${collapsed ? "justify-center" : ""}`}
            >
              {collapsed ? <ChevronRight size={16} /> : <><ChevronLeft size={16} /> {t("nav.collapseMenu")}</>}
            </button>
          </div>
        </aside>

        <main className="flex-1 p-6" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
