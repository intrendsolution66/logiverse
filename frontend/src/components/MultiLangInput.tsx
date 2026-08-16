// frontend/src/components/MultiLangInput.tsx
//
// 三语言(中/英/马来文)输入的共用组件——不再是三列并排的短输入框，改成
// 标签页切换：一次只显示当前选中语言的那一个全宽输入框，大幅减少
// 表单的垂直高度、减少滚动。已经填了内容的语言标签上会有个小圆点，
// 方便一眼看出哪些语言还没填。

import { useState } from "react";

const LANGS = [
  { code: "zh" as const, label: "中文" },
  { code: "en" as const, label: "English" },
  { code: "ms" as const, label: "Bahasa Melayu" },
];

export interface MultiLangValues { zh: string; en: string; ms: string }

export default function MultiLangInput({ label, values, onChange, multiline = false, required = "zh" }: {
  label: string;
  values: MultiLangValues;
  onChange: (lang: "zh" | "en" | "ms", value: string) => void;
  multiline?: boolean;
  required?: "zh" | null; // 哪个语言必填，用来在标签上标星号；传null表示都选填
}) {
  const [active, setActive] = useState<"zh" | "en" | "ms">("zh");

  return (
    <div>
      <span className="text-xs text-muted-foreground block mb-1.5">{label}</span>
      <div className="flex gap-1 mb-1.5">
        {LANGS.map((l) => {
          const filled = values[l.code]?.trim();
          const isActive = active === l.code;
          return (
            <button
              key={l.code} type="button" onClick={() => setActive(l.code)}
              className={`px-3 py-1.5 rounded-t-lg text-xs font-medium flex items-center gap-1.5 border-b-2 transition-colors ${
                isActive ? "border-primary text-primary bg-primary/5" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {l.label}{required === l.code && <span className="text-red-500">*</span>}
              {filled && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
            </button>
          );
        })}
      </div>
      {multiline ? (
        <textarea
          value={values[active]} onChange={(e) => onChange(active, e.target.value)}
          rows={3} placeholder={`用${LANGS.find((l) => l.code === active)?.label}填写`}
          className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      ) : (
        <input
          value={values[active]} onChange={(e) => onChange(active, e.target.value)}
          placeholder={`用${LANGS.find((l) => l.code === active)?.label}填写`}
          className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      )}
    </div>
  );
}
