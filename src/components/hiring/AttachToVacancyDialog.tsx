"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/useToast";
import type { VacancyRequest, CandidateApplication, HiringBatch } from "@/types";

interface AttachToVacancyDialogProps {
  candidateId: string;
  candidateName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAttached: () => void;
}

export function AttachToVacancyDialog({
  candidateId,
  candidateName,
  open,
  onOpenChange,
  onAttached,
}: AttachToVacancyDialogProps) {
  const [vacancies, setVacancies] = useState<VacancyRequest[]>([]);
  const [attachedVacancyIds, setAttachedVacancyIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    setSelectedId("");
    setSearch("");
    void Promise.all([
      fetch("/api/college/vacancy-requests?status=APPROVED")
        .then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>)
        .then((d) => d.vacancyRequests ?? []),
      fetch(`/api/college/candidate-applications?candidateId=${candidateId}`)
        .then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>)
        .then((d) => d.applications ?? []),
      fetch("/api/college/hiring-batches")
        .then((r) => r.json() as Promise<{ batches: HiringBatch[] }>)
        .then((d) => d.batches ?? [])
        .catch(() => []),
    ])
      .then(([allVacancies, applications, batches]) => {
        // A vacancy's own status stays APPROVED forever - whether its hiring
        // has actually finished is tracked on the batch instead, so a past
        // (COMPLETED) hiring must be excluded here explicitly or it stays
        // pickable as if it were still open. Mirrors hod/candidates/new's filter.
        const completedVacancyIds = new Set(
          batches.filter((b) => b.currentPhase === "COMPLETED").map((b) => b.vacancyId)
        );
        setVacancies(allVacancies.filter((v) => v.requiredCount > 0 && !completedVacancyIds.has(v.id)));
        setAttachedVacancyIds(
          new Set(applications.filter((a) => a.status !== "REJECTED").map((a) => a.vacancyRequestId))
        );
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load hiring requests" }))
      .finally(() => setIsLoading(false));
  }, [open, candidateId]);

  const available = vacancies.filter((v) => !attachedVacancyIds.has(v.id));
  const matched = search.trim()
    ? available.filter((v) => v.position.toLowerCase().includes(search.trim().toLowerCase()))
    : available;

  async function handleAttach() {
    if (!selectedId) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/college/candidate-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, vacancyRequestId: selectedId }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to attach", description: json.error });
        return;
      }
      toast({ variant: "success", title: `${candidateName} attached to the hiring request` });
      onOpenChange(false);
      onAttached();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attach to Hiring Request</DialogTitle>
          <DialogDescription>
            Attach {candidateName} to an approved hiring request they&rsquo;re applying for.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4">Loading hiring requests...</p>
        ) : vacancies.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No approved hiring requests yet.</p>
        ) : available.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Already attached to every open hiring request.</p>
        ) : (
          <div className="space-y-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by position..."
              className="h-9"
            />
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {matched.map((v) => {
                const isSelected = selectedId === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedId(isSelected ? "" : v.id)}
                    className={`w-full text-left rounded-lg border-2 px-4 py-3 transition-all ${
                      isSelected ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`text-sm font-medium ${isSelected ? "text-primary" : ""}`}>{v.position}</p>
                        <p className="text-xs text-muted-foreground/60 mt-0.5">{v.department}</p>
                      </div>
                      <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                        {v.requiredCount} post{v.requiredCount !== 1 ? "s" : ""} open
                      </span>
                    </div>
                  </button>
                );
              })}
              {matched.length === 0 && (
                <p className="text-xs text-muted-foreground">No hiring requests match &ldquo;{search.trim()}&rdquo;</p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={() => void handleAttach()} disabled={!selectedId} loading={isSubmitting}>Attach</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
