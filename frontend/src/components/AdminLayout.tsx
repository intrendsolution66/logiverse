// frontend/src/components/AdminLayout.tsx
//
// 后台管理统一外壳——深色侧边栏 + 顶栏，仿照参考截图的视觉语言。所有
// "管理页面"（Programme/等级/课程/素材库/Topic浏览……）都用这个包一层，
// 而不是各自散落的 max-w-7xl 容器，这样侧边栏导航 + 顶栏是全局统一的，
// 不用每个页面重复写。
//
// 用法：
//   export default function SomeManagementPage() {
//     return (
//       <AdminLayout activePath="/admin/programmes">
//         ...页面内容...
//       </AdminLayout>
//     );
//   }
//
// 注意：这个只用在后台管理页面（面向老师/课程设计师/业者），学生端的
// Discovery/Self Guided/LevelPlayer 不套这个壳——那些是全屏沉浸式体验，
// 侧边栏导航会打断学习节奏，不适合。

import { Link, useLocation } from "react-router-dom";

interface NavItem { label: string; path: string; icon: string }
interface NavGroup { label: string; items: NavItem[] }

// 按你现有页面调整这份配置——新增管理页面时只需要在这里加一行，不用
// 改布局本身的代码。
const NAV_GROUPS: NavGroup[] = [
  {
    label: "课程体系",
    items: [
      { label: "课程体系管理", path: "/admin/programmes", icon: "🗂️" },
      { label: "等级管理", path: "/admin/grade-tiers", icon: "🎚️" },
      { label: "课程与课时管理", path: "/admin/courses", icon: "📚" },
      { label: "按 Topic 浏览", path: "/admin/topics", icon: "🔎" },
    ],
  },
  {
    label: "内容管理",
    items: [
      { label: "素材库", path: "/admin/assets", icon: "🖼️" },
      { label: "Activity 设计管理", path: "/admin/activities", icon: "🧩" },
    ],
  },
  {
    label: "人员",
    items: [
      { label: "学生", path: "/admin/students", icon: "🧑‍🎓" },
      { label: "老师", path: "/admin/teachers", icon: "🧑‍🏫" },
      { label: "家长", path: "/admin/parents", icon: "👪" },
    ],
  },
];

export function AdminLayout({ activePath, children }: { activePath: string; children: React.ReactNode }) {
  const location = useLocation();
  const current = activePath ?? location.pathname;

  return (
    <div className="min-h-screen flex bg-[#F4F6FA]">
      {/* ── 侧边栏 ── */}
      <aside className="w-64 shrink-0 bg-[#0B1526] text-white flex flex-col">
        <div className="px-5 py-6 border-b border-white/10">
          <p className="font-bold text-base leading-tight">LogiVerse 管理后台</p>
          <p className="text-xs text-white/50 mt-0.5">教育运营仪表盘</p>
        </div>
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="px-3 text-[11px] font-medium text-white/40 uppercase tracking-wide mb-1.5">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = current === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                        active ? "bg-gradient-to-r from-teal-500 to-blue-600 text-white font-medium" : "text-white/70 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <span>{item.icon}</span>
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* ── 主内容区 ── */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 bg-white border-b border-border flex items-center justify-between px-6">
          <div />
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium px-3 py-1.5 rounded-md bg-blue-50 text-blue-700">管理员</span>
            <button className="text-xs font-medium px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors">退出登录</button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-8">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
