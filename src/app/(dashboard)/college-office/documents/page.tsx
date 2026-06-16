"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { CheckCircle2, FileCheck, FileX, ChevronDown, ChevronUp } from "lucide-react";
import type { Candidate, HiringBatch } from "@/types";

type CandidateWithBatch = Candidate & {
  batch?: HiringBatch;
  checkedDocs: Record<string, boolean>;
};

export default function CollegeOfficeDocumentsPage() {
  const [candidates, setCandidates] = useState<CandidateWithBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [advanceDialog, setAdvanceDialog] = useState<CandidateWithBatch | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const [candRes, batchRes] = await Promise.all([
        fetch("/api/college/candidates?stage=DOCUMENT_VERIFICATION")
          .then((r) => r.json() as Promise<{ candidates: Candidate[] }>)
          .then((d) => d.candidates ?? []),
        fetch("/api/college/hiring-batches")
          .then((r) => r.json() as Promise<{ batches: HiringBatch[] }>)
          .then((d) => d.batches ?? []),
      ]);

      const batchMap = Object.fromEntries(batchRes.map((b) => [b.id, b]));
      const enriched: CandidateWithBatch[] = candRes.map((c) => ({
        ...c,
        batch: c.batchId ? batchMap[c.batchId] : undefined,
        checkedDocs: {},
      }));
      setCandidates(enriched);
    } catch {
      toast({ variant: "destructive", title: "Failed to load" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function toggleDoc(candidateId: string, doc: string) {
    setCandidates((prev) =>
      prev.map((c) =>
        c.id === candidateId
          ? { ...c, checkedDocs: { ...c.checkedDocs, [doc]: !c.checkedDocs[doc] } }
          : c
      )
    );
  }

  async function advanceToDecision(candidate: CandidateWithBatch) {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/college/candidates/${candidate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "DECISION", status: "IN_PROGRESS" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Documents verified", description: `${candidate.name} moved to offer letter stage.` });
      setAdvanceDialog(null);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Failed to update" });
    } finally {
      setIsSaving(false);
    }
  }

  async function markRejected(candidateId: string, name: string) {
    setAdvancing(candidateId);
    try {
      await fetch(`/api/college/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "REJECTED", stage: "DECISION" }),
      });
      toast({ title: `${name} marked as rejected (documents incomplete)` });
      void load();
    } catch {
      toast({ variant: "destructive", title: "Failed to update" });
    } finally {
      setAdvancing(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Document Verification"
        description="Verify candidate documents before final decision"
      />

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
      ) : candidates.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <FileCheck className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No candidates pending verification</p>
            <p className="text-sm text-muted-foreground mt-1">
              Candidates appear here after Accounts creates their salary agreement.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {candidates.map((c) => {
            const requiredDocs = c.batch?.requiredDocuments ?? [];
            const checkedCount = Object.values(c.checkedDocs).filter(Boolean).length;
            const allChecked = requiredDocs.length > 0 && checkedCount === requiredDocs.length;
            const isExpanded = expandedId === c.id;

            return (
              <Card key={c.id}>
                <CardHeader
                  className="pb-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : c.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="font-medium text-sm">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.position} · {c.department}
                          {c.batch && ` · Batch: ${c.batch.position}`}
                        </p>
                      </div>
                      {allChecked ? (
                        <Badge className="bg-green-100 text-green-700 border-green-200">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          All Verified
                        </Badge>
                      ) : requiredDocs.length > 0 ? (
                        <Badge variant="outline" className="text-orange-600 border-orange-300">
                          {checkedCount}/{requiredDocs.length} checked
                        </Badge>
                      ) : (
                        <Badge variant="secondary">No docs required</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={c.status} />
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0 space-y-4">
                    {/* Contact Info */}
                    <div className="text-xs text-muted-foreground grid grid-cols-2 gap-2">
                      <span>Email: {c.email}</span>
                      <span>Phone: {c.phone}</span>
                    </div>

                    {/* Document Checklist */}
                    {requiredDocs.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No specific documents were listed for this batch.</p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Document Checklist</p>
                        {requiredDocs.map((doc) => (
                          <div
                            key={doc}
                            className={`flex items-center gap-3 p-3 rounded-lg border ${c.checkedDocs[doc] ? "bg-green-50 border-green-200" : "bg-background"}`}
                          >
                            <Checkbox
                              id={`${c.id}-${doc}`}
                              checked={!!c.checkedDocs[doc]}
                              onCheckedChange={() => toggleDoc(c.id, doc)}
                            />
                            <label htmlFor={`${c.id}-${doc}`} className="text-sm cursor-pointer flex-1">
                              {doc}
                            </label>
                            {c.checkedDocs[doc] && (
                              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-2 border-t">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void markRejected(c.id, c.name)}
                        loading={advancing === c.id}
                      >
                        <FileX className="h-3.5 w-3.5 mr-1" />
                        Reject (Docs Incomplete)
                      </Button>
                      <Button
                        size="sm"
                        disabled={requiredDocs.length > 0 && !allChecked}
                        onClick={() => setAdvanceDialog(c)}
                      >
                        <FileCheck className="h-3.5 w-3.5 mr-1" />
                        Mark Verified &amp; Proceed
                      </Button>
                    </div>
                    {requiredDocs.length > 0 && !allChecked && (
                      <p className="text-xs text-muted-foreground">Check all documents before proceeding.</p>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!advanceDialog}
        onOpenChange={(o) => { if (!o) setAdvanceDialog(null); }}
        title="Mark Documents Verified?"
        description={`All documents for ${advanceDialog?.name ?? ""} have been verified. This will move them to the offer letter stage.`}
        confirmLabel="Yes, Mark Verified"
        onConfirm={() => { if (advanceDialog) void advanceToDecision(advanceDialog); }}
        loading={isSaving}
      />
    </div>
  );
}
