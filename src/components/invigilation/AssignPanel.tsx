"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Sparkles, UserPlus, X, Repeat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { dayLabel, timeLabel } from "@/lib/midTimetable/rules";
import { AVAILABILITY_LABELS } from "@/lib/invigilation/eligibility";
import { DUTY_CATEGORY_LABELS, ACTIVE_DUTY_STATUSES, type InvigilationDuty } from "@/types/invigilation";
import { AVAILABILITY_TONE, STATUS_TONE, designationLabel, type CandidateRow, type Overview, type SlotRow } from "./model";

// Exam Cell > Invigilation > Assign: pick an exam session and one of its duties
// (a room's invigilators, the relievers, the special squad) on the left; the
// right lists every faculty member judged for it - who can take it, who can't
// and why - fairest first. Saving is re-checked on the server.

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const sessionLabel = (s: string) => { const [d, t] = s.split("|"); const [f, to] = (t ?? "").split("-"); return `${dayLabel(d)} · ${timeLabel(f)} - ${timeLabel(to)}`; };
const SELECTABLE = new Set(["AVAILABLE", "NEEDS_OVERRIDE", "NO_TIMETABLE"]);

export function AssignPanel({ overview, onChanged, initialSlot }: { overview: Overview; onChanged: () => void; initialSlot?: string }) {
  const { schedule, slots, sessions, duties, canOverride } = overview;
  const [session, setSession] = useState(() => (initialSlot ? slots.find((s) => s.key === initialSlot)?.session : undefined) ?? sessions[0] ?? "");
  const [slotKey, setSlotKey] = useState(initialSlot ?? "");
  const [rows, setRows] = useState<CandidateRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [desig, setDesig] = useState("");
  const [show, setShow] = useState<"ELIGIBLE" | "ALL" | "UNAVAILABLE">("ELIGIBLE");
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState<InvigilationDuty | null>(null);
  const [cancelling, setCancelling] = useState<InvigilationDuty | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const sessionSlots = useMemo(() => slots.filter((s) => s.session === session), [slots, session]);
  const slot: SlotRow | undefined = slots.find((s) => s.key === slotKey);
  useEffect(() => {
    if (!sessionSlots.some((s) => s.key === slotKey)) setSlotKey(sessionSlots.find((s) => s.filled < s.required)?.key ?? sessionSlots[0]?.key ?? "");
  }, [sessionSlots, slotKey]);

  useEffect(() => {
    if (!slotKey) { setRows(null); return; }
    let cancelled = false;
    setLoading(true);
    setPicked([]);
    const qs = new URLSearchParams({ slot: slotKey, ...(replacing ? { replacing: replacing.id } : {}) });
    fetch(`/api/college/invigilation/schedules/${schedule.id}/candidates?${qs}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ candidates?: CandidateRow[]; error?: string }>)
      .then((d) => { if (!cancelled) { if (d.error) throw new Error(d.error); setRows(d.candidates ?? []); } })
      .catch((e) => { if (!cancelled) { setRows([]); toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load faculty" }); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [schedule.id, slotKey, replacing, reloadKey]);

  const onSlot = duties.filter((d) => d.slotKey === slotKey && ACTIVE_DUTY_STATUSES.includes(d.status));
  const departments = useMemo(() => [...new Set((rows ?? []).map((r) => r.department).filter(Boolean))].sort(), [rows]);
  const designations = useMemo(() => [...new Set((rows ?? []).map((r) => r.designation).filter(Boolean))].sort(), [rows]);
  const visible = (rows ?? []).filter((r) => {
    if (dept && r.department !== dept) return false;
    if (desig && r.designation !== desig) return false;
    const ok = SELECTABLE.has(r.availability);
    if (show === "ELIGIBLE" && !ok) return false;
    if (show === "UNAVAILABLE" && ok) return false;
    const s = q.trim().toLowerCase();
    return !s || r.name.toLowerCase().includes(s) || r.employeeId.toLowerCase().includes(s) || r.roles.some((x) => x.toLowerCase().includes(s));
  });
  const pickedRows = (rows ?? []).filter((r) => picked.includes(r.facultyId));
  const needsOverride = pickedRows.some((r) => r.evaluation.issues.some((i) => i.level === "WARN"));
  const open = slot ? Math.max(0, slot.required - onSlot.length) : 0;

  async function send(body: object, url = `/api/college/invigilation/schedules/${schedule.id}/duties`, method = "POST") {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json()) as { saved?: number; results?: { facultyId: string; ok: boolean; error?: string }[]; error?: string };
      const failed = data.results?.filter((x) => !x.ok) ?? [];
      if (!res.ok && !data.saved) throw new Error(failed[0]?.error ?? data.error ?? "Could not save");
      if (data.saved !== undefined) toast({ variant: failed.length ? "destructive" : "success", title: `${data.saved} assigned${failed.length ? `, ${failed.length} refused: ${failed[0].error}` : ""}` });
      else toast({ variant: "success", title: "Saved" });
      setPicked([]); setReason(""); setReasonOpen(false); setReplacing(null);
      setReloadKey((k) => k + 1);
      onChanged();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  }

  function assign() {
    if (replacing) {
      if (pickedRows.length !== 1) return toast({ variant: "destructive", title: "Pick one person to take this duty" });
      if (needsOverride) return setReasonOpen(true);
      return void send({ action: "reassign", facultyId: picked[0] }, `/api/college/invigilation/duties/${replacing.id}`, "PATCH");
    }
    if (needsOverride) return setReasonOpen(true);
    void send({ slotKey, facultyIds: picked });
  }
  function confirmWithReason() {
    if (replacing) return void send({ action: "reassign", facultyId: picked[0], reason }, `/api/college/invigilation/duties/${replacing.id}`, "PATCH");
    void send({ slotKey, facultyIds: picked, reason });
  }

  if (!sessions.length) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">No exam sessions yet - the Mid timetables of this schedule have no exams placed.</CardContent></Card>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
      {/* Left: the exam and its duties */}
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="as-session">Exam session</Label>
              <select id="as-session" className={selectClass} value={session} onChange={(e) => { setSession(e.target.value); setReplacing(null); }}>
                {sessions.map((s) => <option key={s} value={s}>{sessionLabel(s)}{schedule.publishedSessions.includes(s) ? " · published" : ""}</option>)}
              </select>
            </div>
            <div className="max-h-[420px] space-y-1 overflow-y-auto">
              {sessionSlots.length === 0 && <p className="text-xs text-muted-foreground">No duties in this session - add a seating plan for it in Exam Seating, or turn categories on.</p>}
              {sessionSlots.map((s) => (
                <button key={s.key} type="button" onClick={() => { setSlotKey(s.key); setReplacing(null); }}
                  className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm ${s.key === slotKey ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}>
                  <span>
                    <span className="font-medium">{s.room ?? DUTY_CATEGORY_LABELS[s.category]}</span>
                    <span className="block text-xs text-muted-foreground">{s.roomId ? `${s.students} students · ${DUTY_CATEGORY_LABELS[s.category]}` : DUTY_CATEGORY_LABELS[s.category]}</span>
                  </span>
                  <Badge variant={s.filled >= s.required ? "approved" : s.filled ? "pending" : "outline"}>{s.filled}/{s.required}</Badge>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {slot && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{slot.room ?? DUTY_CATEGORY_LABELS[slot.category]}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">When:</span> {sessionLabel(slot.session)}</p>
              <p><span className="text-muted-foreground">Duty:</span> {DUTY_CATEGORY_LABELS[slot.category]} · needs {slot.required}{slot.roomId ? ` (${slot.students} students)` : ""}</p>
              <p><span className="text-muted-foreground">Branches:</span> {slot.groups.join(", ") || "-"}</p>
              {slot.courseYears.length > 0 && <p><span className="text-muted-foreground">Year / semester:</span> {[...new Set(slot.courseYears.map((c) => `Year ${c.year} · Sem ${c.semester}`))].join(", ")}</p>}
              <div><span className="text-muted-foreground">Subjects:</span> {slot.subjects.length ? slot.subjects.map((s) => `${s.name} (${s.code})`).join(", ") : "-"}</div>
              <div className="space-y-1 pt-2">
                <p className="text-xs font-medium text-muted-foreground">On this duty</p>
                {onSlot.length === 0 && <p className="text-xs text-muted-foreground">Nobody yet.</p>}
                {onSlot.map((d) => (
                  <div key={d.id} className={`flex items-center justify-between gap-2 rounded border px-2 py-1 ${replacing?.id === d.id ? "border-primary" : ""}`}>
                    <span className="text-xs"><b>{d.facultyName}</b> · {d.employeeId}<Badge variant={STATUS_TONE[d.status]} className="ml-1">{d.status.toLowerCase()}</Badge>{d.overrides?.length ? <Badge variant="modified" className="ml-1">override</Badge> : null}</span>
                    {schedule.status === "ACTIVE" && (
                      <span className="flex">
                        <Button size="icon" variant="ghost" aria-label={`Give ${d.facultyName}'s duty to someone else`} title="Reassign" onClick={() => setReplacing(replacing?.id === d.id ? null : d)}><Repeat className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" aria-label={`Cancel ${d.facultyName}'s duty`} title="Cancel" onClick={() => setCancelling(d)}><X className="h-3.5 w-3.5" /></Button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right: faculty */}
      <Card>
        <CardContent className="space-y-3 p-4">
          {replacing && (
            <div className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
              <span>Pick who takes over <b>{replacing.facultyName}</b>&rsquo;s duty.</span>
              <Button size="sm" variant="ghost" onClick={() => setReplacing(null)}>Stop</Button>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="relative"><Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search faculty" className="pl-8" placeholder="Name, ID or role" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <select aria-label="Department" className={selectClass} value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{departments.map((d) => <option key={d} value={d}>{d}</option>)}</select>
            <select aria-label="Designation" className={selectClass} value={desig} onChange={(e) => setDesig(e.target.value)}><option value="">All designations</option>{designations.map((d) => <option key={d} value={d}>{designationLabel(d)}</option>)}</select>
            <select aria-label="Show" className={selectClass} value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
              <option value="ELIGIBLE">Can take it</option><option value="UNAVAILABLE">Can&rsquo;t take it (with reasons)</option><option value="ALL">Everyone</option>
            </select>
          </div>
          {schedule.status === "ACTIVE" && slot && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={assign} loading={busy} disabled={!picked.length}><UserPlus className="mr-1 h-4 w-4" />{replacing ? "Give the duty" : `Assign ${picked.length || ""}`}</Button>
              {!replacing && <Button size="sm" variant="outline" onClick={() => void send({ slotKey, auto: true })} disabled={busy || open === 0}><Sparkles className="mr-1 h-4 w-4" />Auto-fill {open || ""}</Button>}
              <span className="text-xs text-muted-foreground">{open ? `${open} place${open === 1 ? "" : "s"} open` : "Filled"} · fairest first (fewest duties)</span>
            </div>
          )}
          {loading || rows === null ? (
            <div className="h-40 animate-pulse rounded-md bg-muted/30" />
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nobody matches.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr><th className="w-8 p-2" /><th className="p-2">Faculty</th><th className="p-2">Department · Designation</th><th className="p-2">Status</th><th className="p-2 text-center">Duties</th><th className="p-2">Rooms so far</th></tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const can = SELECTABLE.has(r.availability) && schedule.status === "ACTIVE";
                    return (
                      <tr key={r.facultyId} className="border-t align-top">
                        <td className="p-2"><Checkbox aria-label={`Pick ${r.name}`} disabled={!can} checked={picked.includes(r.facultyId)} onCheckedChange={(v) => setPicked((p) => (v ? (replacing ? [r.facultyId] : [...p, r.facultyId]) : p.filter((x) => x !== r.facultyId)))} /></td>
                        <td className="p-2"><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.employeeId}{r.roles.length ? ` · ${r.roles.join(", ")}` : ""}</p></td>
                        <td className="p-2 text-xs">{r.department}<br /><span className="text-muted-foreground">{designationLabel(r.designation)}</span></td>
                        <td className="p-2">
                          <Badge variant={AVAILABILITY_TONE[r.availability]}>{AVAILABILITY_LABELS[r.availability]}</Badge>
                          {r.evaluation.issues.filter((i) => i.rule !== "FULL").map((i, k) => <p key={k} className={`mt-1 text-xs ${i.level === "HARD" ? "text-destructive" : "text-amber-700 dark:text-amber-400"}`}>{i.message}</p>)}
                          {r.evaluation.freeRanges && <p className="mt-1 text-xs text-muted-foreground">Free {r.evaluation.freeRanges.map((f) => `${f.from}-${f.to}`).join(", ")}</p>}
                        </td>
                        <td className="p-2 text-center text-xs">
                          <b className="text-sm">{r.workload.total}</b>{r.remaining !== null ? <span className="text-muted-foreground"> / {r.workload.total + r.remaining}</span> : null}
                          <p className="text-muted-foreground">I {r.workload.byCategory.INVIGILATOR} · R {r.workload.byCategory.RELIEVER} · S {r.workload.byCategory.SQUAD}</p>
                          {r.workload.onDate > 0 && <p className="text-muted-foreground">{r.workload.onDate} that day</p>}
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">{r.rooms.length ? r.rooms.map((x) => `${x.room} (${x.date.slice(5)})`).join("; ") : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={reasonOpen}
        onOpenChange={setReasonOpen}
        title="Override needed"
        description={canOverride ? "Someone picked breaks a Warn rule. Give the reason - it is kept with the duty and in the audit log." : "Someone picked breaks a Warn rule, and only the Exam Cell users named as approvers in the configuration may override it."}
        confirmLabel="Override and assign"
        confirmDisabled={!canOverride || !reason.trim()}
        loading={busy}
        onConfirm={confirmWithReason}
      >
        <div className="space-y-2 text-sm">
          {pickedRows.flatMap((r) => r.evaluation.issues.filter((i) => i.level === "WARN").map((i, k) => <p key={`${r.facultyId}${k}`}><b>{r.name}:</b> {i.message}</p>))}
          {canOverride && <Textarea aria-label="Reason" placeholder="Reason for the override" value={reason} onChange={(e) => setReason(e.target.value)} />}
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={`Cancel ${cancelling?.facultyName ?? ""}'s duty?`}
        description={cancelling?.status !== "DRAFT" ? "They were told of this duty - they are notified it is cancelled." : "This draft duty is removed from their count."}
        confirmLabel="Cancel duty"
        variant="destructive"
        loading={busy}
        onConfirm={() => { const d = cancelling!; setCancelling(null); void send({ action: "cancel" }, `/api/college/invigilation/duties/${d.id}`, "PATCH"); }}
      />
    </div>
  );
}
