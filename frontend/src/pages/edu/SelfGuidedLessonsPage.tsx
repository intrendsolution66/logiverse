// frontend/src/pages/edu/SelfGuidedLessonsPage.tsx
//
// Self Guided Learning 第二层——某个Course下面的Lesson列表（第一课、
// 第二课……），点进去就是 LessonPlayerPage 按顺序播放这一课的步骤。

import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { selfGuidedApi } from "@/api";
import { Card, CardContent, EmptyState } from "@/components/ui/index";

interface Lesson { id: string; title_i18n: Record<string, string>; order_index: number; step_count: number }

export default function SelfGuidedLessonsPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!courseId) return;
    selfGuidedApi.listLessons(courseId).then((r) => { setLessons(r); setLoading(false); });
  }, [courseId]);

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">课程内容</h1>
        <p className="text-sm text-muted-foreground mt-0.5">按顺序完成每一课</p>
      </div>

      {!loading && lessons.length === 0 && (
        <EmptyState title="这门课还没有内容" description="等老师安排好内容后就能看到了" />
      )}

      <div className="space-y-2">
        {lessons.map((l, i) => (
          <Card key={l.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/self-guided/lessons/${l.id}`)}>
            <CardContent className="p-4 flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{l.title_i18n?.zh ?? l.title_i18n?.en ?? "未命名"}</p>
                <p className="text-xs text-muted-foreground">{l.step_count} 个步骤</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
