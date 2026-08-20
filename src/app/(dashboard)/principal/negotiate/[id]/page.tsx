"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { toast } from "@/hooks/useToast";
import { ArrowRight, Plus, Save, CheckCircle2 } from "lucide-react";
import type { HiringBatch, Candidate, CandidateApplication, HiringTermsTemplate } from "@/types";

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
      const [batchRes, applicationsRes, candidatesRes, termsRes] = await Promise.all([
        fetch(`/api/college/hiring-batches/${id}`).then((r) => r.json() as Promise<{ batch: HiringBatch }>),
        fetch(`/api/college/candidate-applications?batchId=${id}`).then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>),
        fetch(`/api/college/candidates`).then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
        fetch(`/api/college/hiring-terms`).then((r) => r.json() as Promise<{ templates: HiringTermsTemplate[] }>).catch(() => ({ templates: [] })),
      ]);
      setBatch(batchRes.batch);
      const templateTexts = (termsRes.templates ?? []).map((t) => t.text);
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
      setTermsChecklists(Object.fromEntries(cands.map((c) => {
        const selected = new Set(c.termsAndConditions ?? []);
        // Pre-seed with the Principal-managed library (unchecked unless already
        // selected on this candidate), plus any already-selected ad-hoc term
        // that isn't in the library (e.g. typed before the library existed).
        const entries = [
          ...templateTexts.map((t) => [t, selected.has(t)] as const),
          ...(c.termsAndConditions ?? []).filter((t) => !templateTexts.includes(t)).map((t) => [t, true] as const),
        ];
        return [c.id, Object.fromEntries(entries)];
      })));
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
    const todayStr = new Date().toISOString().split("T")[0];
    if (terms.dateOfJoining < todayStr) {
      toast({ variant: "destructive", title: "Date of Joining cannot be in the past" });
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

  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Negotiate Terms: ${batch.position}`}
        description={`${batch.department} · ${candidates.length} candidate${candidates.length !== 1 ? "s" : ""} · enter salary and terms before making the final decision`}
      />

      <div className="space-y-3">
        {candidates.map((candidate) => {
          const terms = hireTerms[candidate.id] ?? emptyHireTerms;
          const isSaved = savedIds.has(candidate.id) || (candidate.negotiatedSalary != null && !!candidate.dateOfJoining);
          const hasIncompleteTerms = !terms.negotiatedSalary || !terms.dateOfJoining || terms.dateOfJoining < todayStr;

          return (
            <Card key={candidate.id} className="overflow-hidden">
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value={candidate.id} className="border-b-0">
                  <AccordionTrigger className="px-5 py-4 hover:no-underline flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 text-left">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-base">{candidate.name}</span>
                          {isSaved ? (
                            <span className="text-xs text-green-700 bg-green-50 border border-green-200 font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Terms Set
                            </span>
                          ) : (
                            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 font-medium px-2 py-0.5 rounded-full">
                              Pending Negotiation
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {candidate.email} · {candidate.phone}
                        </p>
                      </div>
                    </div>
                    {terms.negotiatedSalary && terms.dateOfJoining && (
                      <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground mr-2">
                        <span>CTC: <strong className="text-foreground">₹{Number(terms.negotiatedSalary).toLocaleString("en-IN")}/yr</strong></span>
                        <span>Joining: <strong className="text-foreground">{terms.dateOfJoining}</strong></span>
                      </div>
                    )}
                  </AccordionTrigger>
                  <AccordionContent className="px-5 pb-5 pt-2 space-y-4 border-t bg-muted/10">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Expected Salary (₹/yr)</Label>
                        <Input
                          type="number"
                          min="0"
                          value={terms.expectedSalary}
                          onChange={(e) => setHireTerms((prev) => ({ ...prev, [candidate.id]: { ...emptyHireTerms, ...prev[candidate.id], expectedSalary: e.target.value } }))}
                          placeholder="e.g. 600000"
                          className="text-sm bg-background"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Negotiated Salary (₹/yr) <span className="text-destructive">*</span></Label>
                        <Input
                          type="number"
                          min="0"
                          value={terms.negotiatedSalary}
                          onChange={(e) => setHireTerms((prev) => ({ ...prev, [candidate.id]: { ...emptyHireTerms, ...prev[candidate.id], negotiatedSalary: e.target.value } }))}
                          placeholder="e.g. 650000"
                          className="text-sm bg-background"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Date of Joining <span className="text-destructive">*</span></Label>
                        <Input
                          type="date"
                          min={todayStr}
                          value={terms.dateOfJoining}
                          onChange={(e) => setHireTerms((prev) => ({ ...prev, [candidate.id]: { ...emptyHireTerms, ...prev[candidate.id], dateOfJoining: e.target.value } }))}
                          className="text-sm bg-background"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-medium">Terms &amp; Conditions</Label>
                      <div className="space-y-2 bg-background p-3 rounded-lg border">
                        {Object.entries(termsChecklists[candidate.id] ?? {}).map(([term, checked]) => (
                          <label key={term} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/40 p-1 rounded">
                            <Checkbox checked={checked} onCheckedChange={() => toggleTerm(candidate.id, term)} />
                            <span>{term}</span>
                          </label>
                        ))}
                        <div className="flex gap-2 pt-1">
                          <Input
                            value={newTermInputs[candidate.id] ?? ""}
                            onChange={(e) => setNewTermInputs((prev) => ({ ...prev, [candidate.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTerm(candidate.id); } }}
                            placeholder="Add custom term (e.g. 1 year probation)..."
                            className="text-xs bg-background"
                          />
                          <Button type="button" variant="outline" size="sm" onClick={() => addTerm(candidate.id)}>
                            <Plus className="h-4 w-4 mr-1" /> Add
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      {hasIncompleteTerms && (
                        <p className="text-xs text-amber-600 font-medium">
                          * Negotiated salary and a future joining date are required
                        </p>
                      )}
                      <div className="ml-auto">
                        <Button size="sm" loading={savingId === candidate.id} onClick={() => void saveCandidate(candidate.id)}>
                          <Save className="h-4 w-4 mr-1.5" /> Save Terms
                        </Button>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
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
