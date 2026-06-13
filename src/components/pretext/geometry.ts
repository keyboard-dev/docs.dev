/**
 * Shared layout geometry for the pretext flow engine.
 *
 * These are pure functions (no DOM, no React) ported from pretext's own
 * editorial-engine demo. They turn a set of obstacles into the open horizontal
 * "slots" available on a given line — which is what lets text flow around an
 * obstacle on *both* sides simultaneously, the thing CSS Shapes cannot do.
 */

export type Interval = { left: number; right: number };
export type RectObstacle = { x: number; y: number; w: number; h: number };
export type CircleObstacle = {
  cx: number;
  cy: number;
  r: number;
  hPad: number;
  vPad: number;
};

/**
 * Subtract every blocked interval from the base interval, returning the open
 * slots wide enough to set text in. Left-to-right, this is how a single line
 * can become "left of the orb" + "right of the orb".
 */
export function carveTextLineSlots(
  base: Interval,
  blocked: Interval[],
  minSlotWidth: number,
): Interval[] {
  let slots: Interval[] = [base];
  for (const interval of blocked) {
    const next: Interval[] = [];
    for (const slot of slots) {
      if (interval.right <= slot.left || interval.left >= slot.right) {
        next.push(slot);
        continue;
      }
      if (interval.left > slot.left) next.push({ left: slot.left, right: interval.left });
      if (interval.right < slot.right) next.push({ left: interval.right, right: slot.right });
    }
    slots = next;
  }
  return slots.filter((slot) => slot.right - slot.left >= minSlotWidth);
}

/** Horizontal span a circle blocks within a given vertical band, or null. */
export function circleIntervalForBand(
  circle: CircleObstacle,
  bandTop: number,
  bandBottom: number,
): Interval | null {
  const { cx, cy, r, hPad, vPad } = circle;
  const top = bandTop - vPad;
  const bottom = bandBottom + vPad;
  if (top >= cy + r || bottom <= cy - r) return null;
  const minDy = cy >= top && cy <= bottom ? 0 : cy < top ? top - cy : cy - bottom;
  if (minDy >= r) return null;
  const maxDx = Math.sqrt(r * r - minDy * minDy);
  return { left: cx - maxDx - hPad, right: cx + maxDx + hPad };
}

/** All intervals blocked within a band, from both rectangle and circle obstacles. */
export function blockedIntervalsForBand(
  bandTop: number,
  bandBottom: number,
  rects: RectObstacle[],
  circles: CircleObstacle[],
): Interval[] {
  const blocked: Interval[] = [];
  for (const rect of rects) {
    if (bandBottom <= rect.y || bandTop >= rect.y + rect.h) continue;
    blocked.push({ left: rect.x, right: rect.x + rect.w });
  }
  for (const circle of circles) {
    const interval = circleIntervalForBand(circle, bandTop, bandBottom);
    if (interval) blocked.push(interval);
  }
  return blocked;
}
