// frontend/src/components/StatCard.tsx
//
// 参考截图里"学生 132 / 员工 2 / 班级 10"那种彩色统计卡片。

type StatColor = "green" | "blue" | "amber" | "teal";

const COLOR_MAP: Record<StatColor, string> = {
  green: "bg-emerald-50 border-emerald-100 text-emerald-900",
  blue:  "bg-blue-50 border-blue-100 text-blue-900",
  amber: "bg-amber-50 border-amber-100 text-amber-900",
  teal:  "bg-teal-50 border-teal-100 text-teal-900",
};

export function StatCard({ label, value, sublabel, color = "blue" }: {
  label: string; value: string | number; sublabel?: string; color?: StatColor;
}) {
  return (
    <div className={`rounded-xl border p-5 ${COLOR_MAP[color]}`}>
      <p className="text-sm font-medium opacity-80">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      {sublabel && <p className="text-xs opacity-60 mt-1">{sublabel}</p>}
    </div>
  );
}
