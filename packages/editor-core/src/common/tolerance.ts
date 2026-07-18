export const EPSILON = 1e-9;

export function nearlyEqual(
  a: number,
  b: number,
  eps: number = EPSILON,
): boolean {
  return Math.abs(a - b) <= eps;
}

export function nearlyZero(v: number, eps: number = EPSILON): boolean {
  return Math.abs(v) <= eps;
}
