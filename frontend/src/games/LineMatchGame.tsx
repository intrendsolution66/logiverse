// frontend/src/games/LineMatchGame.tsx
//
// 连线配对 — authored content: every pair IS the puzzle, same "designer
// writes the answer directly" shape as maze/sudoku. The correct left↔right
// pairing never reaches this component — getLevel only sends left items
// (their own order, safe to expose) and right items (shuffled display
// order, opaque ids, no pair_index) — see courses.controller.ts's getLevel
// line_match branch for the full reasoning. Submitting sends back which
// left item the student connected to which right CONTENT (not an opaque
// id, since no session persists what that id meant between requests);
// checkLineMatch compares against the real edu.line_match_configs.pairs
// server-side, same "hidden until checked" principle as sudoku.
//
// Line drawing: an SVG overlay sits on top of the two columns, positioned
// absolutely over a shared container. Each left/right item's DOM node is
// measured (getBoundingClientRect relative to the container) after every
// render via useLayoutEffect, so lines stay glued to their items even if
// the layout reflows (e.g. font loads, window resize). Interaction is
// click-based, not drag-based — tap a left item, then tap a right item to
// connect them, works identically with mouse, touch, or keyboard-driven
// click events, no custom drag/touch-move handling needed.

import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { eduApi } from "@/api/index";
import { Button } from "@/components/ui/button";

interface MatchItem { id: number | string; type: "text" | "image"; content: string }
export interface LineMatchConfig {
  left_items: MatchItem[];
  right_items: MatchItem[];
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
}
export interface LineMatchResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
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

export default function LineMatchGame({ levelId, config, onComplete }: {
  levelId: string; config: LineMatchConfig; onComplete: (r: LineMatchResult) => void;
}) {
  const leftItems = config.left_items ?? [];
  const rightItems = config.right_items ?? [];

  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);
  const [connections, setConnections] = useState<Map<number, string>>(new Map()); // left_id -> right_id
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<Map<number, boolean> | null>(null); // left_id -> correct, after submit
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const startRef = useRef(Date.now());

  const containerRef = useRef<HTMLDivElement | null>(null);
  const leftRefs = useRef<Map<number | string, HTMLButtonElement | null>>(new Map());
  const rightRefs = useRef<Map<number | string, HTMLButtonElement | null>>(new Map());
  const [lines, setLines] = useState<Array<{ leftId: number; rightId: string; x1: number; y1: number; x2: number; y2: number }>>([]);

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [finished]);

  // 每次连线状态变了、或者版面可能重排了（比如窗口大小改变），重新量一次
  // 每个方框的实际像素位置，画线才不会跟方框对不上。
  useLayoutEffect(() => {
    function recalc() {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const next: typeof lines = [];
      connections.forEach((rightId, leftId) => {
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
  }, [connections]);

  function handleLeftClick(leftId: number) {
    if (finished) return;
    setSelectedLeft((cur) => (cur === leftId ? null : leftId));
  }

  function handleRightClick(rightId: string) {
    if (finished || selectedLeft === null) return;
    setConnections((prev) => {
      const next = new Map(prev);
      // 一个右边的项目只能被一条线用——如果它已经连着别的左边，那条线先拆掉
      for (const [lid, rid] of next) { if (rid === rightId && lid !== selectedLeft) next.delete(lid); }
      next.set(selectedLeft, rightId);
      return next;
    });
    setSelectedLeft(null);
  }

  function handleClearLine(leftId: number) {
    if (finished) return;
    setConnections((prev) => { const next = new Map(prev); next.delete(leftId); return next; });
  }

  async function handleSubmit() {
    if (checking || connections.size === 0) return;
    setChecking(true);
    try {
      const matches = Array.from(connections.entries()).map(([leftId, rightId]) => {
        const rightItem = rightItems.find((r) => r.id === rightId);
        return { left_id: leftId, right_content: rightItem?.content ?? "" };
      });
      const r = await eduApi.checkLineMatch(levelId, matches);
      const resultMap = new Map(r.results.map((x) => [x.left_id, x.correct]));
      setResults(resultMap);
      setFinished(true);
      const correctCount = r.results.filter((x) => x.correct).length;
      onComplete({
        score: correctCount, max_score: r.totalPairs,
        time_spent_seconds: (Date.now() - startRef.current) / 1000,
        mistakes: r.totalPairs - correctCount, completed: r.allCorrect,
      });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3">
        <span>🔗 已连 {connections.size} / {leftItems.length}</span>
        <span>⏱️ 用时 {elapsed.toFixed(1)}s</span>
      </div>

      <div ref={containerRef} className="relative bg-card rounded-2xl p-4 shadow-lg ring-1 ring-black/5">
        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
          {lines.map((l) => {
            const wrong = results?.get(l.leftId) === false;
            const correct = results?.get(l.leftId) === true;
            return (
              <line
                key={l.leftId} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                stroke={wrong ? "#ef4444" : correct ? "#10b981" : "var(--primary)"}
                strokeWidth={3} strokeLinecap="round"
              />
            );
          })}
        </svg>

        <div className="grid grid-cols-2 gap-x-12 gap-y-3 relative" style={{ zIndex: 2 }}>
          <div className="space-y-3">
            {leftItems.map((item) => (
              <div key={item.id} className="relative">
                <ItemBox
                  item={item} selected={selectedLeft === item.id as number}
                  matched={connections.has(item.id as number) && !results}
                  wrong={results?.get(item.id as number) === false}
                  onClick={() => handleLeftClick(item.id as number)}
                  boxRef={(el) => leftRefs.current.set(item.id, el)}
                />
                {connections.has(item.id as number) && !finished && (
                  <button
                    type="button" onClick={() => handleClearLine(item.id as number)}
                    className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-muted-foreground/80 text-white text-xs flex items-center justify-center hover:bg-red-500"
                  >✕</button>
                )}
              </div>
            ))}
          </div>
          <div className="space-y-3">
            {rightItems.map((item) => (
              <ItemBox
                key={item.id} item={item}
                matched={Array.from(connections.values()).includes(item.id as string) && !results}
                onClick={() => handleRightClick(item.id as string)}
                boxRef={(el) => rightRefs.current.set(item.id, el)}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground mt-2">
        {selectedLeft !== null ? "已选中左边的项目——点右边任一项目连线" : "点左边一个项目，再点右边对应的项目连起来"}
      </p>

      {!finished ? (
        <div className="flex justify-center mt-4">
          <Button onClick={handleSubmit} disabled={checking || connections.size === 0} className="text-lg font-semibold px-8 py-2.5 rounded-2xl">
            {checking ? "检查中..." : "✅ 提交"}
          </Button>
        </div>
      ) : (
        <div className={`text-center text-lg font-medium mt-4 px-4 py-3 rounded-xl ${
          results && Array.from(results.values()).every((v) => v) ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
          : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
        }`}>
          {results ? `答对 ${Array.from(results.values()).filter((v) => v).length} / ${leftItems.length} 组` : ""}
        </div>
      )}
    </div>
  );
}
