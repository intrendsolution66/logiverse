// frontend/src/games/LineMatchGame.tsx
//
// 连线配对 — authored content: designer 明确画出每一条连线(edges)，不再
// 是"猜配对"。左右各一份物件清单 + 一份 {leftId, rightId} 连线清单，
// 一个物件可以出现在好几条线里（一对多/多对一），不再限制1对1。
//
// 安全模型改了——旧版列表配对刻意隐藏正确配对，靠 checkLineMatch 这个
// API 在服务器端核对（"答案在核对前对客户端不可见"）。多对多之后继续
// 做这种隐藏校验，服务器端逻辑会变得复杂很多，而且连线配对本来就是
// "看图连线"这种偏休闲的玩法，不是需要精确防作弊的题目——所以这版
// 改成跟自定义画面模式(LineMatchSceneGame)一样，edges 直接发给客户端，
// 点对了没对当场就知道，不再调 checkLineMatch。
//
// 向后兼容——旧版数据(config.pairs，隐含1对1，没有 left_items/edges)会
// 在下面 normalizeListData() 里自动转换成新形状，老 Activity 不用重新
// 编辑就能继续玩。
//
// Line drawing: an SVG overlay sits on top of the two columns, positioned
// absolutely over a shared container. Each left/right item's DOM node is
// measured (getBoundingClientRect relative to the container) after every
// render via useLayoutEffect, so lines stay glued to their items even if
// the layout reflows (e.g. font loads, window resize).
//
// 自定义画面模式（config.layout === "scene"）走 LineMatchSceneGame，逻辑
// 跟这里基本一致（也是client端直接核对），只是物件是自由摆放的坐标，
// 不是两栏DOM布局，画线的方式因此不一样（用比例坐标而不是量DOM位置）。
//
// i18n: zh/en/ms 已支持(界面文字) — 见 frontend/src/lib/gameLocale.ts。
// question_i18n 是designer自己填的authored题目文字——现在CourseDesignerPage.tsx
// 已经支持三语言输入了(zh/en/ms)，运行时读取顺序是"当前locale优先，没填
// 再退回zh，还没填再退回en"。

import { useState, useRef, useLayoutEffect, useEffect, useCallback, useMemo } from "react";
import { GAME_CANVAS_W, GAME_CANVAS_H } from "@/lib/gameCanvas";
import { type Locale, type Dict, t } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  connected:        { zh: "🔗 已连 {a} / {b}", en: "🔗 Connected {a} / {b}", ms: "🔗 Disambung {a} / {b}" },
  scene_hint_one:   { zh: "已选中一个物件——点它的配对连起来", en: "One item selected — tap its match to connect", ms: "Satu item dipilih — ketik pasangannya untuk sambung" },
  scene_hint_none:  { zh: "点一个物件，再点跟它配对的物件连起来", en: "Tap an item, then tap its match to connect them", ms: "Ketik satu item, kemudian ketik pasangannya untuk sambungkan" },
  list_hint_one:    { zh: "已选中一项——点对面任一项目连线（一个物件可以连好几条线）", en: "One item selected — tap any item on the other side (an item can have several connections)", ms: "Satu item dipilih — ketik mana-mana item di sebelah (satu item boleh ada beberapa sambungan)" },
  list_hint_none:   { zh: "点一个物件，再点它配对的物件连起来", en: "Tap an item, then tap its match to connect them", ms: "Ketik satu item, kemudian ketik pasangannya untuk sambungkan" },
  matched_lines:    { zh: "连对 {a} / {b} 条", en: "{a} / {b} matched", ms: "{a} / {b} sepadan" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}

