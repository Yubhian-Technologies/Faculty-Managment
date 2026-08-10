"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { ArrowRight, Plus, Save, CheckCircle2 } from "lucide-react";
import type { HiringBatch, Candidate, CandidateApplication } from "@/types";

// Joined view: application (per-hiring-request negotiation state) + candidate
// (person) fields. `id` is the applicationId (used for PATCHes to
// candidate-applications).
type NegotiateCandidateView = {
  id: string;
  candidateId: string;
  name: string;
  email: string;
  phone: string;
  expectedSalary?: number;
  negotiatedSalary?: number;
  dateOfJoining?: string;
  termsAndConditions?: string[];
};

type HireTerms = { expectedSalary: string; negotiatedSalary: string; dateOfJoining: string };
const emptyHireTerms: HireTerms = { expectedSalary: "", negotiatedSalary: "", dateOfJoining: "" };

export default function PrincipalNegotiatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [batch, setBatch] = useState<HiringBatch | null>(null);
  const [candidates, setCandidates] = useState<NegotiateCandidateView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hireTerms, setHireTerms] = useState<Record<string, HireTerms>>({});
  const [termsChecklists, setTermsChecklists] = useState<Record<string, Record<string, boolean>>>({});
  const [newTermInputs, setNewTermInputs] = useState<Record<string, string>>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    try {
      const [batchRes, applicationsRes, candidatesRes] = await Promise.all([
        fetch(`/api/college/hiring-batches/${id}`).then((r) => r.json() as Promise<{ batch: HiringBatch }>),
        fetch(`/api/college/candidate-applications?batchId=${id}`).then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>),
        fetch(`/api/college/candidates`).then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
      ]);
      setBatch(batchRes.batch);
      const candidateMap = new Map((candidatesRes.candidates ?? []).map((c) => [c.id, c]));
      const cands: NegotiateCandidateView[] = (applicationsRes.applications ?? []).map((a) => {
        const person = candidateMap.get(a.candidateId);
        return {
          id: a.id,
          candidateId: a.candidateId,
          name: person?.name ?? "Unknown",
          email: person?.email ?? "",
          phone: person?.phone ?? "",
          expectedSalary: a.expectedSalary,
          negotiatedSalary: a.negotiatedSalary,
          dateOfJoining: a.dateOfJoining,
          termsAndConditions: a.termsAndConditions,
        };
      });
      setCandidates(cands);
      setHireTerms(Object.fromEntries(cands.map((c) => [c.id, {
        expectedSalary: c.expectedSalary != null ? String(c.expectedSalary) : "",
        negotiatedSalary: c.negotiatedSalary != null ? String(c.negotiatedSalary) : "",
        dateOfJoining: c.dateOfJoining ?? "",
      }])));
      setTermsChecklists(Object.fromEntries(cands.map((c) => [c.id, Object.fromEntries((c.termsAndConditions ?? []).map((t) => [t, true]))])));
    } catch {
      toast({ variant: "destructive", title: "Failed to load batch" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, [id]);

  function toggleTerm(candidateId: string, term: string) {
    setTermsChecklists((prev) => ({ ...prev, [candidateId]: { ...prev[candidateId], [term]: !prev[candidateId]?.[term] } }));
  }

  function addTerm(candidateId: string) {
    const trimmed = (newTermInputs[candidateId] ?? "").trim();
    if (!trimmed || termsChecklists[candidateId]?.[trimmed] !== undefined) return;
    setTermsChecklists((prev) => ({ ...prev, [candidateId]: { ...prev[candidateId], [trimmed]: true } }));
    setNewTermInputs((prev) => ({ ...prev, [candidateId]: "" }));
  }

  async function saveCandidate(applicationId: string) {
    const terms = hireTerms[applicationId] ?? emptyHireTerms;
    if (!terms.negotiatedSalary || !terms.dateOfJoining) {
      toast({ variant: "destructive", title: "Enter negotiated salary and date of joining" });
      return;
    }
    setSavingId(applicationId);
    try {
      const selectedTerms = Object.entries(termsChecklists[applicationId] ?? {})
        .filter(([, checked]) => checked)
        .map(([term]) => term);
      const res = await fetch(`/api/college/candidate-applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          negotiatedSalary: Number(terms.negotiatedSalary),
          dateOfJoining: terms.dateOfJoining,
          ...(terms.expectedSalary ? { expectedSalary: Number(terms.expectedSalary) } : {}),
          termsAndConditions: selectedTerms,
        }),
      });
      if (!res.ok) throw new Error();
      setSavedIds((prev) => new Set(prev).add(applicationId));
      toast({ variant: "success", title: "Saved" });
    } catch {
      toast({ variant: "destructive", title: "Failed to save" });
    } finally {
      setSavingId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Negotiate Terms" description="Loading..." />
        <div className="h-64 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!batch) return <div className="text-center py-12 text-muted-foreground">Batch not found</div>;

  const allSaved = candidates.length > 0 && candidates.every((c) => savedIds.has(c.id) || (c.negotiatedSalary != null && c.dateOfJoining));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Negotiate Terms: ${batch.position}`}
        description={`${batch.department} · ${candidates.length} candidate${candidates.length !== 1 ? "s" : ""} · enter salary and terms before making the final decision`}
      />

      <div className="space-y-4">
        {candidates.map((candidate) => {
          const terms = hireTerms[candidate.id] ?? emptyHireTerms;
          const isSaved = savedIds.has(candidate.id);

          return (
            <Card key={candidate.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{candidate.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">{candidate.email} · {candidate.phone}</p>
                  </div>
                  {isSaved && (
                    <span className="text-sm text-green-600 font-medium flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4" />Saved
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Expected Salary (₹/yr)</Label>
                    <Input
                      type="number"
                      min="0"
                      value={terms.expectedSalary}
                      onChange={(e) => setHireTerms((prev) => ({ ...prev, [candidate.id]: { ...emptyHireTerms, ...prev[candidate.id], expectedSalary: e.target.value } }))}
                      placeholder="e.g. 600000"
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Negotiated Salary (₹/yr) *</Label>
                    <Input
                      type="number"
                      min="0"
                      value={terms.negotiatedSalary}
                      onChange={(e) => setHireTerms((prev) => ({ ...prev, [candidate.id]: { ...emptyHireTerms, ...prev[candidate.id], negotiatedSalary: e.target.value } }))}
                      placeholder="e.g. 650000"
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Date of Joining *</Label>
                    <Input
                      type="date"
                      value={terms.dateOfJoining}
                      onChange={(e) => setHireTerms((prev) => ({ ...prev, [candidate.id]: { ...emptyHireTerms, ...prev[candidate.id], dateOfJoining: e.target.value } }))}
                      className="text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Terms &amp; Conditions</Label>
                  <div className="space-y-1.5">
                    {Object.entries(termsChecklists[candidate.id] ?? {}).map(([term, checked]) => (
                      <label key={term} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox checked={checked} onCheckedChange={() => toggleTerm(candidate.id, term)} />
                        {term}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={newTermInputs[candidate.id] ?? ""}
                      onChange={(e) => setNewTermInputs((prev) => ({ ...prev, [candidate.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTerm(candidate.id); } }}
                      placeholder="e.g. Probationary period of one year"
                      className="text-sm"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={() => addTerm(candidate.id)}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="pt-2 border-t">
                  <Button size="sm" loading={savingId === candidate.id} onClick={() => void saveCandidate(candidate.id)}>
                    <Save className="h-4 w-4 mr-1.5" /> Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex justify-end pt-2">
        <Button asChild variant={allSaved ? "default" : "outline"}>
          <Link href={`/principal/decisions/${id}`}>
            Continue to Final Decision
            <ArrowRight className="h-4 w-4 ml-1.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
