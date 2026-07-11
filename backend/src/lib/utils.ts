// Small pure helpers reused across logic. Keep framework-free and dependency-free.

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
