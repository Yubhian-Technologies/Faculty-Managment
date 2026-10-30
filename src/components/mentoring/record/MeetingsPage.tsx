"use client";

import { CalendarCheck } from "lucide-react";
import { entrySection, MEETINGS_TARGET } from "@/lib/mentoring/recordSections";
import type { MentoringEntry, MentoringSemesterOption } from "@/types/mentoring";
import { EntrySectionView, type EntryEditor } from "./EntrySection";

// Pages 13-16 of the booklet: the mentor's meetings with the student, semester by semester.

export function MeetingsPage({
  api, entries, editor, semesters, semester, onPickSemester, readOnly, newestFirst,
}: {
  readOnly?: boolean;
  newestFirst?: boolean;
  api: string;
  entries: MentoringEntry[];
  editor: EntryEditor;
  semesters: MentoringSemesterOption[];
  semester: number | null;
  onPickSemester: (n: number) => void;
}) {
  const section = entrySection("meetings")!;
  const count = (n: number) => entries.filter((e) => e.section === "meetings" && e.semester === n).length;

  if (semesters.length === 0 || semester == null) {
    return <p className="text-sm text-muted-foreground py-6">No semester has started for this student yet.</p>;
  }
  const n = count(semester);
  const pct = Math.min(100, Math.round((n / MEETINGS_TARGET.min) * 100));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 print:hidden" role="tablist" aria-label="Semester">
        {semesters.map((s) => (
          <button
            key={s.semester}
            type="button"
            role="tab"
            aria-selected={s.semester === semester}
            onClick={() => onPickSemester(s.semester)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${s.semester === semester ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}
          >
            {s.label} <span className="opacity-70">· {count(s.semester)}</span>
          </button>
        ))}
      </div>

      <div className="rounded-lg border bg-card px-4 py-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2"><CalendarCheck className="h-4 w-4 text-primary" />
            <strong>{semesters.find((s) => s.semester === semester)?.label}</strong>
          </span>
          <span className="text-muted-foreground">{n} of {MEETINGS_TARGET.min}–{MEETINGS_TARGET.max} meetings</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden>
          <div className={`h-full rounded-full ${n >= MEETINGS_TARGET.min ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <EntrySectionView section={section} entries={entries} api={api} editor={editor} semester={semester} hideTitle readOnly={readOnly} newestFirst={newestFirst} />
    </div>
  );
}
