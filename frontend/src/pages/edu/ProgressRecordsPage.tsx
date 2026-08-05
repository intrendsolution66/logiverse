// frontend/src/pages/edu/ProgressRecordsPage.tsx
//
// operator 专用——全平台学习记录总览。学生自己(listMyProgress)、家长
// (getChildProgress)、老师(getClassProgress)都只能看自己范围内的记录，
// 这个页面不受那些限制，可以查任何学生、任何 Activity、任何时间段，
// 方便 operator 排查问题、核对数据，不用去数据库里手动查。

import { useState, useEffect, useCallback } from "react";
import { adminUsersApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Input, Card, CardContent, Badge, EmptyState } from "@/components/ui/index";

interface ProgressRecord {
  id: string; played_at: string; module_type: string; score: number; max_score: number;
  time_spent_seconds: number | string; mistakes: number; completed: boolean; attempt_number?: number;
  student_id: string; username: string; full_name_zh?: string; full_name_en?: string; role_codes: string[];
  course_level_id?: string; level_title_i18n?: Record<string, string>; exercise_number?: string;
}

const MODULE_LABELS: Record<string, { emoji: string; label: string }> = {
  counting: { emoji: "🔢", label: "点点数数" }, spot_diff: { emoji: "🔍", label: "找不同之处" },
  focus_tap: { emoji: "🎯", label: "专注力点数字" }, memory: { emoji: "🃏", label: "Memory配对" },
  pattern: { emoji: "🧩", label: "找规律" }, word_problem: { emoji: "📝", label: "应用题" },
  maze: { emoji: "🧭", label: "迷宫" }, sudoku: { emoji: "🔢", label: "数独" },
  line_match: { emoji: "🔗", label: "连线配对" }, coloring: { emoji: "🎨", label: "填色游戏" },
  ppt_lecture: { emoji: "📊", label: "PPT讲义" }, video_lecture: { emoji: "🎬", label: "视频讲义" },
};

// 角色不同颜色——一眼能分辨这条记录是真的学生玩的，还是 operator/老师
// 自己测试玩的（同一个账号可能同时挂好几个角色，比如既是operator又
// 拿来当学生账号测试用，全部列出来，不是只显示一个）。
const ROLE_LABELS: Record<string, { label: string; className: string }> = {
  STUDENT: { label: "学生", className: "bg-teal-100 text-teal-700" },
  PARENT: { label: "家长", className: "bg-blue-100 text-blue-700" },
  TEACHER: { label: "老师", className: "bg-purple-100 text-purple-700" },
  OPERATOR: { label: "Operator", className: "bg-amber-100 text-amber-700" },
  COURSE_DESIGNER: { label: "课程设计师", className: "bg-pink-100 text-pink-700" },
};

function fmtDuration(secondsRaw: number | string): string {
  // time_spent_seconds 在数据库里是 numeric 类型，pg 这个库处理 numeric
  // 字段默认会转成字符串返回（避免精度丢失），不是数字——字符串没有
  // .toFixed() 这个方法，这里先强制转成 Number 再算，不管后端给的是
  // 字符串还是数字都能处理，比原来那版 Math.round()（隐式转数字，凑巧
  // 两种类型都能跑）更明确、也更安全。
  const seconds = Number(secondsRaw) || 0;
  if (seconds < 60) return `${seconds.toFixed(1)}秒`;
  const m = Math.floor(seconds / 60), s = (seconds % 60).toFixed(1);
  return `${m}分${s}秒`;
}

const PAGE_SIZE = 30;

