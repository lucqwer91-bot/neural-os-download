// Label layout maths for region and connector labels. Pure functions, screen pixels.

// Keep a region label on its side until its marker is clearly across the middle,
// so labels do not flip-flop while the brain turns. Returns -1 (left) or 1 (right).
export function stickySide(prev, dx, hysteresis = 48) {
  if (!prev || (prev < 0 && dx > hysteresis) || (prev > 0 && dx < -hysteresis)) return dx < 0 ? -1 : 1;
  return prev;
}

// Push items down so that consecutive values of `key` are at least `gap` apart.
// Items must already be sorted by `key`.
export function spreadDown(items, key, gap) {
  let p = -1e9;
  for (const o of items) { o[key] = Math.max(o[key], p + gap); p = o[key]; }
}

// Connector label column: sorted by node height (sy), at least `gap` apart,
// and pulled back up so the column never runs past `bottom`. Writes `y` on each item.
export function stackColumn(items, gap, bottom) {
  items.sort((a, b) => a.sy - b.sy);
  let prev = -1e9;
  for (const n of items) { n.y = Math.max(n.sy, prev + gap); prev = n.y; }
  let nxt = bottom;
  for (let j = items.length - 1; j >= 0; j--) { items[j].y = Math.min(items[j].y, nxt); nxt = items[j].y - gap; }
  return items;
}
