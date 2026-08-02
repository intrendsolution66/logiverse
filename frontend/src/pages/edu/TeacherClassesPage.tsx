// frontend/src/pages/edu/TeacherClassesPage.tsx
//
// The teacher journey: classes → roster → assignments → progress grid.
// Same table+modal pattern as CourseDesignerPage. Clicking a class drills
// down to show its roster/assignments/progress, same "click a row to see
// its children" pattern as course→levels.

import { useState, useEffect } from "react";
import { teacherApi, eduApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, CardHeader, CardTitle, Badge, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

interface ClassRow { id: string; name: string; student_count: number; created_at: string }
interface StudentRow { student_id: string; username: string; full_name_zh?: string; full_name_en?: string }
interface AssignmentRow { id: string; course_level_id: string; scheduled_date?: string; level_title_i18n?: Record<string,string>; module_type: string }
interface ProgressRow {
  student_id: string; username: string; full_name_zh?: string; full_name_en?: string;
  assignment_id: string; level_title_i18n?: Record<string,string>;
  best_score?: number; max_score?: number; completed?: boolean; attempts: number;
}

// ── Modal: new class ───────────────────────────────────────────────────────────
function AddClassModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  async function handleSave() {
    if (!name.trim()) { toast.error("请输入班级名称"); return; }
    try {
      await teacherApi.createClass({ name });
      toast.success("班级建好了");
      setName(""); onSaved(); onClose();
    } catch { toast.error("建立失败（可能没有权限）"); }
  }
  return (
    <Modal open={open} onClose={onClose} title="新建班级" size="sm">
      <div className="space-y-3">
        <div><Label>班级名称</Label><Input placeholder="如：三年级A班" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <Button className="w-full" onClick={handleSave}>建立</Button>
      </div>
    </Modal>
  );
}

