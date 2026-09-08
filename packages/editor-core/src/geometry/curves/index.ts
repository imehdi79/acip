export {
  closestParamOnSegment,
  closestPointOnSegment,
  distanceToSegment,
} from './segment.js';
export {
  pointOnCircle,
  distanceToCircle,
  distanceToArc,
  isAngleInArc,
} from './circle.js';
export { distanceToPolyline } from './polyline.js';
export type { WallSegment, RecognizeWallsOptions } from './sketch.js';
export { simplifyStroke, recognizeWalls } from './sketch.js';
export type { Arc } from './arc.js';
export {
  arcFromChord,
  arcNormalAt,
  arcPointAt,
  arcSagitta,
  arcTangentAt,
  clampSweep,
  sweepFromApex,
  tessellateArc,
  MIN_SWEEP,
  MAX_SWEEP,
} from './arc.js';
