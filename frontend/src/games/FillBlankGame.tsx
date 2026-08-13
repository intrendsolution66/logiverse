// frontend/src/games/FillBlankGame.tsx
//
// 填充题 — authored content，一个Activity一题(跟选择题/点点数数自定义
// 场景同一个定位)。背景图/装饰物件/文字图层用 SceneEditor 组合(同一套
// 编辑工具)，提供题目的视觉背景；题目句子本身用 "___" 标记空的位置，
// 有几个 "___" 就有几个空，学生按顺序填。
//
// 判定：每个空可以设置好几种都算对的写法(比如"5"和"五"都接受)，比对
// 时去掉首尾空格、忽略大小写(英文/马来文答案)，全部空都对了才算这一
// 题过关——client端直接判定，没有隐藏答案这回事，安全等级跟选择题
// 一致。
//
// i18n: zh/en/ms 已支持 — 见 frontend/src/lib/gameLocale.ts

import { useState, useEffect, useRef, useCallback } from "react";
import { GAME_CANVAS_W, GAME_CANVAS_H } from "@/lib/gameCanvas";
import { type Locale, type Dict, t } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  submit:         { zh: "✅ 提交", en: "✅ Submit", ms: "✅ Hantar" },
  all_correct:    { zh: "🎉 全部答对了！", en: "🎉 All correct!", ms: "🎉 Semua betul!" },
  some_wrong:     { zh: "有几个空不对哦，红色标出来了", en: "Some blanks are wrong — shown in red", ms: "Ada ruang kosong yang salah — ditunjukkan merah" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}

export interface FillBlankSceneObject {
  image_url: string; x: number; y: number; w: number; h: number; rotation: number;
  flip_x?: boolean; flip_y?: boolean; opacity?: number;
}
export interface FillBlankSceneText {
  text: string; x: number; y: number; fontSize: number; color: string; fontFamily: string;
  rotation: number; bold?: boolean; italic?: boolean; underline?: boolean;
}
export interface FillBlankItem {
  accepted_answers: string[]; // 这个空所有算对的写法，至少1个
}
export interface FillBlankConfig {
  bg_image_url?: string;
  objects?: FillBlankSceneObject[];
  texts?: FillBlankSceneText[];
  // 题目句子——用 "___"(三个下划线)标记空的位置，有几个"___"就有几个
  // 空，跟下面 blanks 数组按顺序一一对应(句子里第1个"___" = blanks[0])。
  sentence_i18n: { zh?: string; en?: string; ms?: string };
  blanks: FillBlankItem[];
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
}
export interface FillBlankResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
}

const BLANK_MARKER = "___";

function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase();
}

// 把句子按 "___" 切开，切出来的片段数量应该正好是 blanks.length + 1
// (N个空把句子分成N+1段文字)。如果作者句子里"___"的数量跟blanks数组
// 长度对不上(比如改题目的时候手滑删漏了一个"___")，就用能对上的部分
// 渲染、多出来的blanks位置直接不显示——总比整个组件崩溃白屏好，虽然
// 那种情况下这道题本身其实是配置错了，但不该导致整个页面挂掉。
function splitSentence(sentence: string): string[] {
  return sentence.split(BLANK_MARKER);
}

export default function FillBlankGame({ config, onComplete, locale = "zh" }: {
  config: FillBlankConfig; onComplete: (r: FillBlankResult) => void; locale?: Locale;
}) {
  const sentence = config.sentence_i18n?.[locale] || config.sentence_i18n?.zh || config.sentence_i18n?.en || "";
  const segments = splitSentence(sentence);
  const blankCount = Math.max(0, segments.length - 1);
  const blanks = config.blanks ?? [];

  const [values, setValues] = useState<string[]>(() => Array.from({ length: blankCount }, () => ""));
  const [answered, setAnswered] = useState(false);
  const [results, setResults] = useState<boolean[] | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [finished]);

  const finish = useCallback((allCorrect: boolean) => {
    setFinished(true);
    onComplete({
      score: allCorrect ? 1 : 0, max_score: 1,
      time_spent_seconds: (Date.now() - startRef.current) / 1000,
      mistakes: allCorrect ? 0 : 1, completed: true,
    });
  }, [onComplete]);

  useEffect(() => {
    if (config.timer_mode !== "countdown" || !config.time_limit || finished) return;
    if (elapsed >= config.time_limit) finish(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  const allFilled = values.every((v) => v.trim() !== "");

  function submitAnswer() {
    if (answered || !allFilled) return;
    setAnswered(true);
    const r = values.map((v, i) => {
      const accepted = blanks[i]?.accepted_answers ?? [];
      const normalized = normalizeAnswer(v);
      return accepted.some((a) => normalizeAnswer(a) === normalized);
    });
    setResults(r);
    const allCorrect = r.every(Boolean);
    setTimeout(() => finish(allCorrect), 1200);
  }

  const timerLabel = config.timer_mode === "countdown" ? t("time_left", locale) : t("time_used", locale);
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;

  if (finished) {
    const allCorrect = results?.every(Boolean) ?? false;
    return (
      <div className="text-center py-10">
        <div className="text-6xl">{allCorrect ? "🎉" : "🤔"}</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          {allCorrect ? lt("all_correct", locale) : lt("some_wrong", locale)}
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

      <div className="bg-white dark:bg-card rounded-2xl p-6 mb-5 shadow-lg ring-1 ring-black/5">
        <p className="text-lg font-medium text-foreground leading-relaxed flex flex-wrap items-center gap-x-1.5 gap-y-3">
          {segments.map((seg, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              {seg && <span>{seg}</span>}
              {i < blankCount && (
                <input
                  type="text"
                  value={values[i] ?? ""}
                  disabled={answered}
                  onChange={(e) => setValues((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
                  className={`inline-block w-24 px-2 py-1 rounded-lg border-2 text-center font-semibold outline-none transition-colors ${
                    results
                      ? results[i] ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-red-500 bg-red-50 text-red-600"
                      : "border-primary/50 bg-white focus:border-primary"
                  }`}
                />
              )}
            </span>
          ))}
        </p>
      </div>

      <div className="flex justify-center">
        <button
          onClick={submitAnswer}
          disabled={!allFilled}
          className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
        >
          {lt("submit", locale)}
        </button>
      </div>
    </div>
  );
}