interface MatchItem { id: string; type: "text" | "image"; content: string }
interface MatchEdge { leftId: string; rightId: string }
// 自定义画面模式的物件——位置/尺寸都是 0-1 的比例（相对画布 W/H），不是
// 像素，这样不管实际渲染多大的容器都能等比例还原，跟 MemoryGame 的
// positions 是同一种做法。
export interface LineMatchSceneObject {
  image_url: string;
  x: number; y: number; w: number; h: number; rotation: number;
  opacity?: number; flip_x?: boolean; flip_y?: boolean;
  pair_key: string;
}
export interface LineMatchConfig {
  layout?: "list" | "scene"; // 不传视为 "list"（旧数据兼容）
  left_items?: MatchItem[];
  right_items?: MatchItem[];
  edges?: MatchEdge[];
  // 更老的数据——隐含1对1，没有 edges，normalizeListData() 会自动转换
  pairs?: Array<{ left: { type: "text" | "image"; content: string }; right: { type: "text" | "image"; content: string } }>;
  bg_image_url?: string | null;
  objects?: LineMatchSceneObject[];
  shuffle_right?: boolean;
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string; ms?: string };
}
export interface LineMatchResult {
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

// 左右两份物件清单 + 连线清单——新数据直接就是这个形状；老数据(pairs，
// 隐含1对1)在这里现场转换，每对拆成一个左物件+一个右物件+一条线。
function normalizeListData(config: LineMatchConfig): { left: MatchItem[]; right: MatchItem[]; edges: MatchEdge[] } {
  if (config.left_items && config.right_items) {
    return { left: config.left_items, right: config.right_items, edges: config.edges ?? [] };
  }
  const pairs = config.pairs ?? [];
  const left: MatchItem[] = [], right: MatchItem[] = [], edges: MatchEdge[] = [];
  pairs.forEach((p, i) => {
    const leftId = `legacy_l${i}`, rightId = `legacy_r${i}`;
    left.push({ id: leftId, ...p.left });
    right.push({ id: rightId, ...p.right });
    edges.push({ leftId, rightId });
  });
  return { left, right, edges };
}

// 两点之间的弯曲连线——控制点往垂直方向偏一点，弧度跟着距离缩放（越
// 长弧度越明显，但封顶避免太夸张），纯装饰用，怎么弯不影响判对错。
function curvedPath(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.hypot(dx, dy) || 1;
  const curve = Math.min(12, Math.max(3, dist * 0.18));
  const nx = -dy / dist, ny = dx / dist;
  const cx = mx + nx * curve, cy = my + ny * curve;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

function LineMatchSceneGame({ config, onComplete, locale }: {
  config: LineMatchConfig; onComplete: (r: LineMatchResult) => void; locale: Locale;
}) {
  const objects = config.objects ?? [];
  // 一组的成员数不再固定是2——按 pair_key 分组，两两互相连起来才算这一
  // 组"连完"，总连线数是每组"组内两两连线数"加总（N个物件一组要连
  // N*(N-1)/2 条线，两两都连到）。
  const groups = useMemo(() => {
    const byKey = new Map<string, number[]>();
    objects.forEach((o, i) => { const k = o.pair_key || ""; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k)!.push(i); });
    return byKey;
  }, [objects]);
  const totalEdgesNeeded = useMemo(() => {
    let total = 0;
    groups.forEach((idxs) => { const n = idxs.length; total += (n * (n - 1)) / 2; });
    return total;
  }, [groups]);

  const [selected, setSelected] = useState<number | null>(null);
  const [matchedPairs, setMatchedPairs] = useState<Set<string>>(new Set()); // "minIdx-maxIdx" 字符串
  const [pairLines, setPairLines] = useState<Array<{ a: number; b: number }>>([]);
  const [wrongFlash, setWrongFlash] = useState<number[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const startRef = useRef(Date.now());
  const lockRef = useRef(false);

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [finished]);

  const finish = useCallback(() => {
    setFinished(true);
    onComplete({
      score: pairLines.length, max_score: totalEdgesNeeded,
      time_spent_seconds: (Date.now() - startRef.current) / 1000,
      mistakes, completed: pairLines.length === totalEdgesNeeded,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairLines, mistakes, totalEdgesNeeded]);

  useEffect(() => {
    if (!finished && totalEdgesNeeded > 0 && pairLines.length === totalEdgesNeeded) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairLines.length]);

  function handleClick(i: number) {
    if (finished || lockRef.current) return;
    if (selected === i) { setSelected(null); return; }
    if (selected === null) { setSelected(i); return; }

    const a = selected, b = i;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const sameGroup = !!objects[a]?.pair_key && objects[a].pair_key === objects[b]?.pair_key;
    const alreadyDone = matchedPairs.has(key);

    if (sameGroup && !alreadyDone) {
      setMatchedPairs((m) => new Set(m).add(key));
      setPairLines((ls) => [...ls, { a, b }]);
      setSelected(null);
    } else if (sameGroup && alreadyDone) {
      setSelected(null); // 这两个已经连过了，不重复算，也不罚
    } else {
      lockRef.current = true;
      setMistakes((m) => m + 1);
      setWrongFlash([a, b]);
      setTimeout(() => { setWrongFlash([]); setSelected(null); lockRef.current = false; }, 600);
    }
  }

  return (
    <div className="max-w-3xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3">
        <span>{lt("connected", locale, { a: pairLines.length, b: totalEdgesNeeded })}</span>
        <span>⏱️ {t("time_used", locale)} {elapsed.toFixed(1)}s</span>
      </div>
      {(config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en) && (
        <p className="text-center text-lg font-semibold text-foreground mb-3">{config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en}</p>
      )}

      <div
        className="relative w-full rounded-2xl shadow-lg ring-1 ring-black/5 overflow-hidden bg-card"
        style={{
          aspectRatio: `${GAME_CANVAS_W} / ${GAME_CANVAS_H}`,
          backgroundImage: config.bg_image_url ? `url(${config.bg_image_url})` : undefined,
          backgroundSize: "100% 100%", backgroundPosition: "center",
        }}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
          {pairLines.map((pl, idx) => {
            const oa = objects[pl.a], ob = objects[pl.b];
            if (!oa || !ob) return null;
            return (
              <path
                key={idx}
                d={curvedPath(oa.x * 100, oa.y * 100, ob.x * 100, ob.y * 100)}
                fill="none" stroke="var(--primary)" strokeWidth={0.8} strokeLinecap="round"
              />
            );
          })}
        </svg>

        {objects.map((o, i) => {
          const isSelected = selected === i;
          const groupIdxs = groups.get(o.pair_key || "") ?? [];
          const isFullyDone = groupIdxs.length > 1 && groupIdxs.every((j) => j === i || matchedPairs.has(i < j ? `${i}-${j}` : `${j}-${i}`));
          const isWrong = wrongFlash.includes(i);
          return (
            <button
              key={i} type="button" onClick={() => handleClick(i)} disabled={isFullyDone}
              className={`absolute p-0 rounded-xl border-2 flex items-center justify-center transition-colors ${
                isWrong ? "border-red-400 bg-red-50/90 dark:bg-red-950/40"
                : isFullyDone ? "border-emerald-400 bg-emerald-50/70 dark:bg-emerald-950/30 cursor-default"
                : isSelected ? "border-primary bg-primary/10"
                : "border-transparent hover:border-primary/50 bg-transparent"
              }`}
              style={{
                left: `${o.x * 100}%`, top: `${o.y * 100}%`,
                width: `${o.w * 100}%`, height: `${o.h * 100}%`,
                transform: `translate(-50%, -50%) rotate(${o.rotation ?? 0}deg) scale(${o.flip_x ? -1 : 1}, ${o.flip_y ? -1 : 1})`,
                opacity: (o.opacity ?? 100) / 100,
                zIndex: 2,
              }}
            >
              <img src={o.image_url} alt="" className="max-w-full max-h-full object-contain pointer-events-none" />
            </button>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted-foreground mt-2">
        {selected !== null ? lt("scene_hint_one", locale) : lt("scene_hint_none", locale)}
      </p>
    </div>
  );
}

function ItemBox({ item, selected, matched, wrong, onClick, boxRef }: {
  item: MatchItem; selected?: boolean; matched?: boolean; wrong?: boolean; onClick: () => void;
  boxRef: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={boxRef} type="button" onClick={onClick}
      className={`w-full min-h-[3.5rem] px-3 py-2 rounded-xl border-2 flex items-center justify-center text-center font-medium transition-colors ${
        wrong ? "border-red-400 bg-red-50 dark:bg-red-950/30"
        : matched ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30"
        : selected ? "border-primary bg-primary/10"
        : "border-border bg-card hover:border-primary/50"
      }`}
    >
      {item.type === "image" ? <img src={item.content} alt="" className="max-h-16 max-w-full object-contain" /> : <span>{item.content}</span>}
    </button>
  );
}

export default function LineMatchGame({ config, onComplete, locale = "zh" }: {
  levelId: string; config: LineMatchConfig; onComplete: (r: LineMatchResult) => void; locale?: Locale;
}) {
  if (config.layout === "scene") {
    return <LineMatchSceneGame config={config} onComplete={onComplete} locale={locale} />;
  }

  const { left: leftItems, right: rightItemsRaw, edges } = useMemo(() => normalizeListData(config), [config]);
  // 右栏顺序打乱一次就固定住，不要每次渲染都重新洗牌（不然连线画到一半
  // 位置全变了）——用 useState 的惰性初始化，只在挂载那一刻算一次。
  const [rightItems] = useState(() => (config.shuffle_right !== false ? shuffle(rightItemsRaw) : rightItemsRaw));

  const [selected, setSelected] = useState<{ id: string; side: "left" | "right" } | null>(null);
  const [matchedEdges, setMatchedEdges] = useState<MatchEdge[]>([]);
  const [wrongFlash, setWrongFlash] = useState<{ leftId: string; rightId: string } | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const startRef = useRef(Date.now());
  const lockRef = useRef(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const leftRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const rightRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const [lines, setLines] = useState<Array<{ leftId: string; rightId: string; x1: number; y1: number; x2: number; y2: number }>>([]);

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [finished]);

  const finish = useCallback(() => {
    setFinished(true);
    onComplete({
      score: matchedEdges.length, max_score: edges.length,
      time_spent_seconds: (Date.now() - startRef.current) / 1000,
      mistakes, completed: matchedEdges.length === edges.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedEdges, mistakes, edges.length]);

  useEffect(() => {
    if (!finished && edges.length > 0 && matchedEdges.length === edges.length) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedEdges.length]);

  // 每次连线状态变了、或者版面可能重排了（比如窗口大小改变），重新量一次
  // 每个方框的实际像素位置，画线才不会跟方框对不上。
  useLayoutEffect(() => {
    function recalc() {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const next: typeof lines = [];
      matchedEdges.forEach(({ leftId, rightId }) => {
        const leftEl = leftRefs.current.get(leftId);
        const rightEl = rightRefs.current.get(rightId);
        if (!leftEl || !rightEl) return;
        const l = leftEl.getBoundingClientRect(), r = rightEl.getBoundingClientRect();
        next.push({
          leftId, rightId,
          x1: l.right - containerRect.left, y1: l.top + l.height / 2 - containerRect.top,
          x2: r.left - containerRect.left, y2: r.top + r.height / 2 - containerRect.top,
        });
      });
      setLines(next);
    }
    recalc();
    window.addEventListener("resize", recalc);
    return () => window.removeEventListener("resize", recalc);
  }, [matchedEdges]);

  function handleItemClick(id: string, side: "left" | "right") {
    if (finished || lockRef.current) return;
    if (selected === null) { setSelected({ id, side }); return; }
    if (selected.id === id) { setSelected(null); return; }
    if (selected.side === side) { setSelected({ id, side }); return; } // 换选同一边的另一个

    const leftId = selected.side === "left" ? selected.id : id;
    const rightId = selected.side === "left" ? id : selected.id;
    const isValidEdge = edges.some((e) => e.leftId === leftId && e.rightId === rightId);
    const alreadyDone = matchedEdges.some((e) => e.leftId === leftId && e.rightId === rightId);

    if (isValidEdge && !alreadyDone) {
      setMatchedEdges((es) => [...es, { leftId, rightId }]);
      setSelected(null);
    } else if (isValidEdge && alreadyDone) {
      setSelected(null); // 已经连过这条了，不重复算
    } else {
      lockRef.current = true;
      setMistakes((m) => m + 1);
      setWrongFlash({ leftId, rightId });
      setTimeout(() => { setWrongFlash(null); setSelected(null); lockRef.current = false; }, 600);
    }
  }

  const doneCountFor = (id: string, side: "left" | "right") =>
    matchedEdges.filter((e) => (side === "left" ? e.leftId : e.rightId) === id).length;
  const totalNeededFor = (id: string, side: "left" | "right") =>
    edges.filter((e) => (side === "left" ? e.leftId : e.rightId) === id).length;

  return (
    <div className="max-w-3xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3">
        <span>{lt("connected", locale, { a: matchedEdges.length, b: edges.length })}</span>
        <span>⏱️ {t("time_used", locale)} {elapsed.toFixed(1)}s</span>
      </div>
      {(config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en) && (
        <p className="text-center text-lg font-semibold text-foreground mb-3">{config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en}</p>
      )}

      <div ref={containerRef} className="relative bg-card rounded-2xl p-4 shadow-lg ring-1 ring-black/5">
        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
          {lines.map((l, i) => (
            <path
              key={i} d={`M ${l.x1} ${l.y1} L ${l.x2} ${l.y2}`}
              stroke="#10b981" strokeWidth={3} strokeLinecap="round" fill="none"
            />
          ))}
        </svg>

        <div className="grid grid-cols-2 gap-x-12 gap-y-3 relative" style={{ zIndex: 2 }}>
          <div className="space-y-3">
            {leftItems.map((item) => {
              const done = doneCountFor(item.id, "left");
              const total = totalNeededFor(item.id, "left");
              return (
                <div key={item.id} className="relative">
                  <ItemBox
                    item={item} selected={selected?.id === item.id && selected.side === "left"}
                    matched={done > 0 && done === total}
                    wrong={wrongFlash?.leftId === item.id}
                    onClick={() => handleItemClick(item.id, "left")}
                    boxRef={(el) => leftRefs.current.set(item.id, el)}
                  />
                  {total > 1 && (
                    <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-muted-foreground/80 text-white text-[10px] flex items-center justify-center font-semibold">
                      {done}/{total}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="space-y-3">
            {rightItems.map((item) => {
              const done = doneCountFor(item.id, "right");
              const total = totalNeededFor(item.id, "right");
              return (
                <div key={item.id} className="relative">
                  <ItemBox
                    item={item} selected={selected?.id === item.id && selected.side === "right"}
                    matched={done > 0 && done === total}
                    wrong={wrongFlash?.rightId === item.id}
                    onClick={() => handleItemClick(item.id, "right")}
                    boxRef={(el) => rightRefs.current.set(item.id, el)}
                  />
                  {total > 1 && (
                    <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-muted-foreground/80 text-white text-[10px] flex items-center justify-center font-semibold">
                      {done}/{total}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground mt-2">
        {selected !== null ? lt("list_hint_one", locale) : lt("list_hint_none", locale)}
      </p>

      {finished && (
        <div className={`text-center text-lg font-medium mt-4 px-4 py-3 rounded-xl ${
          matchedEdges.length === edges.length ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
          : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
        }`}>
          {lt("matched_lines", locale, { a: matchedEdges.length, b: edges.length })}
        </div>
      )}
    </div>
  );
}
