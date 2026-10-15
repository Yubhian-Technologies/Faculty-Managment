"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { MENTORING_NOTE_MAX_LENGTH } from "@/types/mentoring";
import { MenteeRecord } from "./record/MenteeRecord";

// One mentee's progress, read-only, for their mentor / HOD: profile, attendance,
// semester results, internal marks, and the mentor's own notes. Each tab loads
// only when opened (see api/college/mentoring/students/[id]).

type Tab = "record" | "profile" | "attendance" | "results" | "internal" | "notes";
const TABS: { key: Tab; label: string }[] = [
  { key: "record", label: "Mentoring Record" },
  { key: "profile", label: "Profile" },
  { key: "attendance", label: "Attendance" },
  { key: "results", label: "Semester Results" },
  { key: "internal", label: "Internal Marks" },
  { key: "notes", label: "Mentoring Notes" },
];

interface ProfileData {
  student: {
    id: string; name: string; rollNumber: string; department: string; secondaryDepartment: string | null;
    course: string; section: string; year: number; batch: string; status: string; profilePhotoUrl: string | null; mentorName: string | null;
  };
  groups: { title: string; rows: { label: string; value: string }[] }[];
}
interface AttendanceData {
  semesters: { semester: number; label: string }[];
  scope: { label: string; from: string | null; to: string | null };
  subjects: { subjectId: string; code: string; name: string; held: number; attended: number; percent: number | null }[];
  total: { held: number; attended: number; percent: number | null };
}
interface ResultsData {
  semesters: {
    semester: number; year: number; academicYear: string;
    subjects: { code: string; name: string; credits: number; grade: string; points: number; isPass: boolean; earlier: { examType: string; grade: string }[] }[];
    sgpa: number | null; sgpaWithheld: boolean; cgpa: number | null; cgpaWithheld: boolean; backlogs: string[];
  }[];
  backlogs: string[];
  decimals: number;
}
interface InternalData {
  subjects: {
    subjectCode: string; subjectName: string; year: number | null; sectionName: string; facultyName: string;
    components: { id: string; name: string; maxMarks: number | null; marks: number | null }[];
    total: number | null; maxTotal: number | null;
  }[];
}
interface NoteRow { id: string; text: string; authorUid: string; authorName: string; createdAt: string | null; mine: boolean }

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Could not load this");
  return data;
}

function Loading() { return <p className="text-sm text-muted-foreground py-6">Loading…</p>; }
function Empty({ children }: { children: React.ReactNode }) { return <p className="text-sm text-muted-foreground py-6">{children}</p>; }
const pct = (p: number | null) => (p == null ? "—" : `${p.toFixed(1)}%`);

function useTabData<T>(url: string | null) {
  // The last answer is kept while the next one loads (a picker change must not blank its own options);
  // `loading` is derived from which url the held answer belongs to.
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null });
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    getJson<T>(url)
      .then((data) => { if (!cancelled) setState({ key: url, data, error: null }); })
      .catch((e: Error) => { if (!cancelled) setState((s) => ({ key: url, data: s.data, error: e.message })); });
    return () => { cancelled = true; };
  }, [url]);
  const loading = !!url && state.key !== url;
  return { data: state.data, error: loading ? null : state.error, loading };
}