// ── Modal: add student to roster ────────────────────────────────────────────────
function AddStudentModal({ open, onClose, classId, onSaved }: { open: boolean; onClose: () => void; classId: string | null; onSaved: () => void }) {
  const [icNumber, setIcNumber] = useState("");
  async function handleSave() {
    if (!classId) return;
    if (!icNumber.trim()) { toast.error("请输入学生的身份证/出生证号码"); return; }
    try {
      await teacherApi.addStudentToClass(classId, icNumber.trim());
      toast.success("学生加进班级了");
      setIcNumber(""); onSaved(); onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "新增失败";
      toast.error(msg);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="加学生到班级" size="sm">
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">这里只能加已经有账号的学生（业者或家长建过账号的），不会新建账号。</p>
        <div><Label>学生身份证 / 出生证号码</Label><Input placeholder="例如 180315-10-2244" value={icNumber} onChange={(e) => setIcNumber(e.target.value)} /></div>
        <Button className="w-full" onClick={handleSave}>加入班级</Button>
      </div>
    </Modal>
  );
}

// ── Modal: create assignment (course → level picker) ────────────────────────────
function AddAssignmentModal({ open, onClose, classId, onSaved }: { open: boolean; onClose: () => void; classId: string | null; onSaved: () => void }) {
  const [courses, setCourses] = useState<Array<{ id: string; title_i18n: Record<string,string> }>>([]);
  const [levels, setLevels] = useState<Array<{ id: string; title_i18n?: Record<string,string>; module_type: string; order_index: number }>>([]);
  const [courseId, setCourseId] = useState("");
  const [levelId, setLevelId] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");

  useEffect(() => { if (open) eduApi.listCourses({ limit: 100 }).then((r) => setCourses(r.data)); }, [open]);
  useEffect(() => { if (courseId) eduApi.listLevels(courseId).then(setLevels); else setLevels([]); }, [courseId]);

  async function handleSave() {
    if (!classId) return;
    if (!levelId) { toast.error("请选一个 Activity"); return; }
    try {
      await teacherApi.createAssignment(classId, { course_level_id: levelId, scheduled_date: scheduledDate || undefined });
      toast.success("作业分配好了");
      setCourseId(""); setLevelId(""); setScheduledDate("");
      onSaved(); onClose();
    } catch { toast.error("分配失败（可能没有权限）"); }
  }

  return (
    <Modal open={open} onClose={onClose} title="分配作业" size="sm">
      <div className="space-y-3">
        <div>
          <Label>课程</Label>
          <select className="w-full border rounded-md p-2 text-sm" value={courseId} onChange={(e) => { setCourseId(e.target.value); setLevelId(""); }}>
            <option value="">选课程...</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title_i18n?.zh ?? c.title_i18n?.en}</option>)}
          </select>
        </div>
        <div>
          <Label>Activity</Label>
          <select className="w-full border rounded-md p-2 text-sm" value={levelId} onChange={(e) => setLevelId(e.target.value)} disabled={!courseId}>
            <option value="">选 Activity...</option>
            {levels.map((lv) => <option key={lv.id} value={lv.id}>第{lv.order_index}关：{lv.title_i18n?.zh ?? lv.title_i18n?.en ?? lv.module_type}</option>)}
          </select>
        </div>
        <div><Label>预计完成日期（选填）</Label><input type="date" className="w-full border rounded-md p-2 text-sm" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} /></div>
        <Button className="w-full" onClick={handleSave}>分配</Button>
      </div>
    </Modal>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function TeacherClassesPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [studyTime, setStudyTime] = useState<Array<{ student_id: string; total_seconds_last_14_days: number }>>([]);

  const [showClassModal, setShowClassModal] = useState(false);
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);

  function refreshClasses() { teacherApi.listMyClasses().then(setClasses); }
  useEffect(refreshClasses, []);

  function refreshDetail(classId: string) {
    teacherApi.listClassStudents(classId).then(setStudents);
    teacherApi.listClassAssignments(classId).then(setAssignments);
    teacherApi.getClassProgress(classId).then(setProgress);
    teacherApi.getClassStudyTime(classId).then(setStudyTime);
  }

  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
    if (h > 0) return `${h}小时${m}分钟`;
    return `${m}分钟`;
  }

  function selectClass(id: string) {
    setSelectedClassId(id);
    refreshDetail(id);
  }

  const selectedClass = classes.find((c) => c.id === selectedClassId);

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">我的班级</h1>
        <p className="text-sm text-muted-foreground mt-0.5">管理班级名单、分配作业、查看全班进度</p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>班级列表</CardTitle>
          <Button size="sm" onClick={() => setShowClassModal(true)}>+ 新建班级</Button>
        </CardHeader>
        <CardContent>
          {classes.length === 0 ? (
            <EmptyState title="还没有班级" description="点右上角新建一个" />
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground border-b">
                <th className="py-2">班级名称</th><th>学生人数</th><th></th>
              </tr></thead>
              <tbody>
                {classes.map((c) => (
                  <tr key={c.id} className={`border-b last:border-0 cursor-pointer ${selectedClassId === c.id ? "bg-muted" : ""}`} onClick={() => selectClass(c.id)}>
                    <td className="py-2">{c.name}</td>
                    <td>{c.student_count} 人</td>
                    <td className="text-right text-primary text-xs">管理 →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {selectedClassId && (
        <>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>{selectedClass?.name} — 学生名单</CardTitle>
              <Button size="sm" onClick={() => setShowStudentModal(true)}>+ 加学生</Button>
            </CardHeader>
            <CardContent>
              {students.length === 0 ? (
                <EmptyState title="还没有学生" description="点右上角加一个" />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {students.map((s) => {
                    const st = studyTime.find((t) => t.student_id === s.student_id);
                    return (
                      <Badge key={s.student_id} variant="outline">
                        {s.full_name_zh ?? s.username}
                        {st && st.total_seconds_last_14_days > 0 && (
                          <span className="text-muted-foreground ml-1.5">· 14天学{formatDuration(st.total_seconds_last_14_days)}</span>
                        )}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>作业</CardTitle>
              <Button size="sm" onClick={() => setShowAssignmentModal(true)}>+ 分配作业</Button>
            </CardHeader>
            <CardContent>
              {assignments.length === 0 ? (
                <EmptyState title="还没有分配作业" description="点右上角分配一个" />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {assignments.map((a) => (
                    <Badge key={a.id} variant="outline">{a.level_title_i18n?.zh ?? a.module_type}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {assignments.length > 0 && students.length > 0 && (
            <Card>
              <CardHeader><CardTitle>全班进度</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b">
                        <th className="py-2 pr-3">学生</th>
                        {assignments.map((a) => (
                          <th key={a.id} className="px-3 whitespace-nowrap">{a.level_title_i18n?.zh ?? a.module_type}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((s) => (
                        <tr key={s.student_id} className="border-b last:border-0">
                          <td className="py-2 pr-3 font-medium whitespace-nowrap">{s.full_name_zh ?? s.username}</td>
                          {assignments.map((a) => {
                            const cell = progress.find((p) => p.student_id === s.student_id && p.assignment_id === a.id);
                            return (
                              <td key={a.id} className="px-3">
                                {!cell || cell.attempts === 0 ? (
                                  <span className="text-muted-foreground text-xs">未做</span>
                                ) : (
                                  <span className={cell.completed ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                                    {cell.best_score}/{cell.max_score}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <AddClassModal open={showClassModal} onClose={() => setShowClassModal(false)} onSaved={refreshClasses} />
      <AddStudentModal open={showStudentModal} onClose={() => setShowStudentModal(false)} classId={selectedClassId} onSaved={() => selectedClassId && refreshDetail(selectedClassId)} />
      <AddAssignmentModal open={showAssignmentModal} onClose={() => setShowAssignmentModal(false)} classId={selectedClassId} onSaved={() => selectedClassId && refreshDetail(selectedClassId)} />
    </div>
  );
}
