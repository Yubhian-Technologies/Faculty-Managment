"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { getJson } from "@/components/dashboard/DashboardParts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { MEETING_PLATFORM_LABELS, type Candidate, type CandidateApplication, type HiringBatch, type MeetingPlatform, type VacancyRequest } from "@/types";

// HR > Interviews > Schedule Interview: an approved hiring request -> its shortlisted candidates (all included, as on
// the HOD's form) -> date and time (and the online platform + link for an online request) -> the panel: the request's
// HOD always, the Principal / VP / College Admin ticked by default, the department's faculty to add. Goes to the
// Principal for approval; the HOD then sets up the demo room and coordinator.

interface Person { uid: string; name: string; role: string; department?: string }
interface PanelOptions { hod: Person | null; defaults: Person[]; faculty: Person[] }
const ROLE: Record<string, string> = { PRINCIPAL: "Principal", VICE_PRINCIPAL: "Vice Principal", COLLEGE_ADMIN: "College Admin", DIRECTOR: "Director", HOD: "HOD", PANEL_MEMBER: "Faculty", DEPARTMENT_OFFICE: "Department Office" };

export default function HrScheduleInterviewPage() {
  const router = useRouter();
  const pre = useSearchParams().get("vacancyId") ?? "";
  const [vacancyId, setVacancyId] = useState(pre);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [platform, setPlatform] = useState<MeetingPlatform | "">("");
  const [link, setLink] = useState("");
  const [extra, setExtra] = useState<Set<string>>(new Set());
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const vac = useQuery({ queryKey: ["hr-vacancies"], queryFn: () => getJson<{ vacancyRequests: VacancyRequest[] }>("/api/college/vacancy-requests") });
  const apps = useQuery({ queryKey: ["hr-applications"], queryFn: () => getJson<{ applications: CandidateApplication[] }>("/api/college/candidate-applications") });
  const cands = useQuery({ queryKey: ["hr-candidates"], queryFn: () => getJson<{ candidates: Candidate[] }>("/api/college/candidates") });
  const batches = useQuery({ queryKey: ["hr-batches"], queryFn: () => getJson<{ batches: HiringBatch[] }>("/api/college/hiring-batches") });
  const panel = useQuery({ queryKey: ["hr-panel", vacancyId], queryFn: () => getJson<PanelOptions>(`/api/college/hr/panel-options?vacancyId=${vacancyId}`), enabled: !!vacancyId });

  const completed = useMemo(() => new Set((batches.data?.batches ?? []).filter((b) => b.currentPhase === "COMPLETED").map((b) => b.vacancyId)), [batches.data]);
  const open = (vac.data?.vacancyRequests ?? []).filter((v) => v.status === "APPROVED" && v.requiredCount > 0 && !completed.has(v.id));
  const vacancy = open.find((v) => v.id === vacancyId);
  const names = useMemo(() => new Map((cands.data?.candidates ?? []).map((c) => [c.id, c.name])), [cands.data]);
  const shortlisted = (apps.data?.applications ?? []).filter((a) => a.vacancyRequestId === vacancyId && a.isShortlisted && !a.batchId && a.status !== "APPROVED" && a.status !== "REJECTED");
  const online = vacancy?.hiringMode === "ONLINE";
  const p = panel.data;
  const panelUids = p ? [
    ...(p.hod ? [p.hod.uid] : []),
    ...p.defaults.filter((x) => !dropped.has(x.uid)).map((x) => x.uid),
    ...p.faculty.filter((x) => extra.has(x.uid)).map((x) => x.uid),
  ] : [];
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, uid: string) => { const n = new Set(set); if (n.has(uid)) n.delete(uid); else n.add(uid); setter(n); };

  const submit = async () => {
    if (!vacancy) { toast({ variant: "destructive", title: "Select a hiring request." }); return; }
    if (shortlisted.length === 0) { toast({ variant: "destructive", title: "Shortlist at least one candidate for this request first." }); return; }
    if (!date || !time) { toast({ variant: "destructive", title: "Set the interview date and time." }); return; }
    if (online && (!platform || !link.trim())) { toast({ variant: "destructive", title: "Select a platform and enter the meeting link." }); return; }
    if (panelUids.length < 2) { toast({ variant: "destructive", title: "Select at least 2 panel members." }); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/college/hiring-batches", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vacancyId: vacancy.id, department: vacancy.department, position: vacancy.position, panelMemberUids: panelUids,
          applicationIds: shortlisted.map((a) => a.id), interviewDate: date, interviewTime: time, hiringMode: online ? "ONLINE" : "OFFLINE",
          ...(online ? { meetingPlatform: platform, meetingLink: link.trim() } : {}),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Unable to schedule the interview.");
      toast({ variant: "success", title: "Interview scheduled. It is with the Principal for approval." });
      router.push("/hr/interviews");
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to schedule the interview." }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Schedule Interview" description="Every shortlisted candidate of the request is included. It goes to the Principal for approval; the HOD then sets up the demo room and coordinator." />
      <Card>
        <CardHeader><CardTitle className="text-base">Hiring Request</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Select value={vacancyId} onValueChange={(v) => { setVacancyId(v); setExtra(new Set()); setDropped(new Set()); }}>
            <SelectTrigger className="max-w-xl"><SelectValue placeholder="Select an approved hiring request" /></SelectTrigger>
            <SelectContent>{open.map((v) => <SelectItem key={v.id} value={v.id}>{v.position} · {v.department} ({v.requiredCount} open{v.hiringMode === "ONLINE" ? ", online" : ""})</SelectItem>)}</SelectContent>
          </Select>
          {vacancy && (
            shortlisted.length === 0
              ? <p className="text-sm text-amber-800 dark:text-amber-300">No shortlisted candidates for this request yet. Shortlist them on Applications first.</p>
              : <div className="text-sm"><p className="mb-1 text-muted-foreground">Candidates ({shortlisted.length})</p><p>{shortlisted.map((a) => names.get(a.candidateId) ?? "-").join(", ")}</p></div>
          )}
        </CardContent>
      </Card>

      {vacancy && (
        <Card>
          <CardHeader><CardTitle className="text-base">When{online ? " and Where (Online)" : ""}</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-1"><Label>Time</Label><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
            {online && (
              <>
                <div className="space-y-1"><Label>Platform</Label>
                  <Select value={platform} onValueChange={(v) => setPlatform(v as MeetingPlatform)}>
                    <SelectTrigger><SelectValue placeholder="Select a platform" /></SelectTrigger>
                    <SelectContent>{(Object.keys(MEETING_PLATFORM_LABELS) as MeetingPlatform[]).map((x) => <SelectItem key={x} value={x}>{MEETING_PLATFORM_LABELS[x]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label>Meeting Link</Label><Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." /></div>
              </>
            )}
            {!online && <p className="text-xs text-muted-foreground sm:col-span-2">The venue is added on Interviews (Reschedule) or by the HOD / College Office during setup.</p>}
          </CardContent>
        </Card>
      )}

      {vacancy && (
        <Card>
          <CardHeader><CardTitle className="text-base">Interview Panel <span className="text-sm font-normal text-muted-foreground">({panelUids.length} selected)</span></CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {panel.isLoading ? <p className="text-muted-foreground">Loading...</p> : p && (
              <>
                {p.hod && <label className="flex items-center gap-2"><Checkbox checked disabled />{p.hod.name}<span className="text-xs text-muted-foreground">HOD - always on the panel</span></label>}
                {p.defaults.map((x) => (
                  <label key={x.uid} className="flex items-center gap-2"><Checkbox checked={!dropped.has(x.uid)} onCheckedChange={() => toggle(dropped, setDropped, x.uid)} />{x.name}<span className="text-xs text-muted-foreground">{ROLE[x.role] ?? x.role}</span></label>
                ))}
                {p.faculty.length > 0 && <p className="pt-1 text-xs font-medium text-muted-foreground">{vacancy.department}</p>}
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {p.faculty.map((x) => (
                    <label key={x.uid} className="flex items-center gap-2"><Checkbox checked={extra.has(x.uid)} onCheckedChange={() => toggle(extra, setExtra, x.uid)} />{x.name}<span className="text-xs text-muted-foreground">{ROLE[x.role] ?? x.role}</span></label>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/hr/interviews")}>Cancel</Button>
        <Button disabled={busy || !vacancy} onClick={() => void submit()}>{busy ? "Scheduling..." : "Schedule Interview"}</Button>
      </div>
    </div>
  );
}