export function MenteeProgress({ studentId, backHref }: { studentId: string; backHref: string }) {
  const [tab, setTab] = useState<Tab>("record");
  const api = `/api/college/mentoring/students/${studentId}`;
  const profile = useTabData<ProfileData>(`${api}?part=profile`);
  const s = profile.data?.student;

  return (
    <div className="space-y-4">
      <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      {profile.error && <Empty>{profile.error}</Empty>}
      {s && (
        <div className="flex items-center gap-4">
          {s.profilePhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.profilePhotoUrl} alt="" className="h-16 w-16 rounded-full object-cover border" />
          ) : (
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center text-xl font-semibold text-muted-foreground">
              {s.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight truncate">{s.name}</h1>
            <p className="text-sm text-muted-foreground">
              {s.rollNumber || "No roll number"} · {s.secondaryDepartment || s.department} · Year {s.year}{s.section ? ` · Section ${s.section}` : ""}
              {s.batch ? ` · Batch ${s.batch}` : ""}
            </p>
            {s.status && s.status !== "REGULAR" && <Badge variant="outline" className="mt-1">{s.status}</Badge>}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "record" && <MenteeRecord studentId={studentId} studentName={s?.name ?? ""} rollNumber={s?.rollNumber ?? ""} />}
      {tab === "profile" && <ProfileTab loading={profile.loading} data={profile.data} />}
      {tab === "attendance" && <AttendanceTab api={api} />}
      {tab === "results" && <ResultsTab api={api} />}
      {tab === "internal" && <InternalTab api={api} />}
      {tab === "notes" && <NotesTab api={api} />}
    </div>
  );
}

function ProfileTab({ loading, data }: { loading: boolean; data: ProfileData | null }) {
  if (loading) return <Loading />;
  if (!data || data.groups.length === 0) return <Empty>No details on record yet.</Empty>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {data.groups.map((g) => (
        <Card key={g.title}>
          <CardHeader className="pb-2"><CardTitle className="text-base">{g.title}</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[minmax(0,40%)_1fr] gap-x-3 gap-y-1.5 text-sm">
              {g.rows.map((r) => (
                <div key={r.label} className="contents">
                  <dt className="text-muted-foreground">{r.label}</dt>
                  <dd className="break-words">{r.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AttendanceTab({ api }: { api: string }) {
  const [semester, setSemester] = useState<string>("current");
  const url = `${api}?part=attendance${semester === "current" ? "" : `&semester=${semester}`}`;
  const { data, error, loading } = useTabData<AttendanceData>(url);
  const options = data?.semesters ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={semester} onValueChange={setSemester}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="current">Current semester (till now)</SelectItem>
            {options.map((o) => <SelectItem key={o.semester} value={String(o.semester)}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {data && <span className="text-sm text-muted-foreground">{data.scope.label}{data.scope.from && data.scope.to ? ` · ${data.scope.from} to ${data.scope.to}` : ""}</span>}
      </div>
      {loading && <Loading />}
      {error && <Empty>{error}</Empty>}
      {data && !loading && (data.subjects.length === 0 ? <Empty>No attendance has been marked in this period.</Empty> : (
        <Card>
          <CardContent className="pt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3 font-medium">Subject</th>
                <th className="py-2 pr-3 font-medium text-right">Held</th>
                <th className="py-2 pr-3 font-medium text-right">Attended</th>
                <th className="py-2 font-medium text-right">%</th>
              </tr></thead>
              <tbody>
                {data.subjects.map((r) => (
                  <tr key={r.subjectId} className="border-b last:border-0">
                    <td className="py-2 pr-3"><span className="font-medium">{r.code}</span> <span className="text-muted-foreground">{r.name}</span></td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.held}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.attended}</td>
                    <td className={`py-2 text-right tabular-nums ${r.percent != null && r.percent < 75 ? "text-red-600 font-medium" : ""}`}>{pct(r.percent)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2 pr-3">Overall</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{data.total.held}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{data.total.attended}</td>
                  <td className={`py-2 text-right tabular-nums ${data.total.percent != null && data.total.percent < 75 ? "text-red-600" : ""}`}>{pct(data.total.percent)}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ResultsTab({ api }: { api: string }) {
  const { data, error, loading } = useTabData<ResultsData>(`${api}?part=results`);
  if (loading) return <Loading />;
  if (error) return <Empty>{error}</Empty>;
  if (!data || data.semesters.length === 0) return <Empty>No semester results have been published for this student yet.</Empty>;
  const fmt = (v: number | null, withheld: boolean) => (withheld ? "Withheld" : v == null ? "—" : v.toFixed(data.decimals));
  const latest = data.semesters[data.semesters.length - 1];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge variant="secondary">CGPA {fmt(latest.cgpa, latest.cgpaWithheld)}</Badge>
        {data.backlogs.length > 0
          ? <Badge variant="destructive">{data.backlogs.length} backlog{data.backlogs.length === 1 ? "" : "s"}: {data.backlogs.join(", ")}</Badge>
          : <Badge variant="outline">No backlogs</Badge>}
      </div>
      {[...data.semesters].reverse().map((sem) => (
        <Card key={sem.semester}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
              <span>Semester {sem.semester}{sem.year ? ` · Year ${sem.year}` : ""}{sem.academicYear ? ` · ${sem.academicYear}` : ""}</span>
              <span className="text-sm font-normal text-muted-foreground">
                SGPA <strong className="text-foreground">{fmt(sem.sgpa, sem.sgpaWithheld)}</strong> · CGPA <strong className="text-foreground">{fmt(sem.cgpa, sem.cgpaWithheld)}</strong>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3 font-medium">Code</th>
                <th className="py-2 pr-3 font-medium">Subject</th>
                <th className="py-2 pr-3 font-medium text-right">Credits</th>
                <th className="py-2 pr-3 font-medium">Grade</th>
                <th className="py-2 font-medium text-right">Points</th>
              </tr></thead>
              <tbody>
                {sem.subjects.map((r) => (
                  <tr key={r.code} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{r.code}</td>
                    <td className="py-2 pr-3">{r.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.credits}</td>
                    <td className="py-2 pr-3">
                      <span className={r.isPass ? "" : "text-red-600 font-medium"}>{r.grade}</span>
                      {r.earlier.length > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (earlier: {r.earlier.map((e) => `${e.grade}${e.examType === "SUPPLEMENTARY" ? " supp." : ""}`).join(", ")})
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function InternalTab({ api }: { api: string }) {
  const { data, error, loading } = useTabData<InternalData>(`${api}?part=internal`);
  if (loading) return <Loading />;
  if (error) return <Empty>{error}</Empty>;
  if (!data || data.subjects.length === 0) return <Empty>No internal marks have been submitted for this student yet.</Empty>;
  const years = [...new Set(data.subjects.map((x) => x.year))];
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">Shows marks the faculty have submitted; drafts are not included.</p>
      {years.map((y) => (
        <div key={String(y)} className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">{y != null ? `Year ${y}` : "Other"}</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {data.subjects.filter((x) => x.year === y).map((sub) => (
              <Card key={`${sub.subjectCode}-${sub.sectionName}-${sub.facultyName}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{sub.subjectName}</CardTitle>
                  <p className="text-xs text-muted-foreground">{sub.subjectCode} · {sub.facultyName}</p>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1 text-sm">
                    {sub.components.map((c) => (
                      <li key={c.id} className="flex justify-between gap-3">
                        <span className="text-muted-foreground">{c.name}</span>
                        <span className="tabular-nums">{c.marks ?? "—"}{c.maxMarks != null ? ` / ${c.maxMarks}` : ""}</span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-3 border-t pt-1 font-semibold">
                      <span>Total</span>
                      <span className="tabular-nums">{sub.total ?? "—"}{sub.maxTotal != null ? ` / ${sub.maxTotal}` : ""}</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NotesTab({ api }: { api: string }) {
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getJson<{ notes: NoteRow[] }>(`${api}/notes`)
      .then((d) => setNotes(d.notes))
      .catch((e: Error) => setError(e.message));
  }, [api]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    const body = text.trim();
    if (!body) return;
    setSaving(true);
    try {
      const res = await fetch(`${api}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: body }) });
      const d = (await res.json().catch(() => ({}))) as { note?: NoteRow; error?: string };
      if (!res.ok || !d.note) throw new Error(d.error || "Could not save the note");
      setNotes((prev) => [d.note as NoteRow, ...(prev ?? [])]);
      setText("");
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not save the note" });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`${api}/notes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Could not delete the note");
      setNotes((prev) => (prev ?? []).filter((n) => n.id !== id));
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not delete the note" });
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="space-y-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MENTORING_NOTE_MAX_LENGTH}
          rows={3}
          placeholder="Write what was discussed, concerns, follow-ups…"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Visible to this student&apos;s mentor and HOD only - never to the student.</span>
          <Button size="sm" onClick={add} disabled={saving || !text.trim()}>{saving ? "Saving…" : "Add note"}</Button>
        </div>
      </div>
      {error && <Empty>{error}</Empty>}
      {!notes && !error && <Loading />}
      {notes && notes.length === 0 && <Empty>No notes yet.</Empty>}
      {notes?.map((n) => (
        <Card key={n.id}>
          <CardContent className="pt-4 space-y-1">
            <p className="text-sm whitespace-pre-wrap break-words">{n.text}</p>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{n.authorName}{n.createdAt ? ` · ${new Date(n.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : ""}</span>
              {n.mine && (
                <button type="button" onClick={() => remove(n.id)} className="inline-flex items-center gap-1 hover:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
