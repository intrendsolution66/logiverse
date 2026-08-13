// frontend/src/games/MultipleChoiceGame.tsx
//
// 选择题 — authored content，一个Activity一题(跟点点数数自定义场景/
// 应用题自定义场景同一个定位)。背景图/装饰物件/文字图层用 SceneEditor
// 组合(跟点点数数custom_scene模式同一套编辑工具，见 SceneEditor.tsx)，
// 提供题目的视觉背景；选项本身是纯文字列表(不是图片)，设计师逐条打
// 选项文字、勾选哪个/哪几个是正确答案。
//
// 单选/多选是整个Activity统一设置的(answer_mode: "single"|"multi")，
// 不是每题各自设置——因为一个Activity本来就只有一题，"每题各自设置"
// 在这个架构下跟"整个Activity统一"是同一件事，只是命名上贴近"这个
// Activity是单选题还是多选题"这个更直观的说法。
//
// 判定：client端直接比较学生选的跟正确答案集合是否完全一致(多选模式
// 下，选中的和该选中的必须一个不多一个不少才算对)，没有隐藏答案这
// 回事，安全等级跟贴纸游戏/连线配对这类"休闲游戏"一致。
//
// i18n: zh/en/ms 已支持 — 见 frontend/src/lib/gameLocale.ts

import { useState, useEffect, useRef, useCallback } from "react";
import { GAME_CANVAS_W, GAME_CANVAS_H } from "@/lib/gameCanvas";
import { type Locale, type Dict, t } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  submit:         { zh: "✅ 提交", en: "✅ Submit", ms: "✅ Hantar" },
  correct:        { zh: "🎉 答对了！", en: "🎉 Correct!", ms: "🎉 Betul!" },
  wrong:          { zh: "不对哦，再想想～", en: "Not quite — try again next time", ms: "Kurang tepat — cuba lagi lain kali" },
  single_hint:    { zh: "选一个正确答案", en: "Choose one correct answer", ms: "Pilih satu jawapan yang betul" },
  multi_hint:     { zh: "选出所有正确答案（可能不止一个）", en: "Choose all correct answers (there may be more than one)", ms: "Pilih semua jawapan yang betul (mungkin lebih daripada satu)" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}

