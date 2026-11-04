"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileText, Paperclip, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { toast } from "@/hooks/useToast";
import { toDate } from "@/lib/utils";
import { CERTIFICATE_CATEGORIES } from "@/lib/certifications/typeConfig";
import type { CertificateRequest } from "@/types";
import { cancelRequest } from "./api";
import { applyFor, downloadIssued, loadCatalog, resubmitRequest, uploadAttachment, type CatalogEntry } from "./configApi";
import { FieldInput } from "./IssueCard";
import { RequestForm } from "./RequestForm";
import { StatusBadge } from "./StatusBadge";
import { RequestAnswers, StepTimeline } from "./StepTimeline";

// The student's Certificates page: every certificate the college offers (grouped, with the approvals each needs
// and its fee), the form to apply, and their own requests with every approval, corrections asked for, and the
// issued certificate to download. A college that has not set up any certificate types yet keeps the original
// No Due form.

const when = (ts: unknown) => {
  const d = toDate(ts as never);
  return d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
};

type FormState = { purpose: string; purposeOther: string; values: Record<string, string>; attachments: Record<string, string> };

function ApplyDialog({ entry, request, onClose, onDone }: { entry: CatalogEntry; request?: CertificateRequest; onClose: () => void; onDone: () => void }) {
  const t = entry.type;
  const [form, setForm] = useState<FormState>(() => ({
    purpose: request?.purpose && t.purposes.includes(request.purpose) ? request.purpose : request?.purpose ? "Other" : "",
    purposeOther: request?.purpose && !t.purposes.includes(request.purpose) ? request.purpose : "",
    values: { ...(request?.values ?? {}) },
    attachments: Object.fromEntries((request?.attachments ?? []).map((a) => [a.key, a.url])),
  }));
  const [busy, setBusy] = useState(false);
  const asksPurpose = t.purposes.length > 0 || t.allowOtherPurpose;
  const otherOnly = t.purposes.length === 0 && t.allowOtherPurpose;

  async function attach(key: string, file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try { const url = await uploadAttachment(file); setForm((f) => ({ ...f, attachments: { ...f.attachments, [key]: url } })); }
    catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Upload failed" }); }
    finally { setBusy(false); }
  }

  async function submit() {
    setBusy(true);
    const payload = {
      purpose: otherOnly ? "Other" : form.purpose, purposeOther: form.purposeOther.trim(), values: form.values,
      attachments: Object.entries(form.attachments).map(([key, url]) => ({ key, url })),
    };
    try {
      if (request) {
        await resubmitRequest(request.id, payload);
        toast({ variant: "success", title: "Corrected and sent again" });
      } else {
        const r = await applyFor({ typeId: t.id, ...payload });
        toast({ variant: r.alreadyExists ? "default" : "success", title: r.alreadyExists ? "You already have a request for this certificate" : "Applied" });
      }
      onDone();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't submit" });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{request ? `Correct: ${t.name}` : t.name}</DialogTitle>
          {t.description && <DialogDescription>{t.description}</DialogDescription>}
        </DialogHeader>
        {request?.returnRemarks && (
          <p className="rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-800 dark:bg-orange-950 dark:text-orange-200">To correct: {request.returnRemarks}</p>
        )}
        <div className="space-y-3">
          {asksPurpose && !otherOnly && (
            <div className="space-y-1.5">
              <Label htmlFor="cert-purpose">Purpose *</Label>
              <Select value={form.purpose || undefined} onValueChange={(v) => setForm((f) => ({ ...f, purpose: v }))}>
                <SelectTrigger id="cert-purpose"><SelectValue placeholder="Why do you need it?" /></SelectTrigger>
                <SelectContent>
                  {t.purposes.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  {t.allowOtherPurpose && <SelectItem value="Other">Other</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          )}
          {(otherOnly || form.purpose === "Other") && (
            <div className="space-y-1.5">
              <Label htmlFor="cert-purpose-other">{otherOnly ? "Purpose *" : "Describe the purpose *"}</Label>
              <Input id="cert-purpose-other" value={form.purposeOther} onChange={(e) => setForm((f) => ({ ...f, purposeOther: e.target.value }))} />
            </div>
          )}
          {t.fields.map((fd) => (
            <div key={fd.key} className="space-y-1.5">
              <Label htmlFor={`cert-${fd.key}`}>{fd.label}{fd.required ? " *" : ""}</Label>
              <FieldInput id={`cert-${fd.key}`} field={fd} value={form.values[fd.key] ?? ""} onChange={(v) => setForm((f) => ({ ...f, values: { ...f.values, [fd.key]: v } }))} />
            </div>
          ))}
          {t.attachments.map((a) => (
            <div key={a.key} className="space-y-1.5">
              <Label>{a.label}{a.required ? " *" : " (optional)"}</Label>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                  <Paperclip className="h-4 w-4" /> {form.attachments[a.key] ? "Replace" : "Attach PDF / image"}
                  <input type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => attach(a.key, e.target.files?.[0])} />
                </label>
                {form.attachments[a.key] && <a href={form.attachments[a.key]} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">View</a>}
              </div>
            </div>
          ))}
          <div className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
            <p>Approvals: {entry.steps.join(" → ")}</p>
            {t.feeAmount > 0 && <p>Fee: Rs. {t.feeAmount} - pay at the College Office; the receipt number is entered when it is issued.</p>}
            <p>{t.delivery === "PHYSICAL" ? "Collect the signed copy from the College Office." : t.delivery === "DIGITAL" ? "Download it here once issued." : "Download it here once issued; a signed copy is available at the College Office."}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
          <Button onClick={submit} loading={busy}>{request ? "Send again" : "Apply"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MyRequest({ request, entry, onChanged, onCorrect }: { request: CertificateRequest; entry?: CatalogEntry; onChanged: () => void; onCorrect: () => void }) {
  const [busy, setBusy] = useState(false);
  async function cancel() {
    setBusy(true);
    try { await cancelRequest(request.id); toast({ variant: "success", title: "Request cancelled" }); onChanged(); }
    catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't cancel" }); }
    finally { setBusy(false); }
  }
  async function download() {
    setBusy(true);
    try {
      if (request.issuedCertificateId) await downloadIssued(request.issuedCertificateId);
      else if (request.certificateUrl) window.open(request.certificateUrl, "_blank", "noopener");
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't open the certificate" }); }
    finally { setBusy(false); }
  }
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <p className="font-semibold">{request.certificateTypeLabel}</p>
            <p className="text-xs text-muted-foreground">Applied {when(request.createdAt)}{request.certificateNumber ? ` · ${request.certificateNumber}` : ""}</p>
          </div>
          <StatusBadge status={request.status} />
        </div>
        {request.status === "RETURNED" && request.returnRemarks && (
          <p className="rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-800 dark:bg-orange-950 dark:text-orange-200">Correction needed: {request.returnRemarks}</p>
        )}
        <RequestAnswers request={request} />
        <StepTimeline request={request} />
        <div className="flex flex-wrap gap-2">
          {request.status === "ISSUED" && (request.issuedCertificateId || request.certificateUrl) && (
            <Button size="sm" onClick={download} loading={busy}><Download className="h-4 w-4 mr-1" /> Download</Button>
          )}
          {request.status === "RETURNED" && entry && <Button size="sm" onClick={onCorrect} disabled={busy}>Correct and send again</Button>}
          {(request.status === "IN_PROGRESS" || request.status === "RETURNED") && <Button size="sm" variant="outline" onClick={cancel} disabled={busy}>Cancel request</Button>}
        </div>
      </CardContent>
    </Card>
  );
}

export function StudentCertificates() {
  const [data, setData] = useState<{ entries: CatalogEntry[]; linked: boolean; requests: CertificateRequest[] } | null>(null);
  const [tab, setTab] = useState("apply");
  const [query, setQuery] = useState("");
  const [applying, setApplying] = useState<{ entry: CatalogEntry; request?: CertificateRequest } | null>(null);

  const load = useCallback(async () => {
    try { setData(await loadCatalog()); }
    catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't load certificates" }); setData({ entries: [], linked: true, requests: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.entries ?? []).filter((e) => !q || e.type.name.toLowerCase().includes(q) || (e.type.description ?? "").toLowerCase().includes(q));
    return CERTIFICATE_CATEGORIES.map((c) => ({ ...c, entries: list.filter((e) => e.type.category === c.value) })).filter((g) => g.entries.length);
  }, [data, query]);

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data.linked) return <Card><EmptyState icon={<FileText className="h-6 w-6" />} title="Your login isn't linked to a student record yet" description="Please contact your College Office." /></Card>;
  // Nothing configured yet: the original No Due request form.
  if (data.entries.length === 0 && !data.requests.some((r) => r.certificateTypeId)) return <RequestForm />;

  const open = data.requests.filter((r) => ["IN_PROGRESS", "PENDING_ISSUANCE", "RETURNED"].includes(r.status));
  const byId = new Map(data.entries.map((e) => [e.type.id, e]));

  return (
    <div className="space-y-4">
      <SegmentedTabs value={tab} onChange={setTab} options={[
        { key: "apply", label: "Apply" },
        { key: "mine", label: `My requests${open.length ? ` (${open.length})` : ""}` },
      ]} />

      {tab === "apply" && (
        <div className="space-y-5">
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search certificates" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {groups.length === 0 && <p className="text-sm text-muted-foreground">No certificate matches.</p>}
          {groups.map((g) => (
            <section key={g.value} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">{g.label}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.entries.map((e) => (
                  <Card key={e.type.id} className="flex flex-col">
                    <CardContent className="flex flex-1 flex-col gap-2 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium leading-snug">{e.type.name}</p>
                        {e.type.feeAmount > 0 && <Badge variant="secondary">Rs. {e.type.feeAmount}</Badge>}
                      </div>
                      {e.type.description && <p className="text-xs text-muted-foreground">{e.type.description}</p>}
                      <p className="text-xs text-muted-foreground">Approvals: {e.steps.join(" → ")}</p>
                      <div className="mt-auto pt-1">
                        {e.openRequestId ? (
                          <Button size="sm" variant="outline" onClick={() => setTab("mine")}>View my request</Button>
                        ) : e.blocked ? (
                          <p className="text-xs text-muted-foreground">{e.blocked}</p>
                        ) : (
                          <Button size="sm" onClick={() => setApplying({ entry: e })}>Apply</Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {tab === "mine" && (
        data.requests.length === 0
          ? <Card><EmptyState icon={<FileText className="h-6 w-6" />} title="No requests yet" description="Apply for a certificate from the Apply tab." /></Card>
          : <div className="space-y-3">
              {data.requests.map((r) => (
                <MyRequest key={r.id} request={r} entry={r.certificateTypeId ? byId.get(r.certificateTypeId) : undefined} onChanged={load}
                  onCorrect={() => { const e = r.certificateTypeId ? byId.get(r.certificateTypeId) : undefined; if (e) setApplying({ entry: e, request: r }); }} />
              ))}
            </div>
      )}

      {applying && <ApplyDialog entry={applying.entry} request={applying.request} onClose={() => setApplying(null)} onDone={() => { setApplying(null); setTab("mine"); load(); }} />}
    </div>
  );
}
