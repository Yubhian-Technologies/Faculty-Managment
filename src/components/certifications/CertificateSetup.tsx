"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Library, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { toast } from "@/hooks/useToast";
import { CERTIFICATE_CATEGORIES, DEFAULT_NUMBER_FORMAT, formatCertificateNumber, recipientLabel } from "@/lib/certifications/typeConfig";
import { PLACEHOLDER_GROUPS, renderCertificateHtml } from "@/lib/certifications/render";
import type { CertificateSettings, CertificateSignature, CertificateTemplate, CertificateTypeConfig } from "@/types";
import type { StudentResultsView } from "@/lib/examResults/studentResults";
import {
  deleteTemplate, deleteType, installCatalog, resetType, loadSetup, loadStaff, saveSignatures, saveTemplate, saveType, uploadSignature,
  type SetupType, type StaffOption,
} from "./configApi";
import { A4Preview } from "./A4Preview";
import { AttachmentListEditor, FieldListEditor, FlowEditor, RecipientPicker, Section } from "./SetupEditors";

// Certificate Setup (Principal / College Admin / VP): the certificates students may apply for - who may apply,
// what they fill in, who approves (in order, or several at once), who issues, the template, the number format,
// the fee and the signature - plus the templates and signatures themselves. An edit applies to requests made
// after it; one already applied for keeps what it was made with, and an issued certificate keeps its frozen copy.

const STATUS_OPTIONS = [
  { value: "REGULAR", label: "Studying" }, { value: "DETAINED", label: "Detained" },
  { value: "GRADUATED", label: "Passed out" }, { value: "DISCONTINUED", label: "Discontinued" },
] as const;

const SAMPLE: Record<string, string> = {
  studentName: "RAVI KUMAR", rollNumber: "22A31A0501", admissionNo: "A2022-0501", fatherName: "SURESH KUMAR", motherName: "LAKSHMI",
  gender: "Male", sonDaughter: "son", heShe: "he", hisHer: "his", himHer: "him", MrMs: "Mr.", dateOfBirth: "09-05-2004", nationality: "Indian",
  religion: "Hindu", caste: "BC-B", permanentAddress: "1-23, Main Road, Bhimavaram", dateOfAdmission: "01-08-2022", course: "B.Tech",
  branch: "CSE", year: "III", section: "A", academicYear: "2026-27", batch: "2022-2026", regulation: "R22", studentStatus: "is studying",
  cgpa: "8.42", certificateNumber: "BON/2026/0001", issueDate: "03-11-2026", purpose: "Passport", requestDate: "01-11-2026", feeReceiptNo: "R-1024",
};

// Sample published results, so a marks template's preview shows its tables.
const sub = (code: string, name: string, credits: number, grade: string) => ({ subjectCode: code, subjectName: name, credits, grade, isPass: grade !== "F", attempts: [] });
const SAMPLE_MARKS: StudentResultsView = {
  semesters: [
    { semester: 1, year: 1, sgpa: 8.21, sgpaWithheld: false, cgpa: 8.21, cgpaWithheld: false, credits: 20, backlogs: [],
      subjects: [sub("R22MA101", "Engineering Mathematics - I", 4, "A"), sub("R22PH102", "Engineering Physics", 3, "B+"), sub("R22CS103", "Programming in C", 3, "A+"), sub("R22CS104", "C Programming Lab", 1.5, "O")] },
    { semester: 2, year: 1, sgpa: 8.63, sgpaWithheld: false, cgpa: 8.42, cgpaWithheld: false, credits: 20, backlogs: [],
      subjects: [sub("R22MA201", "Engineering Mathematics - II", 4, "A+"), sub("R22CS202", "Data Structures", 3, "A"), sub("R22EE203", "Basic Electrical Engineering", 3, "B+")] },
  ],
  cgpa: 8.42, cgpaWithheld: false, creditsEarned: 40, backlogs: [], decimals: 2,
};

const SAMPLE_CLEARANCES = [
  { label: "Library", status: "No dues", by: "Librarian", date: "01-11-2026" },
  { label: "Hostel Accounts", status: "Not applicable", by: "Hostel Office", date: "01-11-2026" },
  { label: "Exam Cell", status: "Pass", by: "Exam Cell", date: "02-11-2026" },
  { label: "Physical Education", status: "No dues", by: "Physical Director", date: "02-11-2026" },
];

