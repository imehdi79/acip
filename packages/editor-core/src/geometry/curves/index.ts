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
