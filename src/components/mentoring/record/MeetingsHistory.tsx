"use client";

import { useEffect, useMemo, useState } from "react";
import type { MentoringEntry, MentoringSemesterOption } from "@/types/mentoring";
import type { EntryEditor } from "./EntrySection";
import { MeetingsPage } from "./MeetingsPage";
import { getJson } from "./recordApi";

// The mentor's meetings with a student, under Mentoring Notes: record a meeting (with its discussion
// categories) and look back at the earlier ones, semester by semester, newest first. The meetings are
// the Mentoring Record's own rows (the booklet's pages 13-16 and the Principal's counts read the same
// ones), so nothing is copied.

export function MeetingsHistory({ api, semester, onPickSemester }: { api: string; semester: number | null; onPickSemester: (n: number) => void }) {
  const [semesters, setSemesters] = useState<MentoringSemesterOption[]>([]);
  const [entries, setEntries] = useState<MentoringEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getJson<{ semesters: MentoringSemesterOption[] }>(`${api}?part=semesters`),
      getJson<{ entries: MentoringEntry[] }>(`${api}?part=entries`),
    ])
      .then(([s, e]) => { if (!cancelled) { setSemesters(s.semesters); setEntries(e.entries); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [api]);

  const editor: EntryEditor = useMemo(() => ({
    add: (entry) => setEntries((prev) => [...(prev ?? []), entry]),
    replace: (entry) => setEntries((prev) => (prev ?? []).map((e) => (e.id === entry.id ? entry : e))),
    remove: (id) => setEntries((prev) => (prev ?? []).filter((e) => e.id !== id)),
  }), []);

  if (error) return <p className="text-sm text-muted-foreground py-6">{error}</p>;
  if (!entries) return <p className="text-sm text-muted-foreground py-6">Loading meetings…</p>;

  const current = semesters.find((s) => s.isCurrent)?.semester ?? semesters[semesters.length - 1]?.semester ?? null;
  return <MeetingsPage api={api} entries={entries} editor={editor} semesters={semesters} semester={semester ?? current} onPickSemester={onPickSemester} newestFirst />;
}
