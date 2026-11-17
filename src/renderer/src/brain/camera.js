// Orbit camera maths for the brain view (prototype v12). Pure: no DOM, no three.js.
// Angles: th = around the vertical axis, ph = from the top (0) to the bottom (pi).

/** Default side view: the most recognisable brain profile, with cord and nerves below. */
export const DEFAULT_VIEW = Object.freeze({ th: 1.5, ph: 1.42, r: 3.7, ty: -0.32 })

export const ZOOM_MIN = 0.12   // close enough to fly inside the brain
export const ZOOM_MAX = 26
export const PITCH_MIN = 0.15
export const PITCH_MAX = 3.0

/**
 * Frame brain + cord + nerves. With many connectors the cord gets longer and the
 * camera pulls back; k compensates the point size so the brain keeps its density.
 */
export function frameFor(bodyBottom, top = 1.05) {
  const r = DEFAULT_VIEW.r * Math.max(1, (top - bodyBottom) / 2.8)
  return { th: DEFAULT_VIEW.th, ph: DEFAULT_VIEW.ph, r, ty: (top + bodyBottom) / 2, k: r / DEFAULT_VIEW.r }
}

/** Camera position for an orbit state around target t ({x,y,z}). */
export function orbitPosition(th, ph, r, t) {
  const s = Math.sin(ph)
  return [t.x + r * s * Math.sin(th), t.y + r * Math.cos(ph), t.z + r * s * Math.cos(th)]
}

/** New zoom distance after a wheel or pinch step. */
export function zoomStep(r, deltaY) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, r * Math.exp(deltaY * 0.0011)))
}

/** New angles after dragging by dx/dy pixels. */
export function rotateStep(th, ph, dx, dy) {
  return { th: th - dx * 0.006, ph: Math.min(PITCH_MAX, Math.max(PITCH_MIN, ph - dy * 0.006)) }
}

/** Frame-rate independent easing factor for dt seconds. */
export const ease = (dt) => 1 - Math.pow(0.0005, dt)
