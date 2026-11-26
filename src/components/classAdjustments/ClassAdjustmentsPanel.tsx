"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, CalendarClock, Repeat2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import type { ClassAdjustment, ClassAdjustmentLeg } from "@/types";

// "Adjust / Swap a Class" on Work Adjustments (lib/classAdjustments/server.ts): a faculty member hands a period to a
// colleague who teaches that section (the colleague teaches their own subject in it), or swaps periods with them on
// the same day. The colleague accepts or declines here; an HOD can arrange it for their department's faculty.

type Row = ClassAdjustment & { id: string; createdAt: string | null };
interface ListResponse { myFacultyId: string; mine: Row[]; isHod: boolean; department: Row[]; departmentFaculty: { id: string; name: string; department: string }[] }

interface SwapOption { slotId: string; periodNumber: number; startTime: string; endTime: string; sectionName: string; subjectName: string; myAssignments: { id: string; subjectName: string }[]; blocked: string | null }
interface CandidateOption { facultyId: string; name: string; department: string; assignments: { id: string; subjectName: string }[]; busy: string | null; swaps: SwapOption[] }
interface PeriodOption { slotId: string; periodNumber: number; startTime: string; endTime: string; sectionName: string; subjectName: string; blocked: string | null; candidates: CandidateOption[] }
interface OptionsResponse { faculty: { id: string; name: string }; periods: PeriodOption[]; noClassReason: string | null; error?: string }

const STATUS_LABEL: Record<ClassAdjustment["status"], string> = { PENDING: "Waiting", ACCEPTED: "In Force", DECLINED: "Declined", CANCELLED: "Cancelled" };
const STATUS_CLASS: Record<ClassAdjustment["status"], string> = {
  PENDING: "border-amber-300 text-amber-700 dark:text-amber-400",
  ACCEPTED: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  DECLINED: "text-muted-foreground",
  CANCELLED: "text-muted-foreground",
};

function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function niceDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
function legText(l: ClassAdjustmentLeg): string {
  const time = l.startTime && l.endTime ? ` (${l.startTime}-${l.endTime})` : "";
  return `${l.sectionName} · Period ${l.periodNumber}${time}: ${l.fromFacultyName} (${l.fromSubjectName}) → ${l.toFacultyName} teaches ${l.toSubjectName}`;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const d = (await res.json().catch(() => ({}))) as { error?: string };
  return d.error ?? fallback;
}

function RowCard({ r, actions }: { r: Row; actions?: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1 text-[11px]">
          {r.kind === "SWAP" ? <Repeat2 className="h-3 w-3" /> : <ArrowLeftRight className="h-3 w-3" />}
          {r.kind === "SWAP" ? "Swap" : "Adjust"}
        </Badge>
        <span className="text-sm font-medium">{niceDate(r.date)}</span>
        <Badge variant="outline" className={cn("text-[11px]", STATUS_CLASS[r.status])}>{STATUS_LABEL[r.status]}</Badge>
        {r.createdBy === "HOD" && <span className="text-xs text-muted-foreground">Arranged by {r.createdByName}</span>}
      </div>
      {r.legs.map((l, i) => <p key={i} className="text-sm">{legText(l)}</p>)}
      {r.reason && <p className="text-xs text-muted-foreground">Reason: {r.reason}</p>}
      {r.declineReason && <p className="text-xs text-muted-foreground">Declined: {r.declineReason}</p>}
      {r.status === "CANCELLED" && <p className="text-xs text-muted-foreground">Cancelled by {r.cancelledByName}{r.cancelReason ? ` - ${r.cancelReason}` : ""}</p>}
      {actions && <div className="flex flex-wrap justify-end gap-2 pt-1">{actions}</div>}
    </div>
  );
}