export interface MultipleChoiceOption {
  id: string;
  text_i18n: { zh?: string; en?: string; ms?: string };
}
export interface MultipleChoiceSceneObject {
  image_url: string; x: number; y: number; w: number; h: number; rotation: number;
  flip_x?: boolean; flip_y?: boolean; opacity?: number;
}
export interface MultipleChoiceSceneText {
  text: string; x: number; y: number; fontSize: number; color: string; fontFamily: string;
  rotation: number; bold?: boolean; italic?: boolean; underline?: boolean;
}
export interface MultipleChoiceConfig {
  bg_image_url?: string;
  objects?: MultipleChoiceSceneObject[];
  texts?: MultipleChoiceSceneText[];
  answer_mode: "single" | "multi"; // 整个Activity统一：单选还是多选
  options: MultipleChoiceOption[]; // 至少2个选项
  correct_option_ids: string[];    // single模式下只有1个，multi模式下可以有好几个
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string; ms?: string }; // 题目文字——这里是必填的核心内容(不是辅助说明)，选择题总要有个"问什么"
}
export interface MultipleChoiceResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function MultipleChoiceGame({ config, onComplete, locale = "zh" }: {
  config: MultipleChoiceConfig; onComplete: (r: MultipleChoiceResult) => void; locale?: Locale;
}) {
  const isMulti = config.answer_mode === "multi";
  // 选项显示顺序打乱一次就固定住，不要每次渲染都重新洗牌
  const [displayOptions] = useState(() => shuffle(config.options ?? []));

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [answered, setAnswered] = useState(false);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [finished]);

  const finish = useCallback((isCorrect: boolean) => {
    setFinished(true);
    onComplete({
      score: isCorrect ? 1 : 0, max_score: 1,
      time_spent_seconds: (Date.now() - startRef.current) / 1000,
      mistakes: isCorrect ? 0 : 1, completed: true,
    });
  }, [onComplete]);

  useEffect(() => {
    if (config.timer_mode !== "countdown" || !config.time_limit || finished) return;
    if (elapsed >= config.time_limit) finish(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  function toggleOption(id: string) {
    if (answered) return;
    if (!isMulti) { setSelected(new Set([id])); return; }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function submitAnswer() {
    if (answered || selected.size === 0) return;
    setAnswered(true);
    const correctSet = new Set(config.correct_option_ids);
    // 多选模式要求"选中的"跟"该选中的"完全一致(一个不多一个不少)；
    // 单选模式其实就是这个规则在只有1个正确答案时的特例，不用分开写。
    const isCorrect = selected.size === correctSet.size && [...selected].every((id) => correctSet.has(id));
    setCorrect(isCorrect);
    setTimeout(() => finish(isCorrect), 1200);
  }

  const timerLabel = config.timer_mode === "countdown" ? t("time_left", locale) : t("time_used", locale);
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">{correct ? "🎉" : "🤔"}</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          {correct ? lt("correct", locale) : lt("wrong", locale)}
        </div>
      </div>
    );
  }

  const hasScene = !!config.bg_image_url;

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="flex justify-end text-base font-medium text-muted-foreground mb-3">
        <span>⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>

      {hasScene && (
        <div
          className="relative w-full aspect-[11/7] rounded-2xl mb-4 overflow-hidden shadow-lg ring-1 ring-black/5"
          style={{ backgroundImage: `url(${config.bg_image_url})`, backgroundSize: "100% 100%", backgroundPosition: "center" }}
        >
          {(config.objects ?? []).map((o, i) => (
            <img
              key={i} src={o.image_url} alt=""
              className="absolute object-contain -translate-x-1/2 -translate-y-1/2 pointer-events-none drop-shadow"
              style={{
                left: `${o.x * 100}%`, top: `${o.y * 100}%`,
                width: `${(o.w / GAME_CANVAS_W) * 100}%`, height: `${(o.h / GAME_CANVAS_H) * 100}%`,
                opacity: (o.opacity ?? 100) / 100,
                transform: `translate(-50%, -50%) rotate(${o.rotation ?? 0}deg) scale(${o.flip_x ? -1 : 1}, ${o.flip_y ? -1 : 1})`,
              }}
            />
          ))}
          {(config.texts ?? []).map((tx, i) => (
            <span
              key={`text-${i}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap pointer-events-none"
              style={{
                left: `${tx.x * 100}%`, top: `${tx.y * 100}%`,
                fontSize: `${(tx.fontSize / GAME_CANVAS_H) * 100}cqh`,
                color: tx.color, fontFamily: tx.fontFamily,
                fontWeight: tx.bold ? "bold" : "normal",
                fontStyle: tx.italic ? "italic" : "normal",
                textDecoration: tx.underline ? "underline" : "none",
                transform: `translate(-50%, -50%) rotate(${tx.rotation ?? 0}deg)`,
              }}
            >
              {tx.text}
            </span>
          ))}
        </div>
      )}

      <p className="text-center text-lg font-semibold text-foreground mb-1">
        {config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en}
      </p>
      <p className="text-center text-xs text-muted-foreground mb-4">
        {isMulti ? lt("multi_hint", locale) : lt("single_hint", locale)}
      </p>

      <div className="space-y-2.5 mb-5">
        {displayOptions.map((opt) => {
          const isSelected = selected.has(opt.id);
          const label = opt.text_i18n?.[locale] || opt.text_i18n?.zh || opt.text_i18n?.en || "";
          return (
            <button
              key={opt.id} type="button" onClick={() => toggleOption(opt.id)} disabled={answered}
              className={`w-full text-left px-4 py-3.5 rounded-xl border-2 flex items-center gap-3 transition-colors ${
                isSelected ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"
              }`}
            >
              <span className={`w-5 h-5 flex-shrink-0 border-2 flex items-center justify-center text-xs ${
                isMulti ? "rounded-md" : "rounded-full"
              } ${isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                {isSelected ? "✓" : ""}
              </span>
              <span className="text-base font-medium text-foreground">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex justify-center">
        <button
          onClick={submitAnswer}
          disabled={selected.size === 0}
          className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
        >
          {lt("submit", locale)}
        </button>
      </div>
    </div>
  );
}
