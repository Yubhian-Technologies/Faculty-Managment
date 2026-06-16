"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { VacancyRequest, Candidate, FMSUser } from "@/types";

export default function NewBatchPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [vacancies, setVacancies] = useState<VacancyRequest[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [staffList, setStaffList] = useState<FMSUser[]>([]);

  const [selectedVacancyId, setSelectedVacancyId] = useState("");
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]);
  const [selectedPanel, setSelectedPanel] = useState<string[]>([]);
  const [interviewDate, setInterviewDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/college/vacancy-requests?status=APPROVED")
        .then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>)
        .then((d) => d.vacancyRequests ?? []),
      fetch("/api/college/candidates?isShortlisted=true")
        .then((r) => r.json() as Promise<{ candidates: Candidate[] }>)
        .then((d) => d.candidates ?? []),
      fetch("/api/college/users?allDepts=true")
        .then((r) => r.json() as Promise<{ users: FMSUser[] }>)
        .then((d) => d.users ?? []),
    ])
      .then(([v, c, s]) => {
        setVacancies(v);
        setCandidates(c);
        // Exclude current user and show all staff as potential panel members
        setStaffList(s.filter((u) => u.uid !== user?.uid));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load data" }));
  }, [user?.uid]);

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
    setSelectedPanel((prev) =>
      prev.includes(uid) ? prev.filter((u) => u !== uid) : [...prev, uid]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedVacancyId) { toast({ variant: "destructive", title: "Select a vacancy" }); return; }
    if (selectedCandidates.length === 0) { toast({ variant: "destructive", title: "Select at least one candidate" }); return; }
    if (selectedPanel.length < 2) { toast({ variant: "destructive", title: "Select at least 2 panel members" }); return; }
    if (!interviewDate) { toast({ variant: "destructive", title: "Set an interview date" }); return; }

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

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="New Interview Batch"
        description="Create an interview panel proposal and submit to Principal"
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Vacancy Selection */}
        <Card>
          <CardHeader><CardTitle className="text-base">Step 1: Select Vacancy</CardTitle></CardHeader>
          <CardContent>
            {vacancies.length === 0 ? (
              <p className="text-sm text-muted-foreground">No approved vacancies. Get a vacancy approved first.</p>
            ) : (
              <Select onValueChange={setSelectedVacancyId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an approved vacancy" />
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

        {/* Interview Date */}
        <Card>
          <CardHeader><CardTitle className="text-base">Step 2: Interview Date</CardTitle></CardHeader>
          <CardContent>
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
              Step 4: Select Panel Members (min 2)
              {selectedPanel.length > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {selectedPanel.length} selected
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {staffList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No staff members available.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {staffList.map((s) => (
                  <div key={s.uid} className="flex items-center gap-3 p-2 border rounded-lg">
                    <Checkbox
                      id={`p-${s.uid}`}
                      checked={selectedPanel.includes(s.uid)}
                      onCheckedChange={() => togglePanel(s.uid)}
                    />
                    <label htmlFor={`p-${s.uid}`} className="flex-1 cursor-pointer">
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{ROLE_LABELS[s.role] ?? s.role}{s.department ? ` · ${s.department}` : ""}</p>
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
