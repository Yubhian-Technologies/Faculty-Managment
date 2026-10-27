"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/shared/PageHeader";
import { MenteeList } from "@/components/mentoring/MenteeList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { MenteeSummary, MentorOption } from "@/types/mentoring";

type View = "assign" | "browse" | "mine";
const VIEWS: { key: View; label: string }[] = [
  { key: "assign", label: "Assign Students" },
  { key: "browse", label: "Students & Mentors" },
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
        description="Assign faculty mentors to students and monitor their academic progress, attendance, results, and internal assessment performance."
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
      {view === "assign" && <AssignView onChanged={loadMentors} />}
      {view === "browse" && <BrowseView mentors={mentors} />}
      {view === "mine" && <MyMenteesView />}
    </div>
  );
}

type MentorFilter = "all" | "unassigned" | "assigned";
const MENTOR_FILTERS: { key: MentorFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unassigned", label: "Not assigned" },
  { key: "assigned", label: "Assigned" },
];

interface AssignSection { id: string; name: string; year: number; department: string; courseId: string; courseName: string }

// Course -> Year -> Section, then the mentor, then tick the students (search by name or Regd. No).
// Only sections whose year this HOD runs are offered (a year another department runs is that HOD's to
// assign). The mentor list puts the faculty who teach the chosen class first. A student who already has
// a mentor shows only when the filter asks for them, and cannot be ticked: remove that mentor first
// (the mentoring record stays).
function AssignView({ onChanged }: { onChanged: () => void }) {
  const [sections, setSections] = useState<AssignSection[]>([]);
  const [courseKey, setCourseKey] = useState("");
  const [yearKey, setYearKey] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [mentors, setMentors] = useState<MentorOption[]>([]);
  const [mentorUid, setMentorUid] = useState("");
  const [students, setStudents] = useState<MenteeSummary[] | null>(null);
  const [search, setSearch] = useState("");
  const [mentorFilter, setMentorFilter] = useState<MentorFilter>("unassigned");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    getJson<{ sections: AssignSection[] }>("/api/college/mentoring/sections")
      .then((d) => setSections(d.sections))
      .catch((e: Error) => toast({ variant: "destructive", title: e.message }));
  }, []);

  const courseOf = (s: AssignSection) => s.courseName || "-";
  const courseNames = useMemo(() => [...new Set(sections.map(courseOf))].sort((a, b) => a.localeCompare(b)), [sections]);
  const yearOptions = useMemo(
    () => [...new Set(sections.filter((s) => courseOf(s) === courseKey).map((s) => s.year))].sort((a, b) => a - b),
    [sections, courseKey]
  );
  const sectionOptions = useMemo(
    () => sections.filter((s) => courseOf(s) === courseKey && String(s.year) === yearKey),
    [sections, courseKey, yearKey]
  );
  // Two departments can each run a section with the same name, so the department is shown when names repeat.
  const sectionLabel = (s: AssignSection) => (sectionOptions.filter((o) => o.name === s.name).length > 1 ? `${s.name} · ${s.department}` : s.name);

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

  const loadMentors = useCallback((id: string) => {
    getJson<{ mentors: MentorOption[] }>(`/api/college/mentoring/mentors?sectionId=${encodeURIComponent(id)}`)
      .then((d) => setMentors(d.mentors))
      .catch((e: Error) => toast({ variant: "destructive", title: e.message }));
  }, []);

  function pickSection(id: string) {
    setSectionId(id);
    setPicked(new Set());
    setMentorUid("");
    setSearch("");
    void loadStudents(id);
    loadMentors(id);
  }

  function resetBelow() {
    setSectionId("");
    setStudents(null);
    setMentors([]);
    setMentorUid("");
    setPicked(new Set());
  }

  const shown = useMemo(() => {
    const q = search.trim().toUpperCase();
    return (students ?? []).filter((s) => {
      if (mentorFilter === "assigned" && !s.mentorUid) return false;
      if (mentorFilter === "unassigned" && s.mentorUid) return false;
      if (q && !s.rollNumber.toUpperCase().includes(q) && !s.name.toUpperCase().includes(q)) return false;
      return true;
    });
  }, [students, search, mentorFilter]);

  const pickable = useMemo(() => shown.filter((s) => !s.mentorUid), [shown]);
  const allTicked = pickable.length > 0 && pickable.every((s) => picked.has(s.id));
  const teachingMentors = mentors.filter((m) => m.teaches);
  const otherMentors = mentors.filter((m) => !m.teaches);
  const mentorLabel = (m: MentorOption) => `${m.name}${m.isSelf ? " (You)" : ""} · ${m.menteeCount} mentee${m.menteeCount === 1 ? "" : "s"}`;

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setPicked((prev) => {
      const next = new Set(prev);
      if (allTicked) pickable.forEach((s) => next.delete(s.id));
      else pickable.forEach((s) => next.add(s.id));
      return next;
    });
  }

  async function post(body: unknown) {
    const res = await fetch("/api/college/mentoring/assign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = (await res.json().catch(() => ({}))) as { assigned?: string[]; skipped?: { id: string; reason: string }[]; error?: string };
    if (!res.ok) throw new Error(d.error || "Couldn't save the change");
    return d;
  }

  async function assign() {
    if (!mentorUid || picked.size === 0) return;
    setAssigning(true);
    try {
      const d = await post({ mentorUid, studentIds: [...picked] });
      const n = d.assigned?.length ?? 0;
      const skipped = d.skipped?.length ?? 0;
      toast({
        variant: skipped > 0 ? "destructive" : "success",
        title: `${n} student${n === 1 ? "" : "s"} assigned${skipped > 0 ? `, ${skipped} skipped (${d.skipped![0].reason})` : ""}`,
      });
      setPicked(new Set());
      onChanged();
      loadMentors(sectionId);
      await loadStudents(sectionId);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't assign the students" });
    } finally {
      setAssigning(false);
    }
  }

  async function removeMentor(studentId: string) {
    setRemoving(true);
    try {
      await post({ mentorUid: null, studentIds: [studentId] });
      toast({ title: "Mentor removed - the mentoring record stays with the student" });
      loadMentors(sectionId);
      await loadStudents(sectionId);
      onChanged();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not remove the mentor" });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <p className="text-xs text-muted-foreground mb-1">Course</p>
              <Select value={courseKey} onValueChange={(v) => { setCourseKey(v); setYearKey(""); resetBelow(); }}>
                <SelectTrigger><SelectValue placeholder="Pick a course" /></SelectTrigger>
                <SelectContent>
                  {courseNames.map((c) => <SelectItem key={c} value={c}>{c === "-" ? "No course set" : c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-36">
              <p className="text-xs text-muted-foreground mb-1">Year</p>
              <Select value={yearKey} disabled={!courseKey} onValueChange={(v) => { setYearKey(v); resetBelow(); }}>
                <SelectTrigger><SelectValue placeholder="Pick a year" /></SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{`Year ${y}`}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-56">
              <p className="text-xs text-muted-foreground mb-1">Section</p>
              <Select value={sectionId} disabled={!yearKey} onValueChange={pickSection}>
                <SelectTrigger><SelectValue placeholder="Pick a section" /></SelectTrigger>
                <SelectContent>
                  {sectionOptions.map((o) => <SelectItem key={o.id} value={o.id}>{sectionLabel(o)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full max-w-xs">
              <p className="text-xs text-muted-foreground mb-1">Mentor</p>
              <Select value={mentorUid} disabled={!sectionId} onValueChange={setMentorUid}>
                <SelectTrigger><SelectValue placeholder={sectionId ? "Pick a faculty member" : "Pick the section first"} /></SelectTrigger>
                <SelectContent>
                  {teachingMentors.length > 0 && <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Teaching this class</div>}
                  {teachingMentors.map((m) => <SelectItem key={m.uid} value={m.uid}>{mentorLabel(m)}</SelectItem>)}
                  {otherMentors.length > 0 && <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Other faculty of the department</div>}
                  {otherMentors.map((m) => <SelectItem key={m.uid} value={m.uid}>{mentorLabel(m)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Only sections whose year you run are listed - a year another department runs (the shared first year) is assigned by that department&apos;s HOD.
            A student who already has a mentor must be removed from that mentor first.
          </p>
        </CardContent>
      </Card>

      {!sectionId && <p className="text-sm text-muted-foreground">{sections.length === 0 ? "No sections of yours to assign." : <><span className="font-medium text-foreground">No Section Selected.</span> Select a course, year, and section to view students and assign faculty mentors.</>}</p>}
      {sectionId && !students && <p className="text-sm text-muted-foreground">Loading…</p>}

      {sectionId && students && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-64">
              <p className="text-xs text-muted-foreground mb-1">Search</p>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or Regd. No" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Mentor status</p>
              <div className="flex gap-1.5">
                {MENTOR_FILTERS.map((f) => (
                  <Button key={f.key} size="sm" variant={mentorFilter === f.key ? "default" : "outline"} onClick={() => setMentorFilter(f.key)}>{f.label}</Button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{shown.length} of {students.length} student{students.length === 1 ? "" : "s"} · {picked.size} selected</p>
            <Button onClick={() => void assign()} loading={assigning} disabled={!mentorUid || picked.size === 0 || assigning} title={mentorUid ? undefined : "Pick the mentor first"}>
              {picked.size > 0 ? `Assign ${picked.size} student${picked.size === 1 ? "" : "s"}` : "Assign"}
            </Button>
          </div>

          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">{students.length === 0 ? "No students in this section." : "No students match."}</p>
          ) : (
            <Card>
              <CardContent className="pt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-3 w-8">
                      <Checkbox checked={allTicked} disabled={pickable.length === 0} onCheckedChange={toggleAll} aria-label="Select all shown without a mentor" />
                    </th>
                    <th className="py-2 pr-3 font-medium">Regd. No</th>
                    <th className="py-2 pr-3 font-medium">Name</th>
                    <th className="py-2 font-medium">Mentor</th>
                  </tr></thead>
                  <tbody>
                    {shown.map((s) => (
                      <tr key={s.id} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <Checkbox checked={picked.has(s.id)} disabled={!!s.mentorUid} onCheckedChange={() => toggle(s.id)} aria-label={`Select ${s.name}`} />
                        </td>
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
      )}
    </div>
  );
}

// One place to look students and mentors up: filter by course, year, section and mentor (all optional),
// by assigned / not assigned, or just search a name or Regd. No. Every row opens the student's
// mentoring details. Shows any student the HOD may view (the shared first year included).
function BrowseView({ mentors }: { mentors: MentorOption[] }) {
  const [sections, setSections] = useState<AssignSection[]>([]);
  const [courseKey, setCourseKey] = useState("all");
  const [yearKey, setYearKey] = useState("all");
  const [sectionId, setSectionId] = useState("all");
  const [mentorUid, setMentorUid] = useState("all");
  const [mentorFilter, setMentorFilter] = useState<MentorFilter>("all");
  const [search, setSearch] = useState("");
  const [fetched, setFetched] = useState<{ key: string; students: MenteeSummary[] } | null>(null);
  const [sectionsLoaded, setSectionsLoaded] = useState(false);

  useEffect(() => {
    getJson<{ sections: AssignSection[] }>("/api/college/mentoring/sections?for=view")
      .then((d) => setSections(d.sections))
      .catch((e: Error) => toast({ variant: "destructive", title: `Could not load your classes: ${e.message}` }))
      .finally(() => setSectionsLoaded(true));
  }, []);

  const courseOf = (s: AssignSection) => s.courseName || "-";
  const courseNames = useMemo(() => [...new Set(sections.map(courseOf))].sort((a, b) => a.localeCompare(b)), [sections]);
  const inCourse = useMemo(() => sections.filter((s) => courseKey === "all" || courseOf(s) === courseKey), [sections, courseKey]);
  const yearOptions = useMemo(() => [...new Set(inCourse.map((s) => s.year))].sort((a, b) => a - b), [inCourse]);
  const sectionOptions = useMemo(() => inCourse.filter((s) => yearKey === "all" || String(s.year) === yearKey), [inCourse, yearKey]);
  const sectionLabel = (s: AssignSection) => `${s.name} · ${s.department}${yearKey === "all" ? ` · Y${s.year}` : ""}`;

  const q = search.trim();
  const narrowed = courseKey !== "all" || yearKey !== "all" || sectionId !== "all";
  // What to ask the server for: the chosen section(s) when the class is narrowed, else the mentor's
  // mentees, else a name / Regd. No search. Everything else is a filter over what comes back.
  const plan = useMemo(() => {
    const classUrl = (id: string) => `/api/college/mentoring/students?for=view&sectionId=${encodeURIComponent(id)}`;
    if (sectionId !== "all") return { key: `s:${sectionId}`, urls: [classUrl(sectionId)] };
    if (narrowed) {
      const ids = sectionOptions.map((s) => s.id);
      return { key: `c:${ids.join(",")}`, urls: ids.map(classUrl) };
    }
    if (mentorUid !== "all") return { key: `m:${mentorUid}`, urls: [`/api/college/mentoring/students?mentorUid=${encodeURIComponent(mentorUid)}`] };
    if (q.length >= 3) return { key: `q:${q}`, urls: [`/api/college/mentoring/search?q=${encodeURIComponent(q)}`] };
    return null;
  }, [sectionId, narrowed, sectionOptions, mentorUid, q]);

  useEffect(() => {
    if (!plan) return;
    let cancelled = false;
    const t = setTimeout(() => {
      Promise.all(plan.urls.map((u) => getJson<{ students: MenteeSummary[] }>(u)))
        .then((all) => { if (!cancelled) setFetched({ key: plan.key, students: all.flatMap((d) => d.students) }); })
        .catch((e: Error) => { if (!cancelled) { setFetched({ key: plan.key, students: [] }); toast({ variant: "destructive", title: e.message }); } });
    }, plan.key.startsWith("q:") ? 350 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [plan]);

  const loading = !!plan && fetched?.key !== plan.key;
  const rows = useMemo(() => {
    if (!plan || fetched?.key !== plan.key) return [];
    const needle = q.toUpperCase();
    return fetched.students.filter((s) => {
      if (mentorUid !== "all" && s.mentorUid !== mentorUid) return false;
      if (mentorFilter === "assigned" && !s.mentorUid) return false;
      if (mentorFilter === "unassigned" && s.mentorUid) return false;
      if (yearKey !== "all" && String(s.year) !== yearKey) return false;
      if (needle && !s.rollNumber.toUpperCase().includes(needle) && !s.name.toUpperCase().includes(needle)) return false;
      return true;
    });
  }, [plan, fetched, mentorUid, mentorFilter, yearKey, q]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-52">
              <p className="text-xs text-muted-foreground mb-1">Course</p>
              <Select value={courseKey} onValueChange={(v) => { setCourseKey(v); setYearKey("all"); setSectionId("all"); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All courses</SelectItem>
                  {courseNames.map((c) => <SelectItem key={c} value={c}>{c === "-" ? "No course set" : c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-32">
              <p className="text-xs text-muted-foreground mb-1">Year</p>
              <Select value={yearKey} onValueChange={(v) => { setYearKey(v); setSectionId("all"); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All years</SelectItem>
                  {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{`Year ${y}`}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-52">
              <p className="text-xs text-muted-foreground mb-1">Section</p>
              <Select value={sectionId} onValueChange={setSectionId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sections</SelectItem>
                  {sectionOptions.map((o) => <SelectItem key={o.id} value={o.id}>{sectionLabel(o)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-56">
              <p className="text-xs text-muted-foreground mb-1">Mentor</p>
              <Select value={mentorUid} onValueChange={setMentorUid}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any mentor</SelectItem>
                  {mentors.map((m) => <SelectItem key={m.uid} value={m.uid}>{`${m.name}${m.isSelf ? " (You)" : ""} · ${m.menteeCount}`}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-64">
              <p className="text-xs text-muted-foreground mb-1">Search</p>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or Regd. No" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Mentor status</p>
              <div className="flex gap-1.5">
                {MENTOR_FILTERS.map((f) => (
                  <Button key={f.key} size="sm" variant={mentorFilter === f.key ? "default" : "outline"} onClick={() => setMentorFilter(f.key)}>{f.label}</Button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {sectionsLoaded && sections.length === 0 && (
        <p className="text-sm text-amber-700">No classes were found for your department, so the Course, Year and Section lists are empty. Search by name or Regd. No meanwhile.</p>
      )}
      {!plan && <p className="text-sm text-muted-foreground">Pick a course, year, section or mentor - or type at least 3 characters of a name or Regd. No.</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {plan && !loading && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{rows.length} student{rows.length === 1 ? "" : "s"}</p>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No student matches.</p>
          ) : (
            <Card>
              <CardContent className="pt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-3 font-medium">Regd. No</th>
                    <th className="py-2 pr-3 font-medium">Name</th>
                    <th className="py-2 pr-3 font-medium">Branch</th>
                    <th className="py-2 pr-3 font-medium">Year</th>
                    <th className="py-2 pr-3 font-medium">Section</th>
                    <th className="py-2 font-medium">Mentor</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="py-2 pr-3 tabular-nums">{s.rollNumber || "—"}</td>
                        <td className="py-2 pr-3"><Link href={`/hod/mentoring/${s.id}`} className="font-medium text-primary hover:underline">{s.name}</Link></td>
                        <td className="py-2 pr-3">{s.department}</td>
                        <td className="py-2 pr-3">{s.year}</td>
                        <td className="py-2 pr-3">{s.section || "—"}</td>
                        <td className="py-2">{s.mentorName ? <Badge variant="secondary">{s.mentorName}</Badge> : <span className="text-muted-foreground">Not assigned</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      )}
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
