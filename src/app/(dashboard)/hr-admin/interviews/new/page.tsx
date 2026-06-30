"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import type { FMSUser } from "@/types";

interface LocationCandidate {
  id: string;
  name: string;
  department: string;
  appliedPosition?: string;
  qualification?: string;
  status: string;
}

interface LocationVacancy {
  id: string;
  department: string;
  position: string;
  requiredCount: number;
  qualification?: string;
  status: string;
}

const ROLE_LABELS: Record<string, string> = {
  ADMINISTRATION: "Administration",
  HR_ADMIN: "HR Admin",
  LOCATION_DEPT_HEAD: "Dept Head",
};

export default function NewInterviewPlanPage() {
  const router = useRouter();

  const [vacancies, setVacancies] = useState<LocationVacancy[]>([]);
  const [selectedVacancyId, setSelectedVacancyId] = useState("");
  const [allCandidates, setAllCandidates] = useState<LocationCandidate[]>([]);
  const [locationUsers, setLocationUsers] = useState<FMSUser[]>([]);
  const [title, setTitle] = useState("");
  const [interviewDate, setInterviewDate] = useState("");
  const [venue, setVenue] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [selectedPanel, setSelectedPanel] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/location/vacancy-requests")
        .then((r) => r.json() as Promise<{ vacancyRequests: LocationVacancy[] }>)
        .then((d) => (d.vacancyRequests ?? []).filter((v) => v.status === "APPROVED")),
      fetch("/api/location/candidates")
        .then((r) => r.json() as Promise<{ candidates: LocationCandidate[] }>)
        .then((d) => (d.candidates ?? []).filter((c) => c.status === "SHORTLISTED")),
      fetch("/api/location/users")
        .then((r) => r.json() as Promise<{ users: FMSUser[] }>)
        .then((d) => (d.users ?? []).filter((u) =>
          ["ADMINISTRATION", "HR_ADMIN", "LOCATION_DEPT_HEAD"].includes(u.role)
        )),
    ])
      .then(([v, c, u]) => {
        setVacancies(v);
        setAllCandidates(c);
        setLocationUsers(u);
      })
      .catch(() => {});
  }, []);

  const selectedVacancy = vacancies.find((v) => v.id === selectedVacancyId) ?? null;

  // When vacancy changes: filter candidates + auto-select matching dept head
  function handleVacancyChange(vacancyId: string) {
    setSelectedVacancyId(vacancyId);
    setSelectedCandidates(new Set());

    const vacancy = vacancies.find((v) => v.id === vacancyId);
    if (!vacancy) { setSelectedPanel(new Set()); return; }

    // Auto-select the dept head whose department matches
    const deptHead = locationUsers.find(
      (u) => u.role === "LOCATION_DEPT_HEAD" &&
        (u as unknown as { department?: string }).department === vacancy.department
    );
    if (deptHead) {
      setSelectedPanel(new Set([deptHead.uid]));
    } else {
      setSelectedPanel(new Set());
    }
  }

  const filteredCandidates = selectedVacancy
    ? allCandidates.filter((c) => c.department === selectedVacancy.department)
    : allCandidates;

  function toggleCandidate(id: string) {
    setSelectedCandidates((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function togglePanel(uid: string) {
    setSelectedPanel((prev) => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title || !interviewDate || !venue || selectedCandidates.size === 0 || selectedPanel.size === 0) return;

    const panelMembers = locationUsers
      .filter((u) => selectedPanel.has(u.uid))
      .map((u) => ({ uid: u.uid, name: u.name, role: u.role }));

    setSaving(true);
    try {
      const res = await fetch("/api/location/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, interviewDate, venue, notes,
          panelMembers,
          shortlistedCandidateIds: Array.from(selectedCandidates),
          vacancyId: selectedVacancyId || undefined,
        }),
      });
      const json = await res.json() as { id?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to create", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Interview plan submitted", description: "Administration will review and approve." });
      router.push("/hr-admin/interviews");
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  const isValid = title && interviewDate && venue && selectedCandidates.size > 0 && selectedPanel.size > 0;

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader title="New Interview Plan" description="Create an interview plan for shortlisted candidates" />
      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Vacancy selector */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Hiring Request</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Select Approved Vacancy <span className="text-destructive">*</span></Label>
              <Select value={selectedVacancyId} onValueChange={handleVacancyChange}>
                <SelectTrigger>
                  <SelectValue placeholder={vacancies.length === 0 ? "No approved vacancies" : "Select a vacancy..."} />
                </SelectTrigger>
                <SelectContent>
                  {vacancies.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.position} — {v.department}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {vacancies.length === 0 && (
                <p className="text-xs text-muted-foreground">No approved hiring requests yet. Administration must approve one first.</p>
              )}
            </div>

            {selectedVacancy && (
              <div className="rounded-lg bg-muted/50 border p-3 space-y-1 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{selectedVacancy.position}</span>
                  <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-xs">Approved</Badge>
                </div>
                <p className="text-muted-foreground">
                  {selectedVacancy.department}
                  {selectedVacancy.qualification ? ` · ${selectedVacancy.qualification}` : ""}
                  {` · ${selectedVacancy.requiredCount} seat${selectedVacancy.requiredCount !== 1 ? "s" : ""}`}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Interview details */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Interview Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Interview Title <span className="text-destructive">*</span></Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Faculty Interview — Electrical Dept 2026" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Interview Date <span className="text-destructive">*</span></Label>
                <Input type="date" value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Venue <span className="text-destructive">*</span></Label>
                <Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Conference Hall / Room No." />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Additional Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any special instructions..." />
            </div>
          </CardContent>
        </Card>

        {/* Candidates — filtered by selected vacancy's department */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Shortlisted Candidates
              </CardTitle>
              {selectedVacancy && (
                <span className="text-xs text-muted-foreground">{selectedVacancy.department} only</span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {!selectedVacancyId && (
              <p className="text-sm text-muted-foreground py-2">Select a vacancy above to see candidates for that department.</p>
            )}
            {selectedVacancyId && filteredCandidates.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">
                No shortlisted candidates in <strong>{selectedVacancy?.department}</strong>. Shortlist candidates first.
              </p>
            )}
            {filteredCandidates.map((c) => (
              <label key={c.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted cursor-pointer">
                <Checkbox
                  checked={selectedCandidates.has(c.id)}
                  onCheckedChange={() => toggleCandidate(c.id)}
                />
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.department}
                    {c.appliedPosition ? ` · ${c.appliedPosition}` : ""}
                    {c.qualification ? ` · ${c.qualification}` : ""}
                  </p>
                </div>
              </label>
            ))}
            {selectedCandidates.size > 0 && (
              <p className="text-xs text-muted-foreground pt-1">{selectedCandidates.size} candidate(s) selected</p>
            )}
          </CardContent>
        </Card>

        {/* Panel members — dept head auto-selected based on vacancy */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Panel Members <span className="text-destructive">*</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {locationUsers.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">No eligible panel members found.</p>
            )}
            {locationUsers.map((u) => {
              const uDept = (u as unknown as { department?: string }).department;
              const isMatchingDeptHead = u.role === "LOCATION_DEPT_HEAD" && selectedVacancy && uDept === selectedVacancy.department;
              return (
                <label key={u.uid} className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${isMatchingDeptHead ? "bg-primary/5 border border-primary/20" : "hover:bg-muted"}`}>
                  <Checkbox
                    checked={selectedPanel.has(u.uid)}
                    onCheckedChange={() => togglePanel(u.uid)}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ROLE_LABELS[u.role] ?? u.role}
                      {uDept ? ` · ${uDept}` : ""}
                    </p>
                  </div>
                  {isMatchingDeptHead && (
                    <span className="text-xs text-primary font-medium">Auto-selected</span>
                  )}
                </label>
              );
            })}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!isValid}>
            Submit for Admin Approval
          </Button>
        </div>
      </form>
    </div>
  );
}
