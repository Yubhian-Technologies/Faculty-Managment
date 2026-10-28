"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CalendarDays, Check, Copy, Download, Eraser, Plus, Sparkles, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MidTimetableGrid } from "@/components/midTimetable/MidTimetableGrid";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import { autoFill, checkSlots, dayLabel, MAX_SESSIONS, timeLabel, type BranchSubject } from "@/lib/midTimetable/rules";
import { downloadMidTimetablePdf } from "@/lib/pdf/downloadMidTimetable";
import type { MidExamPlan, MidExamSession, MidExamSlot, MidTimetable } from "@/types";

// Exam Cell: build one Mid's timetables. Top - the exam days (from the Mid's
// dates; Sundays off) and the sessions of a day. Below - one timetable per
// branch: Auto-fill, adjust a subject's day / session, Save draft or Publish.
// "Copy to other branches" gives shared subjects the same day + session there.

interface Branch { branch: string; key: string; subjects: BranchSubject[]; timetable: MidTimetable | null }
interface Data { plan: MidExamPlan; window: { from: string; to: string; fromTime: string; toTime: string } | null; range: { from: string; to: string } | null; branches: Branch[] }
type Row = { subjectId: string; date: string; sessionId: string };

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

/** Every date of the Mid's window, Sundays included (they start unticked). */
function windowDates(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 62) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