export function ClassAdjustmentsPanel() {
  // "?adjust=<slotId>" (the early check-out popup's Adjust Class): open the form on today's period.
  const [presetSlotId] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("adjust") ?? ""));
  const [open, setOpen] = useState(() => !!presetSlotId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declineFor, setDeclineFor] = useState<Row | null>(null);
  const [cancelFor, setCancelFor] = useState<Row | null>(null);
  const [note, setNote] = useState("");

  const query = useQuery({
    queryKey: ["class-adjustments"],
    queryFn: async () => {
      const r = await fetch("/api/college/class-adjustments");
      if (!r.ok) throw new Error(await readError(r, "Unable to load class adjustments."));
      return (await r.json()) as ListResponse;
    },
  });
  const data = query.data ?? null;
  const loading = query.isLoading;
  const load = () => { void query.refetch(); };

  const today = istToday();
  const me = data?.myFacultyId ?? "";
  const asked = (data?.mine ?? []).filter((r) => r.status === "PENDING" && r.counterpartFacultyId === me);
  const mine = (data?.mine ?? []).filter((r) => !(r.status === "PENDING" && r.counterpartFacultyId === me));
  const deptOnly = (data?.department ?? []).filter((r) => !r.facultyIds.includes(me));


  async function act(row: Row, action: "ACCEPT" | "DECLINE" | "CANCEL", reason?: string) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/college/class-adjustments/${row.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }),
      });
      if (!res.ok) throw new Error(await readError(res, "Unable to update the class adjustment."));
      toast({ title: action === "ACCEPT" ? "Class adjustment accepted." : action === "DECLINE" ? "Class adjustment declined." : "Class adjustment cancelled." });
      setDeclineFor(null); setCancelFor(null); setNote("");
      load();
    } catch (e) {
      toast({ variant: "destructive", title: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  const canCancel = (r: Row) => (r.status === "PENDING" || r.status === "ACCEPTED") && r.date >= today;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Adjust or Swap a Class</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Hand a period to a colleague who teaches the same section - they teach their own subject in it - or swap periods with them on the same day.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)} className="shrink-0"><CalendarClock className="h-4 w-4 mr-1.5" />Adjust or Swap</Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {query.error && !data ? <p className="text-sm text-destructive">{(query.error as Error).message}</p>
          : loading && !data ? <div className="h-20 rounded-lg border bg-muted/30 animate-pulse" /> : (
          <>
            {asked.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Requests for You</h3>
                {asked.map((r) => (
                  <RowCard key={r.id} r={r} actions={<>
                    <Button variant="outline" size="sm" disabled={busyId === r.id} onClick={() => { setNote(""); setDeclineFor(r); }}>Decline</Button>
                    <Button size="sm" loading={busyId === r.id} onClick={() => void act(r, "ACCEPT")}>Accept</Button>
                  </>} />
                ))}
              </section>
            )}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">My Class Adjustments</h3>
              {mine.length === 0 ? <p className="text-sm text-muted-foreground">No class adjustments yet.</p> : mine.map((r) => (
                <RowCard key={r.id} r={r} actions={canCancel(r) ? (
                  <Button variant="outline" size="sm" disabled={busyId === r.id} onClick={() => { setNote(""); setCancelFor(r); }}>Cancel</Button>
                ) : undefined} />
              ))}
            </section>
            {data?.isHod && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Department Class Adjustments</h3>
                {deptOnly.length === 0 ? <p className="text-sm text-muted-foreground">No class adjustments in your department in the last 30 days.</p> : deptOnly.map((r) => (
                  <RowCard key={r.id} r={r} actions={canCancel(r) ? (
                    <Button variant="outline" size="sm" disabled={busyId === r.id} onClick={() => { setNote(""); setCancelFor(r); }}>Cancel</Button>
                  ) : undefined} />
                ))}
              </section>
            )}
          </>
        )}
      </CardContent>

      {open && data && (
        <AdjustDialog
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); load(); }}
          myFacultyId={data.myFacultyId}
          departmentFaculty={data.isHod ? data.departmentFaculty : []}
          initialSlotId={presetSlotId ?? ""}
        />
      )}

      <Dialog open={!!declineFor || !!cancelFor} onOpenChange={(o) => { if (!o) { setDeclineFor(null); setCancelFor(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{declineFor ? "Decline Class Adjustment" : "Cancel Class Adjustment"}</DialogTitle>
            <DialogDescription>{declineFor ? "The colleague who asked is told." : "Everyone involved is told; the timetable period goes back to its own faculty."}</DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional)" rows={3} maxLength={300} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeclineFor(null); setCancelFor(null); }}>Close</Button>
            <Button
              variant="destructive"
              loading={!!busyId}
              onClick={() => { const r = declineFor ?? cancelFor; if (r) void act(r, declineFor ? "DECLINE" : "CANCEL", note); }}
            >{declineFor ? "Decline" : "Cancel Adjustment"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AdjustDialog({ onClose, onDone, myFacultyId, departmentFaculty, initialSlotId = "" }: {
  onClose: () => void; onDone: () => void; myFacultyId: string; departmentFaculty: { id: string; name: string; department: string }[];
  /** Today's period to start on (the early check-out popup). */
  initialSlotId?: string;
}) {
  const today = istToday();
  const [forId, setForId] = useState(myFacultyId);
  const [date, setDate] = useState(today);
  const [loaded, setLoaded] = useState<{ key: string; value: OptionsResponse } | null>(null);
  const [kind, setKind] = useState<"ADJUST" | "SWAP">("ADJUST");
  const [slotId, setSlotId] = useState(initialSlotId);
  const [toId, setToId] = useState("");
  const [toAssignmentId, setToAssignmentId] = useState("");
  const [swapSlotId, setSwapSlotId] = useState("");
  const [swapAssignmentId, setSwapAssignmentId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const forOther = forId !== myFacultyId;

  const key = `${date}|${forId}`;
  const opts = loaded?.key === key ? loaded.value : null;
  const loading = !opts;
  useEffect(() => {
    let live = true;
    const fail = (message: string): OptionsResponse => ({ faculty: { id: forId, name: "" }, periods: [], noClassReason: null, error: message });
    fetch(`/api/college/class-adjustments/options?date=${date}${forOther ? `&facultyId=${encodeURIComponent(forId)}` : ""}`)
      .then(async (r) => { const d = (await r.json()) as OptionsResponse; return r.ok ? d : fail(d.error ?? "Unable to load the periods."); })
      .catch(() => fail("Unable to load the periods. Check the connection and try again."))
      .then((d) => { if (live) setLoaded({ key: `${date}|${forId}`, value: d }); });
    return () => { live = false; };
  }, [date, forId, forOther]);

  const period = opts?.periods.find((p) => p.slotId === slotId) ?? null;
  const candidates = useMemo(() => (period?.candidates ?? []).filter((c) => kind === "ADJUST" || c.swaps.length > 0), [period, kind]);
  const cand = candidates.find((c) => c.facultyId === toId) ?? null;
  const swap = cand?.swaps.find((s) => s.slotId === swapSlotId) ?? null;

  function pickColleague(c: CandidateOption) {
    setToId(c.facultyId);
    setToAssignmentId(c.assignments.length === 1 ? c.assignments[0].id : "");
    setSwapSlotId(""); setSwapAssignmentId("");
  }
  function pickSwap(s: SwapOption) {
    setSwapSlotId(s.slotId);
    setSwapAssignmentId(s.myAssignments.length === 1 ? s.myAssignments[0].id : "");
  }

  const ready = !!period && !!cand && !!toAssignmentId && (kind === "ADJUST" ? !cand.busy : !!swap && !swap.blocked && !!swapAssignmentId);

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch("/api/college/class-adjustments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, date, slotId, toFacultyId: toId, toAssignmentId, swapSlotId: kind === "SWAP" ? swapSlotId : undefined, swapAssignmentId: kind === "SWAP" ? swapAssignmentId : undefined, reason, forFacultyId: forOther ? forId : undefined }),
      });
      if (!res.ok) throw new Error(await readError(res, "Unable to save the class adjustment."));
      toast({ title: forOther ? "Class adjustment arranged." : "Request sent." });
      onDone();
    } catch (e) {
      toast({ variant: "destructive", title: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const choice = (active: boolean, disabled = false) => cn(
    "w-full text-left rounded-lg border px-3 py-2 text-sm transition-colors",
    active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50",
    disabled && "opacity-60 cursor-not-allowed hover:bg-transparent",
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adjust or Swap a Class</DialogTitle>
          <DialogDescription>
            {forOther ? "In force at once; both faculty are told." : "Your colleague accepts or declines; your HOD is told once it is accepted."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {departmentFaculty.length > 0 && (
            <div className="space-y-1.5">
              <Label>Faculty</Label>
              <Select value={forId} onValueChange={(v) => { setForId(v); setSlotId(""); setToId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={myFacultyId}>My own classes</SelectItem>
                  {departmentFaculty.filter((f) => f.id !== myFacultyId).map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="adj-date">Date</Label>
              <Input id="adj-date" type="date" value={date} min={today} max={addDays(today, 14)} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setSlotId(""); setToId(""); } }} />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <div className="grid grid-cols-2 gap-1 rounded-lg border p-1">
                {(["ADJUST", "SWAP"] as const).map((k) => (
                  <button key={k} type="button" onClick={() => { setKind(k); setToId(""); }}
                    className={cn("rounded-md py-1.5 text-sm", kind === k ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
                    {k === "ADJUST" ? "Adjust" : "Swap"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{forOther ? "Period" : "Your Period"}</Label>
            {loading ? <div className="h-16 rounded-lg border bg-muted/30 animate-pulse" />
              : opts?.error ? <p className="text-sm text-destructive">{opts.error}</p>
              : opts?.noClassReason ? <p className="text-sm text-muted-foreground">No classes on this date - {opts.noClassReason}.</p>
              : !opts?.periods.length ? <p className="text-sm text-muted-foreground">No periods on the timetable for this date.</p>
              : (
                <div className="space-y-1.5">
                  {opts.periods.map((p) => (
                    <button key={p.slotId} type="button" disabled={!!p.blocked} onClick={() => { setSlotId(p.slotId); setToId(""); }} className={choice(slotId === p.slotId, !!p.blocked)}>
                      <span className="font-medium">Period {p.periodNumber}</span>
                      <span className="text-muted-foreground"> · {p.startTime}-{p.endTime} · {p.sectionName} · {p.subjectName}</span>
                      {p.blocked && <span className="block text-xs text-muted-foreground mt-0.5">{p.blocked}</span>}
                    </button>
                  ))}
                </div>
              )}
          </div>

          {period && (
            <div className="space-y-1.5">
              <Label>Colleague Teaching {period.sectionName}</Label>
              {candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {kind === "SWAP" ? "No colleague teaching this section has a period that day in a section you teach." : "No other faculty teach this section."}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {candidates.map((c) => {
                    const disabled = kind === "ADJUST" && !!c.busy;
                    return (
                      <button key={c.facultyId} type="button" disabled={disabled} onClick={() => pickColleague(c)} className={choice(toId === c.facultyId, disabled)}>
                        <span className="font-medium">{c.name}</span>
                        <span className="text-muted-foreground"> · {c.assignments.map((a) => a.subjectName).join(", ")}</span>
                        {kind === "ADJUST" && <span className={cn("block text-xs mt-0.5", c.busy ? "text-muted-foreground" : "text-emerald-700 dark:text-emerald-400")}>{c.busy ?? "Free at this time"}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {cand && cand.assignments.length > 1 && (
            <div className="space-y-1.5">
              <Label>Subject {cand.name} Will Teach</Label>
              <Select value={toAssignmentId} onValueChange={setToAssignmentId}>
                <SelectTrigger><SelectValue placeholder="Select a subject" /></SelectTrigger>
                <SelectContent>{cand.assignments.map((a) => <SelectItem key={a.id} value={a.id}>{a.subjectName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}

          {cand && kind === "SWAP" && (
            <div className="space-y-1.5">
              <Label>{forOther ? "Period Taken in Return" : "Their Period You Take in Return"}</Label>
              <div className="space-y-1.5">
                {cand.swaps.map((s) => (
                  <button key={s.slotId} type="button" disabled={!!s.blocked} onClick={() => pickSwap(s)} className={choice(swapSlotId === s.slotId, !!s.blocked)}>
                    <span className="font-medium">Period {s.periodNumber}</span>
                    <span className="text-muted-foreground"> · {s.startTime}-{s.endTime} · {s.sectionName} · {s.subjectName}</span>
                    {s.blocked && <span className="block text-xs text-muted-foreground mt-0.5">{s.blocked}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {swap && swap.myAssignments.length > 1 && (
            <div className="space-y-1.5">
              <Label>Subject Taught in Return</Label>
              <Select value={swapAssignmentId} onValueChange={setSwapAssignmentId}>
                <SelectTrigger><SelectValue placeholder="Select a subject" /></SelectTrigger>
                <SelectContent>{swap.myAssignments.map((a) => <SelectItem key={a.id} value={a.id}>{a.subjectName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="adj-reason">Reason</Label>
            <Textarea id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} placeholder="Optional" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button disabled={!ready} loading={saving} onClick={() => void submit()}>{forOther ? "Arrange" : "Send Request"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
