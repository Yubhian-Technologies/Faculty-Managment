"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { MenteeList } from "@/components/mentoring/MenteeList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

function AssignView({ mentors, onChanged }: { mentors: MentorOption[]; onChanged: () => void }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [students, setStudents] = useState<MenteeSummary[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mentorUid, setMentorUid] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/college/sections")
      .then((r) => r.json() as Promise<{ sections?: Section[] }>)
      .then((d) => setSections(d.sections ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load sections" }));
  }, []);

  const loadStudents = useCallback(async (id: string) => {
    setStudents(null);
    setPicked(new Set());
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
  const allPicked = !!students && students.length > 0 && picked.size === students.length;

  function toggle(id: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }

  async function submit(uid: string | null) {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/college/mentoring/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mentorUid: uid, studentIds: [...picked] }),
      });
      const d = (await res.json().catch(() => ({}))) as { assigned?: string[]; skipped?: { id: string; reason: string }[]; error?: string };
      if (!res.ok) throw new Error(d.error || "Could not save");
      const done = d.assigned?.length ?? 0;
      const skipped = d.skipped?.length ?? 0;
      toast({
        title: uid ? `${done} student${done === 1 ? "" : "s"} assigned` : `Mentor removed from ${done} student${done === 1 ? "" : "s"}`,
        description: skipped > 0 ? `${skipped} skipped: ${[...new Set(d.skipped!.map((s) => s.reason))].join(", ")}` : undefined,
      });
      await loadStudents(sectionId);
      onChanged();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-72">
          <p className="text-xs text-muted-foreground mb-1">Section</p>
          <Select value={sectionId} onValueChange={setSectionId}>
            <SelectTrigger><SelectValue placeholder="Pick a section" /></SelectTrigger>
            <SelectContent>
              {sortedSections.map((s) => (
                <SelectItem key={s.id} value={s.id}>{`${s.courseName ? `${s.courseName} · ` : ""}${s.department} · Year ${s.year} · ${s.name}`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-72">
          <p className="text-xs text-muted-foreground mb-1">Mentor</p>
          <Select value={mentorUid} onValueChange={setMentorUid}>
            <SelectTrigger><SelectValue placeholder="Pick a faculty member" /></SelectTrigger>
            <SelectContent>
              {mentors.map((m) => (
                <SelectItem key={m.uid} value={m.uid}>{`${m.name} (${m.menteeCount})`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button disabled={busy || picked.size === 0 || !mentorUid} onClick={() => submit(mentorUid)}>
          Assign {picked.size > 0 ? `${picked.size} selected` : ""}
        </Button>
        <Button variant="outline" disabled={busy || picked.size === 0} onClick={() => submit(null)}>
          Remove mentor
        </Button>
      </div>

      {!sectionId && <p className="text-sm text-muted-foreground">Pick a section to see its students and their mentors.</p>}
      {sectionId && !students && <p className="text-sm text-muted-foreground">Loading…</p>}
      {students && students.length === 0 && <p className="text-sm text-muted-foreground">No students in this section.</p>}
      {students && students.length > 0 && (
        <Card>
          <CardContent className="pt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3 w-8">
                  <Checkbox checked={allPicked} onCheckedChange={(v) => setPicked(v === true ? new Set(students.map((s) => s.id)) : new Set())} aria-label="Select all" />
                </th>
                <th className="py-2 pr-3 font-medium">Roll No</th>
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 font-medium">Mentor</th>
              </tr></thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <Checkbox checked={picked.has(s.id)} onCheckedChange={(v) => toggle(s.id, v === true)} aria-label={`Select ${s.name}`} />
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{s.rollNumber || "—"}</td>
                    <td className="py-2 pr-3">
                      <Link href={`/hod/mentoring/${s.id}`} className="hover:underline">{s.name}</Link>
                    </td>
                    <td className="py-2">{s.mentorName ? <Badge variant="secondary">{s.mentorName}</Badge> : <span className="text-muted-foreground">Not assigned</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
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
