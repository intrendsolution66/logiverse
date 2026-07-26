// frontend/src/pages/HomePage.tsx
//
// Was a Phase 0 placeholder ("占位首页") that just printed a static list of
// what each role SHOULD eventually see — never actually built out, even
// though every one of those pages now exists for real. This replaces it
// with an actual per-role dashboard: each role sees quick-access cards to
// the pages that are actually theirs, matching the same role gating
// AppLayout.tsx's nav now uses (same bug this was part of — "看到所有选项,
// 没有根据权限显示").

import { Link } from "react-router-dom";
import { useAuthStore } from "@/stores/index";

interface DashCard { to: string; emoji: string; title: string; desc: string }

export default function HomePage() {
  const user = useAuthStore((s) => s.user);
  const roleCodes = user?.roles?.map((r) => r.code) ?? [];
  const hasRole = (...codes: string[]) => codes.some((c) => roleCodes.includes(c));

  const cards: DashCard[] = [];
  if (hasRole("STUDENT")) cards.push({ to: "/courses", emoji: "🎮", title: "我的 Activity", desc: "选一门课，开始练习" });
  if (hasRole("PARENT")) cards.push({ to: "/family", emoji: "👨‍👩‍👧", title: "我的孩子", desc: "试用/订阅状态、学习记录、学习时长" });
  if (hasRole("TEACHER")) {
    cards.push({ to: "/my-classes", emoji: "🏫", title: "我的班级", desc: "学生名单、分配作业、班级进度" });
    cards.push({ to: "/schedule", emoji: "📅", title: "日历排课", desc: "给个人、班级、或小组安排 Activity" });
  }
  if (hasRole("OPERATOR", "COURSE_DESIGNER")) {
    cards.push({ to: "/course-designer", emoji: "🛠️", title: "Activity 设计管理", desc: "全平台 Activity，搜索/筛选/排序" });
    cards.push({ to: "/courses-manage", emoji: "📖", title: "课程与课时管理", desc: "建课程、编排课时（视频/PPT/Activity）" });
    cards.push({ to: "/asset-library", emoji: "🗂️", title: "素材库", desc: "背景图、物件图案，可重复使用" });
    cards.push({ to: "/image-editor", emoji: "🎨", title: "图片编辑工具", desc: "组合场景、加文字、手绘" });
    cards.push({ to: "/grade-tiers", emoji: "📶", title: "等级管理", desc: "L1-L4 等级体系" });
    cards.push({ to: "/programmes", emoji: "🏛️", title: "课程体系管理 (Programme)", desc: "最顶层的课程体系" });
    cards.push({ to: "/subjects", emoji: "📚", title: "学习领域管理 (Subject)", desc: "Programme 底下的学习领域" });
    cards.push({ to: "/topics-manage", emoji: "🔢", title: "学习主题管理 (Topic)", desc: "编号前缀、分类细分" });
  }
  if (hasRole("OPERATOR")) {
    cards.push({ to: "/orgs", emoji: "🏢", title: "机构/分校", desc: "组织架构管理" });
    cards.push({ to: "/manage-students", emoji: "🧑‍🎓", title: "学生管理", desc: "全平台学生名单、报读类型" });
    cards.push({ to: "/manage-teachers", emoji: "🧑‍🏫", title: "老师管理", desc: "全平台老师名单、班级/学生数" });
    cards.push({ to: "/manage-parents", emoji: "👪", title: "家长管理", desc: "全平台家长名单、孩子对照" });
    cards.push({ to: "/settings", emoji: "⚙️", title: "设置", desc: "素材储存网址等系统设置" });
  }

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">欢迎，{user?.preferred_name || user?.full_name_zh || user?.username}</h1>
      <p className="text-muted-foreground mb-6">
        {roleCodes.length ? `身份：${roleCodes.join("、")}` : "（尚未分配角色——请联系业者）"}
      </p>

      {cards.length === 0 ? (
        <div className="rounded-lg border p-6 text-sm text-muted-foreground text-center">
          还没有分配任何身份对应的功能，请联系业者确认账号权限设置。
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {cards.map((c) => (
            <Link key={c.to} to={c.to} className="rounded-xl border p-4 hover:border-primary hover:bg-muted/40 transition-colors">
              <div className="text-2xl mb-1">{c.emoji}</div>
              <div className="font-semibold">{c.title}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{c.desc}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
