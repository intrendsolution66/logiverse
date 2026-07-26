// frontend/src/pages/edu/FamilyDashboardPage.tsx
//
// The parent's home base for the family journey (2.5 in the architecture
// doc): see all your children, their trial/subscription status, add a new
// child (which starts their 3-day trial automatically), subscribe when
// ready, and check a child's progress. Table + modal pattern, same as
// CourseDesignerPage/GradeTiersPage for consistency.

import { useState, useEffect } from "react";
import { familyApi, eduApi } from "@/api/index";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, CardHeader, CardTitle, Badge, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface Child {
  student_id: string; username: string; full_name_zh?: string; full_name_en?: string;
  subscription_id?: string; subscription_status?: string; trial_ends_at?: string;
  current_period_end?: string; locked_monthly_fee?: string; currency?: string;
  grade_tier_id?: string; grade_tier_code?: string; grade_tier_name_i18n?: Record<string,string>;
}
function statusBadge(status?: string, trialEndsAt?: string) {
  if (!status) return <Badge variant="outline">—</Badge>;
  if (status === "trial") {
    const daysLeft = trialEndsAt ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000)) : 0;
    return <Badge variant="warning">试用中 · 剩{daysLeft}天</Badge>;
  }
  if (status === "active") return <Badge variant="success">已订阅</Badge>;
  if (status === "past_due") return <Badge variant="destructive">付款异常</Badge>;
  return <Badge variant="outline">已过期</Badge>;
}

// ── Modal: add child ───────────────────────────────────────────────────────────
function AddChildModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [icNumber, setIcNumber] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [gradeTierId, setGradeTierId] = useState("");
  const [tiers, setTiers] = useState<Array<{ id: string; code: string; name_i18n: Record<string,string> }>>([]);
  const [result, setResult] = useState<{ username: string; temp_password?: string } | null>(null);

  useEffect(() => { if (open) eduApi.listGradeTiers().then(setTiers); }, [open]);

  async function handleSave() {
    if (!icNumber.trim()) { toast.error("请输入孩子的身份证/出生证号码"); return; }
    if (!gradeTierId) { toast.error("请选一个等级——订阅是按等级算的，这个等级下的课程孩子都能玩"); return; }
    try {
      const res = await familyApi.addChild({
        ic_number: icNumber.trim(),
        grade_tier_id: gradeTierId,
        full_name_zh: fullName || undefined,
        password: password.length >= 8 ? password : undefined,
      });
      setResult({ username: res.data.data.username, temp_password: res.data.data.temp_password });
      toast.success("孩子的账号建好了，3天免费试用已经开始！");
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "新增失败";
      toast.error(msg);
    }
  }

  function handleClose() {
    setIcNumber(""); setFullName(""); setPassword(""); setGradeTierId(""); setResult(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="添加孩子" size="sm">
      {result ? (
        <div className="space-y-3 text-center">
          <div className="text-4xl">🎉</div>
          <p className="text-sm">账号建好了，3天免费试用已经开始</p>
          <div className="bg-muted rounded-lg p-3 text-sm space-y-1">
            <p>登入账号：<span className="font-mono font-semibold">{result.username}</span></p>
            {result.temp_password && <p>登入密码：<span className="font-mono font-semibold">{result.temp_password}</span>（请记下，只显示这一次）</p>}
          </div>
          <Button className="w-full" onClick={handleClose}>完成</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div><Label>孩子姓名（选填）</Label><Input placeholder="孩子的名字" value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
          <div><Label>身份证 / 出生证号码</Label><Input placeholder="例如 180315-10-2244" value={icNumber} onChange={(e) => setIcNumber(e.target.value)} /></div>
          <div>
            <Label>等级</Label>
            <select className="w-full border rounded-md p-2 text-base sm:text-sm" value={gradeTierId} onChange={(e) => setGradeTierId(e.target.value)}>
              <option value="">选等级...</option>
              {tiers.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name_i18n?.zh ?? t.name_i18n?.en}</option>)}
            </select>
            <p className="text-xs text-muted-foreground mt-1">订阅是按等级算的，这个等级下所有课程孩子都能玩</p>
          </div>
          <div><Label>登入密码（选填，不填会自动生成）</Label><Input type="password" placeholder="至少8个字符" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <Button className="w-full" onClick={handleSave}>开始 3 天免费试用</Button>
        </div>
      )}
    </Modal>
  );
}

