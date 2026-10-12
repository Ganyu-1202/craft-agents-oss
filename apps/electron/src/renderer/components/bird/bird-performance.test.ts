import { describe, expect, it } from 'bun:test'
import { getBirdPerformance } from './bird-performance'

describe('contextual bird performance', () => {
  it('distinguishes inspecting, reading, typing and computer gestures', () => {
    for (const [activity, motion] of [
      ['search', 'scan'], ['screenshot', 'scan'], ['reading', 'read'],
      ['editing', 'type'], ['type', 'type'], ['key', 'type'], ['shell', 'type'],
      ['click', 'tap'], ['drag', 'point'], ['scroll', 'point'], ['wait', 'wait'],
    ]) {
      expect(getBirdPerformance({ mood: 'working', activity: activity! })).toMatchObject({ expression: 'focused', motion, talking: false })
    }
  })

  it('uses permission, error and interruption states ahead of activity', () => {
    expect(getBirdPerformance({ mood: 'waiting', activity: 'type' })).toMatchObject({ motion: 'wait', expression: 'curious' })
    expect(getBirdPerformance({ mood: 'error', activity: 'stepError' })).toMatchObject({ motion: 'shake', expression: 'worried' })
    expect(getBirdPerformance({ mood: 'interrupted', activity: 'interrupted' })).toMatchObject({ motion: 'rest', expression: 'sleepy' })
    expect(getBirdPerformance({ mood: 'success', activity: 'finished' })).toMatchObject({ motion: 'celebrate', expression: 'happy' })
  })

  it('greets, plays manual gestures, and reacts to dragging without masking errors', () => {
    expect(getBirdPerformance({ mood: 'idle', activity: 'greeting' })).toEqual({ motion: 'wave', expression: 'happy', talking: true })
    expect(getBirdPerformance({ mood: 'idle', activity: 'idle' }, 'stretch')).toMatchObject({ motion: 'stretch', expression: 'happy' })
    expect(getBirdPerformance({ mood: 'error', activity: 'error' }, 'nod', true)).toMatchObject({ motion: 'lift', expression: 'worried', talking: false })
  })
})
