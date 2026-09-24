import { calcPercent } from "./percentage";

// Shortage = below threshold (default 75), held>0 required. held==0 -> null (no %)
export function isShortage(held: number, attend: number, threshold = 75): boolean {
  if (held <= 0) return false;
  const pct = calcPercent(attend, held);
  if (pct == null) return false;
  return pct < threshold;
}

export function isShortageByPercent(percent: number | null, threshold = 75): boolean {
  if (percent == null) return false;
  return percent < threshold;
}

export const DEFAULT_SHORTAGE_THRESHOLD = 75;
export const MIN_THRESHOLD = 0;
export const MAX_THRESHOLD = 100;

export function clampThreshold(v: unknown, fallback = DEFAULT_SHORTAGE_THRESHOLD): number {
  const n = Number(v);
  if (Number.isNaN(n)) return fallback;
  return Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, n));
}
