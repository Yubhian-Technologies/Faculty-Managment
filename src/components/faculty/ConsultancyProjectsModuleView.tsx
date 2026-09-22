"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Plus, Pencil, Trash2 } from "lucide-react";
import { Section, SubLabel, Field, TextInput, NumInput, DateInput } from "@/components/shared/ProfileFieldPrimitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
        <Field label="Status" value={project.projectStatus === "ONGOING" ? "Ongoing" : project.projectStatus === "COMPLETED" ? "Completed" : undefined} />
        <Field label={project.projectStatus === "ONGOING" ? "Tentative End Date" : "End Date"} value={project.endDate} />
        <Field label="Duration (Months)" value={project.durationMonths} />
        <Field label="Approved Consultancy Amount (Rs.)" value={project.consultancyAmount} />
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

// One Faculty Consultant row: the Employee ID is typed and the name is fetched
// from the faculty record (same lookup Research Publications/IPR use for an
// internal author), never typed by hand.
interface ConsultantRow {
  facultyId: string;
  name: string;
  lookup: "idle" | "loading" | "found" | "not-found";
}

const EMPTY_CONSULTANT: ConsultantRow = { facultyId: "", name: "", lookup: "idle" };

function FacultyConsultantRows({
  rows, onChange,
}: {
  rows: ConsultantRow[];
  onChange: (next: ConsultantRow[]) => void;
}) {
  // Keeps the latest rows reachable from an async lookup that resolves later,
  // so a slow response never overwrites edits made to other rows meanwhile.
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  function patch(i: number, p: Partial<ConsultantRow>) {
    const next = [...rowsRef.current];
    next[i] = { ...next[i], ...p };
    rowsRef.current = next;
    onChange(next);
  }

  function setId(i: number, raw: string) {
    const facultyId = raw;
    clearTimeout(timers.current[i]);
    if (!facultyId.trim()) { patch(i, { facultyId, name: "", lookup: "idle" }); return; }
    patch(i, { facultyId, name: "", lookup: "loading" });
    timers.current[i] = setTimeout(async () => {
      try {
        const res = await fetch(`/api/college/faculty-lookup?employeeId=${encodeURIComponent(facultyId.trim())}`);
        const data = res.ok ? await res.json() as { name?: string } : null;
        // Ignore a result for an ID the user has since changed.
        if (rowsRef.current[i]?.facultyId !== facultyId) return;
        patch(i, data?.name ? { name: data.name, lookup: "found" } : { name: "", lookup: "not-found" });
      } catch {
        if (rowsRef.current[i]?.facultyId === facultyId) patch(i, { name: "", lookup: "not-found" });
      }
    }, 400);
  }

  return (
    <div className="space-y-2">
      <Label>Faculty Consultant ID(s)</Label>
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-1 space-y-1">
            <Input value={r.facultyId} onChange={(e) => setId(i, e.target.value)} placeholder={`Faculty ID of consultant ${i + 1}`} />
            {r.lookup === "loading" && <p className="text-xs text-muted-foreground">Looking up…</p>}
            {r.lookup === "found" && <p className="text-xs text-green-700">{r.name}</p>}
            {r.lookup === "not-found" && <p className="text-xs text-destructive">No faculty member found with that ID</p>}
          </div>
          {rows.length > 1 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          )}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, { ...EMPTY_CONSULTANT }])}>
        <Plus className="h-3.5 w-3.5 mr-1" />Add Faculty Consultant
      </Button>
    </div>
  );
}

