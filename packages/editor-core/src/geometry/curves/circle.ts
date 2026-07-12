import type { Point } from '../primitives/point.js';
import { angleOf, distance, point, sub } from '../primitives/point.js';

const TWO_PI = Math.PI * 2;

export function pointOnCircle(center: Point, radius: number, angle: number): Point {
  return point(center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle));
}

export function distanceToCircle(p: Point, center: Point, radius: number): number {
  return Math.abs(distance(p, center) - radius);
}

/** arcs sweep CCW from startAngle to endAngle */
export function isAngleInArc(angle: number, startAngle: number, endAngle: number): boolean {
  const sweep = ((endAngle - startAngle) % TWO_PI + TWO_PI) % TWO_PI;
  const a = ((angle - startAngle) % TWO_PI + TWO_PI) % TWO_PI;
  return a <= sweep;
}

export function distanceToArc(
  p: Point,
  center: Point,
  radius: number,
  startAngle: number,
  endAngle: number,
): number {
  if (isAngleInArc(angleOf(sub(p, center)), startAngle, endAngle)) {
    return distanceToCircle(p, center, radius);
  }
  return Math.min(
    distance(p, pointOnCircle(center, radius, startAngle)),
    distance(p, pointOnCircle(center, radius, endAngle)),
  );
}