/** The certificate a template produces, for a sample student (the type's own fields shown by their label). */
type PreviewCollege = { name: string; address?: string; logoUrl?: string };
function sampleHtml(template: CertificateTemplate, opts: { college: PreviewCollege; signature: CertificateSignature | null; certificateNumber: string; fields?: { key: string; label: string; defaultValue?: string; kind?: string }[] }) {
  const own = Object.fromEntries((opts.fields ?? []).filter((f) => f.key).map((f) => [f.key, f.defaultValue || (f.key === "semester" ? "2" : `[${f.label}]`)]));
  return renderCertificateHtml(template, {
    college: opts.college, values: { ...SAMPLE, ...own, certificateNumber: opts.certificateNumber }, certificateNumber: opts.certificateNumber,
    marks: SAMPLE_MARKS, clearances: SAMPLE_CLEARANCES, verifyUrl: "https://example.org/verify-certificate/SAMPLE", preview: true, signature: opts.signature,
  });
}

function blankType(templateId: string): Partial<CertificateTypeConfig> {
  return {
    name: "", code: "", category: "IDENTITY", description: "", isActive: false, eligibility: { statuses: [], years: [] }, purposes: [],
    allowOtherPurpose: true, fields: [], attachments: [], onceOnly: false, feeAmount: 0,
    flow: [{ id: "hod", type: "SEQUENTIAL", label: "HOD verification", recipient: { kind: "STUDENT_DEPARTMENT_HOD" } }],
    issuer: { kind: "ROLE", role: "COLLEGE_OFFICE" }, templateId, issuerFields: [], numberFormat: DEFAULT_NUMBER_FORMAT, delivery: "BOTH",
  };
}

