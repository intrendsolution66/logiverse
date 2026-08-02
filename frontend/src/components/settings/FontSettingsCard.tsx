import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/index";
import {
  ZH_FONT_OPTIONS, EN_FONT_OPTIONS, setFontPreference, getCurrentFontPreference,
  type FontOption,
} from "@/lib/fontPreferences";

function FontPicker({ title, options, kind }: { title: string; options: FontOption[]; kind: "zh" | "en" }) {
  const [selectedId, setSelectedId] = useState(() => getCurrentFontPreference(kind, options));
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <div className="grid sm:grid-cols-3 gap-2">
        {options.map((opt) => {
          const active = selectedId === opt.id;
          return (
            <button
              key={opt.id} type="button"
              onClick={() => { setSelectedId(opt.id); setFontPreference(kind, opt.value); }}
              className={`text-left rounded-lg border p-3 transition-colors ${
                active ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/40"
              }`}
            >
              <p className="text-2xl leading-tight mb-1 truncate" style={{ fontFamily: opt.value }}>
                {kind === "zh" ? "字体预览 Aa" : "Aa Preview 123"}
              </p>
              <p className={`text-xs ${active ? "text-primary font-medium" : "text-muted-foreground"}`}>{opt.label}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function FontSettingsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>字体</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          选好立即生效，只影响你自己这台设备上看到的字体，不影响其他人。
        </p>
        <FontPicker title="中文字体" options={ZH_FONT_OPTIONS} kind="zh" />
        <FontPicker title="英文字体" options={EN_FONT_OPTIONS} kind="en" />
      </CardContent>
    </Card>
  );
}
