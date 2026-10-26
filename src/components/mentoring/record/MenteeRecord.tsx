"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Briefcase, GraduationCap, Printer, Users, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { entrySection } from "@/lib/mentoring/recordSections";
import type { MentoringEntry, MentoringSemesterOption } from "@/types/mentoring";
import { EntrySectionView, type EntryEditor } from "./EntrySection";
import { MeetingsPage } from "./MeetingsPage";
import { SemesterPage } from "./SemesterPage";
import { StudentInfoPage } from "./StudentInfoPage";
import { getJson } from "./recordApi";

// The college's Student Mentoring Record, grouped into four pages so the menu stays short and nothing is dropped:
//   Student profile      = student information (p.1, 7.1) + previous record (7.2 - 8)
//   Semesters            = one semester sheet at a time, picked on the page
//   Progress & activities = progress & placements (p.11) + activities & discipline (p.12)
//   Meetings & follow-up = mentor meetings (p.13-16) + follow-up (actions, weekly check-ins, referrals)
// Everything the system already knows is filled in; the mentor adds what it cannot know.

type View = "profile" | "semesters" | "progress" | "meetings";

const PREVIOUS = ["previousAwards", "previousCoCurricular", "previousExtraCurricular", "healthRecord", "otherInfo"] as const;
const PREVIOUS_NUMBER: Record<string, string> = { previousAwards: "7.2", previousCoCurricular: "7.3", previousExtraCurricular: "7.4", healthRecord: "7.5", otherInfo: "8" };
const PROGRESS = ["scholarships", "internships", "placements", "competitiveExams", "higherStudies"] as const;
const ACTIVITIES = ["achievements", "disciplinary"] as const;
const FOLLOW_UP = ["actionItems", "weeklyAttendance", "escalations"] as const;

const NAV: { view: View; label: string; icon: typeof UserRound; hint: string }[] = [
  { view: "profile", label: "Student profile", icon: UserRound, hint: "Details and previous record" },
  { view: "semesters", label: "Semesters", icon: GraduationCap, hint: "Attendance, marks, grades" },
  { view: "progress", label: "Progress & activities", icon: Briefcase, hint: "Scholarships, jobs, achievements" },
  { view: "meetings", label: "Meetings & follow-up", icon: Users, hint: "Meetings, actions, referrals" },
];

function PartHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold pt-2 border-t first:border-t-0 first:pt-0">{children}</h2>;
}

export function MenteeRecord({ studentId, studentName, rollNumber }: { studentId: string; studentName: string; rollNumber: string }) {
  const api = `/api/college/mentoring/students/${studentId}`;
  const [view, setView] = useState<View>("profile");
  const [meetingSemester, setMeetingSemester] = useState<number | null>(null);
  const [semesterPick, setSemesterPick] = useState<number | null>(null);
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
  const shownSemester = semesterPick ?? current;
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

        <Button variant="outline" size="sm" className="hidden md:inline-flex mt-3 mx-2" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-1.5" /> Print this page
        </Button>
      </nav>

      <div className="min-w-0 space-y-4">
        <div className="hidden print:block">
          <h1 className="text-xl font-bold">Student Mentoring Record</h1>
          <p className="text-sm">{studentName}{rollNumber ? ` · ${rollNumber}` : ""}</p>
        </div>

        {view === "profile" && (
          <>
            <StudentInfoPage api={api} entries={list} editor={editor} />
            <PartHeading>Previous record</PartHeading>
            {renderSections(PREVIOUS, PREVIOUS_NUMBER)}
          </>
        )}
        {view === "semesters" && (
          semesters.length === 0 || shownSemester == null
            ? <p className="text-sm text-muted-foreground py-6">No semester has started for this student yet.</p>
            : (
              <>
                <div className="flex flex-wrap gap-1.5 print:hidden" role="tablist" aria-label="Semester">
                  {semesters.map((s) => (
                    <button
                      key={s.semester}
                      type="button"
                      role="tab"
                      aria-selected={s.semester === shownSemester}
                      onClick={() => setSemesterPick(s.semester)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${s.semester === shownSemester ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}
                    >
                      {s.label}{s.isCurrent && <span className="opacity-70"> · running now</span>}
                    </button>
                  ))}
                </div>
                <SemesterPage key={shownSemester} api={api} semester={shownSemester} onOpenMeetings={openMeetings} />
              </>
            )
        )}
        {view === "progress" && (
          <>
            <PartHeading>Progress & placements</PartHeading>
            {renderSections(PROGRESS)}
            <PartHeading>Activities & discipline</PartHeading>
            {renderSections(ACTIVITIES)}
          </>
        )}
        {view === "meetings" && (
          <>
            <PartHeading>Mentor meetings</PartHeading>
            <MeetingsPage api={api} entries={list} editor={editor} semesters={semesters} semester={meetingSemester ?? current} onPickSemester={setMeetingSemester} />
            <PartHeading>Follow-up</PartHeading>
            {renderSections(FOLLOW_UP)}
          </>
        )}
      </div>
    </div>
  );
}
