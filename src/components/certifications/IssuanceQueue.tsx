"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { toDate } from "@/lib/utils";
import { renderHtmlToPdfBlob } from "@/lib/pdf/htmlToPdf";
import { getCertificateHTML } from "@/lib/pdf/certificateTemplate";
import type { CertificateRequest } from "@/types";
import { issueCertificate, listRequests, rejectAtIssuance, uploadCertificatePdf } from "./api";
import { StatusBadge } from "./StatusBadge";
import { StudentProfileDialog } from "./StudentProfileDialog";

const when = (ts: unknown) => {
  const d = toDate(ts as never);
  return d ? d.toLocaleDateString("en-IN") : "";
};

function certificateNumberFor(request: CertificateRequest): string {
  // Derived from the request's own (already-unique) id rather than a
  // separate sequence counter - no extra Firestore read/write needed, and no
  // race condition between two College Office staff issuing at once.
  return `NODUE-${new Date().getFullYear()}-${request.id.slice(-8).toUpperCase()}`;
}

function CertificateCard({ request, collegeName, onDone }: { request: CertificateRequest; collegeName: string; onDone: () => void }) {
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  const clearances = request.steps
    .flatMap((s) => (s.type === "PARALLEL" ? s.branches : []))
    .filter((b) => b.status === "ACCEPTED");

  async function handleIssue() {
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const certificateNumber = certificateNumberFor(request);
      const html = getCertificateHTML({
        certificateTypeLabel: request.certificateTypeLabel,
        certificateNumber,
        collegeName,
        studentName: request.studentName,
        studentRollNumber: request.studentRollNumber,
        studentDepartment: request.studentDepartment,
        studentYear: request.studentYear,
        studentSection: request.studentSection,
        clearances: clearances.map((c) => ({ branchLabel: c.branchLabel, decidedAt: (toDate(c.decidedAt as never) ?? new Date()).toISOString() })),
        issuedByName: "College Office",
        issuedAt: now,
      });
      const blob = await renderHtmlToPdfBlob(html);
      const url = await uploadCertificatePdf(request.id, blob);
      await issueCertificate(request.id, url, certificateNumber);
      toast({ variant: "success", title: "Certificate issued" });
      onDone();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't generate the certificate" });
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!remarks.trim()) {
      toast({ variant: "destructive", title: "Please add a reason for rejecting" });
      return;
    }
    setBusy(true);
    try {
      await rejectAtIssuance(request.id, remarks.trim());
      toast({ variant: "success", title: "Rejected" });
      onDone();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "That didn't work" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <p className="font-semibold">{request.studentName} · {request.studentRollNumber}</p>
            <p className="text-xs text-muted-foreground">{request.studentDepartment} · Year {request.studentYear} · Section {request.studentSection}</p>
            <p className="text-xs text-muted-foreground mt-1">Submitted {when(request.createdAt)}</p>
            {request.purpose && <p className="text-xs text-muted-foreground mt-1">Purpose: {request.purpose}</p>}
          </div>
          <StatusBadge status={request.status} />
        </div>

        <StudentProfileDialog requestId={request.id} studentName={request.studentName} />

        <ul className="space-y-1">
          {clearances.map((c) => (
            <li key={c.branchKey} className="flex items-center gap-2 text-xs text-green-700">
              <Check className="h-3 w-3" /> {c.branchLabel} cleared on {when(c.decidedAt)}
            </li>
          ))}
        </ul>

        <div className="space-y-1.5">
          <Label htmlFor={`issuance-remarks-${request.id}`}>Remarks (required to reject)</Label>
          <Textarea id={`issuance-remarks-${request.id}`} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>

        <div className="flex gap-2">
          <Button onClick={handleIssue} disabled={busy}>{busy ? "Working…" : "Generate Certificate"}</Button>
          <Button variant="outline" onClick={handleReject} disabled={busy}>Reject</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function IssuanceQueue() {
  const [requests, setRequests] = useState<CertificateRequest[]>([]);
  const [collegeName, setCollegeName] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRequests(await listRequests("issuance-queue"));
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't load the issuance queue" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/college/info").then((r) => r.json()).then((d: { name?: string }) => setCollegeName(d.name ?? "")).catch(() => {});
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (requests.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<FileCheck2 className="h-6 w-6" />}
          title="No requests currently"
          description="Nothing is ready for issuance right now."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((r) => <CertificateCard key={r.id} request={r} collegeName={collegeName} onDone={load} />)}
    </div>
  );
}