export default function ProgressRecordsPage() {
  const [records, setRecords] = useState<ProgressRecord[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [moduleType, setModuleType] = useState("");
  const [completedOnly, setCompletedOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    adminUsersApi.listAllProgressRecords({
      search: search || undefined, module_type: moduleType || undefined,
      completed: completedOnly || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined,
      page, limit: PAGE_SIZE,
    }).then((r) => { setRecords(r.data); setMeta(r.meta); }).finally(() => setLoading(false));
  }, [search, moduleType, completedOnly, dateFrom, dateTo, page]);

  useEffect(refresh, [refresh]);
  useEffect(() => { setPage(1); }, [search, moduleType, completedOnly, dateFrom, dateTo]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">学习记录总览</h1>
        <p className="text-sm text-muted-foreground mt-1">全平台的游玩记录——哪个学生、玩了哪个 Activity、什么时候玩的、花了多久、成绩多少，都能在这里查</p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Input placeholder="搜学生姓名/用户名、Activity标题/编号..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-[260px] shrink-0" />
            <select className="h-10 rounded-lg border border-input bg-transparent px-3 text-sm font-medium shadow-sm w-[150px] shrink-0" value={moduleType} onChange={(e) => setModuleType(e.target.value)}>
              <option value="">全部类型</option>
              {Object.entries(MODULE_LABELS).map(([key, { emoji, label }]) => <option key={key} value={key}>{emoji} {label}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground shrink-0">
              <input type="checkbox" checked={completedOnly} onChange={(e) => setCompletedOnly(e.target.checked)} />
              只看已完成
            </label>
            <div className="flex items-center gap-1.5 shrink-0">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-10 rounded-lg border border-input bg-transparent px-2 text-sm" />
              <span className="text-muted-foreground text-xs">至</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-10 rounded-lg border border-input bg-transparent px-2 text-sm" />
            </div>
            {(search || moduleType || completedOnly || dateFrom || dateTo) && (
              <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setModuleType(""); setCompletedOnly(false); setDateFrom(""); setDateTo(""); }}>清空筛选</Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">加载中...</p>
          ) : records.length === 0 ? (
            <EmptyState title="没有符合条件的记录" description="换个搜索词或筛选条件试试" />
          ) : (
            <>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground bg-muted/50 border-b border-border">
                      <th className="py-2.5 px-3 font-medium">学生</th>
                      <th className="px-3 font-medium">Activity</th>
                      <th className="px-3 font-medium">类型</th>
                      <th className="px-3 font-medium">成绩</th>
                      <th className="px-3 font-medium">用时</th>
                      <th className="px-3 font-medium">失误</th>
                      <th className="px-3 font-medium">状态</th>
                      <th className="px-3 font-medium">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="py-2.5 px-3">
                          {r.full_name_zh || r.full_name_en ? (
                            <>
                              <div className="font-medium">{r.full_name_zh ?? r.full_name_en}</div>
                              <div className="text-xs text-muted-foreground font-mono">{r.username}</div>
                            </>
                          ) : (
                            <>
                              <div className="font-medium font-mono">{r.username}</div>
                              <div className="text-xs text-muted-foreground/60">（未设置姓名）</div>
                            </>
                          )}
                          <div className="flex flex-wrap gap-1 mt-1">
                            {r.role_codes.length === 0 ? (
                              <span className="text-[10px] text-muted-foreground/50">角色未知</span>
                            ) : (
                              r.role_codes.map((code) => {
                                const role = ROLE_LABELS[code];
                                return (
                                  <span key={code} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${role?.className ?? "bg-muted text-muted-foreground"}`}>
                                    {role?.label ?? code}
                                  </span>
                                );
                              })
                            )}
                          </div>
                        </td>
                        <td className="px-3">
                          {r.level_title_i18n?.zh ?? r.level_title_i18n?.en ?? "（已删除）"}
                          {r.exercise_number && <span className="text-xs text-muted-foreground font-mono ml-1.5">{r.exercise_number}</span>}
                        </td>
                        <td className="px-3 text-muted-foreground">{MODULE_LABELS[r.module_type]?.emoji} {MODULE_LABELS[r.module_type]?.label ?? r.module_type}</td>
                        <td className="px-3 font-mono">{r.max_score > 0 ? `${r.score}/${r.max_score}` : "—"}</td>
                        <td className="px-3 text-muted-foreground">{fmtDuration(r.time_spent_seconds)}</td>
                        <td className="px-3 text-muted-foreground">{r.mistakes}</td>
                        <td className="px-3">
                          {r.completed ? <Badge variant="success">已完成</Badge> : <Badge variant="outline">未完成</Badge>}
                        </td>
                        <td className="px-3 text-muted-foreground text-xs whitespace-nowrap">{new Date(r.played_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                <span>Number of Records: {meta.total}，第 {meta.page} / {meta.totalPages} 页</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</Button>
                  <Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
