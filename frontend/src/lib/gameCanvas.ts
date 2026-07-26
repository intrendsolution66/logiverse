// frontend/src/lib/gameCanvas.ts
//
// One shared canvas size for every game engine AND every designer tool
// that draws on a canvas (maze, spot_diff, focus_tap custom, counting
// custom scene, the scene editor). Before this, each one picked its own
// dimensions independently (900×620, 1100×620, 900×560...) — nothing was
// WRONG about that, but it meant a background image authored for one
// module's canvas didn't map cleanly onto another's, and there was no
// single "how big should this be" decision to point at.
//
// Picked reasonably large (matches roughly a 16:10-ish canvas) since a
// bigger canvas gives finer control when marking positions/painting paths
// — the actual rendered size on screen is still responsive (every
// consumer renders this into a `w-full h-auto` container), so this is the
// INTERNAL coordinate space, not a fixed pixel footprint on any given
// screen.
export const GAME_CANVAS_W = 1100;
export const GAME_CANVAS_H = 700;

// Object/icon sizes that scale WITH the canvas rather than staying a fixed
// pixel size regardless of canvas size — e.g. an object icon at 6% of
// canvas width looks proportionally the same whether the canvas renders at
// 1100px on a desktop or 380px on a phone, instead of looking tiny on a
// big canvas or oversized on a small one.
export function scaledIconSize(fraction = 0.07): number {
  return Math.round(GAME_CANVAS_W * fraction);
}
