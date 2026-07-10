export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Vector = Point;

export const point = (x: number, y: number): Point => ({ x, y });

export const ORIGIN: Point = { x: 0, y: 0 };

export function add(a: Point, v: Vector): Point {
  return { x: a.x + v.x, y: a.y + v.y };
}

export function sub(a: Point, b: Point): Vector {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vector, s: number): Vector {
  return { x: v.x * s, y: v.y * s };
}

export function dot(a: Vector, b: Vector): number {
  return a.x * b.x + a.y * b.y;
}

export function cross(a: Vector, b: Vector): number {
  return a.x * b.y - a.y * b.x;
}

export function length(v: Vector): number {
  return Math.hypot(v.x, v.y);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function normalize(v: Vector): Vector {
  const len = length(v);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function perpendicular(v: Vector): Vector {
  return { x: -v.y, y: v.x };
}

export function angleOf(v: Vector): number {
  return Math.atan2(v.y, v.x);
}
