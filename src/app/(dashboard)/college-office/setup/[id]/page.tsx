"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { X, Plus } from "lucide-react";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { HiringBatch } from "@/types";

export default function SetupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [batch, setBatch] = useState<HiringBatch | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [venue, setVenue] = useState("");
  const [documents, setDocuments] = useState<string[]>([]);
  const [newDoc, setNewDoc] = useState("");

  useEffect(() => {
    fetch(`/api/college/hiring-batches/${id}`)
      .then((r) => r.json() as Promise<{ batch: HiringBatch }>)
      .then((d) => {
        setBatch(d.batch);
        setVenue(d.batch.interviewVenue ?? "");
        setDocuments(d.batch.requiredDocuments ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load batch" }))
      .finally(() => setIsLoading(false));
  }, [id]);

  function addDoc() {
    const trimmed = newDoc.trim();
    if (!trimmed || documents.includes(trimmed)) return;
    setDocuments((prev) => [...prev, trimmed]);
    setNewDoc("");
  }

  function removeDoc(doc: string) {
    setDocuments((prev) => prev.filter((d) => d !== doc));
  }

  async function handleSave(markComplete: boolean) {
    if (!venue.trim()) {
      toast({ variant: "destructive", title: "Venue is required" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/college/hiring-batches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interviewVenue: venue.trim(),
          requiredDocuments: documents,
          ...(markComplete ? { setupComplete: true } : {}),
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: markComplete ? "Setup marked complete" : "Saved", description: markComplete ? "HOD has been notified." : undefined });
      if (markComplete) router.push("/college-office/setup");
    } catch {
      toast({ variant: "destructive", title: "Save failed" });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Interview Setup" description="Loading..." />
        <div className="h-32 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!batch) {
    return <div className="text-center py-12 text-muted-foreground">Batch not found</div>;
  }

  return (
    <div className="max-w-xl space-y-6">
      <PageHeader
        title="Interview Setup"
        description={`${batch.position} — ${batch.department}`}
      />

      {/* Batch Info */}
      <Card>
        <CardHeader><CardTitle className="text-base">Interview Details</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Position</span>
            <span className="font-medium">{batch.position}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Department</span>
            <span>{batch.department}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Interview Date</span>
            <span>{formatDate(batch.interviewDate)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Candidates</span>
            <span>{batch.candidateIds.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Panel Size</span>
            <span>{batch.panelMemberUids.length} members</span>
          </div>
        </CardContent>
      </Card>

      {/* Venue Setup */}
      <Card>
        <CardHeader><CardTitle className="text-base">Venue Details *</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="venue">Interview Venue / Hall</Label>
            <Input
              id="venue"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="e.g. Seminar Hall A, Block 2, 2nd Floor"
            />
          </div>
        </CardContent>
      </Card>

      {/* Required Documents */}
      <Card>
        <CardHeader><CardTitle className="text-base">Documents Candidates Must Bring</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={newDoc}
              onChange={(e) => setNewDoc(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDoc(); } }}
              placeholder="e.g. Original Degree Certificate"
            />
            <Button type="button" variant="outline" size="sm" onClick={addDoc}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {documents.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {documents.map((doc) => (
                <Badge key={doc} variant="secondary" className="gap-1 pr-1">
                  {doc}
                  <button
                    onClick={() => removeDoc(doc)}
                    className="ml-1 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {documents.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Common: Degree Certificates, Transcripts, Experience Letters, Photo ID, Passport Photos
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-3 justify-end">
        <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
        <Button variant="outline" onClick={() => void handleSave(false)} loading={isSaving}>Save Draft</Button>
        <Button onClick={() => void handleSave(true)} loading={isSaving}>
          Mark Setup Complete
        </Button>
      </div>
    </div>
  );
}
