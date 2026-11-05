"use client";

import { useState } from "react";
import { Eye, FileCheck2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import type { CertificateFieldDef, CertificateRequest } from "@/types";
import { rejectAtIssuance } from "./api";
import { downloadIssued, issueConfigured, previewCertificate, uploadIssuedPdf } from "./configApi";
import { RequestAnswers, StepTimeline } from "./StepTimeline";
import { A4Preview } from "./A4Preview";
import { StatusBadge } from "./StatusBadge";
import { StudentProfileDialog } from "./StudentProfileDialog";

// Issuing one configured certificate: the issuer fills what only they know (date of leaving, conduct ...), confirms
// the fee receipt when there is a fee, looks at the preview, and issues - the number, QR code and signature are
// added by the server, and the issued copy is frozen. Degree / provisional certificates are uploaded instead.

export function FieldInput({ field, value, onChange, id }: { field: CertificateFieldDef; value: string; onChange: (v: string) => void; id: string }) {
  if (field.kind === "select") {
    return (
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger id={id}><SelectValue placeholder="Choose" /></SelectTrigger>
        <SelectContent>{(field.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    );
  }
  if (field.kind === "textarea") return <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={3} />;
  return <Input id={id} type={field.kind === "date" ? "date" : field.kind === "number" ? "number" : "text"} value={value} onChange={(e) => onChange(e.target.value)} />;
}

export function IssueCard({ request, onDone }: { request: CertificateRequest; onDone: () => void }) {
  const fields = request.issuerFields ?? [];
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.defaultValue ?? ""])));
  const [receipt, setReceipt] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ html: string; missing: string[]; uploadOnly: boolean } | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState("");
  const fee = request.feeAmount ?? 0;

  async function showPreview() {
    setBusy(true);
    try { setPreview(await previewCertificate(request.id, values)); }
    catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't build the preview" }); }
    finally { setBusy(false); }
  }

  async function onUpload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try { setUploadedUrl(await uploadIssuedPdf(request.id, file)); toast({ variant: "success", title: "PDF uploaded" }); }
    catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Upload failed" }); }
    finally { setBusy(false); }
  }

  async function issue() {
    setBusy(true);
    try {
      const done = await issueConfigured(request.id, { issuerValues: values, ...(fee > 0 ? { feeReceiptNo: receipt.trim() } : {}), ...(uploadedUrl ? { uploadedUrl } : {}) });
      toast({ variant: "success", title: `Issued ${done.certificateNumber ?? ""}` });
      setPreview(null);
      if (done.issuedCertificateId) await downloadIssued(done.issuedCertificateId).catch(() => undefined);
      onDone();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't issue the certificate" });
    } finally { setBusy(false); }
  }

  async function reject() {
    if (!remarks.trim()) { toast({ variant: "destructive", title: "Please add a reason for rejecting" }); return; }
    setBusy(true);
    try { await rejectAtIssuance(request.id, remarks.trim()); toast({ variant: "success", title: "Rejected" }); onDone(); }
    catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "That didn't work" }); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <p className="font-semibold">{request.studentName} · {request.studentRollNumber}</p>
            <p className="text-xs text-muted-foreground">{request.studentDepartment} · Year {request.studentYear} · Section {request.studentSection}</p>
            <p className="text-sm font-medium mt-1">{request.certificateTypeLabel}</p>
          </div>
          <StatusBadge status={request.status} />
        </div>
        <StudentProfileDialog requestId={request.id} studentName={request.studentName} />
        <RequestAnswers request={request} />
        <details className="rounded-md border p-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Approvals</summary>
          <div className="mt-2"><StepTimeline request={request} /></div>
        </details>

        {fields.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key} className={f.kind === "textarea" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
                <Label htmlFor={`${request.id}-${f.key}`}>{f.label}{f.required ? " *" : ""}</Label>
                <FieldInput id={`${request.id}-${f.key}`} field={f} value={values[f.key] ?? ""} onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))} />
              </div>
            ))}
          </div>
        )}
        {fee > 0 && (
          <div className="space-y-1.5 max-w-sm">
            <Label htmlFor={`${request.id}-receipt`}>Fee receipt number (Rs. {fee}) *</Label>
            <Input id={`${request.id}-receipt`} value={receipt} onChange={(e) => setReceipt(e.target.value)} placeholder="Receipt no. of the fee paid" />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor={`${request.id}-remarks`}>Remarks (required to reject)</Label>
          <Textarea id={`${request.id}-remarks`} value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={showPreview} disabled={busy}><Eye className="h-4 w-4 mr-1" /> Preview & issue</Button>
          <Button variant="outline" onClick={reject} disabled={busy}>Reject</Button>
        </div>
      </CardContent>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>{request.certificateTypeLabel} - {request.studentName}</DialogTitle></DialogHeader>
          {preview?.uploadOnly ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">This certificate is issued as a PDF you upload (e.g. the university&apos;s certificate). A number and QR record are still kept in the register.</p>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Upload className="h-4 w-4" /> {uploadedUrl ? "Replace PDF" : "Upload PDF"}
                <input type="file" accept="application/pdf" className="hidden" onChange={(e) => onUpload(e.target.files?.[0])} />
              </label>
              {uploadedUrl && <a className="ml-2 text-sm text-primary underline" href={uploadedUrl} target="_blank" rel="noopener noreferrer">View uploaded PDF</a>}
            </div>
          ) : (
            <>
              {preview && preview.missing.length > 0 && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  Not filled: {preview.missing.join(", ")}. Fill the field above, or the student&apos;s record, before issuing - blanks print as a line.
                </p>
              )}
              <div className="max-h-[65vh] overflow-y-auto"><A4Preview title="Certificate preview" html={preview?.html ?? ""} /></div>
            </>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={showPreview} disabled={busy}>Refresh preview</Button>
            <Button onClick={issue} loading={busy} disabled={preview?.uploadOnly ? !uploadedUrl : false}><FileCheck2 className="h-4 w-4 mr-1" /> Issue certificate</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
