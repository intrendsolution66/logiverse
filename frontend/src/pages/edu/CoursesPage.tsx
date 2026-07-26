// frontend/src/pages/edu/CoursesPage.tsx
//
// Minimal Phase 1 browser: list courses, click one to see its levels, click
// a level to play it. No assignment filtering yet (every student sees every
// course) — that's Phase 3. This page exists purely to prove the vertical
// slice end-to-end; it'll be replaced by proper per-role dashboards later.
//
// Each Activity now shows its Topic (and Subject/Programme via the same
// chain the course designer's Activity table shows) — eduApi.listLevels
// already returns these fields, this page just wasn't displaying them
// before. The collapsed course row also gets a "涉及主题" summary — grouped
// by Programme → Subject rather than just listing bare Topic names, so the
// full taxonomy chain is visible without needing to open the course (an
// earlier version of this only showed Topic names, dropping Subject/
// Programme entirely from the summary line even though the expanded
// per-Activity view had them).

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { eduApi } from "@/api/index";

interface Course { id: string; title_i18n: Record<string,string>; age_group?: string }
interface Level {
  id: string; order_index: number; module_type: string; title_i18n?: Record<string,string>;
  category_name_zh?: string; subject_name_zh?: string; programme_name_zh?: string;
}
// Programme → Subject → [Topic names] — one summary line per Programme/Subject
// pair, listing every distinct Topic under it, rather than one flat list of
// bare Topic names with no indication of which Subject/Programme they're under.
type TopicSummary = { programme: string; subject: string; topics: string[] };

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [openCourseId, setOpenCourseId] = useState<string | null>(null);
  const [levels, setLevels] = useState<Level[]>([]);
  const [topicSummaries, setTopicSummaries] = useState<Record<string, TopicSummary[]>>({}); // courseId -> grouped chain summaries

  useEffect(() => { eduApi.listCourses({ limit: 100 }).then((r) => setCourses(r.data)); }, []);

  // Pre-fetch each course's Activities just to derive the "涉及主题" summary
  // shown on the collapsed row — a student deciding whether to open a
  // course benefits from seeing what it covers without opening every one.
  useEffect(() => {
    courses.forEach((c) => {
      if (topicSummaries[c.id]) return;
      eduApi.listLevels(c.id).then((lv) => {
        const groups = new Map<string, TopicSummary>();
        lv.forEach((l) => {
          if (!l.category_name_zh) return;
          const programme = l.programme_name_zh ?? "未分类课程体系";
          const subject = l.subject_name_zh ?? "未分类学习领域";
          const key = `${programme}|||${subject}`;
          const existing = groups.get(key);
          if (existing) { if (!existing.topics.includes(l.category_name_zh)) existing.topics.push(l.category_name_zh); }
          else groups.set(key, { programme, subject, topics: [l.category_name_zh] });
        });
        setTopicSummaries((prev) => ({ ...prev, [c.id]: Array.from(groups.values()) }));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses]);

  async function openCourse(id: string) {
    setOpenCourseId(id);
    const lv = await eduApi.listLevels(id);
    setLevels(lv);
  }

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-xl font-bold mb-4">课程列表</h1>
      {courses.length === 0 && <p className="text-muted-foreground">还没有课程，先去「课程与课时管理」建一个。</p>}
      <div className="space-y-2">
        {courses.map((c) => (
          <div key={c.id} className="border rounded-lg p-3">
            <button className="font-semibold" onClick={() => openCourse(c.id)}>
              {c.title_i18n?.zh ?? c.title_i18n?.en} {c.age_group && <span className="text-xs text-muted-foreground">({c.age_group})</span>}
            </button>
            {topicSummaries[c.id]?.length > 0 && (
              <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
                {topicSummaries[c.id].map((g, i) => (
                  <p key={i}>涉及主题：{g.programme} → {g.subject} → {g.topics.join("、")}</p>
                ))}
              </div>
            )}
            {openCourseId === c.id && (
              <div className="mt-2 pl-3 space-y-1">
                {levels.length === 0 && <p className="text-sm text-muted-foreground">这门课还没有 Activity</p>}
                {levels.map((lv) => (
                  <Link key={lv.id} to={`/play/${lv.id}`} className="block text-sm text-primary hover:underline">
                    第{lv.order_index}关：{lv.title_i18n?.zh ?? lv.title_i18n?.en ?? lv.module_type} ({lv.module_type})
                    {lv.category_name_zh && (
                      <span className="text-xs text-muted-foreground ml-2">
                        [{lv.programme_name_zh && `${lv.programme_name_zh} → `}{lv.subject_name_zh && `${lv.subject_name_zh} → `}{lv.category_name_zh}]
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