interface ProjectFormState {
  title: string;
  consultants: ConsultantRow[];
  department: string;
  clientName: string;
  clientType: ConsultancyClientType | "";
  consultancyCategory: ConsultancyCategory | "";
  problemStatement: string;
  projectStatus: "ONGOING" | "COMPLETED" | "";
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
      title: "", consultants: [{ ...EMPTY_CONSULTANT }], department: "",
      clientName: "", clientType: "", consultancyCategory: "", problemStatement: "", projectStatus: "",
      startDate: "", endDate: "", durationMonths: "", consultancyAmount: "", amountReceived: "",
      amountReceivedDate: "", institutionalInfrastructureUsage: "", hoursSpentDuringAcademicHours: "",
      institutionalShare: "", facultyShare: "", facultyShareProofUrl: "", deliverables: [],
      completionReportUrl: "", incomeSupportingDocUrl: "",
    };
  }
  return {
    title: editing.title,
    consultants: editing.facultyConsultants?.length
      ? editing.facultyConsultants.map((c) => ({ facultyId: c.facultyId, name: c.name, lookup: "found" as const }))
      : [{ ...EMPTY_CONSULTANT }],
    department: editing.department ?? "",
    clientName: editing.clientName,
    clientType: editing.clientType,
    consultancyCategory: editing.consultancyCategory,
    problemStatement: editing.problemStatement,
    projectStatus: editing.projectStatus ?? "",
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

  // A row left blank is ignored; at least one must be filled, and every filled
  // one must have resolved to a real faculty member (the server re-checks).
  const filledConsultants = form.consultants.filter((c) => c.facultyId.trim());
  const consultantsValid = filledConsultants.length > 0 && filledConsultants.every((c) => c.lookup === "found");
  const isCompleted = form.projectStatus === "COMPLETED";
  const isOngoing = form.projectStatus === "ONGOING";

  // Every section is compulsory except Financials (mirrors
  // validateConsultancyBody on the server). Deliverables & Reports only apply
  // once Completed; the two financial proofs in it stay optional.
  const isValid =
    form.title.trim().length > 1 &&
    consultantsValid &&
    form.department.trim().length > 0 &&
    form.clientName.trim().length > 1 &&
    !!form.clientType &&
    !!form.consultancyCategory &&
    form.problemStatement.trim().length > 1 &&
    !!form.projectStatus &&
    !!form.startDate &&
    !!form.endDate &&
    form.durationMonths.trim() !== "" && !Number.isNaN(Number(form.durationMonths)) &&
    (!isCompleted || (form.deliverables.length > 0 && !!form.completionReportUrl));

  async function handleSubmit() {
    if (!isValid) return;
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        facultyConsultantIds: filledConsultants.map((c) => c.facultyId.trim()),
        department: form.department.trim(),
        clientName: form.clientName.trim(),
        clientType: form.clientType || undefined,
        consultancyCategory: form.consultancyCategory || undefined,
        problemStatement: form.problemStatement.trim(),
        projectStatus: form.projectStatus || undefined,
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
        // Deliverables & reports only exist once Completed. Empty values (not
        // undefined) so an edit flipping Completed -> Ongoing clears what was saved.
        facultyShareProofUrl: isCompleted ? form.facultyShareProofUrl : "",
        deliverables: isCompleted ? form.deliverables : [],
        completionReportUrl: isCompleted ? form.completionReportUrl : "",
        incomeSupportingDocUrl: isCompleted ? form.incomeSupportingDocUrl : "",
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
          <FacultyConsultantRows rows={form.consultants} onChange={(next) => set("consultants", next)} />
          {!editingProject?.facultyConsultants?.length && editingProject?.facultyConsultantsNames && (
            <p className="text-xs text-muted-foreground">Previously entered as text: {editingProject.facultyConsultantsNames}. Add their Faculty IDs above - they are required.</p>
          )}
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
          <div className="space-y-2 max-w-[240px]">
            <Label>Status of Consultancy Project</Label>
            <Select value={form.projectStatus} onValueChange={(v) => set("projectStatus", v as "ONGOING" | "COMPLETED")}>
              <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ONGOING">Ongoing</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-4">
          <SubLabel>Timeline</SubLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <DateInput label="Start Date" value={form.startDate} onChange={(v) => set("startDate", v)} />
            <DateInput label={isOngoing ? "Tentative End Date" : "End Date"} value={form.endDate} onChange={(v) => set("endDate", v)} />
            <NumInput label="Duration (Months)" value={toNumberOrUndefined(form.durationMonths)} onChange={(v) => set("durationMonths", String(v))} />
          </div>
        </div>

        <div className="space-y-4">
          <SubLabel>Financials</SubLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumInput label="Approved Consultancy Amount (Rs.)" value={toNumberOrUndefined(form.consultancyAmount)} onChange={(v) => set("consultancyAmount", String(v))} />
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
            <NumInput label={isOngoing ? "Tentative Total Hours Spent during Academic Hours" : "Total Hours Spent during Academic Hours"} value={toNumberOrUndefined(form.hoursSpentDuringAcademicHours)} onChange={(v) => set("hoursSpentDuringAcademicHours", String(v))} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumInput label="Institutional Share (Rs.)" value={toNumberOrUndefined(form.institutionalShare)} onChange={(v) => set("institutionalShare", String(v))} />
            <NumInput label="Faculty Share (Rs.)" value={toNumberOrUndefined(form.facultyShare)} onChange={(v) => set("facultyShare", String(v))} />
          </div>
        </div>
      </div>

      {isCompleted && (
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
      )}
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
