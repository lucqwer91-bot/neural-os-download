import { describe, expect, it } from 'vitest'
import { DEFAULT_VIEW, ZOOM_MAX, ZOOM_MIN, frameFor, orbitPosition, rotateStep, zoomStep } from '../../src/renderer/src/brain/camera.js'

describe('orbit camera', () => {
  it('frames the default body like the prototype', () => {
    const f = frameFor(-2.4)
    expect(f.r).toBeCloseTo(3.7 * (3.45 / 2.8))
    expect(f.ty).toBeCloseTo((1.05 - 2.4) / 2)
  })
  it('never zooms beyond the limits (always a way back)', () => {
    expect(zoomStep(ZOOM_MAX, 5000)).toBe(ZOOM_MAX)
    expect(zoomStep(ZOOM_MIN, -5000)).toBe(ZOOM_MIN)
  })
  it('clamps the pitch so the view never flips', () => {
    expect(rotateStep(0, 1, 0, -10000).ph).toBe(3.0)
    expect(rotateStep(0, 1, 0, 10000).ph).toBe(0.15)
  })
  it('places the camera at distance r from the target', () => {
    const t = { x: 0, y: DEFAULT_VIEW.ty, z: 0 }
    const [x, y, z] = orbitPosition(DEFAULT_VIEW.th, DEFAULT_VIEW.ph, 3.7, t)
    expect(Math.hypot(x - t.x, y - t.y, z - t.z)).toBeCloseTo(3.7)
  })
})
