import type { Point, Vector } from './point.js';

/**
 * 2D affine transform:
 * | a c tx |
 * | b d ty |
 * | 0 0 1  |
 */
export interface Matrix3 {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export const IDENTITY: Matrix3 = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

export function multiply(m1: Matrix3, m2: Matrix3): Matrix3 {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    tx: m1.a * m2.tx + m1.c * m2.ty + m1.tx,
    ty: m1.b * m2.tx + m1.d * m2.ty + m1.ty,
  };
}

export function translation(v: Vector): Matrix3 {
  return { a: 1, b: 0, c: 0, d: 1, tx: v.x, ty: v.y };
}

export function rotation(angle: number, center?: Point): Matrix3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const m: Matrix3 = { a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 };
  if (!center) return m;
  return multiply(
    multiply(translation(center), m),
    translation({ x: -center.x, y: -center.y }),
  );
}

export function scaling(s: number, center?: Point): Matrix3 {
  const m: Matrix3 = { a: s, b: 0, c: 0, d: s, tx: 0, ty: 0 };
  if (!center) return m;
  return multiply(
    multiply(translation(center), m),
    translation({ x: -center.x, y: -center.y }),
  );
}

export function applyToPoint(m: Matrix3, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.tx, y: m.b * p.x + m.d * p.y + m.ty };
}

export function applyToVector(m: Matrix3, v: Vector): Vector {
  return { x: m.a * v.x + m.c * v.y, y: m.b * v.x + m.d * v.y };
}
