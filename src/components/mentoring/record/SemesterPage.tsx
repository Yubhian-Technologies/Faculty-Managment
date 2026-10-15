"use client";

import { useState } from "react";
import { AlertTriangle, CalendarCheck, CheckCircle2, Info, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { MEETINGS_TARGET, SEMESTER_REMARKS_MAX_LENGTH, formatEntryDate } from "@/lib/mentoring/recordSections";
import { semesterHeading } from "@/lib/mentoring/semesterWindows";
import type { MentoringSemesterSheet, SheetSubject, SubjectsSource } from "@/types/mentoring";
import { percentText, sendJson, useLoaded } from "./recordApi";

// One semester page of the Student Mentoring Record: the student's subjects for that semester (kept
// per student, so an earlier batch never sees a later batch's curriculum), attendance up to Mid I,
// Mid II and the end of the semester, internal marks from the faculty, the Exam Cell's grades,
// backlogs, SGPA / CGPA, and the mentor's remarks.

const LOW_ATTENDANCE = 75;

const SOURCE_STYLE: Record<SubjectsSource, { label: string; className: string }> = {
  SNAPSHOT: { label: "Kept on record", className: "text-emerald-700 dark:text-emerald-400" },
  LIVE: { label: "Current curriculum", className: "text-sky-700 dark:text-sky-400" },
  RESULTS: { label: "Rebuilt from results", className: "text-amber-700 dark:text-amber-400" },
  ATTENDANCE: { label: "From attendance", className: "text-amber-700 dark:text-amber-400" },
  NONE: { label: "Not found", className: "text-red-600" },
};

function Att({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return <span className={value < LOW_ATTENDANCE ? "text-red-600 font-medium" : ""}>{percentText(value)}</span>;
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold tabular-nums leading-tight mt-0.5 ${tone === "bad" ? "text-red-600" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

function InternalCell({ internal }: { internal: SheetSubject["internal"] }) {
  if (!internal) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="min-w-[8rem]">
      <p className="font-medium tabular-nums">
        {internal.total ?? "—"}{internal.maxTotal != null ? <span className="text-muted-foreground font-normal"> / {internal.maxTotal}</span> : null}
      </p>
      {internal.components.length > 0 && (
        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
          {internal.components.map((c) => `${c.name} ${c.marks ?? "—"}${c.maxMarks != null ? `/${c.maxMarks}` : ""}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

export function SemesterPage({
  api, semester, onOpenMeetings,
}: { api: string; semester: number; onOpenMeetings: (semester: number) => void }) {
  const { data, error, loading } = useLoaded<{ sheet: MentoringSemesterSheet }>(`${api}?part=sheet&semester=${semester}`);
  const sheet = data?.sheet.semester === semester ? data.sheet : null;

  if (error && !sheet) return <p className="text-sm text-muted-foreground py-6">{error}</p>;
  if (!sheet) return <p className="text-sm text-muted-foreground py-6">{loading ? "Loading this semester…" : "Nothing to show."}</p>;
  // Remounts the remarks box when another semester's sheet arrives.
  return <Sheet key={sheet.semester} api={api} sheet={sheet} stale={loading} onOpenMeetings={onOpenMeetings} />;
}

function Sheet({ api, sheet, stale, onOpenMeetings }: { api: string; sheet: MentoringSemesterSheet; stale: boolean; onOpenMeetings: (s: number) => void }) {
  const src = SOURCE_STYLE[sheet.subjectsSource];
  const o = sheet.overall;
  const fmt = (v: number | null, withheld: boolean) => (withheld ? "Withheld" : v == null ? "—" : v.toFixed(o.decimals));
  const totalCredits = sheet.subjects.reduce((n, s) => n + (s.credits ?? 0), 0);
  const metTarget = sheet.meetingCount >= MEETINGS_TARGET.min;

  return (
    <div className={`space-y-4 ${stale ? "opacity-60 transition-opacity" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">Record of {semesterHeading(sheet.semester, sheet.year, sheet.inYear)}</h2>
        {sheet.isCurrent && <Badge>Running now</Badge>}
        <span className="text-sm text-muted-foreground">
          {[sheet.academicYear && `Academic year ${sheet.academicYear}`, sheet.regulation && `Regulation ${sheet.regulation}`,
            sheet.startDate && sheet.endDate && `${formatEntryDate(sheet.startDate)} to ${formatEntryDate(sheet.endDate)}`].filter(Boolean).join(" · ")}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="SGPA" value={o.published ? fmt(o.sgpa, o.sgpaWithheld) : "—"} sub={o.published ? undefined : "Results not published"} />
        <Stat label="CGPA" value={o.published ? fmt(o.cgpa, o.cgpaWithheld) : "—"} sub={o.published ? "Up to this semester" : undefined} />
        <Stat label="Credits" value={o.published ? `${o.creditsEarned}` : `${totalCredits || "—"}`} sub={o.published ? `earned of ${o.creditsRegistered} registered` : "this semester"} />
        <Stat label="Backlogs" value={o.published ? String(o.backlogCodes.length) : "—"} tone={o.backlogCodes.length > 0 ? "bad" : undefined} sub={o.backlogCodes.length > 0 ? o.backlogCodes.join(", ") : o.published ? "None up to this semester" : undefined} />
      </div>

      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-base">Details of academic performance</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {sheet.subjects.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">{sheet.subjectsNote}</p>
          ) : (
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-left text-muted-foreground border-b align-bottom">
                  <th className="py-2 pr-3 font-medium">Course</th>
                  <th className="py-2 pr-3 font-medium text-right">Credits</th>
                  <th className="py-2 pr-3 font-medium text-right">
                    % Att. Mid I
                    {sheet.attendanceTo.mid1 && <span className="block text-[10px] font-normal">till {formatEntryDate(sheet.attendanceTo.mid1)}</span>}
                  </th>
                  <th className="py-2 pr-3 font-medium text-right">
                    % Att. Mid II
                    {sheet.attendanceTo.mid2 && <span className="block text-[10px] font-normal">till {formatEntryDate(sheet.attendanceTo.mid2)}</span>}
                  </th>
                  <th className="py-2 pr-3 font-medium text-right">
                    % Att. {sheet.isCurrent ? "so far" : "end of sem."}
                    {sheet.attendanceTo.end && <span className="block text-[10px] font-normal">till {formatEntryDate(sheet.attendanceTo.end)}</span>}
                  </th>
                  <th className="py-2 pr-3 font-medium">Internal marks</th>
                  <th className="py-2 font-medium">End sem. grade</th>
                </tr>
              </thead>
              <tbody>
                {sheet.subjects.map((s) => (
                  <tr key={s.subjectId || s.code} className="border-b last:border-0 align-top">
                    <td className="py-2.5 pr-3">
                      <p className="font-medium leading-tight">{s.name || s.code}</p>
                      <p className="text-xs text-muted-foreground">{s.code}</p>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{s.credits ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums"><Att value={s.attendance.mid1} /></td>
                    <td className="py-2.5 pr-3 text-right tabular-nums"><Att value={s.attendance.mid2} /></td>
                    <td className="py-2.5 pr-3 text-right tabular-nums"><Att value={s.attendance.end} /></td>
                    <td className="py-2.5 pr-3"><InternalCell internal={s.internal} /></td>
                    <td className="py-2.5">
                      {s.grade
                        ? <span className={`font-semibold ${s.grade.isPass ? "" : "text-red-600"}`}>{s.grade.grade}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold border-t-2">
                  <td className="py-2.5 pr-3">Overall</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{totalCredits || "—"}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums"><Att value={sheet.attendanceOverall.mid1} /></td>
                  <td className="py-2.5 pr-3 text-right tabular-nums"><Att value={sheet.attendanceOverall.mid2} /></td>
                  <td className="py-2.5 pr-3 text-right tabular-nums"><Att value={sheet.attendanceOverall.end} /></td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          )}
          <p className={`mt-3 flex items-start gap-1.5 text-xs ${src.className}`}>
            <Info className="h-3.5 w-3.5 mt-px shrink-0" />
            <span><strong>{src.label}.</strong> <span className="text-muted-foreground">{sheet.subjectsNote}</span></span>
          </p>
          {!sheet.mids.mid1 && !sheet.mids.mid2 && sheet.subjects.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">Mid I and Mid II attendance appear once the Exam Cell publishes the mid exam dates for this semester.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-base">Backlog subjects information</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {sheet.backlogs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2 flex items-center gap-1.5">
              {o.published ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> No backlog in this semester.</> : "Appears once this semester's results are published."}
            </p>
          ) : (
            <table className="w-full text-sm min-w-[480px]">
              <thead><tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3 font-medium">Course</th>
                <th className="py-2 font-medium">Attempts (Regular, then each supplementary)</th>
              </tr></thead>
              <tbody>
                {sheet.backlogs.map((b) => (
                  <tr key={b.code} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-3"><p className="font-medium leading-tight">{b.name || b.code}</p><p className="text-xs text-muted-foreground">{b.code}</p></td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {b.attempts.map((a, i) => (
                          <Badge key={i} variant={a.isPass ? "secondary" : "destructive"} className="font-normal">{a.label}: <strong className="ml-1">{a.grade}</strong></Badge>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Remarks api={api} sheet={sheet} />

      <button
        type="button"
        onClick={() => onOpenMeetings(sheet.semester)}
        className="w-full flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-left hover:bg-muted/50 print:hidden"
      >
        <span className="flex items-center gap-2 text-sm">
          {metTarget ? <CalendarCheck className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
          <span><strong>{sheet.meetingCount}</strong> mentor meeting{sheet.meetingCount === 1 ? "" : "s"} recorded this semester
            <span className="text-muted-foreground"> · the booklet asks for {MEETINGS_TARGET.min} to {MEETINGS_TARGET.max}</span></span>
        </span>
        <span className="text-xs text-primary">Open meetings →</span>
      </button>
    </div>
  );
}

function Remarks({ api, sheet }: { api: string; sheet: MentoringSemesterSheet }) {
  const [text, setText] = useState(sheet.remarks?.text ?? "");
  const [saved, setSaved] = useState(sheet.remarks);
  const [saving, setSaving] = useState(false);
  const dirty = text.trim() !== (saved?.text ?? "");

  async function save() {
    setSaving(true);
    try {
      const d = await sendJson<{ remarks: MentoringSemesterSheet["remarks"] }>(`${api}/record/semester`, "PATCH", { semester: sheet.semester, remarks: text });
      setSaved(d.remarks);
      setText(d.remarks?.text ?? "");
      toast({ title: "Remarks saved" });
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-1"><CardTitle className="text-base">Remarks of the mentor on attendance and performance</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <Textarea value={text} rows={4} maxLength={SEMESTER_REMARKS_MAX_LENGTH} placeholder="Attendance, performance, and what the student should work on this semester…" onChange={(e) => setText(e.target.value)} className="print:hidden" />
        <p className="hidden print:block text-sm whitespace-pre-wrap min-h-24">{text}</p>
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <span className="text-xs text-muted-foreground">
            {saved ? `Last saved by ${saved.byName}${saved.at ? ` · ${new Date(saved.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : ""}` : "Visible to this student's mentor and HOD only."}
          </span>
          <Button size="sm" onClick={save} disabled={saving || !dirty}><Save className="h-4 w-4 mr-1" /> {saving ? "Saving…" : "Save remarks"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
