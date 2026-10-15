"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Award, BookOpen, Briefcase, GraduationCap, Printer, Users, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { entrySection } from "@/lib/mentoring/recordSections";
import type { MentoringEntry, MentoringSemesterOption } from "@/types/mentoring";
import { EntrySectionView, type EntryEditor } from "./EntrySection";
import { MeetingsPage } from "./MeetingsPage";
import { SemesterPage } from "./SemesterPage";
import { StudentInfoPage } from "./StudentInfoPage";
import { getJson } from "./recordApi";

// The college's Student Mentoring Record as pages: student information, previous record, one page per
// semester, progress & placements, activities & discipline, and the mentor meetings. Everything the
// system already knows is filled in; the mentor adds what it cannot know.

type View = "info" | "previous" | "progress" | "activities" | "meetings" | `sem:${number}`;

const PREVIOUS = ["previousAwards", "previousCoCurricular", "previousExtraCurricular", "healthRecord", "otherInfo"] as const;
const PREVIOUS_NUMBER: Record<string, string> = { previousAwards: "7.2", previousCoCurricular: "7.3", previousExtraCurricular: "7.4", healthRecord: "7.5", otherInfo: "8" };
const PROGRESS = ["scholarships", "internships", "placements", "competitiveExams", "higherStudies"] as const;
const ACTIVITIES = ["achievements", "disciplinary"] as const;

const NAV: { view: View; label: string; icon: typeof UserRound; hint: string }[] = [
  { view: "info", label: "Student information", icon: UserRound, hint: "Page 1 · 7.1" },
  { view: "previous", label: "Previous record", icon: BookOpen, hint: "7.2 – 8" },
];
const NAV_AFTER: { view: View; label: string; icon: typeof UserRound; hint: string }[] = [
  { view: "progress", label: "Progress & placements", icon: Briefcase, hint: "Scholarships, internships, jobs" },
  { view: "activities", label: "Activities & discipline", icon: Award, hint: "Achievements, issues" },
  { view: "meetings", label: "Mentor meetings", icon: Users, hint: "6–8 a semester" },
];

export function MenteeRecord({ studentId, studentName, rollNumber }: { studentId: string; studentName: string; rollNumber: string }) {
  const api = `/api/college/mentoring/students/${studentId}`;
  const [view, setView] = useState<View>("info");
  const [meetingSemester, setMeetingSemester] = useState<number | null>(null);
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

  const current = semesters.find((s) => s.isCurrent)?.semester ?? semesters[semesters.length - 1]?.semester ?? null;
  const openMeetings = useCallback((n: number) => { setMeetingSemester(n); setView("meetings"); }, []);
  const list = entries ?? [];

  const renderSections = (keys: readonly string[], numbered?: Record<string, string>) => (
    <div className="space-y-4">
      {keys.map((k) => {
        const s = entrySection(k);
        if (!s) return null;
        return <EntrySectionView key={k} section={numbered ? { ...s, title: `${numbered[k]}. ${s.title}` } : s} entries={list} api={api} editor={editor} />;
      })}
    </div>
  );

  const navButton = (item: { view: View; label: string; icon: typeof UserRound; hint?: string }) => {
    const Icon = item.icon;
    const active = view === item.view;
    return (
      <button
        key={item.view}
        type="button"
        onClick={() => setView(item.view)}
        aria-current={active ? "page" : undefined}
        className={`group flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm whitespace-nowrap transition-colors ${active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="min-w-0">
          <span className="block leading-tight">{item.label}</span>
          {item.hint && <span className="hidden md:block text-[11px] font-normal text-muted-foreground/80 leading-tight">{item.hint}</span>}
        </span>
      </button>
    );
  };

  if (error) return <p className="text-sm text-muted-foreground py-6">{error}</p>;
  if (!entries) return <p className="text-sm text-muted-foreground py-6">Loading the record…</p>;

  return (
    <div className="grid gap-5 md:grid-cols-[230px_minmax(0,1fr)] items-start">
      <nav aria-label="Record pages" className="print:hidden md:sticky md:top-4 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-1 md:pb-0 -mx-1 px-1">
        {NAV.map(navButton)}

        <div className="hidden md:block px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Semesters</div>
        {semesters.length === 0 && <p className="hidden md:block px-3 text-xs text-muted-foreground">No semester has started yet.</p>}
        {semesters.map((s) => navButton({ view: `sem:${s.semester}`, label: s.label, icon: GraduationCap, hint: s.isCurrent ? "Running now" : undefined }))}

        <div className="hidden md:block px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">More</div>
        {NAV_AFTER.map(navButton)}

        <Button variant="outline" size="sm" className="hidden md:inline-flex mt-3 mx-2" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-1.5" /> Print this page
        </Button>
      </nav>

      <div className="min-w-0 space-y-4">
        <div className="hidden print:block">
          <h1 className="text-xl font-bold">Student Mentoring Record</h1>
          <p className="text-sm">{studentName}{rollNumber ? ` · ${rollNumber}` : ""}</p>
        </div>

        {view === "info" && <StudentInfoPage api={api} entries={list} editor={editor} />}
        {view === "previous" && renderSections(PREVIOUS, PREVIOUS_NUMBER)}
        {view.startsWith("sem:") && <SemesterPage api={api} semester={Number(view.slice(4))} onOpenMeetings={openMeetings} />}
        {view === "progress" && renderSections(PROGRESS)}
        {view === "activities" && renderSections(ACTIVITIES)}
        {view === "meetings" && (
          <MeetingsPage api={api} entries={list} editor={editor} semesters={semesters} semester={meetingSemester ?? current} onPickSemester={setMeetingSemester} />
        )}
      </div>
    </div>
  );
}
