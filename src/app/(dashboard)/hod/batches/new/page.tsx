"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import { ShieldCheck } from "lucide-react";
import { ROLE_LABELS } from "@/types";
import type { VacancyRequest, Candidate, FMSUser } from "@/types";

const DEFAULT_ROLES = ["PRINCIPAL", "VICE_PRINCIPAL"] as const;
const SELECTABLE_ROLES = ["HOD", "PANEL_MEMBER"] as const;

export default function NewBatchPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const searchParams = useSearchParams();
  const prefilledVacancyId = searchParams.get("vacancyId") ?? "";

  const [vacancies, setVacancies] = useState<VacancyRequest[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  // Always-included locked panel members (Principal, VP — fetched)
  const [defaultMembers, setDefaultMembers] = useState<FMSUser[]>([]);
  // Selectable: other HODs + PANEL_MEMBER
  const [staffList, setStaffList] = useState<FMSUser[]>([]);

  const [selectedVacancyId, setSelectedVacancyId] = useState("");
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]);
  // selectedPanel includes HOD + all defaults; extras toggled by user
  const [selectedPanel, setSelectedPanel] = useState<string[]>(() =>
    user?.uid ? [user.uid] : []
  );
  const [interviewDate, setInterviewDate] = useState("");
  const [interviewTime, setInterviewTime] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/college/vacancy-requests?status=APPROVED")
        .then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>)
        .then((d) => d.vacancyRequests ?? []),
      fetch("/api/college/candidates?isShortlisted=true")
        .then((r) => r.json() as Promise<{ candidates: Candidate[] }>)
        .then((d) => d.candidates ?? []),
      fetch("/api/college/users?allDepts=true&includeAll=true")
        .then((r) => r.json() as Promise<{ users: FMSUser[] }>)
        .then((d) => d.users ?? []),
    ])
      .then(([v, c, s]) => {
        setVacancies(v);
        setCandidates(c);

        // Auto-select if vacancyId was passed from pipeline
        if (prefilledVacancyId && v.find((vac) => vac.id === prefilledVacancyId)) {
          setSelectedVacancyId(prefilledVacancyId);
        }

        // Locked defaults: Principal + VP (excluding self, though unlikely)
        const defaults = s.filter(
          (u) => u.uid !== user?.uid && (DEFAULT_ROLES as readonly string[]).includes(u.role)
        );
        setDefaultMembers(defaults);

        // Selectable: other HODs + PANEL_MEMBER (excluding self)
        setStaffList(
          s.filter(
            (u) => u.uid !== user?.uid && (SELECTABLE_ROLES as readonly string[]).includes(u.role)
          )
        );

        // Build full default uid set: HOD + all Principals + all VPs
        const defaultUids = [
          ...(user?.uid ? [user.uid] : []),
          ...defaults.map((u) => u.uid),
        ];
        setSelectedPanel((prev) => {
          const merged = [...prev];
          for (const uid of defaultUids) {
            if (!merged.includes(uid)) merged.push(uid);
          }
          return merged;
        });
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load data" }));
  }, [user?.uid]);

  // Uids that must always stay in selectedPanel
  const lockedUids = new Set([
    ...(user?.uid ? [user.uid] : []),
    ...defaultMembers.map((u) => u.uid),
  ]);

  const selectedVacancy = vacancies.find((v) => v.id === selectedVacancyId);
  const filteredCandidates = selectedVacancy
    ? candidates.filter(
        (c) =>
          !c.batchId &&
          (c.vacancyId === selectedVacancyId || c.position === selectedVacancy.position)
      )
    : candidates.filter((c) => !c.batchId);

  function toggleCandidate(id: string) {
    setSelectedCandidates((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  function togglePanel(uid: string) {
    if (lockedUids.has(uid)) return; // cannot deselect locked members
    setSelectedPanel((prev) =>
      prev.includes(uid) ? prev.filter((u) => u !== uid) : [...prev, uid]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedVacancyId) { toast({ variant: "destructive", title: "Select a hiring request" }); return; }
    if (selectedCandidates.length === 0) { toast({ variant: "destructive", title: "Select at least one candidate" }); return; }
    if (!interviewDate) { toast({ variant: "destructive", title: "Set an interview date" }); return; }
    if (!interviewTime) { toast({ variant: "destructive", title: "Set an interview time" }); return; }

    const vacancy = vacancies.find((v) => v.id === selectedVacancyId)!;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/college/hiring-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vacancyId: selectedVacancyId,
          department: vacancy.department,
          position: vacancy.position,
          panelMemberUids: selectedPanel,
          candidateIds: selectedCandidates,
          interviewDate,
          interviewTime,
        }),
      });
      const json = await res.json() as { id?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to create batch", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Interview panel proposal submitted to Principal" });
      router.push("/hod/batches");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  const extraSelected = selectedPanel.filter((uid) => !lockedUids.has(uid)).length;

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="New Interview Batch"
        description="Create an interview panel proposal and submit to Principal"
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Vacancy Selection */}
        <Card>
          <CardHeader><CardTitle className="text-base">Step 1: Select Hiring Request</CardTitle></CardHeader>
          <CardContent>
            {vacancies.length === 0 ? (
              <p className="text-sm text-muted-foreground">No approved hiring requests. Get a hiring request approved first.</p>
            ) : prefilledVacancyId ? (
              // Locked card — came from pipeline; show vacancy details once loaded
              <div className="flex items-center justify-between rounded-lg border-2 border-primary bg-primary/5 px-4 py-3">
                {selectedVacancy ? (
                  <div>
                    <p className="text-sm font-semibold text-primary">{selectedVacancy.position}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {selectedVacancy.department} · {selectedVacancy.requiredCount} position{selectedVacancy.requiredCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                )}
                <span className="text-[10px] text-primary font-medium">Auto-linked ✓</span>
              </div>
            ) : (
              <Select value={selectedVacancyId} onValueChange={setSelectedVacancyId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an approved hiring request" />
                </SelectTrigger>
                <SelectContent>
                  {vacancies.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.position} — {v.department} ({v.requiredCount} positions)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        {/* Interview Date & Time */}
        <Card>
          <CardHeader><CardTitle className="text-base">Step 2: Interview Date & Time</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="interviewDate">Proposed Interview Date *</Label>
                <Input
                  id="interviewDate"
                  type="date"
                  value={interviewDate}
                  min={new Date().toISOString().split("T")[0]}
                  onChange={(e) => setInterviewDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="interviewTime">Interview Time *</Label>
                <Input
                  id="interviewTime"
                  type="time"
                  value={interviewTime}
                  onChange={(e) => setInterviewTime(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Candidate Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Step 3: Select Candidates
              {selectedCandidates.length > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {selectedCandidates.length} selected
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredCandidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No shortlisted candidates without a batch. Add and shortlist candidates first.
              </p>
            ) : (
              <div className="space-y-3">
                {filteredCandidates.map((c) => (
                  <div key={c.id} className="flex items-start gap-3 p-3 border rounded-lg">
                    <Checkbox
                      id={`c-${c.id}`}
                      checked={selectedCandidates.includes(c.id)}
                      onCheckedChange={() => toggleCandidate(c.id)}
                    />
                    <label htmlFor={`c-${c.id}`} className="flex-1 cursor-pointer">
                      <p className="font-medium text-sm">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.email} · {c.phone}</p>
                      <p className="text-xs text-muted-foreground">{c.position} · {c.department}</p>
                    </label>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Panel Member Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Step 4: Panel Members
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {selectedPanel.length} total ({lockedUids.size} default
                {extraSelected > 0 && ` + ${extraSelected} selected`})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">

            {/* HOD — locked */}
            <DefaultMemberRow
              name={user?.name ?? "You"}
              subtitle={`Head of Department${user?.department ? ` · ${user.department}` : ""}`}
            />

            {/* Principal + VP — locked */}
            {defaultMembers.map((m) => (
              <DefaultMemberRow
                key={m.uid}
                name={m.name}
                subtitle={ROLE_LABELS[m.role] ?? m.role}
              />
            ))}

            {/* Divider */}
            {staffList.length > 0 && (
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide pt-1">
                Additional members (optional)
              </p>
            )}

            {/* Selectable: other HODs + PANEL_MEMBER */}
            {staffList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No additional staff available.</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {staffList.map((s) => (
                  <div key={s.uid} className="flex items-center gap-3 p-2 border rounded-lg">
                    <Checkbox
                      id={`p-${s.uid}`}
                      checked={selectedPanel.includes(s.uid)}
                      onCheckedChange={() => togglePanel(s.uid)}
                    />
                    <label htmlFor={`p-${s.uid}`} className="flex-1 cursor-pointer">
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {ROLE_LABELS[s.role] ?? s.role}{s.department ? ` · ${s.department}` : ""}
                      </p>
                    </label>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" loading={isSubmitting}>Submit to Principal</Button>
        </div>
      </form>
    </div>
  );
}

function DefaultMemberRow({ name, subtitle }: { name: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 p-2.5 border-2 border-primary/30 bg-primary/5 rounded-lg">
      <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <span className="text-[10px] font-semibold bg-primary text-primary-foreground px-2 py-0.5 rounded-full shrink-0">
        Default
      </span>
    </div>
  );
}
