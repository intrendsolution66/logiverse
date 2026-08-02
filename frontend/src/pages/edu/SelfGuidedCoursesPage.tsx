// frontend/src/pages/edu/SelfGuidedCoursesPage.tsx
//
// Self Guided Learning 第一层——选一门课程（Course），进去之后看这门课
// 有哪些 Lesson。

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { selfGuidedApi } from "@/api";
import { Card, CardContent, EmptyState } from "@/components/ui/index";

interface Course { id: string; title_i18n: Record<string, string>; description_i18n?: Record<string, string>; lesson_count: number }

export default function SelfGuidedCoursesPage() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    selfGuidedApi.listCourses().then((r) => { setCourses(r); setLoading(false); });
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">📚 Self Guided Learning</h1>
        <p className="text-sm text-muted-foreground mt-0.5">选一门课程，按顺序学下去</p>
      </div>

      {!loading && courses.length === 0 && (
        <EmptyState title="暂时没有适合你的课程" description="等老师安排好课程内容后就能看到了" />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {courses.map((c) => (
          <Card key={c.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/self-guided/courses/${c.id}`)}>
            <CardContent className="p-4 space-y-2">
              <h3 className="font-semibold">{c.title_i18n?.zh ?? c.title_i18n?.en ?? "未命名课程"}</h3>
              {c.description_i18n?.zh && <p className="text-sm text-muted-foreground line-clamp-2">{c.description_i18n.zh}</p>}
              <p className="text-xs text-muted-foreground">共 {c.lesson_count} 课</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
