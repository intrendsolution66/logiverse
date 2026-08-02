// frontend/src/components/layout/AppLayout.tsx
//
// 去掉"课程/Activity"这个菜单项（对应已删除的 CoursesPage/`/courses`
// 路由），顺带去掉不再用到的 canBrowseCourses 变量。

import { useEffect, useState } from "react";
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/index";
import { LanguageSwitcher } from "@/components/shared/LanguageSwitcher";
import { authApi } from "@/api";
import {
  ChevronLeft, ChevronRight, Home, FolderTree, FolderOpen, Tag, SlidersHorizontal,
  BookOpen, Puzzle, Image as ImageIcon, Palette, Baby, Search, School, Calendar,
  Building2, GraduationCap, UserCog, Users, Trash2, Settings, ClipboardList,
  ChevronDown, User as UserIcon, LogOut, type LucideIcon,
} from "lucide-react";
import toast from "react-hot-toast";

const SIDEBAR_COLLAPSED_KEY = "logiverse-sidebar-collapsed";

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
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
      toast.success("已登出");
      navigate("/login");
    }
  }

  const roleCodes = user?.roles?.map((r) => r.code) ?? [];
  const hasRole = (...codes: string[]) => codes.some((c) => roleCodes.includes(c));

  const canDesignCourses = hasRole("OPERATOR", "COURSE_DESIGNER");
  const isParent   = hasRole("PARENT");
  const isTeacher  = hasRole("TEACHER");
  const isOperator = hasRole("OPERATOR");

  interface NavLink { to: string; label: string; show: boolean; icon: LucideIcon; group: string }

  const navLinks: NavLink[] = [
    { to: "/home", label: "首页", show: true, icon: Home, group: "总览" },

    { to: "/programmes", label: "课程体系管理 (Programme)", show: canDesignCourses, icon: FolderTree, group: "分类体系" },
    { to: "/subjects", label: "学习领域管理 (Subject)", show: canDesignCourses, icon: FolderOpen, group: "分类体系" },
    { to: "/topics-manage", label: "学习主题管理 (Topic)", show: canDesignCourses, icon: Tag, group: "分类体系" },
    { to: "/grade-tiers", label: "等级管理 (Level)", show: canDesignCourses, icon: SlidersHorizontal, group: "分类体系" },

    { to: "/courses-manage", label: "课程与课时管理", show: canDesignCourses, icon: BookOpen, group: "课程与内容" },
    { to: "/course-designer", label: "Activity 设计管理", show: canDesignCourses, icon: Puzzle, group: "课程与内容" },

    { to: "/asset-library", label: "素材库", show: canDesignCourses, icon: ImageIcon, group: "内容管理" },
    { to: "/image-editor", label: "图片编辑工具", show: canDesignCourses, icon: Palette, group: "内容管理" },

    { to: "/family", label: "我的孩子", show: isParent, icon: Baby, group: "家庭与班级" },
    { to: "/parent-preview", label: "课程预览", show: isParent, icon: Search, group: "家庭与班级" },
    { to: "/my-classes", label: "我的班级", show: isTeacher, icon: School, group: "家庭与班级" },
    { to: "/schedule", label: "日历排课", show: isTeacher, icon: Calendar, group: "家庭与班级" },

    { to: "/orgs", label: "机构/分校", show: isOperator, icon: Building2, group: "机构管理" },
    { to: "/manage-students", label: "学生管理", show: isOperator, icon: GraduationCap, group: "机构管理" },
    { to: "/manage-teachers", label: "老师管理", show: isOperator, icon: UserCog, group: "机构管理" },
    { to: "/manage-parents", label: "家长管理", show: isOperator, icon: Users, group: "机构管理" },
    { to: "/admin/progress-records", label: "学习记录总览", show: isOperator, icon: ClipboardList, group: "机构管理" },
    { to: "/admin/activity-cleanup", label: "数据清理", show: isOperator, icon: Trash2, group: "机构管理" },
    { to: "/settings", label: "设置", show: isOperator, icon: Settings, group: "机构管理" },
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
            aria-label="菜单"
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
                    {roleCodes.length > 0 && <p className="text-xs text-muted-foreground mt-0.5">{roleCodes.join("、")}</p>}
                  </div>
                  <Link to="/profile" className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors">
                    <UserIcon size={15} /> 个人资料
                  </Link>
                  {isOperator && (
                    <Link to="/settings" className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors">
                      <Settings size={15} /> 设置
                    </Link>
                  )}
                  <button type="button" onClick={handleLogout} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors">
                    <LogOut size={15} /> 登出
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
            <button type="button" onClick={handleLogout} className="w-full text-left px-3 py-2.5 rounded-md hover:bg-white/10 text-sm text-red-300">登出</button>
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
              title={collapsed ? "展开菜单" : "收起菜单"}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white/60 hover:bg-white/5 hover:text-white transition-colors w-full ${collapsed ? "justify-center" : ""}`}
            >
              {collapsed ? <ChevronRight size={16} /> : <><ChevronLeft size={16} /> 收起菜单</>}
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
