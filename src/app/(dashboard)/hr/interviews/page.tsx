"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, Mail, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { getJson } from "@/components/dashboard/DashboardParts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { cn, formatDate, formatDateTime, toDate } from "@/lib/utils";
import { istDateKey } from "@/lib/attendance/istTime";
import { BATCH_PHASE_LABELS, MEETING_PLATFORM_LABELS, type HiringBatch, type MeetingPlatform } from "@/types";

// HR > Interviews: every interview batch of the college - schedule a new one, change a schedule (date, time, venue,
// online link) until the interview starts, and email the candidates their invitations once the Principal approves.
// Setup (demo room, coordinator), scoring and decisions stay with the HOD, the panel and the Principal.

type Tab = "upcoming" | "past";
const EDITABLE = ["PRINCIPAL_REVIEW", "HOD_FINAL_SETUP", "INTERVIEW_READY"];
const INVITABLE = ["HOD_FINAL_SETUP", "INTERVIEW_READY"];

export default function HrInterviewsPage() {
  const [tab, setTab] = useState<Tab>("upcoming");
  const [edit, setEdit] = useState<HiringBatch | null>(null);
  const [form, setForm] = useState({ date: "", time: "", venue: "", platform: "" as MeetingPlatform | "", link: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["hr-batches"], queryFn: () => getJson<{ batches: HiringBatch[] }>("/api/college/hiring-batches") });

  const all = (q.data?.batches ?? []).filter((b) => b.status !== "REJECTED");
  const isPast = (b: HiringBatch) => b.currentPhase === "COMPLETED";
  const rows = all.filter((b) => (tab === "past") === isPast(b))
    .sort((a, b) => (tab === "past" ? -1 : 1) * ((toDate(a.interviewDate)?.getTime() ?? 0) - (toDate(b.interviewDate)?.getTime() ?? 0)));

  const openEdit = (b: HiringBatch) => {
    const d = toDate(b.interviewDate);
    setForm({ date: d ? istDateKey(d) : "", time: b.interviewTime ?? "", venue: b.interviewVenue ?? "", platform: (b.meetingPlatform ?? "") as MeetingPlatform | "", link: b.meetingLink ?? "" });
    setEdit(b);
  };
  const saveEdit = async () => {
    if (!edit) return;
    const online = edit.hiringMode === "ONLINE";
    setBusy(edit.id);
    try {
      const res = await fetch(`/api/college/hiring-batches/${edit.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewDate: form.date, interviewTime: form.time, ...(online ? { meetingPlatform: form.platform, meetingLink: form.link.trim() } : { interviewVenue: form.venue.trim() }) }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Unable to save the schedule.");
      toast({ variant: "success", title: "Schedule saved. The HOD and panel were told." });
      setEdit(null); await q.refetch();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save the schedule." }); }
    finally { setBusy(null); }
  };
  const invite = async (b: HiringBatch) => {
    setBusy(b.id);
    try {
      const res = await fetch(`/api/college/hiring-batches/${b.id}/invitations`, { method: "POST" });
      const json = (await res.json()) as { sent?: number; failed?: string[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Unable to send the invitations.");
      toast({ variant: json.failed?.length ? "destructive" : "success", title: `Invitations sent to ${json.sent ?? 0} candidate${json.sent === 1 ? "" : "s"}.`, ...(json.failed?.length ? { description: `Not sent: ${json.failed.join(", ")}` } : {}) });
      await q.refetch();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to send the invitations." }); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Interviews" description="Schedule interviews for approved hiring requests, keep their schedule up to date and send the candidates their invitations."
        actions={<Button asChild><Link href="/hr/interviews/new"><CalendarPlus className="mr-1.5 h-4 w-4" />Schedule Interview</Link></Button>} />
      <div className="flex gap-1.5">
        {([["upcoming", "Upcoming and In Progress"], ["past", "Completed"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn("rounded-full border px-3 py-1 text-xs font-medium", tab === k ? "border-foreground bg-foreground text-background" : "bg-card hover:border-primary")}>{l}</button>
        ))}
      </div>
      {q.isError && <p className="text-sm text-destructive">Unable to load the interviews. Try again; if it continues, contact the administrator.</p>}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground">
            {["Date", "Position", "Mode / Venue", "Candidates", "Principal", "Stage", "Invitations", ""].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y">
            {rows.map((b) => (
              <tr key={b.id}>
                <td className="px-3 py-2.5 whitespace-nowrap">{formatDate(b.interviewDate)}{b.interviewTime && <span className="block text-xs text-muted-foreground">{b.interviewTime}</span>}</td>
                <td className="px-3 py-2.5 font-medium">{b.position}<span className="block text-xs font-normal text-muted-foreground">{b.department} · HOD {b.hodName ?? "-"}{b.scheduledByName ? ` · scheduled by ${b.scheduledByName}` : ""}</span></td>
                <td className="px-3 py-2.5 text-xs">{b.hiringMode === "ONLINE" ? `Online · ${MEETING_PLATFORM_LABELS[b.meetingPlatform as MeetingPlatform] ?? "-"}` : (b.interviewVenue || <span className="text-amber-700 dark:text-amber-400">Venue not set</span>)}</td>
                <td className="px-3 py-2.5 tabular-nums">{b.applicationIds?.length ?? 0}</td>
                <td className="px-3 py-2.5"><StatusBadge status={b.status} /></td>
                <td className="px-3 py-2.5 text-xs">{BATCH_PHASE_LABELS[b.currentPhase] ?? b.currentPhase}</td>
                <td className="px-3 py-2.5 text-xs">{b.invitationsSentAt ? `Sent ${formatDateTime(b.invitationsSentAt)}` : <span className="text-muted-foreground">Not sent</span>}</td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1.5">
                    {EDITABLE.includes(b.currentPhase) && <Button size="sm" variant="outline" disabled={busy === b.id} onClick={() => openEdit(b)}><Pencil className="mr-1 h-3.5 w-3.5" />Reschedule</Button>}
                    {b.status === "APPROVED" && INVITABLE.includes(b.currentPhase) && (
                      <Button size="sm" disabled={busy === b.id} onClick={() => void invite(b)}><Mail className="mr-1 h-3.5 w-3.5" />{b.invitationsSentAt ? "Send Again" : "Send Invitations"}</Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.data && rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{tab === "past" ? "No completed interviews." : "No interviews scheduled."}</p>}
      </Card>

      <Dialog open={!!edit} onOpenChange={(o) => { if (!o) setEdit(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule Interview</DialogTitle>
            <DialogDescription>{edit ? `${edit.position} · ${edit.department}. The HOD and the panel are told of a new date or time.` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Time</Label><Input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} /></div>
            {edit?.hiringMode === "ONLINE" ? (
              <>
                <div className="space-y-1"><Label>Platform</Label>
                  <Select value={form.platform} onValueChange={(v) => setForm((f) => ({ ...f, platform: v as MeetingPlatform }))}>
                    <SelectTrigger><SelectValue placeholder="Select a platform" /></SelectTrigger>
                    <SelectContent>{(Object.keys(MEETING_PLATFORM_LABELS) as MeetingPlatform[]).map((p) => <SelectItem key={p} value={p}>{MEETING_PLATFORM_LABELS[p]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label>Meeting Link</Label><Input value={form.link} onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))} placeholder="https://..." /></div>
              </>
            ) : (
              <div className="space-y-1 sm:col-span-2"><Label>Venue</Label><Input value={form.venue} onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))} placeholder="For example: Seminar Hall, Block A" /></div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button disabled={!form.date || busy === edit?.id} onClick={() => void saveEdit()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
