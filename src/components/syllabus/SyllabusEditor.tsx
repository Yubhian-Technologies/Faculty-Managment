"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, Check, FileText, History, Layers, Lock, Send, ShieldCheck, Target, Trash2, Undo2, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CountInput, MappingChips } from "@/components/midBank/PrepareBank";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { LIMITS } from "@/lib/midBank/constants";
import { SYLLABUS_STATUS_LABEL } from "@/lib/subjects/syllabus";
import type { OutcomeMapping, SubjectSyllabus, SubjectSyllabusStatus } from "@/types";

// One subject's syllabus: the PDF, the units (title + topics), the Course Outcomes (each in a unit) and the
// CO -> PO/PSO ticks. The HOD of the Subject Department prepares and submits it; Academics freezes or returns it,
// and once frozen only Academics edits it - every change kept with date and time. Faculty read it here.

interface Loaded {
  subject: { id: string; name: string; code: string; courseName: string; regulation: string; syllabusUrl: string | null; syllabusFileName: string | null };
  subjectDepartments: string[];
  syllabus: SubjectSyllabus | null;
  can: { hodEdit: boolean; decide: boolean; editFrozen: boolean; isHod: boolean; isAcademics: boolean };
}
interface Draft { units: { title: string; syllabus: string }[]; cos: { statement: string; unit: number }[]; mapping: OutcomeMapping }

const blankDraft = (): Draft => ({ units: Array.from({ length: 5 }, () => ({ title: "", syllabus: "" })), cos: Array.from({ length: 5 }, () => ({ statement: "", unit: 0 })), mapping: {} });
const toDraft = (s: SubjectSyllabus | null): Draft => s
  ? { units: s.units.map((u) => ({ title: u.title, syllabus: u.syllabus ?? "" })), cos: s.cos.map((c) => ({ statement: c.statement, unit: c.unit ?? 0 })), mapping: s.mapping ?? {} }
  : blankDraft();
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

const STATUS_CLASS: Record<SubjectSyllabusStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  SUBMITTED: "bg-amber-100 text-amber-900",
  FROZEN: "bg-emerald-100 text-emerald-800",
  RETURNED: "bg-red-100 text-red-800",
};
const ACTION_LABEL: Record<string, string> = {
  SAVED: "Saved", SUBMITTED: "Submitted to Academics", FROZEN: "Frozen", RETURNED: "Returned to HOD",
  EDITED_AFTER_FREEZE: "Changed after freezing", PDF_CHANGED: "Syllabus PDF changed",
};

