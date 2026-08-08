// frontend/src/pages/HomePage.tsx
//
// Was a Phase 0 placeholder ("占位首页") that just printed a static list of
// what each role SHOULD eventually see — never actually built out, even
// though every one of those pages now exists for real. This replaces it
// with an actual per-role dashboard: each role sees quick-access cards to
// the pages that are actually theirs, matching the same role gating
// AppLayout.tsx's nav now uses (same bug this was part of — "看到所有选项,
// 没有根据权限显示").
//
// i18n: 已接入 react-i18next(zh/en/ms) — 见 src/i18n/locales/*.json 的
// home.* 命名空间。

import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/stores/index";

interface DashCard { to: string; emoji: string; titleKey: string; descKey: string }

export default function HomePage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const roleCodes = user?.roles?.map((r) => r.code) ?? [];
  const hasRole = (...codes: string[]) => codes.some((c) => roleCodes.includes(c));

  const cards: DashCard[] = [];
  if (hasRole("STUDENT")) cards.push({ to: "/learn", emoji: "🎮", titleKey: "home.cards.student.title", descKey: "home.cards.student.desc" });
  if (hasRole("PARENT")) cards.push({ to: "/family", emoji: "👨‍👩‍👧", titleKey: "home.cards.parent.title", descKey: "home.cards.parent.desc" });
  if (hasRole("TEACHER")) {
    cards.push({ to: "/my-classes", emoji: "🏫", titleKey: "home.cards.teacherClasses.title", descKey: "home.cards.teacherClasses.desc" });
    cards.push({ to: "/schedule", emoji: "📅", titleKey: "home.cards.teacherSchedule.title", descKey: "home.cards.teacherSchedule.desc" });
  }
  if (hasRole("OPERATOR", "COURSE_DESIGNER")) {
    cards.push({ to: "/course-designer", emoji: "🛠️", titleKey: "home.cards.activityDesigner.title", descKey: "home.cards.activityDesigner.desc" });
    cards.push({ to: "/courses-manage", emoji: "📖", titleKey: "home.cards.coursesManage.title", descKey: "home.cards.coursesManage.desc" });
    cards.push({ to: "/asset-library", emoji: "🗂️", titleKey: "home.cards.assetLibrary.title", descKey: "home.cards.assetLibrary.desc" });
    cards.push({ to: "/image-editor", emoji: "🎨", titleKey: "home.cards.imageEditor.title", descKey: "home.cards.imageEditor.desc" });
    cards.push({ to: "/grade-tiers", emoji: "📶", titleKey: "home.cards.gradeTiers.title", descKey: "home.cards.gradeTiers.desc" });
    cards.push({ to: "/programmes", emoji: "🏛️", titleKey: "home.cards.programmes.title", descKey: "home.cards.programmes.desc" });
    cards.push({ to: "/subjects", emoji: "📚", titleKey: "home.cards.subjects.title", descKey: "home.cards.subjects.desc" });
    cards.push({ to: "/topics-manage", emoji: "🔢", titleKey: "home.cards.topics.title", descKey: "home.cards.topics.desc" });
  }
  if (hasRole("OPERATOR")) {
    cards.push({ to: "/orgs", emoji: "🏢", titleKey: "home.cards.orgs.title", descKey: "home.cards.orgs.desc" });
    cards.push({ to: "/manage-students", emoji: "🧑‍🎓", titleKey: "home.cards.manageStudents.title", descKey: "home.cards.manageStudents.desc" });
    cards.push({ to: "/manage-teachers", emoji: "🧑‍🏫", titleKey: "home.cards.manageTeachers.title", descKey: "home.cards.manageTeachers.desc" });
    cards.push({ to: "/manage-parents", emoji: "👪", titleKey: "home.cards.manageParents.title", descKey: "home.cards.manageParents.desc" });
    cards.push({ to: "/settings", emoji: "⚙️", titleKey: "home.cards.settings.title", descKey: "home.cards.settings.desc" });
  }

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">{t("home.welcome", { name: user?.preferred_name || user?.full_name_zh || user?.username })}</h1>
      <p className="text-muted-foreground mb-6">
        {roleCodes.length ? t("home.roleLabel", { roles: roleCodes.join(", ") }) : t("home.noRoleShort")}
      </p>

      {cards.length === 0 ? (
        <div className="rounded-lg border p-6 text-sm text-muted-foreground text-center">
          {t("home.noRole")}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {cards.map((c) => (
            <Link key={c.to} to={c.to} className="rounded-xl border p-4 hover:border-primary hover:bg-muted/40 transition-colors">
              <div className="text-2xl mb-1">{c.emoji}</div>
              <div className="font-semibold">{t(c.titleKey)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{t(c.descKey)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
