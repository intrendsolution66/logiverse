// frontend/src/lib/gameLocale.ts
//
// 游戏侧多语言基础设施——目前只服务"家长/学生玩游戏"这一端，课程设计器
// /管理后台维持中文，不受这套机制影响。
//
// 语言偏好存哪里：这一版先存 localStorage(见 useGameLocale)，不碰账户
// 系统/数据库。以后要接到"学生账户里的语言设置"，只需要改
// useGameLocale 内部"当前语言从哪来"这几行，所有已经接入这套机制的
// 游戏组件完全不用动——它们只认 Locale 这个值和 t() 这个函数，不关心
// 这个值从localStorage来还是从账户设置来。
//
// I18N_READY_MODULES 是"债务清单"倒过来的用法——记录哪些 module_type
// 已经真正支持多语言(游戏内部所有硬编码中文都换成了 t() 查词典)。
// LevelPlayerPage 只对这份清单里的模块显示语言切换按钮，没接入的游戏
// 保持现状(没有切换按钮，等于一直只用中文)，不会出现"按钮在但点了没
// 反应"这种半吊子体验。以后每接入一个新游戏，往这个数组里加一行就行；
// 新建的游戏应该从第一天就用这套机制写，不要再往"纯中文债务"里添新的。

import { useState, useCallback } from "react";

export type Locale = "zh" | "en" | "ms";
export const LOCALE_LABELS: Record<Locale, string> = { zh: "中文", en: "English", ms: "Bahasa Melayu" };
export const ALL_LOCALES: Locale[] = ["zh", "en", "ms"];

const STORAGE_KEY = "logiverse_game_locale";

export function useGameLocale(): [Locale, (l: Locale) => void] {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === "undefined") return "zh";
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return (saved === "en" || saved === "ms" || saved === "zh") ? saved : "zh";
  });

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { window.localStorage.setItem(STORAGE_KEY, l); } catch { /* 存不进去(比如隐私模式)不影响当前这次session用，只是刷新后会重置回zh，不用特别处理 */ }
  }, []);

  return [locale, setLocale];
}

// ── 通用UI词典 ─────────────────────────────────────────────────────────────
// 十几个游戏都在重复用的短语，一次翻译，全部试点游戏共用。key用英文
// snake_case命名(不是中文原文当key)，这样以后中文措辞想微调，不用跟着
// 改遍布各个游戏文件里的调用点。
//
// 翻译说明：这一版英文/马来文是合理推断先填上的，不是找母语者/专业译者
// 校对过的——课程团队之后应该走一遍校对，尤其是马来文这边更需要，机器
// 翻译/推断的准确度没有中文原文可靠。
export type Dict = Record<Locale, string>;

export const COMMON: Record<string, Dict> = {
  submit:            { zh: "提交",           en: "Submit",         ms: "Hantar" },
  next_question:     { zh: "下一题",         en: "Next question",  ms: "Soalan seterusnya" },
  confirm_answer:    { zh: "确认答案",       en: "Confirm answer", ms: "Sahkan jawapan" },
  time_used:         { zh: "用时",           en: "Time",           ms: "Masa" },
  time_left:         { zh: "剩余",           en: "Left",           ms: "Baki" },
  accuracy:          { zh: "正确率",         en: "Accuracy",       ms: "Ketepatan" },
  streak:            { zh: "连对",           en: "Streak",         ms: "Beruntun" },
  best_streak:       { zh: "最长连对",       en: "Best streak",    ms: "Beruntun terbaik" },
  ending_level:      { zh: "结束时等级",     en: "Ending level",   ms: "Tahap akhir" },
  level_up_msg:      { zh: "难度提升一级",   en: "Level up",       ms: "Naik satu tahap" },
  level_down_msg:    { zh: "难度降一级",     en: "Level down",     ms: "Turun satu tahap" },
  correct_exclaim:   { zh: "🎉 答对了！",    en: "🎉 Correct!",     ms: "🎉 Betul!" },
  drag_rotate:       { zh: "拖动旋转视角",   en: "Drag to rotate", ms: "Seret untuk putar" },
  scroll_zoom:       { zh: "滚轮缩放",       en: "Scroll to zoom", ms: "Skrol untuk zum" },
  practice_complete: { zh: "练习完成！",     en: "Practice complete!", ms: "Latihan selesai!" },
};

// {name} 这种占位符替换——数字/变量拼进句子的部分(比如"第{i}/{n}题")
// 才需要传 vars，纯静态短语(比如"提交")不用传第三个参数。
export function t(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = COMMON[key];
  if (!entry) return key; // 词典里没有这个key——大概率是漏翻了，先把key本身显示出来，方便发现，不要让页面崩掉
  let s = entry[locale] ?? entry.zh; // 某个语言漏填了，退回中文兜底，不要显示空白
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  }
  return s;
}

// 题目进度这种"第X/Y题"格式，三种语言语序都还算规则(数字在中间)，用
// 同一个占位符模板就够，不需要像应用题那样为每种语言另外写生成逻辑。
export function questionProgress(i: number, n: number, locale: Locale): string {
  const templates: Dict = { zh: "第 {i} / {n} 题", en: "Question {i} / {n}", ms: "Soalan {i} / {n}" };
  return templates[locale].replaceAll("{i}", String(i)).replaceAll("{n}", String(n));
}

// ── i18n 接入进度清单 ────────────────────────────────────────────────────────
// 目前试点：CubeStack系列 + 应用题(word_problem)。其他游戏都还没接入，
// 完成一个就加一行，不要漏更新，这份清单直接决定LevelPlayerPage要不要
// 显示语言切换按钮。
export const I18N_READY_MODULES: string[] = [
  "cube_stack", "cube_layer_count", "cube_find_hidden", "cube_free_rotate", "cube_build", "cube_three_view", "word_problem",
];