function TypeEditor({ initial, id, templates, signatures, staff, college, onClose, onSaved }: {
  initial: Partial<CertificateTypeConfig>; id?: string; templates: CertificateTemplate[]; signatures: CertificateSignature[]; staff: StaffOption[]; college: PreviewCollege;
  onClose: () => void; onSaved: () => void;
}) {
  const [t, setT] = useState<Partial<CertificateTypeConfig>>(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof CertificateTypeConfig>(k: K, v: CertificateTypeConfig[K]) => setT((p) => ({ ...p, [k]: v }));
  const elig = t.eligibility ?? { statuses: [], years: [] };
  const sampleNo = formatCertificateNumber(t.numberFormat || DEFAULT_NUMBER_FORMAT, { code: (t.code || "CODE").toUpperCase(), year: new Date().getFullYear(), academicYear: "2026-27", seq: 1 });
  const [previewing, setPreviewing] = useState(false);
  const template = templates.find((x) => x.id === t.templateId);
  const signature = signatures.find((x) => x.id === t.signatureId) ?? signatures[0] ?? null;
  const previewHtml = useMemo(() => (previewing && template
    ? sampleHtml({ ...template, title: template.title || t.name || "CERTIFICATE" }, { college, signature, certificateNumber: sampleNo, fields: [...(t.fields ?? []), ...(t.issuerFields ?? [])] })
    : ""), [previewing, template, signature, sampleNo, t.fields, t.issuerFields, t.name, college]);

  async function save() {
    setBusy(true);
    try { await saveType(t, id); toast({ variant: "success", title: "Saved" }); onSaved(); }
    catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save" }); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{id ? `Edit ${initial.name}` : "New certificate"}</DialogTitle></DialogHeader>
        <div className="space-y-6">
          <Section title="Certificate">
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem_14rem]">
              <div className="space-y-1.5"><Label htmlFor="ct-name">Name *</Label><Input id="ct-name" value={t.name ?? ""} onChange={(e) => set("name", e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="ct-code">Code *</Label><Input id="ct-code" value={t.code ?? ""} maxLength={10} onChange={(e) => set("code", e.target.value.toUpperCase())} /></div>
              <div className="space-y-1.5"><Label>Group</Label>
                <Select value={t.category} onValueChange={(v) => set("category", v as CertificateTypeConfig["category"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CERTIFICATE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="ct-desc">Description shown to students</Label><Input id="ct-desc" value={t.description ?? ""} onChange={(e) => set("description", e.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm"><Switch checked={t.isActive === true} onCheckedChange={(c) => set("isActive", c)} /> Switched on</label>
            <div className="space-y-1.5 max-w-md"><Label>Who starts it</Label>
              <Select value={t.startedBy ?? "STUDENT"} onValueChange={(v) => set("startedBy", v as CertificateTypeConfig["startedBy"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="STUDENT">The student applies</SelectItem>
                  <SelectItem value="OFFICE">The College Office starts it for classes (e.g. No Dues)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Section>

          <Section title="Who can apply" hint="Leave all unticked for every student.">
            <div className="flex flex-wrap gap-4">
              {STATUS_OPTIONS.map((s) => (
                <label key={s.value} className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={elig.statuses.includes(s.value)} onCheckedChange={(c) => set("eligibility", { ...elig, statuses: c ? [...elig.statuses, s.value] : elig.statuses.filter((x) => x !== s.value) })} /> {s.label}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-sm text-muted-foreground">Years:</span>
              {[1, 2, 3, 4, 5, 6].map((y) => (
                <label key={y} className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={elig.years.includes(y)} onCheckedChange={(c) => set("eligibility", { ...elig, years: c ? [...elig.years, y].sort() : elig.years.filter((x) => x !== y) })} /> {y}
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={t.onceOnly === true} onCheckedChange={(c) => set("onceOnly", c === true)} /> Issued only once to a student (e.g. TC)</label>
          </Section>

          <Section title="What the student fills in">
            <div className="space-y-1.5">
              <Label htmlFor="ct-purposes">Purposes to choose from (one per line)</Label>
              <Textarea id="ct-purposes" rows={3} value={(t.purposes ?? []).join("\n")} onChange={(e) => set("purposes", e.target.value.split("\n").map((p) => p.trim()).filter(Boolean))} />
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={t.allowOtherPurpose === true} onCheckedChange={(c) => set("allowOtherPurpose", c === true)} /> Allow &quot;Other&quot; with their own text</label>
            </div>
            <FieldListEditor fields={t.fields ?? []} onChange={(f) => set("fields", f)} addLabel="Add question" />
            <Label>Documents to attach</Label>
            <AttachmentListEditor items={t.attachments ?? []} onChange={(a) => set("attachments", a)} />
          </Section>

          <Section title="Approvals" hint="In order, top to bottom. Any approver can approve, reject, or send it back to the student to correct.">
            <FlowEditor flow={t.flow ?? []} onChange={(f) => set("flow", f)} staff={staff} />
          </Section>

          <Section title="Issuing">
            <div className="space-y-1.5"><Label>Issued by</Label><RecipientPicker idPrefix="issuer" value={t.issuer ?? { kind: "ROLE", role: "COLLEGE_OFFICE" }} onChange={(r) => set("issuer", r)} staff={staff} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Template *</Label>
                <div className="flex gap-2">
                  <Select value={t.templateId || undefined} onValueChange={(v) => set("templateId", v)}>
                    <SelectTrigger className="min-w-0 flex-1"><SelectValue placeholder="Pick a template" /></SelectTrigger>
                    <SelectContent>{templates.map((x) => <SelectItem key={x.id} value={x.id}>{x.name} ({x.kind.toLowerCase()})</SelectItem>)}</SelectContent>
                  </Select>
                  <Button type="button" variant="outline" disabled={!template} onClick={() => setPreviewing(true)}><Eye className="h-4 w-4 mr-1" /> Preview</Button>
                </div>
              </div>
              <div className="space-y-1.5"><Label>Signature</Label>
                <Select value={t.signatureId || "DEFAULT"} onValueChange={(v) => set("signatureId", v === "DEFAULT" ? undefined : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DEFAULT">First signature (default)</SelectItem>
                    {signatures.map((s) => <SelectItem key={s.id} value={s.id}>{s.designation}{s.name ? ` - ${s.name}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="ct-number">Number format</Label>
                <Input id="ct-number" value={t.numberFormat ?? ""} onChange={(e) => set("numberFormat", e.target.value)} />
                <p className="text-xs text-muted-foreground">{"{CODE} {YYYY} {AY} {SEQ}"} - e.g. {sampleNo}</p>
              </div>
              <div className="space-y-1.5"><Label htmlFor="ct-fee">Fee (Rs., 0 = free)</Label>
                <Input id="ct-fee" type="number" min={0} value={t.feeAmount ?? 0} onChange={(e) => set("feeAmount", Number(e.target.value))} />
              </div>
              <div className="space-y-1.5"><Label>Delivery</Label>
                <Select value={t.delivery} onValueChange={(v) => set("delivery", v as CertificateTypeConfig["delivery"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DIGITAL">Download only</SelectItem><SelectItem value="PHYSICAL">Signed copy at the office</SelectItem><SelectItem value="BOTH">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Label>Filled in by the issuer</Label>
            <FieldListEditor fields={t.issuerFields ?? []} onChange={(f) => set("issuerFields", f)} withDefaults addLabel="Add issuer field" />
          </Section>
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} loading={busy}>Save</Button>
        </div>
      </DialogContent>
      <Dialog open={previewing} onOpenChange={setPreviewing}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Preview: {t.name || "certificate"}</DialogTitle></DialogHeader>
          {template?.kind === "UPLOAD" ? (
            <p className="text-sm text-muted-foreground">This template is an uploaded PDF: the issuer uploads the certificate (e.g. the university&apos;s) when issuing. It is still numbered ({sampleNo}) and kept in the register with a QR record.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">A sample student. This certificate&apos;s own questions and issuer fields show as [their label]. {signatures.length === 0 && "No signature is set up yet - add one under Signatures."}</p>
              <div className="max-h-[75vh] overflow-y-auto"><A4Preview title="Certificate preview" html={previewHtml} /></div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function TemplateEditor({ initial, id, signature, college, onClose, onSaved }: { initial: Partial<CertificateTemplate>; id?: string; signature: CertificateSignature | null; college: PreviewCollege; onClose: () => void; onSaved: () => void }) {
  const [t, setT] = useState<Partial<CertificateTemplate>>(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof CertificateTemplate>(k: K, v: CertificateTemplate[K]) => setT((p) => ({ ...p, [k]: v }));
  const kind = t.kind ?? "LETTER";
  const html = useMemo(() => sampleHtml({ id: "x", name: "", title: t.title || "TITLE", showQr: t.showQr !== false, ...t, kind } as CertificateTemplate,
    { college, signature, certificateNumber: SAMPLE.certificateNumber }), [t, kind, signature, college]);

  async function save() {
    setBusy(true);
    try { await saveTemplate({ ...t, kind }, id); toast({ variant: "success", title: "Template saved" }); onSaved(); }
    catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save" }); }
    finally { setBusy(false); }
  }
  const insert = (key: string) => set("body", `${t.body ?? ""}{{${key}}}`);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(96vw,90rem)] max-h-[94vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{id ? `Edit template: ${initial.name}` : "New template"}</DialogTitle></DialogHeader>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="tp-name">Name *</Label><Input id="tp-name" value={t.name ?? ""} onChange={(e) => set("name", e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Kind</Label>
                <Select value={kind} onValueChange={(v) => set("kind", v as CertificateTemplate["kind"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LETTER">Letter (paragraphs)</SelectItem><SelectItem value="FORM">Form (numbered rows)</SelectItem>
                    <SelectItem value="MARKS">Marks (from published results)</SelectItem><SelectItem value="UPLOAD">Uploaded PDF</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="tp-title">Heading *</Label><Input id="tp-title" value={t.title ?? ""} onChange={(e) => set("title", e.target.value)} /></div>
            {kind === "MARKS" && (
              <div className="space-y-1.5"><Label>Statement</Label>
                <Select value={t.marksKind ?? "SEMESTER"} onValueChange={(v) => set("marksKind", v as CertificateTemplate["marksKind"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SEMESTER">One semester (asks the student which)</SelectItem>
                    <SelectItem value="CONSOLIDATED">Consolidated (SGPA per semester, CGPA)</SelectItem>
                    <SelectItem value="TRANSCRIPT">Transcript (every subject)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {(kind === "LETTER" || kind === "MARKS") && (
              <div className="space-y-1.5">
                <Label htmlFor="tp-body">{kind === "MARKS" ? "Text above the marks (optional)" : "Certificate text *"}</Label>
                <Textarea id="tp-body" rows={9} value={t.body ?? ""} onChange={(e) => set("body", e.target.value)} />
                <p className="text-xs text-muted-foreground">A blank line starts a new paragraph. Click a value to add it:</p>
                {PLACEHOLDER_GROUPS.map((g) => (
                  <div key={g.title} className="flex flex-wrap gap-1">
                    {g.items.map((i) => <button key={i.key} type="button" onClick={() => insert(i.key)} className="rounded border px-1.5 py-0.5 text-xs hover:bg-muted" title={`{{${i.key}}}`}>{i.label}</button>)}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">A certificate&apos;s own questions and issuer fields are added by their code, e.g. {"{{dateOfLeaving}}"}.</p>
              </div>
            )}
            {kind === "FORM" && (
              <div className="space-y-2">
                <Label>Rows</Label>
                {(t.rows ?? []).map((r, i) => (
                  <div key={i} className="flex gap-2">
                    <Input className="w-2/5" value={r.label} placeholder="Label" onChange={(e) => set("rows", (t.rows ?? []).map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                    <Input value={r.value} placeholder="{{studentName}}" onChange={(e) => set("rows", (t.rows ?? []).map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                    <Button size="icon" variant="ghost" onClick={() => set("rows", (t.rows ?? []).filter((_, j) => j !== i))} aria-label="Remove row"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => set("rows", [...(t.rows ?? []), { label: "", value: "" }])}><Plus className="h-4 w-4 mr-1" /> Add row</Button>
              </div>
            )}
            {kind !== "UPLOAD" && (
              <div className="space-y-1.5"><Label htmlFor="tp-footer">Note below (optional)</Label><Textarea id="tp-footer" rows={2} value={t.footer ?? ""} onChange={(e) => set("footer", e.target.value)} /></div>
            )}
            {kind !== "UPLOAD" && (
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={t.showClearances === true} onCheckedChange={(c) => set("showClearances", c === true)} /> Print every department&apos;s clearance as a table (No Dues)</label>
            )}
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={t.showQr !== false} onCheckedChange={(c) => set("showQr", c === true)} /> Print the QR verification code</label>
          </div>
          <div className="space-y-1.5">
            <Label>Preview (sample student)</Label>
            <div className="max-h-[75vh] overflow-y-auto"><A4Preview title="Template preview" html={html} /></div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} loading={busy}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SignaturesEditor({ settings, canEdit, onSaved }: { settings: CertificateSettings; canEdit: boolean; onSaved: () => void }) {
  const [list, setList] = useState<CertificateSignature[]>(settings.signatures);
  const [busy, setBusy] = useState(false);
  async function upload(i: number, file?: File) {
    if (!file) return;
    setBusy(true);
    try { const url = await uploadSignature(file); setList((l) => l.map((s, j) => (j === i ? { ...s, imageUrl: url } : s))); }
    catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Upload failed" }); }
    finally { setBusy(false); }
  }
  async function save() {
    setBusy(true);
    try { await saveSignatures(list); toast({ variant: "success", title: "Signatures saved" }); onSaved(); }
    catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save" }); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">The signature printed on certificates. A certificate type picks one; the first is used otherwise. Use a PNG with a transparent background (max 512 KB).</p>
      {list.map((s, i) => (
        <Card key={s.id}><CardContent className="p-3 flex flex-wrap items-center gap-3">
          <div className="flex h-14 w-40 items-center justify-center rounded border bg-white">
            {s.imageUrl ? <img src={s.imageUrl} alt="Signature" className="max-h-12 max-w-36 object-contain" /> : <span className="text-xs text-muted-foreground">No image</span>}
          </div>
          <Input className="w-44" value={s.designation} placeholder="Designation (Principal)" disabled={!canEdit} onChange={(e) => setList((l) => l.map((x, j) => (j === i ? { ...x, designation: e.target.value } : x)))} />
          <Input className="w-52" value={s.name} placeholder="Name (optional)" disabled={!canEdit} onChange={(e) => setList((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          {canEdit && (
            <>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"><Upload className="h-4 w-4" /> Image
                <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => upload(i, e.target.files?.[0])} />
              </label>
              <Button size="icon" variant="ghost" onClick={() => setList((l) => l.filter((_, j) => j !== i))} aria-label="Remove signature"><Trash2 className="h-4 w-4" /></Button>
            </>
          )}
        </CardContent></Card>
      ))}
      {canEdit && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setList((l) => [...l, { id: `sig${Date.now().toString(36)}`, name: "", designation: "Principal", imageUrl: "" }])}><Plus className="h-4 w-4 mr-1" /> Add signature</Button>
          <Button onClick={save} loading={busy}>Save signatures</Button>
        </div>
      )}
    </div>
  );
}

export function CertificateSetup({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<{ types: SetupType[]; templates: CertificateTemplate[]; settings: CertificateSettings } | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [tab, setTab] = useState("types");
  const [editingType, setEditingType] = useState<{ initial: Partial<CertificateTypeConfig>; id?: string } | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<{ initial: Partial<CertificateTemplate>; id?: string } | null>(null);
  const [deleting, setDeleting] = useState<{ kind: "type" | "template"; id: string; name: string } | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try { setData(await loadSetup()); }
    catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to load setup" }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (canEdit) loadStaff().then(setStaff).catch(() => setStaff([])); }, [canEdit]);
  // The college's own name, address and logo, so previews look like the real certificate.
  const [college, setCollege] = useState<PreviewCollege>({ name: "Your College" });
  useEffect(() => {
    fetch("/api/college/info").then((r) => (r.ok ? r.json() : null))
      .then((d: { name?: string; address?: string; rawLogoUrl?: string } | null) => { if (d) setCollege({ name: d.name || "Your College", address: d.address || undefined, logoUrl: d.rawLogoUrl || undefined }); })
      .catch(() => undefined);
  }, []);

  async function install() {
    setBusy("install");
    try {
      const { added } = await installCatalog();
      toast({ variant: "success", title: added.types || added.templates ? `Added ${added.types} certificates and ${added.templates} templates` : "Everything in the starter list is already installed" });
      load();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to install" }); }
    finally { setBusy(""); }
  }

  async function reset(t: SetupType) {
    if (!window.confirm(`Put "${t.name}" and its template back to the starter version? Your edits to them are replaced.`)) return;
    setBusy(`reset:${t.id}`);
    try { await resetType(t.id); toast({ variant: "success", title: "Reset to the starter version" }); load(); }
    catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to reset" }); }
    finally { setBusy(""); }
  }

  async function toggle(t: SetupType, on: boolean) {
    setBusy(t.id);
    try { await saveType({ ...t, isActive: on }, t.id); load(); }
    catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to change it" }); }
    finally { setBusy(""); }
  }

  async function remove() {
    if (!deleting) return;
    setBusy("delete");
    try {
      if (deleting.kind === "type") await deleteType(deleting.id); else await deleteTemplate(deleting.id);
      toast({ variant: "success", title: "Deleted" }); setDeleting(null); load();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to delete" }); }
    finally { setBusy(""); }
  }

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const templateName = new Map(data.templates.map((t) => [t.id, t.name]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedTabs value={tab} onChange={setTab} options={[
          { key: "types", label: `Certificates (${data.types.length})` }, { key: "templates", label: `Templates (${data.templates.length})` }, { key: "signatures", label: "Signatures" },
        ]} />
        {canEdit && (
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <Button variant="outline" onClick={install} loading={busy === "install"}><Library className="h-4 w-4 mr-1" /> Add starter certificates</Button>
            {tab === "types" && <Button onClick={() => setEditingType({ initial: blankType(data.templates[0]?.id ?? "") })} disabled={data.templates.length === 0}><Plus className="h-4 w-4 mr-1" /> New certificate</Button>}
            {tab === "templates" && <Button onClick={() => setEditingTemplate({ initial: { kind: "LETTER", showQr: true, title: "", name: "" } })}><Plus className="h-4 w-4 mr-1" /> New template</Button>}
          </div>
        )}
      </div>

      {tab === "types" && (data.types.length === 0 ? (
        <Card><EmptyState icon={<Library className="h-6 w-6" />} title="No certificates set up yet"
          description={canEdit ? "Add the starter certificates (28 common ones, switched off until you review them), or create your own." : "The Principal sets these up."} /></Card>
      ) : (
        <div className="space-y-4">
          {CERTIFICATE_CATEGORIES.map((c) => {
            const list = data.types.filter((t) => t.category === c.value);
            if (!list.length) return null;
            return (
              <section key={c.value} className="space-y-2">
                <h2 className="text-sm font-semibold text-muted-foreground">{c.label}</h2>
                {list.map((t) => (
                  <Card key={t.id}><CardContent className="p-3 flex flex-wrap items-center gap-3">
                    <Switch checked={t.isActive} disabled={!canEdit || busy === t.id} onCheckedChange={(on) => toggle(t, on)} aria-label={`${t.name} available to students`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{t.name} <span className="text-xs font-mono text-muted-foreground">{t.code}</span></p>
                      <p className="text-xs text-muted-foreground">
                        {t.flow.map((s) => (s.type === "PARALLEL" ? s.branches.map((b) => b.label || recipientLabel(b.recipient)).join(" + ") : s.label || recipientLabel(s.recipient))).join(" → ")}
                        {" → issued by "}{recipientLabel(t.issuer)} · {templateName.get(t.templateId) ?? "no template"}{t.startedBy === "OFFICE" ? " · started by the College Office" : ""}
                      </p>
                    </div>
                    {t.feeAmount > 0 && <Badge variant="secondary">Rs. {t.feeAmount}</Badge>}
                    {t.onceOnly && <Badge variant="outline">Once</Badge>}
                    {canEdit && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditingType({ initial: t, id: t.id })}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
                        {!t.inUse && t.catalogKey && <Button size="sm" variant="ghost" loading={busy === `reset:${t.id}`} onClick={() => reset(t)} title="Put this certificate and its template back to the starter version">Reset</Button>}
                        {!t.inUse && <Button size="icon" variant="ghost" onClick={() => setDeleting({ kind: "type", id: t.id, name: t.name })} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button>}
                      </div>
                    )}
                  </CardContent></Card>
                ))}
              </section>
            );
          })}
        </div>
      ))}

      {tab === "templates" && (
        <div className="grid gap-2 sm:grid-cols-2">
          {data.templates.map((t) => (
            <Card key={t.id}><CardContent className="p-3 flex items-center gap-3">
              <div className="min-w-0 flex-1"><p className="font-medium">{t.name}</p><p className="text-xs text-muted-foreground">{t.kind.toLowerCase()} · {t.title}</p></div>
              {canEdit && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setEditingTemplate({ initial: t, id: t.id })}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
                  <Button size="icon" variant="ghost" onClick={() => setDeleting({ kind: "template", id: t.id, name: t.name })} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button>
                </>
              )}
            </CardContent></Card>
          ))}
          {data.templates.length === 0 && <p className="text-sm text-muted-foreground">No templates yet.</p>}
        </div>
      )}

      {/* Keyed on what was saved, so a reload shows the stored list. */}
      {tab === "signatures" && <SignaturesEditor key={data.settings.signatures.map((s) => `${s.id}:${s.imageUrl}:${s.designation}:${s.name}`).join("|")} settings={data.settings} canEdit={canEdit} onSaved={load} />}

      {editingType && (
        <TypeEditor initial={editingType.initial} id={editingType.id} templates={data.templates} signatures={data.settings.signatures} staff={staff} college={college}
          onClose={() => setEditingType(null)} onSaved={() => { setEditingType(null); load(); }} />
      )}
      {editingTemplate && (
        <TemplateEditor initial={editingTemplate.initial} id={editingTemplate.id} signature={data.settings.signatures[0] ?? null} college={college}
          onClose={() => setEditingTemplate(null)} onSaved={() => { setEditingTemplate(null); load(); }} />
      )}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title={`Delete ${deleting?.name ?? ""}?`}
        description={deleting?.kind === "type" ? "Only certificates nobody has applied for can be deleted." : "Only templates no certificate uses can be deleted."}
        confirmLabel="Delete" variant="destructive" onConfirm={remove} loading={busy === "delete"} />
    </div>
  );
}
