"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Plus, Download, Save } from "lucide-react";
import { toast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import { downloadDocumentAcknowledgementPdf } from "@/lib/pdf/downloadDocumentAcknowledgement";
import { DocumentUploadField } from "@/components/shared/DocumentUploadField";
import type { Candidate, HiringBatch, OfferLetter } from "@/types";

export default function CollegeOfficeDocumentsPage() {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [batches, setBatches] = useState<Record<string, HiringBatch>>({});
  const [collegeName, setCollegeName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [checklists, setChecklists] = useState<Record<string, Record<string, boolean>>>({});
  const [newDocInputs, setNewDocInputs] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [joiningLetterUrls, setJoiningLetterUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([
      fetch("/api/college/candidates").then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
      fetch("/api/college/hiring-batches").then((r) => r.json() as Promise<{ batches: HiringBatch[] }>),
      fetch("/api/college/info").then((r) => r.json() as Promise<{ name: string }>).catch(() => ({ name: "" })),
      fetch("/api/college/offer-letters").then((r) => r.json() as Promise<{ letters: OfferLetter[] }>).catch(() => ({ letters: [] })),
    ])
      .then(([candidatesRes, batchesRes, infoRes, offersRes]) => {
        // Document verification only starts once an offer has actually gone out.
        const offeredCandidateIds = new Set(
          (offersRes.letters ?? [])
            .filter((l) => l.status === "SENT" || l.status === "ACCEPTED")
            .map((l) => l.candidateId)
        );
        const decisionStage = (candidatesRes.candidates ?? []).filter(
          (c) => c.currentStage === "DECISION" && offeredCandidateIds.has(c.id)
        );
        setCandidates(decisionStage);
        setBatches(Object.fromEntries((batchesRes.batches ?? []).map((b) => [b.id, b])));
        setCollegeName(infoRes.name ?? "");
        setJoiningLetterUrls(Object.fromEntries(decisionStage.map((c) => [c.id, c.joiningLetterUrl ?? ""])));

        const initialChecklists: Record<string, Record<string, boolean>> = {};
        for (const c of decisionStage) {
          const batch = (batchesRes.batches ?? []).find((b) => b.id === c.batchId);
          const docs = batch?.requiredDocuments ?? [];
          const saved = c.documentVerification?.checkedDocs ?? {};
          const merged: Record<string, boolean> = {};
          for (const doc of docs) merged[doc] = saved[doc] ?? false;
          for (const [doc, checked] of Object.entries(saved)) if (!(doc in merged)) merged[doc] = checked;
          initialChecklists[c.id] = merged;
        }
        setChecklists(initialChecklists);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load candidates" }))
      .finally(() => setIsLoading(false));
  }, []);

  async function uploadJoiningLetter(candidateId: string, url: string) {
    try {
      const res = await fetch(`/api/college/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joiningLetterUrl: url }),
      });
      if (!res.ok) throw new Error();
      setJoiningLetterUrls((prev) => ({ ...prev, [candidateId]: url }));
      if (url) toast({ variant: "success", title: "Joining letter saved" });
    } catch {
      toast({ variant: "destructive", title: "Failed to save joining letter" });
    }
  }

  function toggleDoc(candidateId: string, doc: string) {
    setChecklists((prev) => ({
      ...prev,
      [candidateId]: { ...prev[candidateId], [doc]: !prev[candidateId]?.[doc] },
    }));
  }

  function addDoc(candidateId: string) {
    const trimmed = (newDocInputs[candidateId] ?? "").trim();
    if (!trimmed || checklists[candidateId]?.[trimmed] !== undefined) return;
    setChecklists((prev) => ({ ...prev, [candidateId]: { ...prev[candidateId], [trimmed]: false } }));
    setNewDocInputs((prev) => ({ ...prev, [candidateId]: "" }));
  }

  async function saveChecklist(candidateId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/college/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentVerification: { checkedDocs: checklists[candidateId] ?? {} } }),
      });
      if (!res.ok) throw new Error();
      return true;
    } catch {
      toast({ variant: "destructive", title: "Failed to save checklist" });
      return false;
    }
  }

  async function handleSave(candidateId: string) {
    setBusyId(candidateId);
    const ok = await saveChecklist(candidateId);
    if (ok) toast({ variant: "success", title: "Checklist saved" });
    setBusyId(null);
  }

  async function handleDownload(candidate: Candidate) {
    setBusyId(candidate.id);
    try {
      const ok = await saveChecklist(candidate.id);
      if (!ok) return;
      await downloadDocumentAcknowledgementPdf(
        {
          collegeName: collegeName || "College",
          candidateName: candidate.name,
          position: candidate.position,
          department: candidate.department,
          checkedDocs: checklists[candidate.id] ?? {},
          verifiedByName: user?.name ?? "College Office",
          verifiedAt: new Date().toISOString(),
        },
        candidate.name
      );
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to generate acknowledgement", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Document Verification" description="Loading..." />
        <div className="h-32 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Document Verification"
        description="Check off documents each candidate has submitted and generate a signed acknowledgement"
      />

      {candidates.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">No candidates awaiting document verification</div>
      )}

      {candidates.map((candidate) => {
        const checklist = checklists[candidate.id] ?? {};
        const docs = Object.keys(checklist);
        const checkedCount = Object.values(checklist).filter(Boolean).length;
        const isBusy = busyId === candidate.id;

        return (
          <Card key={candidate.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{candidate.name}</CardTitle>
                <p className="text-sm text-muted-foreground">{candidate.position} — {candidate.department}</p>
              </div>
              <Badge variant={checkedCount === docs.length && docs.length > 0 ? "default" : "secondary"}>
                {checkedCount}/{docs.length} verified
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {docs.length === 0 && (
                <p className="text-sm text-muted-foreground">No required documents set for this batch — add one below.</p>
              )}
              <div className="space-y-2">
                {docs.map((doc) => (
                  <label key={doc} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={checklist[doc]} onCheckedChange={() => toggleDoc(candidate.id, doc)} />
                    {doc}
                  </label>
                ))}
              </div>

              <div className="flex gap-2">
                <Input
                  value={newDocInputs[candidate.id] ?? ""}
                  onChange={(e) => setNewDocInputs((prev) => ({ ...prev, [candidate.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDoc(candidate.id); } }}
                  placeholder="Add another document"
                />
                <Button type="button" variant="outline" size="sm" onClick={() => addDoc(candidate.id)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex gap-2 pt-2 border-t">
                <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => handleSave(candidate.id)}>
                  <Save className="h-4 w-4 mr-1.5" /> Save
                </Button>
                <Button type="button" size="sm" disabled={isBusy} onClick={() => handleDownload(candidate)}>
                  <Download className="h-4 w-4 mr-1.5" /> Save &amp; Download Acknowledgement
                </Button>
              </div>

              {checkedCount === docs.length && docs.length > 0 && (
                <div className="pt-2 border-t">
                  <DocumentUploadField
                    label="Joining Letter"
                    value={joiningLetterUrls[candidate.id]}
                    uploadEndpoint="/api/upload/joining-letter"
                    extraFields={{ candidateId: candidate.id }}
                    onUploaded={(url) => void uploadJoiningLetter(candidate.id, url)}
                    onRemoved={() => void uploadJoiningLetter(candidate.id, "")}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
