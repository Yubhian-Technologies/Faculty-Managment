// "Topics covered": what a faculty member wrote as the class work when they
// submitted student attendance (StudentAttendanceSession.classNotes), laid out
// one row per class day with that day's periods joined - the college's
// "Topics Covered" register.

export interface TopicSessionInput {
  date: string; // "YYYY-MM-DD"
  periodNumber?: number | null;
  classNotes?: string | null;
}

export interface TopicRow {
  date: string;
  periods: number[];
  topics: string;
}

/** One row per date, newest first. Periods are listed ascending; the topic is
 *  what was written, with the same text across periods shown once and different
 *  texts joined in period order. Sessions with no notes still count as periods. */
export function groupTopicsByDate(sessions: TopicSessionInput[]): TopicRow[] {
  const byDate = new Map<string, TopicSessionInput[]>();
  for (const s of sessions) {
    if (!s.date) continue;
    byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  }
  const rows: TopicRow[] = [];
  for (const [date, list] of byDate) {
    const ordered = [...list].sort((a, b) => (a.periodNumber ?? 99) - (b.periodNumber ?? 99));
    const periods = Array.from(new Set(ordered.map((s) => s.periodNumber).filter((p): p is number => Number.isInteger(p))));
    const seen = new Set<string>();
    const topics: string[] = [];
    for (const s of ordered) {
      const t = (s.classNotes ?? "").trim().replace(/\s+/g, " ");
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      topics.push(t);
    }
    rows.push({ date, periods, topics: topics.join(" / ") });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

/** "2026-03-11" -> "11/03/2026" */
export function dmy(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : date;
}
