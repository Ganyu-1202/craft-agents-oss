import type { BirdCompanionState, BirdGesture } from '../../../shared/bird-companion'

export type BirdExpression = 'neutral' | 'curious' | 'focused' | 'happy' | 'worried' | 'sleepy'
export type BirdMotion = BirdGesture | 'breathe' | 'think' | 'scan' | 'read' | 'type' | 'tap' | 'point' | 'wait' | 'celebrate' | 'shake' | 'rest' | 'lift'
export interface BirdPerformance { expression: BirdExpression; motion: BirdMotion; talking: boolean }

/** Generate the pose from progress metadata; no request text or model calls. */
export function getBirdPerformance(
  state: Pick<BirdCompanionState, 'mood' | 'activity'>,
  gesture: BirdGesture | null = null,
  dragging = false,
): BirdPerformance {
  // Permission and error expressions remain authoritative during interaction.
  let expression: BirdExpression = 'neutral'
  let motion: BirdMotion = 'breathe'
  switch (state.mood) {
    case 'waiting': expression = 'curious'; motion = 'wait'; break
    case 'error': expression = 'worried'; motion = 'shake'; break
    case 'interrupted': expression = 'sleepy'; motion = 'rest'; break
    case 'success': expression = 'happy'; motion = 'celebrate'; break
    case 'thinking': expression = 'curious'; motion = 'think'; break
    case 'working':
      expression = 'focused'
      if (['search', 'browser', 'windows', 'snapshot', 'screenshot', 'status', 'position'].includes(state.activity)) motion = 'scan'
      else if (['reading', 'help'].includes(state.activity)) motion = 'read'
      else if (['editing', 'type', 'key', 'shell'].includes(state.activity)) motion = 'type'
      else if (state.activity === 'click') motion = 'tap'
      else if (['move', 'drag', 'scroll', 'focus', 'computer'].includes(state.activity)) motion = 'point'
      else if (state.activity === 'wait') motion = 'wait'
      else motion = 'nod'
      break
    case 'idle':
      if (state.activity === 'greeting') { expression = 'happy'; motion = 'wave' }
      break
  }
  if (gesture) {
    motion = gesture
    if (state.mood === 'idle') expression = 'happy'
  }
  if (dragging) motion = 'lift'
  return { expression, motion, talking: state.activity === 'greeting' || state.mood === 'success' }
}