// ── Modal: child progress ───────────────────────────────────────────────────────
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}小时${m}分钟`;
  return `${m}分钟`;
}

function ProgressModal({ open, onClose, child }: { open: boolean; onClose: () => void; child: Child | null }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof familyApi.getChildProgress>>>([]);
  const [topicBreakdown, setTopicBreakdown] = useState<Awaited<ReturnType<typeof familyApi.getChildTopicBreakdown>>>([]);
  const [loading, setLoading] = useState(false);
  const [studyTime, setStudyTime] = useState<{ daily: Array<{ study_date: string; total_seconds: number; session_count: number }> } | null>(null);

  useEffect(() => {
    if (!open || !child) return;
    setLoading(true);
    familyApi.getChildProgress(child.student_id).then(setRows).finally(() => setLoading(false));
    familyApi.getChildTopicBreakdown(child.student_id).then(setTopicBreakdown);
    familyApi.getChildStudyTime(child.student_id).then(setStudyTime);
  }, [open, child]);

  const totalSeconds14d = studyTime?.daily.reduce((sum, d) => sum + d.total_seconds, 0) ?? 0;

  // 分数趋势图：拿现有的「最近记录」清单直接画，不用另外开一支API——这份
  // 清单本来就是照时间排序的，只是原本是新到旧（给列表用），画图要反过来
  // 变旧到新，而且只有算得出百分比的才画得出点（max_score要有值且大于0）。
  const trendData = [...rows]
    .filter((r) => r.max_score != null && r.max_score > 0 && r.score != null)
    .reverse()
    .map((r) => ({
      date: new Date(r.played_at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }),
      分数: Math.round((r.score! / r.max_score!) * 100),
      name: r.level_title_i18n?.zh ?? r.level_title_i18n?.en ?? r.module_type,
    }));

  return (
    <Modal open={open} onClose={onClose} title={`${child?.full_name_zh ?? child?.username ?? ""} 的学习记录`} size="md">
      {studyTime && studyTime.daily.length > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-muted/40 space-y-2">
          <p className="text-sm font-medium">📊 最近14天学习时长：{formatDuration(totalSeconds14d)}</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {studyTime.daily.map((d) => (
              <div key={d.study_date} className="flex justify-between text-xs text-muted-foreground">
                <span>{new Date(d.study_date).toLocaleDateString()}</span>
                <span>{formatDuration(d.total_seconds)}（{d.session_count}次登入）</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {trendData.length >= 2 && (
        <div className="mb-4 p-3 rounded-lg bg-muted/40">
          <p className="text-sm font-medium mb-2">📈 分数趋势（每次玩完的成绩，百分比）</p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={trendData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(value, _key, item) => [`${value}%`, (item?.payload as { name?: string } | undefined)?.name ?? ""]}
              />
              <Line type="monotone" dataKey="分数" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {topicBreakdown.length > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-muted/40 space-y-2">
          <p className="text-sm font-medium">📚 按主题汇总（弱项排前面）</p>
          <div className="space-y-1.5">
            {topicBreakdown.map((t) => (
              <div key={t.topic_id ?? "unclassified"} className="flex items-center justify-between text-xs">
                <span className="flex-1">{t.topic_name_zh ?? "（未分类）"}</span>
                <span className="text-muted-foreground mr-2">{t.levels_played} 关 · {t.total_attempts} 次</span>
                <span className={`font-medium ${t.avg_score_pct != null && +t.avg_score_pct < 60 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {t.avg_score_pct != null ? `${t.avg_score_pct}%` : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-center text-sm text-muted-foreground py-6">加载中...</p>
      ) : rows.length === 0 ? (
        <EmptyState title="还没有练习记录" description="孩子开始玩 Activity 后，记录会出现在这里" />
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-sm border-b border-border pb-2 last:border-0">
              <div>
                <p className="font-medium">{r.level_title_i18n?.zh ?? r.level_title_i18n?.en ?? r.module_type}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(r.played_at).toLocaleString()}
                  {r.topic_name_zh && <span className="ml-1.5">· {r.topic_name_zh}</span>}
                </p>
              </div>
              <div className="text-right">
                <p className={r.completed ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-muted-foreground"}>
                  {r.score ?? "—"} / {r.max_score ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">{r.time_spent_seconds?.toFixed(0) ?? "—"}秒</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ── Modal: reset child password ─────────────────────────────────────────────────
function ResetPasswordModal({ open, onClose, child }: { open: boolean; onClose: () => void; child: Child | null }) {
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<{ temp_password?: string } | null>(null);

  async function handleReset() {
    if (!child) return;
    try {
      const res = await familyApi.resetChildPassword(child.student_id, password.length >= 8 ? password : undefined);
      setResult(res.data.data);
      toast.success("密码重设成功");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "重设失败";
      toast.error(msg);
    }
  }

  function handleClose() {
    setPassword(""); setResult(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title={`重设 ${child?.full_name_zh ?? child?.username ?? ""} 的密码`} size="sm">
      {result ? (
        <div className="space-y-3 text-center">
          <div className="text-4xl">🔑</div>
          <p className="text-sm">密码重设成功，孩子其他装置上的登入状态已经全部登出</p>
          {result.temp_password && (
            <div className="bg-muted rounded-lg p-3 text-sm">
              新密码：<span className="font-mono font-semibold">{result.temp_password}</span>（请记下，只显示这一次）
            </div>
          )}
          <Button className="w-full" onClick={handleClose}>完成</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">重设后，孩子原本登入的装置会被自动登出，需要用新密码重新登入。</p>
          <div>
            <Label>新密码（选填，不填会自动生成）</Label>
            <Input type="password" placeholder="至少8个字符" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button className="w-full" onClick={handleReset}>重设密码</Button>
        </div>
      )}
    </Modal>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function FamilyDashboardPage() {
  const [children, setChildren] = useState<Child[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [progressChild, setProgressChild] = useState<Child | null>(null);
  const [resetPasswordChild, setResetPasswordChild] = useState<Child | null>(null);

  function refresh() { familyApi.listMyChildren().then(setChildren); }
  useEffect(refresh, []);

  async function handleSubscribe(studentId: string) {
    try {
      await familyApi.subscribeChild(studentId);
      toast.success("订阅成功！");
      refresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "订阅失败";
      toast.error(msg);
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">我的孩子</h1>
        <p className="text-sm text-muted-foreground mt-0.5">管理孩子的账号、试用和订阅状态</p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>孩子列表</CardTitle>
          <Button size="sm" onClick={() => setShowAddModal(true)}>+ 添加孩子</Button>
        </CardHeader>
        <CardContent>
          {children.length === 0 ? (
            <EmptyState title="还没有添加孩子" description="点右上角添加一个，马上开始3天免费试用" />
          ) : (
            <div className="space-y-3">
              {children.map((c) => (
                <div key={c.student_id} className="border border-border rounded-lg p-4 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="font-medium">{c.full_name_zh ?? c.full_name_en ?? c.username}</p>
                    <p className="text-xs text-muted-foreground font-mono">{c.username}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.grade_tier_code && <Badge variant="outline">{c.grade_tier_code}</Badge>}
                    {statusBadge(c.subscription_status, c.trial_ends_at)}
                    {c.subscription_status !== "active" && (
                      <Button size="sm" onClick={() => handleSubscribe(c.student_id)}>
                        订阅 {c.currency} {c.locked_monthly_fee}/月
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setProgressChild(c)}>学习记录</Button>
                    <Button size="sm" variant="outline" onClick={() => setResetPasswordChild(c)}>重设密码</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AddChildModal open={showAddModal} onClose={() => setShowAddModal(false)} onSaved={refresh} />
      <ProgressModal open={!!progressChild} onClose={() => setProgressChild(null)} child={progressChild} />
      <ResetPasswordModal open={!!resetPasswordChild} onClose={() => setResetPasswordChild(null)} child={resetPasswordChild} />
    </div>
  );
}
