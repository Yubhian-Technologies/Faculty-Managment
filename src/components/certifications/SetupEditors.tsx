"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { APPROVER_ROLES, recipientLabel } from "@/lib/certifications/typeConfig";
import type { CertificateAttachmentDef, CertificateFieldDef, FlowStepDef, RecipientResolver, UserRole } from "@/types";
import type { StaffOption } from "./configApi";

// The small editors of Certificate Setup: who approves (a role, the student's HOD / mentor / class in-charge, or a
// named person), the approval steps (one approver, or several at the same time), and field lists.

const KIND_OPTIONS = [
  { value: "ROLE", label: "A role" },
  { value: "STUDENT_DEPARTMENT_HOD", label: "HOD of the student's department" },
  { value: "STUDENT_MENTOR", label: "Student's mentor" },
  { value: "CLASS_INCHARGE", label: "Class in-charge" },
  { value: "USER", label: "A named person" },
];

export function RecipientPicker({ value, onChange, staff, idPrefix }: { value: RecipientResolver; onChange: (r: RecipientResolver) => void; staff: StaffOption[]; idPrefix: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Select value={value.kind} onValueChange={(k) => onChange(
        k === "ROLE" ? { kind: "ROLE", role: "PRINCIPAL" } : k === "USER" ? { kind: "USER", uid: "", name: "" } : { kind: k as "STUDENT_DEPARTMENT_HOD" | "STUDENT_MENTOR" | "CLASS_INCHARGE" },
      )}>
        <SelectTrigger id={`${idPrefix}-kind`} className="w-60"><SelectValue /></SelectTrigger>
        <SelectContent>{KIND_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
      {value.kind === "ROLE" && (
        <Select value={value.role} onValueChange={(r) => onChange({ kind: "ROLE", role: r as UserRole })}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>{APPROVER_ROLES.map((r) => <SelectItem key={r.role} value={r.role}>{r.label}</SelectItem>)}</SelectContent>
        </Select>
      )}
      {value.kind === "USER" && (
        <Select value={value.uid || undefined} onValueChange={(uid) => onChange({ kind: "USER", uid, name: staff.find((s) => s.uid === uid)?.name ?? "" })}>
          <SelectTrigger className="w-64"><SelectValue placeholder={value.name || "Pick a person"} /></SelectTrigger>
          <SelectContent>{staff.map((s) => <SelectItem key={s.uid} value={s.uid}>{s.name} ({s.role.replace(/_/g, " ").toLowerCase()})</SelectItem>)}</SelectContent>
        </Select>
      )}
    </div>
  );
}

const newId = () => Math.random().toString(36).slice(2, 8);

export function FlowEditor({ flow, onChange, staff }: { flow: FlowStepDef[]; onChange: (f: FlowStepDef[]) => void; staff: StaffOption[] }) {
  const set = (i: number, s: FlowStepDef) => onChange(flow.map((x, j) => (j === i ? s : x)));
  const move = (i: number, d: -1 | 1) => { const n = [...flow]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange(n); };
  return (
    <div className="space-y-2">
      {flow.map((step, i) => (
        <div key={step.id} className="rounded-md border p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground w-12">Step {i + 1}</span>
            <Input className="w-56" value={step.label} placeholder="Step name (for example HOD verification)" onChange={(e) => set(i, { ...step, label: e.target.value })} />
            <Select value={step.type} onValueChange={(t) => set(i, t === "PARALLEL"
              ? { id: step.id, type: "PARALLEL", label: step.label, branches: [
                  { key: newId(), label: "", recipient: step.type === "SEQUENTIAL" ? step.recipient : { kind: "ROLE", role: "LIBRARY" } },
                  { key: newId(), label: "", recipient: { kind: "ROLE", role: "HOSTEL" } }] }
              : { id: step.id, type: "SEQUENTIAL", label: step.label, recipient: step.type === "PARALLEL" ? step.branches[0]?.recipient ?? { kind: "ROLE", role: "PRINCIPAL" } : step.recipient })}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SEQUENTIAL">One approver</SelectItem>
                <SelectItem value="PARALLEL">Several at the same time</SelectItem>
              </SelectContent>
            </Select>
            <div className="ml-auto flex gap-1">
              <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" disabled={i === flow.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" disabled={flow.length === 1} onClick={() => onChange(flow.filter((_, j) => j !== i))} aria-label="Remove step"><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
          {step.type === "SEQUENTIAL" ? (
            <RecipientPicker idPrefix={step.id} value={step.recipient} staff={staff} onChange={(r) => set(i, { ...step, recipient: r })} />
          ) : (
            <div className="space-y-2 pl-4 border-l-2">
              <p className="text-xs text-muted-foreground">Each office works independently; the request moves on once all have cleared it. A dues check is marked No Dues, Dues Pending (the student pays first) or Not Applicable; an examination result check shows Pass or Fail from published results, then is approved or rejected.</p>
              {step.branches.map((b, j) => (
                <div key={b.key} className="flex flex-wrap items-center gap-2">
                  <Input className="w-48" value={b.label} placeholder={recipientLabel(b.recipient)}
                    onChange={(e) => set(i, { ...step, branches: step.branches.map((x, k) => (k === j ? { ...x, label: e.target.value } : x)) })} />
                  <RecipientPicker idPrefix={`${step.id}-${b.key}`} value={b.recipient} staff={staff}
                    onChange={(r) => set(i, { ...step, branches: step.branches.map((x, k) => (k === j ? { ...x, recipient: r } : x)) })} />
                  <Select value={b.check ?? "APPROVAL"} onValueChange={(c) => set(i, { ...step, branches: step.branches.map((x, k) => (k === j ? { ...x, check: c === "APPROVAL" ? undefined : (c as "DUES" | "RESULT") } : x)) })}>
                    <SelectTrigger className="w-48" aria-label="What they check"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="APPROVAL">Approval</SelectItem>
                      <SelectItem value="DUES">Dues check</SelectItem>
                      <SelectItem value="RESULT">Exam result (Pass / Fail)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" disabled={step.branches.length <= 2} aria-label="Remove approver"
                    onClick={() => set(i, { ...step, branches: step.branches.filter((_, k) => k !== j) })}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button size="sm" variant="outline" disabled={step.branches.length >= 25} onClick={() => set(i, { ...step, branches: [...step.branches, { key: newId(), label: "", recipient: { kind: "ROLE", role: "PD" } }] })}>
                <Plus className="h-4 w-4 mr-1" /> Add department
              </Button>
            </div>
          )}
        </div>
      ))}
      <Button size="sm" variant="outline" disabled={flow.length >= 8}
        onClick={() => onChange([...flow, { id: `s${newId()}`, type: "SEQUENTIAL", label: "", recipient: { kind: "ROLE", role: "PRINCIPAL" } }])}>
        <Plus className="h-4 w-4 mr-1" /> Add step
      </Button>
    </div>
  );
}

export function FieldListEditor({ fields, onChange, withDefaults, addLabel }: { fields: CertificateFieldDef[]; onChange: (f: CertificateFieldDef[]) => void; withDefaults?: boolean; addLabel: string }) {
  const set = (i: number, f: CertificateFieldDef) => onChange(fields.map((x, j) => (j === i ? f : x)));
  return (
    <div className="space-y-2">
      {fields.map((f, i) => (
        <div key={i} className="rounded-md border p-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input className="w-56" value={f.label} placeholder="Label" onChange={(e) => set(i, { ...f, label: e.target.value })} />
            <Select value={f.kind} onValueChange={(k) => set(i, { ...f, kind: k as CertificateFieldDef["kind"] })}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem><SelectItem value="textarea">Long text</SelectItem>
                <SelectItem value="date">Date</SelectItem><SelectItem value="number">Number</SelectItem><SelectItem value="select">Choice</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1.5 text-sm"><Checkbox checked={f.required} onCheckedChange={(c) => set(i, { ...f, required: c === true })} /> Required</label>
            {f.key && <code className="text-xs text-muted-foreground">{`{{${f.key}}}`}</code>}
            <Button size="icon" variant="ghost" className="ml-auto" onClick={() => onChange(fields.filter((_, j) => j !== i))} aria-label="Remove field"><Trash2 className="h-4 w-4" /></Button>
          </div>
          {f.kind === "select" && (
            <Input value={(f.options ?? []).join(", ")} placeholder="Options, separated by commas"
              onChange={(e) => set(i, { ...f, options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })} />
          )}
          {withDefaults && (
            <Input value={f.defaultValue ?? ""} placeholder="Used when left blank (optional)" onChange={(e) => set(i, { ...f, defaultValue: e.target.value })} />
          )}
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange([...fields, { key: "", label: "", kind: "text", required: true }])}><Plus className="h-4 w-4 mr-1" /> {addLabel}</Button>
    </div>
  );
}

export function AttachmentListEditor({ items, onChange }: { items: CertificateAttachmentDef[]; onChange: (a: CertificateAttachmentDef[]) => void }) {
  return (
    <div className="space-y-2">
      {items.map((a, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Input className="w-64" value={a.label} placeholder="Document (for example Fee receipt)" onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <label className="flex items-center gap-1.5 text-sm"><Checkbox checked={a.required} onCheckedChange={(c) => onChange(items.map((x, j) => (j === i ? { ...x, required: c === true } : x)))} /> Required</label>
          <Button size="icon" variant="ghost" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove document"><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <Button size="sm" variant="outline" disabled={items.length >= 5} onClick={() => onChange([...items, { key: "", label: "", required: false }])}><Plus className="h-4 w-4 mr-1" /> Add document</Button>
    </div>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div><h3 className="text-sm font-semibold">{title}</h3>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
      {children}
    </section>
  );
}

