// Colour themes for the brain. "color" gives every region, nerve and project its own hue;
// "mono" is the original silver look. Pure functions, no three.js needed.

/** one hue per region, same order as REG in geometry.js */
export const REGION_HEX = {
  memory: 0x3fd8ff,     // cyan
  planning: 0xa77bff,   // violet
  execution: 0xff8a3d,  // orange
  research: 0x4f8bff,   // blue
  workflows: 0x46e39a,  // green
  connectors: 0xff5fc8, // magenta
  subagents: 0xffd23f,  // amber
};

/** @param {number} hex @returns {[number,number,number]} */
export const rgb = hex => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

/** @param {number} h 0..1 @param {number} s @param {number} l @returns {[number,number,number]} */
export function hsl(h, s, l) {
  const f = n => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}

/** stable hue for any name (projects, connectors) */
export function nameColor(name) {
  let h = 2166136261;
  for (const ch of String(name)) { h ^= ch.codePointAt(0) || 0; h = Math.imul(h, 16777619); }
  return hsl(((h >>> 0) % 360) / 360, .85, .62);
}

/** colour for region r in the given theme; mono = faint cold silver */
export function regionColor(regName, theme) {
  if (theme !== "color" || !(regName in REGION_HEX)) return [.92, .98, 1.08];
  return rgb(REGION_HEX[regName]);
}

/** CSS colour string */
export const css = c => `rgb(${c.map(v => Math.round(Math.min(1, v) * 255)).join(",")})`;
