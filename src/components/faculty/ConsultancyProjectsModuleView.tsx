"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Plus, Pencil } from "lucide-react";
import { Section, SubLabel, Field, TextInput, NumInput, DateInput } from "@/components/shared/ProfileFieldPrimitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DocumentUploadField } from "@/components/shared/DocumentUploadField";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import {
  CONSULTANCY_CATEGORIES, CONSULTANCY_CATEGORY_LABELS,
  CONSULTANCY_CLIENT_TYPES, CONSULTANCY_CLIENT_TYPE_LABELS,
  CONSULTANCY_DELIVERABLES, CONSULTANCY_DELIVERABLE_LABELS,
} from "@/lib/research/consultancyProjectOptions";
import type { ConsultancyCategory, ConsultancyClientType, ConsultancyDeliverable, ConsultancyProjectRequest } from "@/types";

const PREVIEW_COUNT = 3;

function ConsultancyProjectRow({
  project, isOwnProfile, onEdit,
}: {
  project: ConsultancyProjectRequest;
  isOwnProfile?: boolean;
  onEdit?: (project: ConsultancyProjectRequest) => void;
}) {
  return (
    <div className="rounded-md border bg-muted/20 shadow-sm p-2 space-y-2">
      {isOwnProfile && project.status !== "APPROVED" && (
        <div className="flex items-center gap-2">
          {project.status === "PENDING" ? (
            <Badge variant="pending" className="text-xs">Pending Verification</Badge>
          ) : (
            <>
              <Badge variant="rejected" className="text-xs">Rejected</Badge>
              {onEdit && (
                <button type="button" onClick={() => onEdit(project)} className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1">
                  <Pencil className="h-3 w-3" />Edit &amp; Resubmit
                </button>
              )}
            </>
          )}
        </div>
      )}
      {project.status === "REJECTED" && project.rejectionReason && (
        <p className="text-xs text-destructive">Reason: {project.rejectionReason}</p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Title" value={project.title} />
        <Field label="Client / Organization" value={project.clientName} />
        <Field label="Client Type" value={CONSULTANCY_CLIENT_TYPE_LABELS[project.clientType]} />
        <Field label="Category" value={CONSULTANCY_CATEGORY_LABELS[project.consultancyCategory]} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Faculty Consultant(s)" value={project.facultyConsultantsNames} />
        <Field label="Department" value={project.department} />
        <Field label="Start Date" value={project.startDate} />
        <Field label="End Date" value={project.endDate} />
        <Field label="Duration (Months)" value={project.durationMonths} />
        <Field label="Consultancy Amount (Rs.)" value={project.consultancyAmount} />
        <Field label="Amount Received (Rs.)" value={project.amountReceived} />
        <Field label="Institutional Share (Rs.)" value={project.institutionalShare} />
        <Field label="Faculty Share (Rs.)" value={project.facultyShare} />
      </div>
      {project.problemStatement && (
        <div>
          <p className="text-xs text-muted-foreground">Problem Statement</p>
          <p className="text-sm">{project.problemStatement}</p>
        </div>
      )}
      {project.deliverables.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {project.deliverables.map((d) => (
            <Badge key={d} variant="secondary" className="text-xs font-normal">{CONSULTANCY_DELIVERABLE_LABELS[d]}</Badge>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {project.facultyShareProofUrl && (
          <a href={project.facultyShareProofUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Proof of Faculty Share
          </a>
        )}
        {project.completionReportUrl && (
          <a href={project.completionReportUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Completion Report
          </a>
        )}
        {project.incomeSupportingDocUrl && (
          <a href={project.incomeSupportingDocUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Income Proof
          </a>
        )}
      </div>
    </div>
  );
}

interface ProjectFormState {
  title: string;
  facultyConsultantsCount: string;
  facultyConsultantsNames: string;
  department: string;
  clientName: string;
  clientType: ConsultancyClientType | "";
  consultancyCategory: ConsultancyCategory | "";
  problemStatement: string;
  startDate: string;
  endDate: string;
  durationMonths: string;
  consultancyAmount: string;
  amountReceived: string;
  amountReceivedDate: string;
  institutionalInfrastructureUsage: "YES" | "NO" | "";
  hoursSpentDuringAcademicHours: string;
  institutionalShare: string;
  facultyShare: string;
  facultyShareProofUrl: string;
  deliverables: ConsultancyDeliverable[];
  completionReportUrl: string;
  incomeSupportingDocUrl: string;
}

function initialFormState(editing: ConsultancyProjectRequest | null): ProjectFormState {
  if (!editing) {
    return {
      title: "", facultyConsultantsCount: "", facultyConsultantsNames: "", department: "",
      clientName: "", clientType: "", consultancyCategory: "", problemStatement: "",
      startDate: "", endDate: "", durationMonths: "", consultancyAmount: "", amountReceived: "",
      amountReceivedDate: "", institutionalInfrastructureUsage: "", hoursSpentDuringAcademicHours: "",
      institutionalShare: "", facultyShare: "", facultyShareProofUrl: "", deliverables: [],
      completionReportUrl: "", incomeSupportingDocUrl: "",
    };
  }
  return {
    title: editing.title,
    facultyConsultantsCount: editing.facultyConsultantsCount !== undefined ? String(editing.facultyConsultantsCount) : "",
    facultyConsultantsNames: editing.facultyConsultantsNames ?? "",
    department: editing.department ?? "",
    clientName: editing.clientName,
    clientType: editing.clientType,
    consultancyCategory: editing.consultancyCategory,
    problemStatement: editing.problemStatement,
    startDate: editing.startDate,
    endDate: editing.endDate ?? "",
    durationMonths: editing.durationMonths !== undefined ? String(editing.durationMonths) : "",
    consultancyAmount: editing.consultancyAmount !== undefined ? String(editing.consultancyAmount) : "",
    amountReceived: editing.amountReceived !== undefined ? String(editing.amountReceived) : "",
    amountReceivedDate: editing.amountReceivedDate ?? "",
    institutionalInfrastructureUsage: editing.institutionalInfrastructureUsage ?? "",
    hoursSpentDuringAcademicHours: editing.hoursSpentDuringAcademicHours !== undefined ? String(editing.hoursSpentDuringAcademicHours) : "",
    institutionalShare: editing.institutionalShare !== undefined ? String(editing.institutionalShare) : "",
    facultyShare: editing.facultyShare !== undefined ? String(editing.facultyShare) : "",
    facultyShareProofUrl: editing.facultyShareProofUrl ?? "",
    deliverables: editing.deliverables ?? [],
    completionReportUrl: editing.completionReportUrl ?? "",
    incomeSupportingDocUrl: editing.incomeSupportingDocUrl ?? "",
  };
}

function toNumberOrUndefined(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

function ProjectFormFields({
  editingProject, onCancel, onSaved,
}: {
  editingProject: ConsultancyProjectRequest | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ProjectFormState>(() => initialFormState(editingProject));
  const [saving, setSaving] = useState(false);
  const editingId = editingProject?.id ?? null;

  function set<K extends keyof ProjectFormState>(key: K, value: ProjectFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleDeliverable(d: ConsultancyDeliverable, checked: boolean) {
    setForm((f) => ({
      ...f,
      deliverables: checked ? [...f.deliverables, d] : f.deliverables.filter((x) => x !== d),
    }));
  }

  const isValid =
    form.title.trim().length > 1 &&
    form.clientName.trim().length > 1 &&
    !!form.clientType &&
    !!form.consultancyCategory &&
    form.problemStatement.trim().length > 1 &&
    !!form.startDate;

  async function handleSubmit() {
    if (!isValid) return;
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        facultyConsultantsCount: toNumberOrUndefined(form.facultyConsultantsCount),
        facultyConsultantsNames: form.facultyConsultantsNames.trim(),
        department: form.department.trim(),
        clientName: form.clientName.trim(),
        clientType: form.clientType || undefined,
        consultancyCategory: form.consultancyCategory || undefined,
        problemStatement: form.problemStatement.trim(),
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        durationMonths: toNumberOrUndefined(form.durationMonths),
        consultancyAmount: toNumberOrUndefined(form.consultancyAmount),
        amountReceived: toNumberOrUndefined(form.amountReceived),
        amountReceivedDate: form.amountReceivedDate || undefined,
        institutionalInfrastructureUsage: form.institutionalInfrastructureUsage || undefined,
        hoursSpentDuringAcademicHours: toNumberOrUndefined(form.hoursSpentDuringAcademicHours),
        institutionalShare: toNumberOrUndefined(form.institutionalShare),
        facultyShare: toNumberOrUndefined(form.facultyShare),
        facultyShareProofUrl: form.facultyShareProofUrl || undefined,
        deliverables: form.deliverables,
        completionReportUrl: form.completionReportUrl || undefined,
        incomeSupportingDocUrl: form.incomeSupportingDocUrl || undefined,
      };
      const res = editingId
        ? await fetch(`/api/college/consultancy-projects/${editingId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          })
        : await fetch("/api/college/consultancy-projects", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        toast({ variant: "destructive", title: "Failed to save consultancy project", description: json.error });
        return;
      }
      toast({ variant: "success", title: editingId ? "Resubmitted for verification" : "Submitted for verification" });
      onSaved();
    } catch {
      toast({ variant: "destructive", title: "Network error. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editingId ? "Edit & Resubmit Consultancy Project" : "Add Consultancy Project"}</DialogTitle>
        <DialogDescription>
          {editingId
            ? "Correct the details below and resubmit - this goes back to R&D for verification."
            : "This is submitted to R&D for verification before it shows as an official record."}
        </DialogDescription>
      </DialogHeader>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5 items-start">
      <div className="space-y-5">
        <div className="space-y-4">
          <SubLabel>Overview</SubLabel>
          <TextInput label="Title of the Consultancy Project" value={form.title} onChange={(v) => set("title", v)} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumInput label="No. of Faculty Consultant(s)" value={toNumberOrUndefined(form.facultyConsultantsCount)} onChange={(v) => set("facultyConsultantsCount", String(v))} />
            <TextInput label="Name of the Faculty Consultant(s)" value={form.facultyConsultantsNames} onChange={(v) => set("facultyConsultantsNames", v)} placeholder="Comma-separated names" />
          </div>
          <TextInput label="Department" value={form.department} onChange={(v) => set("department", v)} />
        </div>

        <div className="space-y-4">
          <SubLabel>Client &amp; Category</SubLabel>
          <TextInput label="Client / Organization Name" value={form.clientName} onChange={(v) => set("clientName", v)} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Client Type</Label>
              <Select value={form.clientType} onValueChange={(v) => set("clientType", v as ConsultancyClientType)}>
                <SelectTrigger><SelectValue placeholder="Select client type" /></SelectTrigger>
                <SelectContent>
                  {CONSULTANCY_CLIENT_TYPES.map((t) => <SelectItem key={t} value={t}>{CONSULTANCY_CLIENT_TYPE_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Consultancy Category</Label>
              <Select value={form.consultancyCategory} onValueChange={(v) => set("consultancyCategory", v as ConsultancyCategory)}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {CONSULTANCY_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CONSULTANCY_CATEGORY_LABELS[c]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Problem Statement</Label>
            <Textarea value={form.problemStatement} onChange={(e) => set("problemStatement", e.target.value)} placeholder="Brief description of the work assigned" rows={3} />
          </div>
        </div>

        <div className="space-y-4">
          <SubLabel>Timeline</SubLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <DateInput label="Start Date" value={form.startDate} onChange={(v) => set("startDate", v)} />
            <DateInput label="End Date" value={form.endDate} onChange={(v) => set("endDate", v)} />
            <NumInput label="Duration (Months)" value={toNumberOrUndefined(form.durationMonths)} onChange={(v) => set("durationMonths", String(v))} />
          </div>
        </div>

        <div className="space-y-4">
          <SubLabel>Financials</SubLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumInput label="Consultancy Amount (Rs.)" value={toNumberOrUndefined(form.consultancyAmount)} onChange={(v) => set("consultancyAmount", String(v))} />
            <NumInput label="Amount Received (Rs.)" value={toNumberOrUndefined(form.amountReceived)} onChange={(v) => set("amountReceived", String(v))} />
          </div>
          <DateInput label="Date of Amount Received" value={form.amountReceivedDate} onChange={(v) => set("amountReceivedDate", v)} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Institutional Infrastructure Usage</Label>
              <Select value={form.institutionalInfrastructureUsage} onValueChange={(v) => set("institutionalInfrastructureUsage", v as "YES" | "NO")}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="YES">Yes</SelectItem>
                  <SelectItem value="NO">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <NumInput label="Hours Spent during Academic Hours" value={toNumberOrUndefined(form.hoursSpentDuringAcademicHours)} onChange={(v) => set("hoursSpentDuringAcademicHours", String(v))} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumInput label="Institutional Share (Rs.)" value={toNumberOrUndefined(form.institutionalShare)} onChange={(v) => set("institutionalShare", String(v))} />
            <NumInput label="Faculty Share (Rs.)" value={toNumberOrUndefined(form.facultyShare)} onChange={(v) => set("facultyShare", String(v))} />
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <div className="space-y-4">
          <SubLabel>Deliverables &amp; Reports</SubLabel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CONSULTANCY_DELIVERABLES.map((d) => (
              <label key={d} className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.deliverables.includes(d)} onCheckedChange={(c) => toggleDeliverable(d, c === true)} />
                {CONSULTANCY_DELIVERABLE_LABELS[d]}
              </label>
            ))}
          </div>
          <DocumentUploadField
            label="Proof of Faculty Share"
            value={form.facultyShareProofUrl}
            uploadEndpoint="/api/upload/consultancy-doc"
            extraFields={{ kind: "faculty-share-proof" }}
            onUploaded={(url) => set("facultyShareProofUrl", url)}
            onRemoved={() => set("facultyShareProofUrl", "")}
          />
          <DocumentUploadField
            label="Completion Report"
            value={form.completionReportUrl}
            uploadEndpoint="/api/upload/consultancy-doc"
            extraFields={{ kind: "completion-report" }}
            onUploaded={(url) => set("completionReportUrl", url)}
            onRemoved={() => set("completionReportUrl", "")}
          />
          <DocumentUploadField
            label="Supporting Documents of Income Generated"
            value={form.incomeSupportingDocUrl}
            uploadEndpoint="/api/upload/consultancy-doc"
            extraFields={{ kind: "income-proof" }}
            onUploaded={(url) => set("incomeSupportingDocUrl", url)}
            onRemoved={() => set("incomeSupportingDocUrl", "")}
          />
        </div>
      </div>
      </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button onClick={() => void handleSubmit()} loading={saving} disabled={!isValid}>
          {editingId ? "Resubmit" : "Submit"}
        </Button>
      </DialogFooter>
    </>
  );
}

function AddConsultancyProjectDialog({
  open, onOpenChange, editingProject, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingProject: ConsultancyProjectRequest | null;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[1400px] h-[90vh] max-h-[90vh] flex flex-col overflow-hidden">
        {open && (
          <ProjectFormFields
            editingProject={editingProject}
            onCancel={() => onOpenChange(false)}
            onSaved={() => { onOpenChange(false); onSaved(); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// Consultancy Projects - self-submitted, same PENDING/APPROVED/REJECTED
// verification flow as Research Publications (see /api/college/
// consultancy-projects), a repeating list per person (unlike the singleton
// Research Profiles/Citations tabs, since a person can run many consultancy
// projects over their career).
export function ConsultancyProjectsModuleView({ uid, isOwnProfile }: { uid?: string; isOwnProfile?: boolean }) {
  const [projects, setProjects] = useState<ConsultancyProjectRequest[] | null>(null);

  function load() {
    const url = uid ? `/api/college/consultancy-projects?uid=${encodeURIComponent(uid)}` : "/api/college/consultancy-projects";
    fetch(url)
      .then((r) => r.json() as Promise<{ projects?: ConsultancyProjectRequest[] }>)
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => setProjects([]));
  }

  useEffect(() => { load(); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  return <ConsultancyProjectsSection projects={projects} isOwnProfile={isOwnProfile} onChanged={load} />;
}

export function ConsultancyProjectsSection({
  projects, isOwnProfile, onChanged,
}: {
  projects: ConsultancyProjectRequest[] | null;
  isOwnProfile?: boolean;
  onChanged?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ConsultancyProjectRequest | null>(null);

  const sorted = (projects ?? []).slice();
  const visible = expanded ? sorted : sorted.slice(0, PREVIEW_COUNT);
  const hidden = sorted.length - PREVIEW_COUNT;

  function openAdd() {
    setEditingProject(null);
    setFormOpen(true);
  }

  function openEdit(project: ConsultancyProjectRequest) {
    setEditingProject(project);
    setFormOpen(true);
  }

  return (
    <Section number={3} title="Consultancy Projects">
      <div className="flex items-center justify-between">
        <SubLabel>Projects</SubLabel>
        {isOwnProfile && (
          <Button variant="outline" size="sm" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add Consultancy Project
          </Button>
        )}
      </div>
      {projects === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">None recorded.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((project) => <ConsultancyProjectRow key={project.id} project={project} isOwnProfile={isOwnProfile} onEdit={openEdit} />)}
          {sorted.length > PREVIEW_COUNT && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-medium text-primary hover:underline">
              {expanded ? "Show less" : `Show ${hidden} more`}
            </button>
          )}
        </div>
      )}

      {isOwnProfile && (
        <AddConsultancyProjectDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          editingProject={editingProject}
          onSaved={() => onChanged?.()}
        />
      )}
    </Section>
  );
}
