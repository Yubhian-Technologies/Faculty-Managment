"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/useToast";
import {
  CheckCircle2, FileCheck, FileX, ChevronDown, ChevronUp,
  Clock, Search, UploadCloud, ExternalLink, User, Building2,
} from "lucide-react";
import type { Candidate, HiringBatch } from "@/types";

type DocEntry = { label: string; url: string; uploadedAt: string; uploadedBy?: string };

type CandidateWithBatch = Candidate & {
  batch?: HiringBatch;
  checkedDocs: Record<string, boolean>;
  submittedDocuments: Record<string, DocEntry>;
};

function safeKey(label: string) {
  return label.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function DocumentsPageInner() {
  const searchParams = useSearchParams();
  const focusedCandidateId = searchParams.get("candidateId");

  const [candidates, setCandidates] = useState<CandidateWithBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(focusedCandidateId);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [advanceDialog, setAdvanceDialog] = useState<CandidateWithBatch | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState<{ candidateId: string; docType: string } | null>(null);
  const [search, setSearch] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUpload = useRef<{ candidateId: string; docType: string } | null>(null);

  const load = useCallback(async () => {
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
        checkedDocs: Object.fromEntries((c.verifiedDocuments ?? []).map((d) => [d, true])),
        submittedDocuments: (c.submittedDocuments as Record<string, DocEntry>) ?? {},
      }));
      setCandidates(enriched);
      if (focusedCandidateId) setExpandedId(focusedCandidateId);
    } catch {
      toast({ variant: "destructive", title: "Failed to load" });
    } finally {
      setIsLoading(false);
    }
  }, [focusedCandidateId]);

  useEffect(() => { void load(); }, [load]);

  async function toggleVerified(candidateId: string, doc: string, currentChecked: boolean) {
    const newChecked = !currentChecked;
    setCandidates((prev) =>
      prev.map((c) =>
        c.id === candidateId ? { ...c, checkedDocs: { ...c.checkedDocs, [doc]: newChecked } } : c
      )
    );
    try {
      const candidate = candidates.find((c) => c.id === candidateId);
      if (!candidate) return;
      const updated = Object.entries({ ...candidate.checkedDocs, [doc]: newChecked })
        .filter(([, v]) => v).map(([k]) => k);
      await fetch(`/api/college/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifiedDocuments: updated }),
      });
    } catch {
      setCandidates((prev) =>
        prev.map((c) =>
          c.id === candidateId ? { ...c, checkedDocs: { ...c.checkedDocs, [doc]: currentChecked } } : c
        )
      );
      toast({ variant: "destructive", title: "Failed to save" });
    }
  }

  function openFilePicker(candidateId: string, docType: string) {
    pendingUpload.current = { candidateId, docType };
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const pending = pendingUpload.current;
    if (!file || !pending) return;

    const { candidateId, docType } = pending;
    setUploadingDoc({ candidateId, docType });
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("docType", docType);

      const res = await fetch(`/api/college/candidates/${candidateId}/upload-doc`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json() as { url?: string; safeKey?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Upload failed");

      const key = json.safeKey ?? safeKey(docType);
      setCandidates((prev) =>
        prev.map((c) =>
          c.id === candidateId
            ? {
                ...c,
                submittedDocuments: {
                  ...c.submittedDocuments,
                  [key]: { label: docType, url: json.url!, uploadedAt: new Date().toISOString(), uploadedBy: "office" },
                },
              }
            : c
        )
      );
      toast({ variant: "success", title: "Document uploaded" });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setUploadingDoc(null);
      pendingUpload.current = null;
    }
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
        description="Review candidate-uploaded documents and verify before final decision"
      />

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
      ) : candidates.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <FileCheck className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No candidates pending verification</p>
            <p className="text-sm text-muted-foreground mt-1">
              Candidates appear here after the Principal approves them.
            </p>
          </CardContent>
        </Card>
      ) : (() => {
        const q = search.trim().toLowerCase();
        const filtered = candidates.filter((c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.department.toLowerCase().includes(q) ||
          c.position.toLowerCase().includes(q)
        );
        return (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by name, email, department or position…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            {filtered.length === 0 && q ? (
              <p className="text-sm text-muted-foreground text-center py-8">No candidates match &quot;{search}&quot;</p>
            ) : null}
            {filtered.map((c) => {
              const requiredDocs = c.batch?.requiredDocuments ?? [];
              const verifiedCount = Object.values(c.checkedDocs).filter(Boolean).length;
              const allVerified = requiredDocs.length > 0 && verifiedCount === requiredDocs.length;
              const isExpanded = expandedId === c.id;
              const isFocused = focusedCandidateId === c.id;

              return (
                <Card key={c.id} className={isFocused ? "ring-2 ring-primary" : ""}>
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
                        {allVerified ? (
                          <Badge className="bg-green-100 text-green-700 border-green-200 shrink-0">
                            <CheckCircle2 className="h-3 w-3 mr-1" />All Verified
                          </Badge>
                        ) : requiredDocs.length > 0 && verifiedCount > 0 ? (
                          <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 shrink-0">
                            <Clock className="h-3 w-3 mr-1" />{verifiedCount}/{requiredDocs.length} Verified
                          </Badge>
                        ) : requiredDocs.length > 0 ? (
                          <Badge variant="outline" className="text-orange-600 border-orange-300 shrink-0">
                            0/{requiredDocs.length} Verified
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="shrink-0">No docs required</Badge>
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
                      <div className="text-xs text-muted-foreground grid grid-cols-2 gap-2">
                        <span>Email: {c.email}</span>
                        <span>Phone: {c.phone}</span>
                      </div>

                      {requiredDocs.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No specific documents were listed for this batch.</p>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Documents</p>
                          {requiredDocs.map((doc) => {
                            const key = safeKey(doc);
                            const uploaded = c.submittedDocuments[key];
                            const isVerified = !!c.checkedDocs[key];
                            const isUploading = uploadingDoc?.candidateId === c.id && uploadingDoc.docType === doc;

                            return (
                              <div
                                key={doc}
                                className={`rounded-lg border p-3 space-y-2 transition-colors ${
                                  isVerified ? "bg-green-50 border-green-200" : uploaded ? "bg-blue-50/40 border-blue-100" : "bg-background border-border"
                                }`}
                              >
                                {/* Doc name + upload source */}
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    {isVerified ? (
                                      <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                                    ) : (
                                      <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0 mt-0.5" />
                                    )}
                                    <span className="text-sm font-medium">{doc}</span>
                                  </div>
                                  {uploaded && (
                                    <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                                      {uploaded.uploadedBy === "office" ? (
                                        <><Building2 className="h-3 w-3" />Office</>
                                      ) : (
                                        <><User className="h-3 w-3" />Candidate</>
                                      )}
                                    </span>
                                  )}
                                </div>

                                {/* File actions row */}
                                <div className="flex items-center gap-2 pl-6">
                                  {uploaded ? (
                                    <>
                                      <a
                                        href={uploaded.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                      >
                                        <ExternalLink className="h-3 w-3" />View document
                                      </a>
                                      <span className="text-muted-foreground/40 text-xs">·</span>
                                      <button
                                        type="button"
                                        onClick={() => openFilePicker(c.id, doc)}
                                        disabled={isUploading}
                                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
                                      >
                                        <UploadCloud className="h-3 w-3" />
                                        {isUploading ? "Uploading…" : "Re-upload"}
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => openFilePicker(c.id, doc)}
                                      disabled={isUploading}
                                      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary border border-primary/30 rounded-md px-2.5 py-1 hover:bg-primary/5 disabled:opacity-50"
                                    >
                                      <UploadCloud className="h-3.5 w-3.5" />
                                      {isUploading ? "Uploading…" : "Upload document"}
                                    </button>
                                  )}

                                  {/* Verify toggle — only enabled when a file exists */}
                                  {uploaded && (
                                    <label className="ml-auto flex items-center gap-1.5 cursor-pointer select-none">
                                      <input
                                        type="checkbox"
                                        checked={isVerified}
                                        onChange={() => void toggleVerified(c.id, key, isVerified)}
                                        className="h-3.5 w-3.5 accent-green-600"
                                      />
                                      <span className="text-xs text-muted-foreground">Mark verified</span>
                                    </label>
                                  )}
                                </div>

                                {!uploaded && (
                                  <p className="text-xs text-muted-foreground pl-6">
                                    Not yet uploaded — you can upload on behalf of the candidate.
                                  </p>
                                )}
                              </div>
                            );
                          })}

                          {verifiedCount > 0 && !allVerified && (
                            <p className="text-xs text-amber-600">
                              {verifiedCount} of {requiredDocs.length} verified — you can continue later.
                            </p>
                          )}
                        </div>
                      )}

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
                          disabled={requiredDocs.length > 0 && !allVerified}
                          onClick={() => setAdvanceDialog(c)}
                        >
                          <FileCheck className="h-3.5 w-3.5 mr-1" />
                          Mark Verified &amp; Proceed
                        </Button>
                      </div>
                      {requiredDocs.length > 0 && !allVerified && (
                        <p className="text-xs text-muted-foreground">Verify all documents to proceed.</p>
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        );
      })()}

      {/* Hidden file input for office uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={handleFileChange}
      />

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

export default function CollegeOfficeDocumentsPage() {
  return (
    <Suspense>
      <DocumentsPageInner />
    </Suspense>
  );
}