export function SyllabusEditor({ subjectId, backHref, backLabel }: { subjectId: string; backHref: string; backLabel: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirm, setConfirm] = useState<null | "SUBMIT" | "FREEZE" | "RETURN" | "SAVE_FROZEN">(null);
  const [remarks, setRemarks] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let off = false;
    fetch(`/api/college/subjects/${encodeURIComponent(subjectId)}/syllabus-outcomes`)
      .then(async (r) => { const d = (await r.json()) as Loaded & { error?: string }; if (!r.ok) throw new Error(d.error ?? "Failed to load"); return d; })
      .then((d) => { if (!off) { setData(d); setDraft(toDraft(d.syllabus)); setError(""); } })
      .catch((e: unknown) => { if (!off) setError(e instanceof Error ? e.message : "Failed to load"); });
    return () => { off = true; };
  }, [subjectId, reloadKey]);

  if (error) return <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</p>;
  if (!data) return <div className="h-40 animate-pulse rounded-2xl border bg-muted/30" />;

  const { subject, syllabus, can } = data;
  const status = syllabus?.status ?? null;
  const editable = can.hodEdit || can.editFrozen;
  const unitNos = draft.units.map((_, i) => i + 1);
  const mapped = draft.cos.filter((_, i) => (draft.mapping[`CO${i + 1}`] ?? []).length > 0).length;
  const reload = () => setReloadKey((k) => k + 1);

  const body = () => ({
    baseVersion: syllabus?.version ?? 0,
    units: draft.units.map((u) => ({ title: u.title, syllabus: u.syllabus })),
    cos: draft.cos.map((c) => ({ statement: c.statement, unit: c.unit })),
    mapping: draft.mapping,
  });

  async function save(): Promise<SubjectSyllabus | null> {
    const res = await fetch(`/api/college/subjects/${encodeURIComponent(subjectId)}/syllabus-outcomes`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()),
    });
    const json = (await res.json()) as { syllabus?: SubjectSyllabus; error?: string; errors?: string[] };
    if (!res.ok || !json.syllabus) { setErrors(json.errors ?? [json.error ?? "Failed to save"]); return null; }
    return json.syllabus;
  }

  async function act(action: "SUBMIT" | "FREEZE" | "RETURN", version: number) {
    const res = await fetch(`/api/college/subjects/${encodeURIComponent(subjectId)}/syllabus-outcomes`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, remarks, baseVersion: version }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) { setErrors([json.error ?? "Failed"]); return false; }
    return true;
  }

  async function run(kind: "SAVE" | "SUBMIT" | "FREEZE" | "RETURN" | "SAVE_FROZEN") {
    setErrors([]);
    setBusy(true);
    try {
      if (kind === "SAVE" || kind === "SAVE_FROZEN") {
        if (await save()) { toast({ variant: "success", title: kind === "SAVE" ? "Draft saved" : "Changes saved and recorded" }); reload(); }
      } else if (kind === "SUBMIT") {
        const saved = await save();
        if (saved && (await act("SUBMIT", saved.version))) { toast({ variant: "success", title: "Submitted to Academics" }); reload(); }
      } else if (await act(kind, syllabus?.version ?? 0)) {
        toast({ variant: "success", title: kind === "FREEZE" ? "Syllabus frozen" : "Returned to the HOD" });
        reload();
      }
    } catch {
      setErrors(["Network error - nothing was saved"]);
    } finally {
      setBusy(false);
      setConfirm(null);
      setRemarks("");
    }
  }

  async function uploadPdf(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/college/subjects/${encodeURIComponent(subjectId)}/syllabus`, { method: "POST", body: fd });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) toast({ variant: "destructive", title: json.error ?? "Upload failed" });
      else { toast({ variant: "success", title: "Syllabus PDF uploaded" }); reload(); }
    } finally {
      setBusy(false);
    }
  }

  async function removePdf() {
    setBusy(true);
    try {
      const res = await fetch(`/api/college/subjects/${encodeURIComponent(subjectId)}/syllabus`, { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) toast({ variant: "destructive", title: json.error ?? "Could not remove it" });
      else { toast({ variant: "success", title: "Syllabus PDF removed" }); reload(); }
    } finally {
      setBusy(false);
    }
  }

  const resizeUnits = (n: number) => setDraft((d) => ({ ...d, units: Array.from({ length: n }, (_, i) => d.units[i] ?? { title: "", syllabus: "" }), cos: d.cos.map((c) => (c.unit > n ? { ...c, unit: 0 } : c)) }));
  const resizeCos = (n: number) => setDraft((d) => {
    const mapping: OutcomeMapping = {};
    for (let i = 0; i < n; i++) if (d.mapping[`CO${i + 1}`]) mapping[`CO${i + 1}`] = d.mapping[`CO${i + 1}`];
    return { ...d, cos: Array.from({ length: n }, (_, i) => d.cos[i] ?? { statement: "", unit: 0 }), mapping };
  });

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Syllabus"
        description={`${subject.name} (${subject.code})${subject.courseName ? ` · ${subject.courseName}` : ""}${subject.regulation ? ` · ${subject.regulation}` : ""}`}
        actions={<Button asChild variant="ghost" size="sm"><Link href={backHref}><ArrowLeft className="mr-1.5 h-4 w-4" />{backLabel}</Link></Button>}
      />

      {/* Where it stands */}
      <Card className="rounded-2xl">
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", status ? STATUS_CLASS[status] : "bg-muted text-muted-foreground")}>{status ? SYLLABUS_STATUS_LABEL[status] : "Not started"}</span>
          <span className="text-muted-foreground">Subject Department: {data.subjectDepartments.join(", ") || "not set"}</span>
          {syllabus?.frozenAt && <span className="text-muted-foreground">Frozen by {syllabus.frozenByName} on {when(syllabus.frozenAt)}</span>}
          {status === "SUBMITTED" && syllabus?.submittedAt && <span className="text-muted-foreground">Submitted by {syllabus.submittedByName} on {when(syllabus.submittedAt)}</span>}
          {!editable && !can.decide && <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" />Read-only</span>}
        </CardContent>
      </Card>
      {data.subjectDepartments.length === 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Academics hasn&apos;t set this subject&apos;s Subject Department yet (Curriculum &gt; Subjects). Its HOD prepares the syllabus after that.</p>
      )}
      {status === "RETURNED" && syllabus?.returnRemarks && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900"><b>Returned by Academics:</b> {syllabus.returnRemarks}</p>
      )}
      {status === "FROZEN" && can.editFrozen && (
        <p className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">The syllabus is frozen. Your changes are recorded with the date and time, and the HOD is told. A unit or CO that Mid questions already use can&apos;t be removed.</p>
      )}

      {/* PDF */}
      <Card className="rounded-2xl">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <FileText className="h-5 w-5 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Syllabus PDF</p>
            {subject.syllabusUrl
              ? <a href={subject.syllabusUrl} target="_blank" rel="noreferrer" className="truncate text-sm text-primary underline-offset-2 hover:underline">{subject.syllabusFileName || "syllabus.pdf"}</a>
              : <p className="text-xs text-muted-foreground">Not uploaded yet</p>}
          </div>
          {editable && (
            <>
              <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadPdf(f); }} />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}><Upload className="mr-1.5 h-4 w-4" />{subject.syllabusUrl ? "Replace" : "Upload PDF"}</Button>
              {subject.syllabusUrl && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void removePdf()} aria-label="Remove the PDF"><Trash2 className="h-4 w-4" /></Button>}
            </>
          )}
        </CardContent>
      </Card>

      {/* Units */}
      <Card className="rounded-2xl">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
            <h2 className="flex items-center gap-2 text-base font-semibold"><Layers className="h-4 w-4 text-primary" />Units</h2>
            <CountInput id="syl-units" label="Number of units" value={draft.units.length} max={LIMITS.units} disabled={!editable} onChange={resizeUnits} />
          </div>
          <ol className="grid gap-3 md:grid-cols-2">
            {draft.units.map((u, i) => (
              <li key={i} className="space-y-2 rounded-xl border p-3">
                <Label htmlFor={`syl-unit-${i}`} className="text-sm font-medium">Unit {i + 1}</Label>
                <Input id={`syl-unit-${i}`} value={u.title} disabled={!editable} maxLength={LIMITS.unitTitle} placeholder="Unit title, as in the syllabus"
                  onChange={(e) => setDraft((d) => ({ ...d, units: d.units.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) }))} />
                <Textarea aria-label={`Unit ${i + 1} topics`} rows={3} value={u.syllabus} disabled={!editable} maxLength={LIMITS.unitSyllabus} placeholder="Topics of this unit (optional)"
                  onChange={(e) => setDraft((d) => ({ ...d, units: d.units.map((x, j) => (j === i ? { ...x, syllabus: e.target.value } : x)) }))} />
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* COs */}
      <Card className="rounded-2xl">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
            <h2 className="flex items-center gap-2 text-base font-semibold"><Target className="h-4 w-4 text-primary" />Course Outcomes</h2>
            <CountInput id="syl-cos" label="Number of COs" value={draft.cos.length} max={LIMITS.cos} disabled={!editable} onChange={resizeCos} />
          </div>
          <ol className="space-y-3">
            {draft.cos.map((c, i) => (
              <li key={i} className="grid gap-2 rounded-xl border p-3 md:grid-cols-[70px_minmax(0,1fr)_160px] md:items-center">
                <span className="text-sm font-semibold">CO{i + 1}</span>
                <Input aria-label={`CO${i + 1} statement`} value={c.statement} disabled={!editable} maxLength={LIMITS.statement} placeholder="What the student will be able to do"
                  onChange={(e) => setDraft((d) => ({ ...d, cos: d.cos.map((x, j) => (j === i ? { ...x, statement: e.target.value } : x)) }))} />
                <select aria-label={`CO${i + 1} unit`} disabled={!editable} value={c.unit || ""}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
                  onChange={(e) => setDraft((d) => ({ ...d, cos: d.cos.map((x, j) => (j === i ? { ...x, unit: Number(e.target.value) || 0 } : x)) }))}>
                  <option value="">Unit...</option>
                  {unitNos.map((n) => <option key={n} value={n}>Unit {n}{draft.units[n - 1]?.title ? ` - ${draft.units[n - 1].title.slice(0, 30)}` : ""}</option>)}
                </select>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* Mapping */}
      <Card className="rounded-2xl">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
            <h2 className="flex items-center gap-2 text-base font-semibold"><BookOpen className="h-4 w-4 text-primary" />CO-PO / PSO mapping</h2>
            <span className={cn("text-xs font-semibold", mapped === draft.cos.length ? "text-emerald-600" : "text-muted-foreground")}>{mapped} of {draft.cos.length} COs mapped</span>
          </div>
          <ul className="space-y-3">
            {draft.cos.map((c, i) => {
              const co = `CO${i + 1}`;
              return (
                <li key={co} className="space-y-2 rounded-xl border p-3">
                  <p className="text-sm"><b>{co}</b>{c.unit ? <span className="ml-2 text-xs text-muted-foreground">Unit {c.unit}</span> : null} <span className="text-muted-foreground">{c.statement}</span></p>
                  <MappingChips co={co} value={draft.mapping[co] ?? []} disabled={!editable} onChange={(v) => setDraft((d) => ({ ...d, mapping: { ...d.mapping, [co]: v } }))} />
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {errors.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      {/* Actions */}
      {(can.hodEdit || can.decide || can.editFrozen) && (
        <div className="flex flex-wrap gap-2">
          {can.hodEdit && <>
            <Button variant="outline" disabled={busy} onClick={() => void run("SAVE")}><Check className="mr-1.5 h-4 w-4" />Save draft</Button>
            <Button disabled={busy} onClick={() => setConfirm("SUBMIT")}><Send className="mr-1.5 h-4 w-4" />Submit to Academics</Button>
          </>}
          {can.decide && <>
            <Button disabled={busy} onClick={() => setConfirm("FREEZE")}><ShieldCheck className="mr-1.5 h-4 w-4" />Freeze</Button>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm("RETURN")}><Undo2 className="mr-1.5 h-4 w-4" />Return to HOD</Button>
          </>}
          {can.editFrozen && <Button disabled={busy} onClick={() => setConfirm("SAVE_FROZEN")}><Check className="mr-1.5 h-4 w-4" />Save changes</Button>}
        </div>
      )}

      {/* History */}
      {!!syllabus?.history?.length && (
        <Card className="rounded-2xl">
          <CardContent className="space-y-3 p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold"><History className="h-4 w-4 text-primary" />History</h2>
            <ol className="space-y-3">
              {[...syllabus.history].reverse().map((h, i) => (
                <li key={`${h.at}-${i}`} className="rounded-xl border p-3 text-sm">
                  <p><b>{ACTION_LABEL[h.action] ?? h.action}</b> <span className="text-muted-foreground">· {h.byName} ({h.role === "ACADEMICS" ? "Academics" : "HOD"}) · {when(h.at)}</span></p>
                  {h.remarks && <p className="mt-1 text-muted-foreground">{h.remarks}</p>}
                  {!!h.changes?.length && (
                    <table className="mt-2 w-full text-xs">
                      <thead className="text-left text-muted-foreground"><tr><th className="py-1 pr-2 font-medium">What</th><th className="py-1 pr-2 font-medium">Before</th><th className="py-1 font-medium">After</th></tr></thead>
                      <tbody>{h.changes.map((c, j) => <tr key={j} className="border-t align-top"><td className="py-1 pr-2 font-medium">{c.field}</td><td className="py-1 pr-2 text-muted-foreground">{c.before}</td><td className="py-1">{c.after}</td></tr>)}</tbody>
                    </table>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => { if (!o) { setConfirm(null); setRemarks(""); } }}
        title={{ SUBMIT: "Submit to Academics?", FREEZE: "Freeze this syllabus?", RETURN: "Return it to the HOD?", SAVE_FROZEN: "Save changes to the frozen syllabus?" }[confirm ?? "SUBMIT"]}
        description={{
          SUBMIT: "Academics reviews and freezes it. You can't change it while it is with them; if they return it, you can.",
          FREEZE: "Faculty then prepare Mid papers from it. After this only Academics can change it, and every change is recorded.",
          RETURN: "The HOD can edit it again and resubmit. Say what needs changing.",
          SAVE_FROZEN: "Each change is recorded with the date and time, and the HOD is told.",
        }[confirm ?? "SUBMIT"]}
        confirmLabel={{ SUBMIT: "Submit", FREEZE: "Freeze", RETURN: "Return", SAVE_FROZEN: "Save" }[confirm ?? "SUBMIT"]}
        loading={busy}
        confirmDisabled={confirm === "RETURN" && !remarks.trim()}
        onConfirm={() => (confirm ? run(confirm) : undefined)}
      >
        {confirm === "RETURN" && (
          <Textarea aria-label="What needs changing" rows={3} value={remarks} maxLength={1000} placeholder="What needs changing" onChange={(e) => setRemarks(e.target.value)} />
        )}
      </ConfirmDialog>
    </div>
  );
}
