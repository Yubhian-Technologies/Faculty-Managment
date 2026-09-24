// Shared percentage math for student attendance — single source, 2-decimal rounding
// Matches existing pattern: Math.round(attend/held*10000)/100 (see section-attendance-report:205)
// held = SUBMITTED sessions count, not timetable denominator. DRAFT excluded everywhere.
export function calcPercent(attend: number, held: number): number | null {
  if (held <= 0) return null;
  return Math.round((attend / held) * 10000) / 100;
}

export function calcConsolidatedPercent(bySubject: Record<string, { held: number; attend: number }>): number | null {
  let held = 0;
  let attend = 0;
  for (const v of Object.values(bySubject)) {
    held += v.held;
    attend += v.attend;
  }
  return calcPercent(attend, held);
}

export function formatPercent(p: number | null): string {
  if (p == null) return "—";
  return `${p.toFixed(2)}%`;
}
