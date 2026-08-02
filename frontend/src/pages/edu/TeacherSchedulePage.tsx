// frontend/src/pages/edu/TeacherSchedulePage.tsx
//
// 日历排课 — referenced ScheduleView.tsx's weekly hour-grid pattern (click a
// slot to create an event, color-coded, click-to-edit) but adapted the
// SHAPE to what exercise-scheduling actually needs: a 习题 is scheduled for
// a DAY, not a specific hour, so this is a MONTHLY day-grid instead of an
// hourly week-grid. Same interaction spirit (click a day → schedule
// something), different unit of time.
//
// Also houses 学生小组 (student group) management — a group has to exist
// before you can pick it as a schedule target, so creating/managing groups
// lives on the same page rather than a separate one you'd have to jump to
// first.

import { useState, useEffect, useCallback } from "react";
import { scheduleApi, studentGroupsApi, teacherApi, eduApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, CardHeader, CardTitle, Badge, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

const TARGET_COLORS: Record<string, string> = {
  student: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-400",
  class:   "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400",
  group:   "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-400",
};
const TARGET_LABELS: Record<string, string> = { student: "个人", class: "班级", group: "小组" };

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }

function buildMonthGrid(monthDate: Date): Date[] {
  const first = startOfMonth(monthDate);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

interface Assignment {
  id: string; scheduled_date: string; target_type: "student" | "class" | "group";
  class_id?: string; student_id?: string; group_id?: string;
  course_level_id: string; level_title_i18n?: Record<string,string>; module_type: string; target_name: string;
}

function AddAssignmentModal({ open, onClose, date, onSaved }: {
  open: boolean; onClose: () => void; date: Date | null; onSaved: () => void;
}) {
  const [targetType, setTargetType] = useState<"student" | "class" | "group">("class");
  const [classes, setClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [classId, setClassId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [roster, setRoster] = useState<Array<{ student_id: string; username: string; full_name_zh?: string }>>([]);
  const [studentId, setStudentId] = useState("");
  const [courses, setCourses] = useState<Array<{ id: string; title_i18n: Record<string,string> }>>([]);
  const [levels, setLevels] = useState<Array<{ id: string; title_i18n?: Record<string,string>; module_type: string; order_index: number }>>([]);
  const [courseId, setCourseId] = useState("");
  const [levelId, setLevelId] = useState("");

  useEffect(() => {
    if (!open) return;
    teacherApi.listMyClasses().then(setClasses);
    studentGroupsApi.listMyGroups().then(setGroups);
    eduApi.listCourses({ limit: 100 }).then((r) => setCourses(r.data));
  }, [open]);
  useEffect(() => { if (courseId) eduApi.listLevels(courseId).then(setLevels); else setLevels([]); setLevelId(""); }, [courseId]);
  useEffect(() => {
    if (targetType !== "student") return;
    setRoster([]); setStudentId("");
    if (classId) teacherApi.listClassStudents(classId).then(setRoster);
    else if (groupId) studentGroupsApi.listGroupMembers(groupId).then(setRoster);
  }, [targetType, classId, groupId]);

  function reset() {
    setTargetType("class"); setClassId(""); setGroupId(""); setStudentId("");
    setCourseId(""); setLevelId(""); setRoster([]);
  }

  async function handleSave() {
    if (!date) return;
    if (!levelId) { toast.error("请选一个 Activity"); return; }
    const targetId = targetType === "class" ? classId : targetType === "group" ? groupId : studentId;
    if (!targetId) { toast.error("请选排课对象"); return; }
    try {
      await scheduleApi.createAssignment({ target_type: targetType, target_id: targetId, course_level_id: levelId, scheduled_date: isoDate(date) });
      toast.success("排课成功");
      reset(); onSaved(); onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "排课失败";
      toast.error(msg);
    }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title={date ? `为 ${date.toLocaleDateString()} 排课` : "排课"} size="sm">
      <div className="space-y-3">
        <div>
          <Label>排课对象</Label>
          <div className="flex gap-1.5">
            {(["class", "group", "student"] as const).map((t) => (
              <button
                key={t} type="button" onClick={() => { setTargetType(t); setClassId(""); setGroupId(""); setStudentId(""); }}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${targetType === t ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}
              >
                {TARGET_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {targetType === "class" && (
          <select className="w-full border rounded-md p-2 text-sm" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">选班级...</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {targetType === "group" && (
          <select className="w-full border rounded-md p-2 text-sm" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">选小组...</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
        {targetType === "student" && (
          <>
            <p className="text-xs text-muted-foreground">先选这个学生所在的班级或小组，再选具体的人。</p>
            <div className="flex gap-2">
              <select className="flex-1 border rounded-md p-2 text-sm" value={classId} onChange={(e) => { setClassId(e.target.value); setGroupId(""); }}>
                <option value="">从班级选...</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className="flex-1 border rounded-md p-2 text-sm" value={groupId} onChange={(e) => { setGroupId(e.target.value); setClassId(""); }}>
                <option value="">从小组选...</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <select className="w-full border rounded-md p-2 text-sm" value={studentId} onChange={(e) => setStudentId(e.target.value)} disabled={roster.length === 0}>
              <option value="">选学生...</option>
              {roster.map((s) => <option key={s.student_id} value={s.student_id}>{s.full_name_zh ?? s.username}</option>)}
            </select>
          </>
        )}

        <div>
          <Label>课程</Label>
          <select className="w-full border rounded-md p-2 text-sm" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">选课程...</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title_i18n?.zh ?? c.title_i18n?.en}</option>)}
          </select>
        </div>
        <div>
          <Label>Activity</Label>
          <select className="w-full border rounded-md p-2 text-sm" value={levelId} onChange={(e) => setLevelId(e.target.value)} disabled={!courseId}>
            <option value="">选 Activity...</option>
            {levels.map((lv) => <option key={lv.id} value={lv.id}>第{lv.order_index}题：{lv.title_i18n?.zh ?? lv.title_i18n?.en ?? lv.module_type}</option>)}
          </select>
        </div>

        <Button className="w-full" onClick={handleSave}>排课</Button>
      </div>
    </Modal>
  );
}

function GroupsCard() {
  const [groups, setGroups] = useState<Array<{ id: string; name: string; member_count: number }>>([]);
  const [newName, setNewName] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [members, setMembers] = useState<Array<{ student_id: string; username: string; full_name_zh?: string }>>([]);
  const [icInput, setIcInput] = useState("");

  function refresh() { studentGroupsApi.listMyGroups().then(setGroups); }
  useEffect(refresh, []);

  async function handleCreate() {
    if (!newName.trim()) { toast.error("请输入小组名称"); return; }
    try {
      await studentGroupsApi.createGroup(newName.trim());
      setNewName(""); refresh();
      toast.success("小组建好了");
    } catch { toast.error("建立失败"); }
  }

  function selectGroup(id: string) {
    setSelectedGroupId(id);
    studentGroupsApi.listGroupMembers(id).then(setMembers);
  }

  async function handleAddMember() {
    if (!selectedGroupId) return;
    if (!icInput.trim()) { toast.error("请输入身份证号码"); return; }
    try {
      await studentGroupsApi.addGroupMember(selectedGroupId, icInput.trim());
      setIcInput(""); selectGroup(selectedGroupId); refresh();
      toast.success("加入成功");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "加入失败";
      toast.error(msg);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>学生小组</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input placeholder="新小组名称，如：进度超前小组" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button size="sm" onClick={handleCreate}>+ 建小组</Button>
        </div>
        {groups.length === 0 ? (
          <EmptyState title="还没有小组" description="建一个，之后排课可以直接指定给这个小组" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <button key={g.id} onClick={() => selectGroup(g.id)}>
                <Badge variant={selectedGroupId === g.id ? "default" : "outline"}>{g.name} · {g.member_count}人</Badge>
              </button>
            ))}
          </div>
        )}
        {selectedGroupId && (
          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => <Badge key={m.student_id} variant="outline">{m.full_name_zh ?? m.username}</Badge>)}
              {members.length === 0 && <span className="text-xs text-muted-foreground">还没有成员</span>}
            </div>
            <div className="flex gap-2">
              <Input placeholder="加学生：身份证号码" value={icInput} onChange={(e) => setIcInput(e.target.value)} className="max-w-[200px]" />
              <Button size="sm" variant="outline" onClick={handleAddMember}>加入</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function TeacherSchedulePage() {
  const [monthDate, setMonthDate] = useState(new Date());
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const days = buildMonthGrid(monthDate);
  const todayStr = isoDate(new Date());

  const refresh = useCallback(() => {
    const from = isoDate(days[0]), to = isoDate(days[days.length - 1]);
    scheduleApi.listMine(from, to).then(setAssignments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthDate]);
  useEffect(refresh, [refresh]);

  function assignmentsFor(d: Date) { return assignments.filter((a) => a.scheduled_date.slice(0, 10) === isoDate(d)); }

  function prevMonth() { setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1)); }
  function nextMonth() { setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1)); }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">日历排课</h1>
        <p className="text-sm text-muted-foreground mt-0.5">点日期给个人、班级、或小组安排 Activity</p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={prevMonth}>←</Button>
            <CardTitle>{monthDate.getFullYear()}年{monthDate.getMonth() + 1}月</CardTitle>
            <Button size="sm" variant="outline" onClick={nextMonth}>→</Button>
          </div>
          <Button size="sm" variant="outline" onClick={() => setMonthDate(new Date())}>回到今天</Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground mb-1">
            {["日","一","二","三","四","五","六"].map((d) => <div key={d} className="py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((d, i) => {
              const inMonth = d.getMonth() === monthDate.getMonth();
              const dayAssignments = assignmentsFor(d);
              const isToday = isoDate(d) === todayStr;
              return (
                <button
                  key={i} onClick={() => { setSelectedDate(d); setShowAddModal(true); }}
                  className={`min-h-[70px] rounded-lg border p-1.5 text-left align-top transition-colors hover:border-primary ${
                    inMonth ? "bg-card border-border" : "bg-muted/30 border-transparent text-muted-foreground"
                  }`}
                >
                  <div className={`text-xs mb-1 ${isToday ? "inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground" : ""}`}>
                    {d.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dayAssignments.slice(0, 3).map((a) => (
                      <div key={a.id} className={`text-[10px] px-1 py-0.5 rounded truncate ${TARGET_COLORS[a.target_type]}`}>
                        {a.target_name}
                      </div>
                    ))}
                    {dayAssignments.length > 3 && <div className="text-[10px] text-muted-foreground">+{dayAssignments.length - 3}</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <GroupsCard />

      <AddAssignmentModal open={showAddModal} onClose={() => setShowAddModal(false)} date={selectedDate} onSaved={refresh} />
    </div>
  );
}
