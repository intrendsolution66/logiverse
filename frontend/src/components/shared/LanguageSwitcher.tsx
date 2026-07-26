// src/components/shared/LanguageSwitcher.tsx
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n } = useTranslation();
  const lang    = i18n.language ?? "en";
  const current = lang.startsWith("zh") ? "zh" : "en";

  const toggle = () => {
    i18n.changeLanguage(current === "en" ? "zh" : "en");
  };

  return (
    <button
      onClick={toggle}
      title={current === "en" ? "切换中文" : "Switch to English"}
      className={cn(
        "flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-colors hover:bg-accent",
        className
      )}
    >
      <span className="text-sm">{current === "en" ? "🇲🇾" : "🇬🇧"}</span>
      <span>{current === "en" ? "中文" : "EN"}</span>
    </button>
  );
}