export default function MidTimetableBuilderPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = use(params);
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  // Unsaved edits per branch key (absent = as saved).
  const [edits, setEdits] = useState<Record<string, Row[]>>({});
  const [days, setDays] = useState<string[]>([]);
  const [sessions, setSessions] = useState<MidExamSession[]>([]);
  const [setupDirty, setSetupDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTo, setCopyTo] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/college/mid-timetables/${encodeURIComponent(planId)}`)
      .then(async (r) => { const d = (await r.json()) as Data & { error?: string }; if (!r.ok) throw new Error(d.error ?? "Failed to load"); return d; })
      .then((d) => {
        setData(d);
        setDays(d.plan.days);
        setSessions(d.plan.sessions);
        setSetupDirty(false);
        setSelected((s) => s || d.branches[0]?.key || "");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [planId]);
  useEffect(() => { load(); }, [load]);

  const dirty = setupDirty || Object.keys(edits).length > 0;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const plan = data?.plan;
  const branch = data?.branches.find((b) => b.key === selected) ?? null;
  const rowsOf = useCallback((b: Branch): Row[] =>
    edits[b.key] ?? b.subjects.map((s) => {
      const slot = b.timetable?.slots.find((x) => x.subjectId === s.subjectId);
      return { subjectId: s.subjectId, date: slot?.date ?? "", sessionId: slot?.sessionId ?? "" };
    }), [edits]);
  const rows = useMemo(() => (branch ? rowsOf(branch) : []), [branch, rowsOf]);
  // Checked against the SAVED days / sessions - the server's rules.
  const check = useMemo(() => (branch && plan ? checkSlots(rows, branch.subjects, plan.days, plan.sessions) : null), [rows, branch, plan]);
  const clashKeys = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of rows) if (r.date && r.sessionId) count.set(`${r.date}|${r.sessionId}`, (count.get(`${r.date}|${r.sessionId}`) ?? 0) + 1);
    return new Set([...count].filter(([, n]) => n > 1).map(([k]) => k));
  }, [rows]);
  const placed = rows.filter((r) => r.date && r.sessionId).length;

  const setRow = (subjectId: string, patch: Partial<Row>) => {
    if (!branch) return;
    const next = rows.map((r) => (r.subjectId === subjectId ? { ...r, ...patch } : r));
    setEdits((e) => ({ ...e, [branch.key]: next }));
  };

  function runAutoFill() {
    if (!branch || !plan) return;
    const kept: MidExamSlot[] = rows.filter((r) => r.date && r.sessionId && plan.days.includes(r.date) && plan.sessions.some((s) => s.id === r.sessionId))
      .map((r) => ({ ...branch.subjects.find((s) => s.subjectId === r.subjectId)!, date: r.date, sessionId: r.sessionId }));
    const { slots, unplaced } = autoFill(branch.subjects, kept, plan.days, plan.sessions);
    setEdits((e) => ({ ...e, [branch.key]: branch.subjects.map((s) => {
      const x = slots.find((y) => y.subjectId === s.subjectId);
      return { subjectId: s.subjectId, date: x?.date ?? "", sessionId: x?.sessionId ?? "" };
    }) }));
    if (unplaced.length) toast({ variant: "destructive", title: `Not enough exam slots for ${unplaced.length} subject(s)`, description: `${unplaced.join(", ")} - add an exam day or a session.` });
    else toast({ title: "Every subject placed", description: "Check the days, then Save draft or Publish." });
  }

  async function saveBranch(b: Branch, action: "draft" | "publish" | "unpublish", list: Row[] = rowsOf(b)): Promise<boolean> {
    const res = await fetch(`/api/college/mid-timetables/${encodeURIComponent(planId)}/branches/${encodeURIComponent(b.key)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, slots: list, baseRev: b.timetable?.rev ?? 0 }),
    });
    const json = (await res.json()) as { error?: string; timetable?: MidTimetable };
    if (!res.ok || !json.timetable) { toast({ variant: "destructive", title: `${b.branch}: ${json.error ?? "Could not save"}` }); return false; }
    setData((d) => d && ({ ...d, branches: d.branches.map((x) => (x.key === b.key ? { ...x, timetable: json.timetable! } : x)) }));
    setEdits((e) => { const n = { ...e }; delete n[b.key]; return n; });
    return true;
  }

  async function act(action: "draft" | "publish" | "unpublish") {
    if (!branch) return;
    setBusy(action);
    try {
      if (await saveBranch(branch, action)) {
        toast({ variant: "success", title: action === "publish" ? `${branch.branch} published - students, faculty and the Principal can see it` : action === "unpublish" ? `${branch.branch} is a draft again` : "Draft saved" });
      }
    } catch { toast({ variant: "destructive", title: "Network error - nothing was saved" }); }
    finally { setBusy(null); }
  }

  async function saveSetup() {
    setBusy("setup");
    try {
      const res = await fetch(`/api/college/mid-timetables/${encodeURIComponent(planId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days, sessions }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Could not save" }); return; }
      toast({ variant: "success", title: "Exam days and sessions saved" });
      setEdits({});
      load();
    } catch { toast({ variant: "destructive", title: "Network error - nothing was saved" }); }
    finally { setBusy(null); }
  }

  /** The shared subjects of the chosen branches get this branch's day + session (drafts only; published ones are skipped). */
  async function copyToOthers() {
    if (!branch || !data) return;
    setBusy("copy");
    let done = 0;
    const skipped: string[] = [];
    try {
      for (const other of data.branches.filter((b) => copyTo.has(b.key))) {
        if (other.timetable?.status === "PUBLISHED") { skipped.push(`${other.branch} (published)`); continue; }
        const mine = new Map(rows.filter((r) => r.date && r.sessionId).map((r) => [r.subjectId, r]));
        const next = rowsOf(other).map((r) => (mine.has(r.subjectId) ? { ...mine.get(r.subjectId)! } : r));
        const c = checkSlots(next, other.subjects, data.plan.days, data.plan.sessions);
        if (c.errors.length) { skipped.push(`${other.branch} (${c.errors[0]})`); continue; }
        if (await saveBranch(other, "draft", next)) done++;
      }
      toast({ variant: done ? "success" : "destructive", title: `Copied to ${done} branch${done === 1 ? "" : "es"} as drafts`, description: skipped.length ? `Skipped: ${skipped.join("; ")}` : undefined });
      setCopyOpen(false);
      setCopyTo(new Set());
    } catch { toast({ variant: "destructive", title: "Network error - some branches were not copied" }); }
    finally { setBusy(null); }
  }

  async function removePlan() {
    const res = await fetch(`/api/college/mid-timetables/${encodeURIComponent(planId)}`, { method: "DELETE" });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Could not delete" }); setDeleting(false); return; }
    router.push("/exam-cell/mid-timetable");
  }

  if (error) return <div className="space-y-4"><Button asChild variant="ghost" size="sm"><Link href="/exam-cell/mid-timetable"><ArrowLeft className="mr-1.5 h-4 w-4" />Mid Timetable</Link></Button><p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</p></div>;
  if (!data || !plan) return <div className="space-y-4"><div className="h-10 w-72 animate-pulse rounded bg-muted" /><div className="h-96 animate-pulse rounded-2xl bg-muted" /></div>;

  const allDates = data.range ? windowDates(data.range.from, data.range.to) : plan.days;
  const status = branch?.timetable?.status;
  const shared = (b: Branch) => branch ? b.subjects.filter((s) => branch.subjects.some((x) => x.subjectId === s.subjectId)).length : 0;
  const previewSlots: MidExamSlot[] = branch ? (check?.slots ?? []) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Mid ${plan.midNumber} timetable`}
        description={`${plan.courseName} · ${ordinalYearLabel(plan.year)} · Semester ${plan.semester}${data.range ? ` · ${data.window ? "Mid dates" : "Exam dates"} ${dayLabel(data.range.from)} - ${dayLabel(data.range.to)}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="ghost" size="sm"><Link href="/exam-cell/mid-timetable"><ArrowLeft className="mr-1.5 h-4 w-4" />Mid Timetable</Link></Button>
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleting(true)}><Trash2 className="mr-1.5 h-4 w-4" />Delete</Button>
          </div>
        }
      />

      {/* 1. Exam days and sessions (shared by every branch) */}
      <Card className="rounded-2xl">
        <CardContent className="space-y-5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">1. Exam days and sessions</h2>
              <p className="text-sm text-muted-foreground">The same for every branch. Tick the days exams are held; add a second session for two exams a day.</p>
            </div>
            {setupDirty && <Button onClick={() => void saveSetup()} loading={busy === "setup"}><Check className="mr-1.5 h-4 w-4" />Save days &amp; sessions</Button>}
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Exam days">
            {allDates.map((d) => {
              const on = days.includes(d);
              const sunday = new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
              return (
                <button key={d} type="button" aria-pressed={on} onClick={() => { setDays((x) => (on ? x.filter((y) => y !== d) : [...x, d].sort())); setSetupDirty(true); }}
                  className={cn("rounded-xl border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-background text-muted-foreground hover:border-primary/40", sunday && !on && "border-dashed")}>
                  <span className="block font-semibold">{dayLabel(d).split(" ")[0]}</span>
                  <span>{dayLabel(d).split(" ").slice(1, 3).join(" ")}</span>
                </button>
              );
            })}
          </div>
          <div className="space-y-2">
            {sessions.map((s, i) => (
              <div key={s.id} className="flex flex-wrap items-end gap-2 rounded-xl border bg-muted/20 p-3">
                <div className="min-w-40 flex-1 space-y-1"><Label htmlFor={`ses-${i}`} className="text-xs">Session name</Label>
                  <Input id={`ses-${i}`} value={s.label} maxLength={40} onChange={(e) => { setSessions((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y))); setSetupDirty(true); }} /></div>
                <div className="space-y-1"><Label htmlFor={`ses-${i}-from`} className="text-xs">From</Label>
                  <Input id={`ses-${i}-from`} type="time" value={s.from} className="w-32" onChange={(e) => { setSessions((x) => x.map((y, j) => (j === i ? { ...y, from: e.target.value } : y))); setSetupDirty(true); }} /></div>
                <div className="space-y-1"><Label htmlFor={`ses-${i}-to`} className="text-xs">To</Label>
                  <Input id={`ses-${i}-to`} type="time" value={s.to} className="w-32" onChange={(e) => { setSessions((x) => x.map((y, j) => (j === i ? { ...y, to: e.target.value } : y))); setSetupDirty(true); }} /></div>
                {sessions.length > 1 && <Button variant="ghost" size="icon" aria-label={`Remove ${s.label}`} onClick={() => { setSessions((x) => x.filter((_, j) => j !== i)); setSetupDirty(true); }}><X className="h-4 w-4" /></Button>}
              </div>
            ))}
            {sessions.length < MAX_SESSIONS && (
              <Button variant="outline" size="sm" onClick={() => {
                const used = new Set(sessions.map((s) => s.id));
                const id = ["S1", "S2", "S3"].find((x) => !used.has(x)) ?? `S${sessions.length + 1}`;
                setSessions((x) => [...x, { id, label: x.length === 1 ? "Afternoon" : `Session ${x.length + 1}`, from: "14:00", to: "15:30" }]);
                setSetupDirty(true);
              }}><Plus className="mr-1.5 h-4 w-4" />Add a session</Button>
            )}
          </div>
          {setupDirty && <p className="text-xs text-amber-700">Save the days and sessions before placing exams - the branch timetables use the saved ones.</p>}
        </CardContent>
      </Card>

      {/* 2. Branch timetables */}
      {data.branches.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">No branch of this year has Theory subjects with teaching assignments in semester {plan.semester} yet.</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="Branches" className="space-y-2 lg:sticky lg:top-4 lg:self-start">
            <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">2. Branches ({data.branches.length})</p>
            {data.branches.map((b) => {
              const st = b.timetable?.status;
              const n = rowsOf(b).filter((r) => r.date && r.sessionId).length;
              return (
                <button key={b.key} type="button" aria-current={b.key === selected ? "true" : undefined} onClick={() => setSelected(b.key)}
                  className={cn("w-full rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    b.key === selected ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20" : "bg-card hover:bg-muted/50")}>
                  <span className="block text-sm font-medium leading-snug">{b.branch}</span>
                  <span className="mt-1.5 flex items-center gap-2 text-xs">
                    <span className={cn("rounded-full px-2 py-0.5 font-semibold", st === "PUBLISHED" ? "bg-emerald-100 text-emerald-800" : st === "DRAFT" ? "bg-amber-100 text-amber-900" : "bg-muted text-muted-foreground")}>
                      {st === "PUBLISHED" ? "Published" : st === "DRAFT" ? "Draft" : "Not started"}
                    </span>
                    <span className="text-muted-foreground">{n}/{b.subjects.length} placed{edits[b.key] ? " · unsaved" : ""}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          {branch && (
            <section aria-label={`${branch.branch} timetable`} className="min-w-0 space-y-4">
              <Card className="rounded-2xl">
                <CardContent className="space-y-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">{branch.branch}</h2>
                      <p className="text-sm text-muted-foreground">{branch.subjects.length} Theory subject{branch.subjects.length === 1 ? "" : "s"} · {placed} placed</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={runAutoFill} disabled={setupDirty}><Sparkles className="mr-1.5 h-4 w-4" />Auto-fill</Button>
                      <Button variant="ghost" size="sm" onClick={() => setEdits((e) => ({ ...e, [branch.key]: branch.subjects.map((s) => ({ subjectId: s.subjectId, date: "", sessionId: "" })) }))}><Eraser className="mr-1.5 h-4 w-4" />Clear</Button>
                      {data.branches.length > 1 && <Button variant="ghost" size="sm" onClick={() => setCopyOpen(true)} disabled={placed === 0}><Copy className="mr-1.5 h-4 w-4" />Copy to other branches</Button>}
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full min-w-[32rem] text-sm">
                      <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                        <tr><th className="p-3 font-medium">Subject</th><th className="w-52 p-3 font-medium">Day</th>{plan.sessions.length > 1 && <th className="w-48 p-3 font-medium">Session</th>}</tr>
                      </thead>
                      <tbody>
                        {branch.subjects.map((s) => {
                          const r = rows.find((x) => x.subjectId === s.subjectId) ?? { subjectId: s.subjectId, date: "", sessionId: "" };
                          const clash = Boolean(r.date && r.sessionId && clashKeys.has(`${r.date}|${r.sessionId}`));
                          return (
                            <tr key={s.subjectId} className={cn("border-t", clash && "bg-destructive/5")}>
                              <td className="p-3"><p className="font-medium">{s.subjectName}</p><p className="text-xs text-muted-foreground">{s.subjectCode}{clash && <span className="ml-2 font-medium text-destructive">Clashes with another exam</span>}</p></td>
                              <td className="p-3">
                                <select aria-label={`Day for ${s.subjectName}`} className={selectClass} value={r.date} disabled={setupDirty}
                                  onChange={(e) => setRow(s.subjectId, { date: e.target.value, sessionId: e.target.value ? (r.sessionId || (plan.sessions.length === 1 ? plan.sessions[0].id : "")) : "" })}>
                                  <option value="">Not placed</option>
                                  {plan.days.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
                                </select>
                              </td>
                              {plan.sessions.length > 1 && (
                                <td className="p-3">
                                  <select aria-label={`Session for ${s.subjectName}`} className={selectClass} value={r.sessionId} disabled={setupDirty || !r.date} onChange={(e) => setRow(s.subjectId, { sessionId: e.target.value })}>
                                    <option value="">Pick</option>
                                    {plan.sessions.map((x) => <option key={x.id} value={x.id}>{x.label} ({timeLabel(x.from)})</option>)}
                                  </select>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {check && check.errors.length > 0 && (
                    <ul className="space-y-1 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
                      {check.errors.map((e) => <li key={e} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{e}</li>)}
                    </ul>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                    <span className="text-xs text-muted-foreground">
                      {status === "PUBLISHED" ? `Published${branch.timetable?.publishedByName ? ` by ${branch.timetable.publishedByName}` : ""} - students, faculty and the Principal see it` : status === "DRAFT" ? "Draft - only the Exam Cell sees it" : "Not saved yet"}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {status === "PUBLISHED" && <Button variant="ghost" onClick={() => void act("unpublish")} loading={busy === "unpublish"}>Unpublish</Button>}
                      {status !== "PUBLISHED" && <Button variant="outline" onClick={() => void act("draft")} loading={busy === "draft"} disabled={setupDirty || Boolean(check?.errors.length)}>Save draft</Button>}
                      <Button onClick={() => void act("publish")} loading={busy === "publish"} disabled={setupDirty || !check?.complete}>
                        {status === "PUBLISHED" ? "Save & keep published" : "Publish"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardContent className="space-y-3 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4 text-primary" />Preview</h3>
                    <Button size="sm" variant="outline" disabled={previewSlots.length === 0} loading={busy === "pdf"}
                      onClick={async () => {
                        setBusy("pdf");
                        try { await downloadMidTimetablePdf([{ ...plan, branch: branch.branch, slots: previewSlots, sessions: plan.sessions }], `mid${plan.midNumber}-${branch.branch}-timetable`); }
                        catch { toast({ variant: "destructive", title: "Could not make the PDF" }); }
                        finally { setBusy(null); }
                      }}><Download className="mr-1.5 h-4 w-4" />PDF</Button>
                  </div>
                  <MidTimetableGrid slots={previewSlots} sessions={plan.sessions} days={plan.days} />
                </CardContent>
              </Card>
            </section>
          )}
        </div>
      )}

      <Dialog open={copyOpen} onOpenChange={(o) => !o && busy !== "copy" && setCopyOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Copy to other branches</DialogTitle>
            <DialogDescription>Subjects the branches share get the same day and session as in {branch?.branch}. Their other subjects stay as they are. Saved as drafts; published branches are skipped.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto">
            {data.branches.filter((b) => b.key !== selected).map((b) => {
              const n = shared(b);
              return (
                <li key={b.key}>
                  <label className={cn("flex items-center gap-3 rounded-lg border p-2.5 text-sm", n === 0 ? "opacity-50" : "cursor-pointer hover:bg-muted/50")}>
                    <Checkbox checked={copyTo.has(b.key)} disabled={n === 0} onCheckedChange={(v) => setCopyTo((s) => { const x = new Set(s); if (v === true) x.add(b.key); else x.delete(b.key); return x; })} />
                    <span className="flex-1">{b.branch}<span className="block text-xs text-muted-foreground">{n} shared subject{n === 1 ? "" : "s"}{b.timetable?.status === "PUBLISHED" ? " · published (skipped)" : ""}</span></span>
                  </label>
                </li>
              );
            })}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCopyOpen(false)} disabled={busy === "copy"}>Cancel</Button>
            <Button onClick={() => void copyToOthers()} loading={busy === "copy"} disabled={copyTo.size === 0}>Copy</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting}
        onOpenChange={(o) => !o && setDeleting(false)}
        title="Delete this Mid timetable?"
        description="Every branch's draft is removed. Only possible while no branch is published."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void removePlan()}
      />
    </div>
  );
}
