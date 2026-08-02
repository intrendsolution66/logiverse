// frontend/src/components/TabPills.tsx
//
// 参考截图里"总览(135) / MS-音乐(5) / OM-奥数(132)"、"奥数/科技/音乐"这种
// 胶囊状tab——选中项是青到蓝的渐变底，未选中是浅灰底。

interface TabPillsProps<T extends string> {
  tabs: Array<{ key: T; label: string; count?: number }>;
  active: T;
  onChange: (key: T) => void;
}

export function TabPills<T extends string>({ tabs, active, onChange }: TabPillsProps<T>) {
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive ? "bg-gradient-to-r from-teal-500 to-blue-600 text-white" : "bg-white border border-border text-foreground hover:bg-muted"
            }`}
          >
            {t.label}{t.count !== undefined && ` (${t.count})`}
          </button>
        );
      })}
    </div>
  );
}
