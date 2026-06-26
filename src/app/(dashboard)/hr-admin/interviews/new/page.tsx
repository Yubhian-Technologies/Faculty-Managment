"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";
import type { FMSUser, LocationDepartment } from "@/types";

interface LocationCandidate {
  id: string;
  name: string;
  department: string;
  qualification?: string;
  status: string;
}

export default function NewInterviewPlanPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [interviewDate, setInterviewDate] = useState("");
  const [venue, setVenue] = useState("");
  const [notes, setNotes] = useState("");
  const [candidates, setCandidates] = useState<LocationCandidate[]>([]);
  const [locationUsers, setLocationUsers] = useState<FMSUser[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [selectedPanel, setSelectedPanel] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [depts, setDepts] = useState<LocationDepartment[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/location/candidates")
        .then((r) => r.json() as Promise<{ candidates: LocationCandidate[] }>)
        .then((d) => setCandidates((d.candidates ?? []).filter((c) => c.status === "SHORTLISTED"))),
      fetch("/api/location/users")
        .then((r) => r.json() as Promise<{ users: FMSUser[] }>)
        .then((d) => setLocationUsers((d.users ?? []).filter((u) =>
          ["ADMINISTRATION", "HR_ADMIN", "LOCATION_DEPT_HEAD"].includes(u.role)
        ))),
      fetch("/api/location/departments")
        .then((r) => r.json() as Promise<{ departments: LocationDepartment[] }>)
        .then((d) => setDepts(d.departments ?? [])),
    ]).catch(() => {});
  }, []);

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

  const ROLE_LABELS: Record<string, string> = {
    ADMINISTRATION: "Administration",
    HR_ADMIN: "HR Admin",
    LOCATION_DEPT_HEAD: "Dept Head",
  };

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

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Shortlisted Candidates
              {candidates.length === 0 && <span className="text-xs font-normal text-muted-foreground ml-2">(No shortlisted candidates. Shortlist first.)</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {candidates.map((c) => (
              <label key={c.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted cursor-pointer">
                <Checkbox
                  checked={selectedCandidates.has(c.id)}
                  onCheckedChange={() => toggleCandidate(c.id)}
                />
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.department}{c.qualification ? ` · ${c.qualification}` : ""}</p>
                </div>
              </label>
            ))}
            {candidates.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">No shortlisted candidates available.</p>
            )}
            {selectedCandidates.size > 0 && (
              <p className="text-xs text-muted-foreground pt-1">{selectedCandidates.size} candidate(s) selected</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Panel Members <span className="text-destructive">*</span></CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {locationUsers.map((u) => (
              <label key={u.uid} className="flex items-center gap-3 p-2 rounded hover:bg-muted cursor-pointer">
                <Checkbox
                  checked={selectedPanel.has(u.uid)}
                  onCheckedChange={() => togglePanel(u.uid)}
                />
                <div>
                  <p className="text-sm font-medium">{u.name}</p>
                  <p className="text-xs text-muted-foreground">{ROLE_LABELS[u.role] ?? u.role}</p>
                </div>
              </label>
            ))}
            {locationUsers.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">No eligible panel members found.</p>
            )}
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
