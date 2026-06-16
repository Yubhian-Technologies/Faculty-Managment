"use client";

import { use, useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Maximize2, CheckCircle2 } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import type { HiringBatch, Candidate } from "@/types";

export default function CoordinatorQRPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = use(params);

  const [batch, setBatch] = useState<HiringBatch | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [demoCompleteDialog, setDemoCompleteDialog] = useState(false);
  const [isMarkingComplete, setIsMarkingComplete] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    Promise.all([
      fetch(`/api/college/hiring-batches/${batchId}`)
        .then((r) => r.json() as Promise<{ batch: HiringBatch }>)
        .then((d) => d.batch),
      fetch(`/api/college/candidates?batchId=${batchId}`)
        .then((r) => r.json() as Promise<{ candidates: Candidate[] }>)
        .then((d) => d.candidates ?? []),
    ])
      .then(([b, cands]) => {
        setBatch(b);
        setCandidates(cands);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load session" }))
      .finally(() => setIsLoading(false));
  }, [batchId]);

  const candidate = candidates[selectedIndex];
  const feedbackUrl = candidate && batch ? `${origin}/feedback/${batch.collegeId}/${batchId}/${candidate.id}` : "";

  function prev() { setSelectedIndex((i) => Math.max(0, i - 1)); }
  function next() { setSelectedIndex((i) => Math.min(candidates.length - 1, i + 1)); }

  async function markDemoComplete() {
    setIsMarkingComplete(true);
    try {
      const res = await fetch(`/api/college/hiring-batches/${batchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demoComplete: true }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Demo marked complete", description: "Panel members and HOD have been notified." });
      setBatch((prev) => prev ? { ...prev, demoComplete: true } : prev);
      setDemoCompleteDialog(false);
    } catch {
      toast({ variant: "destructive", title: "Failed to mark complete" });
    } finally {
      setIsMarkingComplete(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="QR Display" description="Loading..." />
        <div className="h-64 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!batch) return <div className="text-center py-12 text-muted-foreground">Session not found</div>;

  if (candidates.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Demo QR Display"
          description={`${batch.position} — ${batch.department}`}
        />
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <p>No candidates in this batch yet.</p>
            <p className="text-sm mt-1">Candidates will appear once they are added to this session.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Fullscreen QR mode — for projecting to class
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 bg-white flex flex-col items-center justify-center z-50 p-8">
        <div className="text-center space-y-6 max-w-lg w-full">
          <div>
            <h1 className="text-3xl font-bold">{candidate?.name}</h1>
            <p className="text-lg text-muted-foreground mt-1">{batch.position} · {batch.department}</p>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-2xl border-4 border-primary inline-block">
            {feedbackUrl && (
              <QRCode
                value={feedbackUrl}
                size={280}
                style={{ height: "auto", maxWidth: "100%", width: "100%" }}
              />
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xl font-semibold">Scan to rate this demo class</p>
            <p className="text-muted-foreground">Your feedback is anonymous</p>
          </div>

          <div className="flex gap-4 justify-center">
            <Button variant="outline" size="lg" onClick={prev} disabled={selectedIndex === 0}>
              <ChevronLeft className="h-5 w-5 mr-1" />
              Previous
            </Button>
            <Button variant="outline" size="lg" onClick={() => setIsFullscreen(false)}>
              Exit Fullscreen
            </Button>
            <Button size="lg" onClick={next} disabled={selectedIndex === candidates.length - 1}>
              Next
              <ChevronRight className="h-5 w-5 ml-1" />
            </Button>
          </div>

          <div className="flex gap-2 justify-center">
            {candidates.map((_, i) => (
              <button
                key={i}
                onClick={() => setSelectedIndex(i)}
                className={`h-2 w-2 rounded-full transition-colors ${i === selectedIndex ? "bg-primary" : "bg-muted-foreground/30"}`}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Demo QR Display"
        description={`${batch.position} · ${batch.department} · ${formatDate(batch.interviewDate)}`}
        actions={
          <div className="flex gap-2">
            {batch.demoComplete ? (
              <div className="flex items-center gap-1.5 text-sm text-green-600 font-medium px-3">
                <CheckCircle2 className="h-4 w-4" />
                Demo Complete
              </div>
            ) : (
              <Button variant="outline" onClick={() => setDemoCompleteDialog(true)}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Mark Demo Complete
              </Button>
            )}
            <Button onClick={() => setIsFullscreen(true)}>
              <Maximize2 className="h-4 w-4 mr-2" />
              Fullscreen Mode
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        {/* QR Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Candidate {selectedIndex + 1} of {candidates.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {candidate && (
              <>
                <div className="text-center p-2 rounded-lg bg-muted/40">
                  <p className="font-semibold text-lg">{candidate.name}</p>
                  <p className="text-sm text-muted-foreground">{candidate.email}</p>
                </div>

                <div className="flex justify-center">
                  <div className="bg-white p-4 rounded-xl border shadow-sm">
                    {feedbackUrl && (
                      <QRCode
                        value={feedbackUrl}
                        size={200}
                        style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                      />
                    )}
                  </div>
                </div>

                <p className="text-center text-sm text-muted-foreground">
                  Students scan this QR to rate the demo class
                </p>

                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={prev} disabled={selectedIndex === 0}>
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <Button className="flex-1" onClick={next} disabled={selectedIndex === candidates.length - 1}>
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Candidate List */}
        <Card>
          <CardHeader><CardTitle className="text-base">All Candidates</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {candidates.map((c, i) => (
              <div
                key={c.id}
                onClick={() => setSelectedIndex(i)}
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                  i === selectedIndex
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.email}</p>
                  </div>
                  {i === selectedIndex && (
                    <span className="text-xs text-primary font-medium">Active QR</span>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Demo info */}
      <Card className="border-dashed">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Coordinator</p>
              <p className="font-medium">{batch.coordinatorName ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Demo Room</p>
              <p className="font-medium">{batch.demoClassroom ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Interview Venue</p>
              <p className="font-medium">{batch.interviewVenue ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Date</p>
              <p className="font-medium">{formatDate(batch.interviewDate)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={demoCompleteDialog}
        onOpenChange={setDemoCompleteDialog}
        title="Mark Demo as Complete?"
        description="This will notify the HOD and unlock panel feedback for all panel members. This action cannot be undone."
        confirmLabel="Yes, Mark Complete"
        onConfirm={markDemoComplete}
        loading={isMarkingComplete}
      />
    </div>
  );
}
