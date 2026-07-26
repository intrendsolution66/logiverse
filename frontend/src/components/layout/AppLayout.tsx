// frontend/src/components/layout/AppLayout.tsx
//
// Rewritten from scratch rather than trimmed from LifeVerse's original
// (345 lines of nav links to feed/diary/goals/tasks/etc — not worth
// surgically editing down). This is a deliberately minimal generic shell:
// header with logo + role-aware nav placeholder + logout, sidebar slot,
// and an <Outlet /> for whichever role-specific page is routed in.
//
// Expect to flesh out the sidebar per role once Phase 1+ pages exist —
// e.g. a TEACHER sees "排课 / 学生进度", a STUDENT sees "我的习题", etc.
// The role list is already available on `user.roles` (see types/index.ts).

import { useEffect, useState } from "react";
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/index";
import { LanguageSwitcher } from "@/components/shared/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { authApi } from "@/api/index";
import toast from "react-hot-toast";

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, clearAuth, setUser } = useAuthStore();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // 换页就把手机版菜单收起来——不然点完一个连结跳到新页面，菜单还
  // 开着盖住内容，得再点一次汉堡按钮才能关掉，体验很怪。
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  // The login response only returns { id, username, email } — no roles (see
  // auth.controller.ts#login). If we just kept that object in the store,
  // this page would show "no role assigned" forever no matter what the DB
  // actually says, since nothing would ever re-fetch the richer profile.
  // Fetch the full /me payload (which does include roles) once the shell
  // mounts, so a role change made directly in the DB shows up after the
  // next login/page load without needing any other code changes.
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
      // logout should never block the user from leaving, even if the
      // network call fails
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

  // NEW: every nav link used to render unconditionally regardless of role —
  // that's the "登入后什么身份都看到所有选项" bug. Each link now checks
  // whether the current user's role(s) actually use that page. A user with
  // multiple roles (e.g. an OPERATOR who's also a TEACHER) sees the union
  // of both — that's intentional, not a leftover bug.
  const canDesignCourses = hasRole("OPERATOR", "COURSE_DESIGNER");
  const canBrowseCourses = hasRole("STUDENT", "OPERATOR", "COURSE_DESIGNER", "TEACHER");
  const isParent  = hasRole("PARENT");
  const isTeacher = hasRole("TEACHER");
  const isOperator = hasRole("OPERATOR");

  // 桌面版側邊欄跟手机版下拉菜单共用同一份清单——两边分开各写一份很
  // 容易改一边忘了改另一边，导致某个角色在手机上看到的选项跟电脑上
  // 对不起来。
  const navLinks: Array<{ to: string; label: string; show: boolean }> = [
    { to: "/home", label: "首页", show: true },
    { to: "/courses", label: "课程/Activity", show: canBrowseCourses },
    { to: "/course-designer", label: "Activity 设计管理", show: canDesignCourses },
    { to: "/courses-manage", label: "课程与课时管理", show: canDesignCourses },
    { to: "/asset-library", label: "素材库", show: canDesignCourses },
    { to: "/image-editor", label: "图片编辑工具", show: canDesignCourses },
    { to: "/grade-tiers", label: "等级管理", show: canDesignCourses },
    { to: "/programmes", label: "课程体系管理 (Programme)", show: canDesignCourses },
    { to: "/subjects", label: "学习领域管理 (Subject)", show: canDesignCourses },
    { to: "/topics-manage", label: "学习主题管理 (Topic)", show: canDesignCourses },
    { to: "/topics", label: "按 Topic 浏览", show: canDesignCourses },
    { to: "/family", label: "我的孩子", show: isParent },
    { to: "/my-classes", label: "我的班级", show: isTeacher },
    { to: "/schedule", label: "日历排课", show: isTeacher },
    { to: "/orgs", label: "机构/分校", show: isOperator },
    { to: "/manage-students", label: "学生管理", show: isOperator },
    { to: "/manage-teachers", label: "老师管理", show: isOperator },
    { to: "/manage-parents", label: "家长管理", show: isOperator },
    { to: "/settings", label: "设置", show: isOperator },
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <header className="border-b flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          {/* 汉堡按钮——只有小屏幕（md以下）才显示，桌面版側邊欄本来就
              一直看得到，不需要再多一个按钮 */}
          <button
            type="button" onClick={() => setMobileNavOpen((v) => !v)}
            className="md:hidden w-9 h-9 -ml-1.5 flex items-center justify-center rounded-md hover:bg-muted"
            aria-label="菜单"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {mobileNavOpen ? <path d="M18 6 6 18M6 6l12 12" /> : <><path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" /></>}
            </svg>
          </button>
          <Link to="/home" className="flex items-center gap-2 font-bold text-lg">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-blue-500 flex items-center justify-center text-white text-sm">
              LG
            </div>
            LogiVerse
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <span className="text-sm text-muted-foreground hidden sm:inline">
            {user?.preferred_name || user?.full_name_zh || user?.username}
            {roleCodes.length > 0 && (
              <span className="ml-1 text-xs opacity-70">({roleCodes.join(", ")})</span>
            )}
          </span>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="hidden md:inline-flex">登出</Button>
        </div>
      </header>

      {/* 手机版下拉菜单——盖在内容上面的浮层，不是把版面往下挤，這樣
          背景内容（比如正在玩到一半的游戏）状态不会因为菜单开关而跑掉 */}
      {mobileNavOpen && (
        <div className="md:hidden border-b bg-card">
          <nav className="p-3 space-y-0.5 max-h-[70vh] overflow-y-auto">
            {navLinks.filter((l) => l.show).map((l) => (
              <Link
                key={l.to} to={l.to}
                className="block px-3 py-2.5 rounded-md hover:bg-muted text-sm"
              >
                {l.label}
              </Link>
            ))}
            <button
              type="button" onClick={handleLogout}
              className="w-full text-left px-3 py-2.5 rounded-md hover:bg-muted text-sm text-red-500"
            >
              登出
            </button>
          </nav>
        </div>
      )}

      <div className="flex-1 flex">
        {/* 桌面版側邊欄——跟手机菜单共用 navLinks 这份清单 */}
        <aside className="w-56 border-r p-4 hidden md:block">
          <nav className="space-y-1 text-sm">
            {navLinks.filter((l) => l.show).map((l) => (
              <Link key={l.to} to={l.to} className="block px-3 py-2 rounded-md hover:bg-muted">{l.label}</Link>
            ))}
          </nav>
        </aside>

        <main className="flex-1 p-4" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

