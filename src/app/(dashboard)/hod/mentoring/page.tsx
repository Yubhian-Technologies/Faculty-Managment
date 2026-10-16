"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { MenteeList } from "@/components/mentoring/MenteeList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { Section } from "@/types";
import type { MenteeSummary, MentorOption } from "@/types/mentoring";

type View = "assign" | "mentors" | "mine";
const VIEWS: { key: View; label: string }[] = [
  { key: "assign", label: "Assign Students" },
  { key: "mentors", label: "Mentors" },
  { key: "mine", label: "My Mentees" },
];

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Could not load this");
  return data;
}

export default function HodMentoringPage() {
  const [view, setView] = useState<View>("assign");
  const [mentors, setMentors] = useState<MentorOption[]>([]);
  const [mentorsError, setMentorsError] = useState<string | null>(null);

  const loadMentors = useCallback(() => {
    getJson<{ mentors: MentorOption[] }>("/api/college/mentoring/mentors")
      .then((d) => setMentors(d.mentors))
      .catch((e: Error) => setMentorsError(e.message));
  }, []);
  useEffect(() => { loadMentors(); }, [loadMentors]);

  return (
    <div>
      <PageHeader
        title="Mentoring"
        description="Assign students to a faculty member who follows their progress - profile, attendance, results and internal marks."
      />
      <div className="flex flex-wrap gap-1 border-b mb-4">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${view === v.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {mentorsError && <p className="text-sm text-red-600 mb-3">{mentorsError}</p>}
      {view === "assign" && <AssignView mentors={mentors} onChanged={loadMentors} />}
      {view === "mentors" && <MentorsView mentors={mentors} />}
      {view === "mine" && <MyMenteesView />}
    </div>
  );
}

interface RollPlanRow { roll: string; status: "ASSIGN" | "ALREADY_MENTEE" | "HAS_OTHER_MENTOR" | "NOT_FOUND" | "OUTSIDE_DEPARTMENT" | "GRADUATED"; studentId?: string; name?: string; section?: string; year?: number; message?: string }
interface RollCheck { ok: boolean; mentor: { uid: string; name: string }; plan: RollPlanRow[]; counts: { toAssign: number; alreadyMentee: number; problems: number; repeatedInList: number } }

const ROLL_STATUS: Record<RollPlanRow["status"], { label: string; className: string }> = {
  ASSIGN: { label: "Will be assigned", className: "text-green-700 dark:text-green-400" },
  ALREADY_MENTEE: { label: "Already with this mentor", className: "text-muted-foreground" },
  HAS_OTHER_MENTOR: { label: "Has another mentor", className: "text-red-600" },
  NOT_FOUND: { label: "Not found", className: "text-red-600" },
  OUTSIDE_DEPARTMENT: { label: "Not your department", className: "text-red-600" },
  GRADUATED: { label: "Graduated", className: "text-red-600" },
};

// Mentor + pasted roll numbers, like assigning subjects by code: check what each roll comes to, then
// assign. One roll that cannot be assigned and nothing is saved. A student who already has a mentor must
// have that mentor removed first (the Remove link in the section list below) - their record stays.
function AssignView({ mentors, onChanged }: { mentors: MentorOption[]; onChanged: () => void }) {
  const [mentorUid, setMentorUid] = useState("");
  const [rollText, setRollText] = useState("");
  const [check, setCheck] = useState<{ result: RollCheck; forKey: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState("");

  const [sections, setSections] = useState<Section[]>([]);
  const [courseKey, setCourseKey] = useState("");
  const [yearKey, setYearKey] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [students, setStudents] = useState<MenteeSummary[] | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    fetch("/api/college/sections")
      .then((r) => r.json() as Promise<{ sections?: Section[] }>)
      .then((d) => setSections(d.sections ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load sections" }));
  }, []);

  const loadStudents = useCallback(async (id: string) => {
    setStudents(null);
    try {
      const d = await getJson<{ students: MenteeSummary[] }>(`/api/college/mentoring/students?sectionId=${encodeURIComponent(id)}`);
      setStudents(d.students);
    } catch (e) {
      setStudents([]);
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load students" });
    }
  }, []);

  useEffect(() => { if (sectionId) void loadStudents(sectionId); }, [sectionId, loadStudents]);

  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => (a.courseName ?? "").localeCompare(b.courseName ?? "") || a.year - b.year || a.name.localeCompare(b.name)),
    [sections]
  );

  // Course -> Year -> Section, each narrowing the next; a section's own list loads once all three are picked.
  const courseOf = (s: Section) => s.courseName || "-";
  const courseNames = useMemo(() => [...new Set(sections.map(courseOf))].sort((a, b) => a.localeCompare(b)), [sections]);
  const yearOptions = useMemo(
    () => [...new Set(sections.filter((s) => courseOf(s) === courseKey).map((s) => s.year))].sort((a, b) => a - b),
    [sections, courseKey]
  );
  const sectionOptions = useMemo(
    () => sortedSections.filter((s) => courseOf(s) === courseKey && String(s.year) === yearKey),
    [sortedSections, courseKey, yearKey]
  );
  // Two departments can each run a section with the same name, so the department is shown when names repeat.
  const sectionLabel = (s: Section) => (sectionOptions.filter((o) => o.name === s.name).length > 1 ? `${s.name} · ${s.department}` : s.name);
  const withoutMentor = useMemo(() => (students ?? []).filter((s) => !s.mentorUid && s.rollNumber), [students]);

  function addToRollBox() {
    const have = new Set(rollText.split(/[\s,;]+/).map((r) => r.trim().toUpperCase()).filter(Boolean));
    const add = withoutMentor.map((s) => s.rollNumber).filter((r) => !have.has(r.toUpperCase()));
    if (add.length === 0) return;
    setRollText((t) => `${t.trim() ? `${t.trim()}\n` : ""}${add.join("\n")}`);
  }

  const key = `${mentorUid}|${rollText.trim()}`;
  const fresh = !!check && check.forKey === key;
  const canAssign = fresh && check!.result.ok && check!.result.counts.toAssign > 0 && !assigning;

  async function post(mode: "validate" | "commit") {
    const res = await fetch("/api/college/mentoring/assign-by-roll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, mentorUid, rollNumbers: rollText }),
    });
    return (await res.json().catch(() => ({}))) as Partial<RollCheck> & { error?: string };
  }

  async function runCheck() {
    if (!mentorUid || !rollText.trim()) return;
    setChecking(true);
    setError("");
    try {
      const json = await post("validate");
      if (json.plan) setCheck({ result: json as RollCheck, forKey: key });
      else { setCheck(null); setError(json.error ?? "Couldn't check the roll numbers."); }
    } catch {
      setError("Network error while checking the roll numbers.");
    } finally {
      setChecking(false);
    }
  }

  async function runAssign() {
    if (!canAssign) return;
    setAssigning(true);
    setError("");
    try {
      const json = await post("commit");
      if (json.plan && json.ok) {
        const n = json.counts?.toAssign ?? 0;
        toast({ variant: "success", title: n > 0 ? `${n} student${n === 1 ? "" : "s"} assigned to ${json.mentor?.name ?? "the mentor"}` : "Nothing new to assign" });
        setRollText("");
        setCheck(null);
        onChanged();
        if (sectionId) void loadStudents(sectionId);
      } else if (json.plan) {
        setCheck({ result: json as RollCheck, forKey: key });
        setError("Nothing was assigned. Fix the roll numbers marked below and check again.");
      } else {
        setError(json.error ?? "Couldn't assign the students. Nothing was saved.");
      }
    } catch {
      setError("Network error. Nothing was saved.");
    } finally {
      setAssigning(false);
    }
  }

  async function removeMentor(studentId: string) {
    setRemoving(true);
    try {
      const res = await fetch("/api/college/mentoring/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mentorUid: null, studentIds: [studentId] }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || "Could not remove the mentor");
      toast({ title: "Mentor removed - the mentoring record stays with the student" });
      if (sectionId) await loadStudents(sectionId);
      onChanged();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not remove the mentor" });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="w-full max-w-md">
            <p className="text-xs text-muted-foreground mb-1">Mentor</p>
            <Select value={mentorUid} onValueChange={setMentorUid}>
              <SelectTrigger><SelectValue placeholder="Pick a faculty member" /></SelectTrigger>
              <SelectContent>
                {mentors.map((m) => (
                  <SelectItem key={m.uid} value={m.uid}>{`${m.name}${m.isSelf ? " (You)" : ""} · ${m.menteeCount} mentee${m.menteeCount === 1 ? "" : "s"}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Roll numbers</p>
            <Textarea
              rows={6}
              value={rollText}
              disabled={!mentorUid}
              onChange={(e) => setRollText(e.target.value)}
              placeholder={mentorUid ? "24A91A0514\n24A91A0515\n24A91A0516" : "Pick the mentor first"}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              One roll number per line, or separated by commas or spaces - up to 200. These students become this mentor&apos;s mentees.
              A student who already has a mentor has to be removed from that mentor first (list below).
            </p>
          </div>

          {error && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-destructive/20 dark:bg-destructive/10 dark:text-red-400">{error}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => void runCheck()} loading={checking} disabled={!mentorUid || !rollText.trim() || assigning}>Check roll numbers</Button>
            <Button onClick={() => void runAssign()} loading={assigning} disabled={!canAssign}>
              {fresh && check!.result.counts.toAssign > 0 ? `Assign ${check!.result.counts.toAssign} student${check!.result.counts.toAssign === 1 ? "" : "s"}` : "Assign"}
            </Button>
            {check && !fresh && <span className="text-xs text-muted-foreground">The mentor or roll numbers changed - check again.</span>}
          </div>

          {check && (
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="p-2">Roll No</th><th className="p-2">Student</th><th className="p-2">Result</th></tr>
                </thead>
                <tbody className="divide-y">
                  {check.result.plan.map((p) => (
                    <tr key={p.roll}>
                      <td className="p-2 font-mono">{p.roll}</td>
                      <td className="p-2">{p.name ? `${p.name}${p.section ? ` · ${p.section}` : ""}` : "-"}</td>
                      <td className={`p-2 ${ROLL_STATUS[p.status].className}`}>
                        <span className="inline-flex items-start gap-1">
                          {p.status === "ASSIGN" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : p.status === "ALREADY_MENTEE" ? null : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                          {ROLL_STATUS[p.status].label}{p.message && p.status !== "ASSIGN" ? ` - ${p.message}` : ""}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {check.result.counts.repeatedInList > 0 && (
                <p className="border-t p-2 text-xs text-muted-foreground">{check.result.counts.repeatedInList} repeated roll number{check.result.counts.repeatedInList === 1 ? "" : "s"} in the list ignored.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Who has a mentor - filter by course, year and section</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <p className="text-xs text-muted-foreground mb-1">Course</p>
            <Select value={courseKey} onValueChange={(v) => { setCourseKey(v); setYearKey(""); setSectionId(""); setStudents(null); }}>
              <SelectTrigger><SelectValue placeholder="Pick a course" /></SelectTrigger>
              <SelectContent>
                {courseNames.map((c) => <SelectItem key={c} value={c}>{c === "-" ? "No course set" : c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-36">
            <p className="text-xs text-muted-foreground mb-1">Year</p>
            <Select value={yearKey} disabled={!courseKey} onValueChange={(v) => { setYearKey(v); setSectionId(""); setStudents(null); }}>
              <SelectTrigger><SelectValue placeholder="Pick a year" /></SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{`Year ${y}`}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-56">
            <p className="text-xs text-muted-foreground mb-1">Section</p>
            <Select value={sectionId} disabled={!yearKey} onValueChange={setSectionId}>
              <SelectTrigger><SelectValue placeholder="Pick a section" /></SelectTrigger>
              <SelectContent>
                {sectionOptions.map((o) => <SelectItem key={o.id} value={o.id}>{sectionLabel(o)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {sectionId && students && withoutMentor.length > 0 && (
            <Button variant="outline" size="sm" disabled={!mentorUid} onClick={addToRollBox} title={mentorUid ? undefined : "Pick the mentor above first"}>
              Add the {withoutMentor.length} without a mentor to the roll numbers
            </Button>
          )}
        </div>
        {sectionId && !students && <p className="text-sm text-muted-foreground">Loading…</p>}
        {sectionId && students && students.length === 0 && <p className="text-sm text-muted-foreground">No students in this section.</p>}
        {sectionId && students && students.length > 0 && (
          <Card>
            <CardContent className="pt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 pr-3 font-medium">Roll No</th>
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 font-medium">Mentor</th>
                </tr></thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 tabular-nums">{s.rollNumber || "—"}</td>
                      <td className="py-2 pr-3">
                        <Link href={`/hod/mentoring/${s.id}`} className="hover:underline">{s.name}</Link>
                      </td>
                      <td className="py-2">
                        {s.mentorName ? (
                          <span className="inline-flex items-center gap-2">
                            <Badge variant="secondary">{s.mentorName}</Badge>
                            <button type="button" disabled={removing} onClick={() => void removeMentor(s.id)} className="text-xs text-destructive hover:underline disabled:opacity-50">Remove</button>
                          </span>
                        ) : <span className="text-muted-foreground">Not assigned</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function MentorsView({ mentors }: { mentors: MentorOption[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [menteesByMentor, setMenteesByMentor] = useState<Record<string, MenteeSummary[]>>({});

  async function toggle(uid: string) {
    if (open === uid) { setOpen(null); return; }
    setOpen(uid);
    if (menteesByMentor[uid]) return;
    try {
      const d = await getJson<{ students: MenteeSummary[] }>(`/api/college/mentoring/students?mentorUid=${encodeURIComponent(uid)}`);
      setMenteesByMentor((prev) => ({ ...prev, [uid]: d.students }));
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load mentees" });
    }
  }

  if (mentors.length === 0) {
    return <p className="text-sm text-muted-foreground">No available faculty with a login in your department.</p>;
  }
  return (
    <div className="space-y-2">
      {mentors.map((m) => (
        <Card key={m.uid}>
          <CardContent className="pt-4">
            <button type="button" onClick={() => toggle(m.uid)} className="w-full flex items-center justify-between gap-3 text-left">
              <span>
                <span className="font-medium">{m.name}</span>
                <span className="text-sm text-muted-foreground"> · {m.designation || m.department}</span>
              </span>
              <Badge variant={m.menteeCount > 0 ? "secondary" : "outline"}>{m.menteeCount} mentee{m.menteeCount === 1 ? "" : "s"}</Badge>
            </button>
            {open === m.uid && (
              <div className="mt-3">
                {!menteesByMentor[m.uid]
                  ? <p className="text-sm text-muted-foreground">Loading…</p>
                  : <MenteeList students={menteesByMentor[m.uid]} basePath="/hod/mentoring" empty="No students assigned." />}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MyMenteesView() {
  const [students, setStudents] = useState<MenteeSummary[] | null>(null);
  useEffect(() => {
    getJson<{ students: MenteeSummary[] }>("/api/college/mentoring/my-mentees")
      .then((d) => setStudents(d.students))
      .catch((e: Error) => { setStudents([]); toast({ variant: "destructive", title: e.message }); });
  }, []);
  if (!students) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return <MenteeList students={students} basePath="/hod/mentoring" empty="No students have been assigned to you for mentoring." />;
}
