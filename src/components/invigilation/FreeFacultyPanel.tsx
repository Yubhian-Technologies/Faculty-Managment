"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { dayLabel, timeLabel } from "@/lib/midTimetable/rules";
import { AVAILABILITY_LABELS, type Availability } from "@/lib/invigilation/eligibility";
import { AVAILABILITY_TONE, designationLabel, type CandidateRow, type Overview } from "./model";

// Exam Cell > Invigilation > Free Faculty: for one exam session, everyone who
// is free for the whole of it (no class, leave or other duty), and everyone
// who isn't - grouped, with the reason. Subjects and rooms don't enter here;
// they are checked per duty on Assign.

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const ORDER: Availability[] = ["AVAILABLE", "NEEDS_OVERRIDE", "NO_TIMETABLE", "PARTIAL", "BUSY", "ON_DUTY", "ON_LEAVE", "SUBJECT", "NOT_ELIGIBLE"];
const sessionLabel = (s: string) => { const [d, t] = s.split("|"); const [f, to] = (t ?? "").split("-"); return `${dayLabel(d)} · ${timeLabel(f)} - ${timeLabel(to)}`; };

export function FreeFacultyPanel({ overview }: { overview: Overview }) {
  const [session, setSession] = useState(overview.sessions[0] ?? "");
  const [rows, setRows] = useState<CandidateRow[] | null>(null);
  const [dept, setDept] = useState("");

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setRows(null);
    fetch(`/api/college/invigilation/schedules/${overview.schedule.id}/candidates?session=${encodeURIComponent(session)}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ candidates?: CandidateRow[]; error?: string }>)
      .then((d) => { if (!cancelled) { if (d.error) throw new Error(d.error); setRows(d.candidates ?? []); } })
      .catch((e) => { if (!cancelled) { setRows([]); toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load" }); } });
    return () => { cancelled = true; };
  }, [overview.schedule.id, session]);

  const departments = useMemo(() => [...new Set((rows ?? []).map((r) => r.department).filter(Boolean))].sort(), [rows]);
  const groups = useMemo(() => {
    const list = (rows ?? []).filter((r) => !dept || r.department === dept);
    return ORDER.map((a) => ({ a, list: list.filter((r) => r.availability === a) })).filter((g) => g.list.length);
  }, [rows, dept]);

  if (!overview.sessions.length) return <Card><CardContent className="p-6 text-sm text-muted-foreground">No exam sessions yet.</CardContent></Card>;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="ff-session">Exam session</Label><select id="ff-session" className={selectClass} value={session} onChange={(e) => setSession(e.target.value)}>{overview.sessions.map((s) => <option key={s} value={s}>{sessionLabel(s)}</option>)}</select></div>
        <div className="space-y-1.5"><Label htmlFor="ff-dept">Department</Label><select id="ff-dept" className={selectClass} value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{departments.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
      </div>
      {rows === null ? <div className="h-40 animate-pulse rounded-md bg-muted/30" /> : (
        <>
          <div className="flex flex-wrap gap-2">{groups.map((g) => <Badge key={g.a} variant={AVAILABILITY_TONE[g.a]}>{AVAILABILITY_LABELS[g.a]}: {g.list.length}</Badge>)}</div>
          {groups.map((g) => (
            <Card key={g.a}>
              <CardContent className="p-0">
                <p className="border-b px-4 py-2 text-sm font-medium">{AVAILABILITY_LABELS[g.a]} ({g.list.length})</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <tbody>
                      {g.list.map((r) => (
                        <tr key={r.facultyId} className="border-b last:border-0 align-top">
                          <td className="w-28 p-2 text-xs text-muted-foreground">{r.employeeId}</td>
                          <td className="p-2"><span className="font-medium">{r.name}</span>{r.roles.length ? <span className="block text-xs text-muted-foreground">{r.roles.join(", ")}</span> : null}</td>
                          <td className="p-2 text-xs">{r.department}<br /><span className="text-muted-foreground">{designationLabel(r.designation)}</span></td>
                          <td className="p-2 text-xs">{r.workload.total} dut{r.workload.total === 1 ? "y" : "ies"}</td>
                          <td className="p-2 text-xs text-muted-foreground">{r.evaluation.issues.map((i) => i.message).join("; ")}{r.evaluation.freeRanges ? ` · free ${r.evaluation.freeRanges.map((f) => `${f.from}-${f.to}`).join(", ")}` : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
