// src/components/shared/LanguageSwitcher.tsx
//
// 从"点一下在中/英之间切换"改成三选一分段按钮（中文/EN/BM）——原本的
// toggle写法在只有2个语言时够用，3个语言没法再用"toggle"这个概念（点一
// 下该切到哪个？），改成一排小按钮各自选，跟游戏那边 gameLocale.ts 的
// 语言切换器是同一个视觉语言，两套系统虽然底层机制不同（这边是
// react-i18next，游戏那边是自己写的简易版），但至少交互一致，用户不用
// 学两套UI。

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const LOCALES = [
  { code: "zh", label: "中文" },
  { code: "en", label: "EN" },
  { code: "ms", label: "BM" },
] as const;

export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n } = useTranslation();
  const current = (["zh", "en", "ms"] as const).includes(i18n.language as "zh" | "en" | "ms")
    ? (i18n.language as "zh" | "en" | "ms")
    : "en";

  return (
    <div className={cn("flex items-center gap-0.5 bg-muted/50 p-0.5 rounded-lg", className)}>
      {LOCALES.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => i18n.changeLanguage(l.code)}
          className={cn(
            "px-2.5 py-1 rounded-md text-xs font-medium transition-all",
            current === l.code ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
