"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Plus, Pencil } from "lucide-react";
import {
  Section, SubLabel, Field, TextInput, NumInput, DateInput, RepeatingGroup, TableRepeatingGroup,
} from "@/components/shared/ProfileFieldPrimitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DocumentUploadField } from "@/components/shared/DocumentUploadField";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import type {
  SeedFundingEquipmentItem, SeedFundingPaperItem, SeedFundingPatentItem,
  SeedFundingProjectRequest, SeedFundingProjectStatus, SeedFundingStudentItem,
} from "@/types";

const PREVIEW_COUNT = 3;

const EMPTY_STUDENT: SeedFundingStudentItem = { name: "", regdNumber: "", yearOfStudy: "" };
const EMPTY_EQUIPMENT: SeedFundingEquipmentItem = { name: "", makeModel: "", softwareOrHardware: "", amount: undefined, purpose: "" };
const EMPTY_PAPER: SeedFundingPaperItem = { title: "", journalOrConference: "" };
const EMPTY_PATENT: SeedFundingPatentItem = { applicationNo: "", applicantName: "", patentTitle: "", inventorDetails: "", status: "" };

function toNumberOrUndefined(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

function SeedFundingRow({
  project, isOwnProfile, onEdit,
}: {
  project: SeedFundingProjectRequest;
  isOwnProfile?: boolean;
  onEdit?: (project: SeedFundingProjectRequest) => void;
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
        <Field label="PI" value={project.piName} />
        <Field label="Dept. of PI" value={project.piDepartment} />
        <Field label="Status" value={project.projectStatus === "SANCTIONED" ? "Sanctioned" : "Completed"} />
        <Field label="Duration (Months)" value={project.durationMonths} />
        <Field label="Total Amount Sanctioned (Rs.)" value={project.totalAmountSanctioned} />
        <Field label="Recurring (Rs.)" value={project.recurringAmount} />
        <Field label="Non-Recurring (Rs.)" value={project.nonRecurringAmount} />
      </div>
      {project.objectives && (
        <div>
          <p className="text-xs text-muted-foreground">Objectives</p>
          <p className="text-sm">{project.objectives}</p>
        </div>
      )}
      {project.outcomes && (
        <div>
          <p className="text-xs text-muted-foreground">Outcomes</p>
          <p className="text-sm">{project.outcomes}</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Equipment Procured" value={project.equipmentProcured.length} />
        <Field label="Papers Published" value={project.papersPublished.length} />
        <Field label="Patents Filed/Published/Granted" value={project.patents.length} />
        <Field label="Students Trained" value={project.studentsTrainedCount} />
      </div>
      <div className="flex flex-wrap gap-3">
        {project.progressReportUrl && (
          <a href={project.progressReportUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Progress Report
          </a>
        )}
        {project.utilizationCertificateUrl && (
          <a href={project.utilizationCertificateUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Utilization Certificate
          </a>
        )}
      </div>
    </div>
  );
}

interface ProjectFormState {
  title: string;
  durationMonths: string;
  objectives: string;
  tentativeOutcomes: string;
  piName: string;
  piDepartment: string;
  studentsInvolvedCount: string;
  students: SeedFundingStudentItem[];
  projectStatus: SeedFundingProjectStatus | "";
  dateSanctioned: string;
  dateOfStart: string;
  financialYearOfStart: string;
  totalAmountSanctioned: string;
  recurringAmount: string;
  nonRecurringAmount: string;
  equipmentProcured: SeedFundingEquipmentItem[];
  outcomes: string;
  papersPublished: SeedFundingPaperItem[];
  patents: SeedFundingPatentItem[];
  studentsProjectsUG: string;
  studentsProjectsPG: string;
  studentsProjectsPhD: string;
  studentsTrainedCount: string;
  externalFundedProposalsApplied: string;
  progressReportUrl: string;
  utilizationCertificateUrl: string;
}

function initialFormState(editing: SeedFundingProjectRequest | null): ProjectFormState {
  if (!editing) {
    return {
      title: "", durationMonths: "", objectives: "", tentativeOutcomes: "", piName: "", piDepartment: "",
      studentsInvolvedCount: "", students: [], projectStatus: "", dateSanctioned: "", dateOfStart: "",
      financialYearOfStart: "", totalAmountSanctioned: "", recurringAmount: "", nonRecurringAmount: "",
      equipmentProcured: [], outcomes: "", papersPublished: [], patents: [],
      studentsProjectsUG: "", studentsProjectsPG: "", studentsProjectsPhD: "", studentsTrainedCount: "",
      externalFundedProposalsApplied: "", progressReportUrl: "", utilizationCertificateUrl: "",
    };
  }
  const n = (v: number | undefined) => (v !== undefined ? String(v) : "");
  return {
    title: editing.title,
    durationMonths: n(editing.durationMonths),
    objectives: editing.objectives,
    tentativeOutcomes: editing.tentativeOutcomes ?? "",
    piName: editing.piName,
    piDepartment: editing.piDepartment ?? "",
    studentsInvolvedCount: n(editing.studentsInvolvedCount),
    students: editing.students ?? [],
    projectStatus: editing.projectStatus,
    dateSanctioned: editing.dateSanctioned ?? "",
    dateOfStart: editing.dateOfStart ?? "",
    financialYearOfStart: editing.financialYearOfStart ?? "",
    totalAmountSanctioned: n(editing.totalAmountSanctioned),
    recurringAmount: n(editing.recurringAmount),
    nonRecurringAmount: n(editing.nonRecurringAmount),
    equipmentProcured: editing.equipmentProcured ?? [],
    outcomes: editing.outcomes ?? "",
    papersPublished: editing.papersPublished ?? [],
    patents: editing.patents ?? [],
    studentsProjectsUG: n(editing.studentsProjectsUG),
    studentsProjectsPG: n(editing.studentsProjectsPG),
    studentsProjectsPhD: n(editing.studentsProjectsPhD),
    studentsTrainedCount: n(editing.studentsTrainedCount),
    externalFundedProposalsApplied: n(editing.externalFundedProposalsApplied),
    progressReportUrl: editing.progressReportUrl ?? "",
    utilizationCertificateUrl: editing.utilizationCertificateUrl ?? "",
  };
}

function ProjectFormFields({
  editingProject, onCancel, onSaved,
}: {
  editingProject: SeedFundingProjectRequest | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ProjectFormState>(() => initialFormState(editingProject));
  const [saving, setSaving] = useState(false);
  const editingId = editingProject?.id ?? null;

  function set<K extends keyof ProjectFormState>(key: K, value: ProjectFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const isValid = form.title.trim().length > 1 && form.objectives.trim().length > 1 && form.piName.trim().length > 1 && !!form.projectStatus;

  async function handleSubmit() {
    if (!isValid) return;
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        durationMonths: toNumberOrUndefined(form.durationMonths),
        objectives: form.objectives.trim(),
        tentativeOutcomes: form.tentativeOutcomes.trim(),
        piName: form.piName.trim(),
        piDepartment: form.piDepartment.trim(),
        studentsInvolvedCount: toNumberOrUndefined(form.studentsInvolvedCount),
        students: form.students,
        projectStatus: form.projectStatus || undefined,
        dateSanctioned: form.dateSanctioned || undefined,
        dateOfStart: form.dateOfStart || undefined,
        financialYearOfStart: form.financialYearOfStart || undefined,
        totalAmountSanctioned: toNumberOrUndefined(form.totalAmountSanctioned),
        recurringAmount: toNumberOrUndefined(form.recurringAmount),
        nonRecurringAmount: toNumberOrUndefined(form.nonRecurringAmount),
        equipmentProcured: form.equipmentProcured,
        outcomes: form.outcomes.trim(),
        papersPublished: form.papersPublished,
        patents: form.patents,
        studentsProjectsUG: toNumberOrUndefined(form.studentsProjectsUG),
        studentsProjectsPG: toNumberOrUndefined(form.studentsProjectsPG),
        studentsProjectsPhD: toNumberOrUndefined(form.studentsProjectsPhD),
        studentsTrainedCount: toNumberOrUndefined(form.studentsTrainedCount),
        externalFundedProposalsApplied: toNumberOrUndefined(form.externalFundedProposalsApplied),
        progressReportUrl: form.progressReportUrl || undefined,
        utilizationCertificateUrl: form.utilizationCertificateUrl || undefined,
      };
      const res = editingId
        ? await fetch(`/api/college/seed-funding/${editingId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          })
        : await fetch("/api/college/seed-funding", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        toast({ variant: "destructive", title: "Failed to save seed funding project", description: json.error });
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
        <DialogTitle>{editingId ? "Edit & Resubmit Seed Funding Project" : "Add Seed Funding Project"}</DialogTitle>
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
          <TextInput label="Title of the Project" value={form.title} onChange={(v) => set("title", v)} />
          <NumInput label="Duration (Months)" value={toNumberOrUndefined(form.durationMonths)} onChange={(v) => set("durationMonths", String(v))} />
          <div className="space-y-2">
            <Label>Objectives of the Project</Label>
            <Textarea value={form.objectives} onChange={(e) => set("objectives", e.target.value)} rows={3} />
          </div>
          <div className="space-y-2">
            <Label>Tentative Outcomes of Project</Label>
            <Textarea value={form.tentativeOutcomes} onChange={(e) => set("tentativeOutcomes", e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput label="Name of the PI" value={form.piName} onChange={(v) => set("piName", v)} />
            <TextInput label="Dept. of PI" value={form.piDepartment} onChange={(v) => set("piDepartment", v)} />
          </div>
          <NumInput label="No. of Students Involved" value={toNumberOrUndefined(form.studentsInvolvedCount)} onChange={(v) => set("studentsInvolvedCount", String(v))} />
        </div>

        <div className="space-y-4">
          <SubLabel>Status &amp; Funding</SubLabel>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={form.projectStatus} onValueChange={(v) => set("projectStatus", v as SeedFundingProjectStatus)}>
              <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SANCTIONED">Sanctioned</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.projectStatus === "SANCTIONED" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 rounded-lg border p-3">
              <DateInput label="Date of Project Sanctioned" value={form.dateSanctioned} onChange={(v) => set("dateSanctioned", v)} />
              <DateInput label="Date of Start" value={form.dateOfStart} onChange={(v) => set("dateOfStart", v)} />
              <TextInput label="F.Y. of Start" value={form.financialYearOfStart} onChange={(v) => set("financialYearOfStart", v)} placeholder="e.g. 2024-25" />
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <NumInput label="Total Amount Sanctioned (Rs.)" value={toNumberOrUndefined(form.totalAmountSanctioned)} onChange={(v) => set("totalAmountSanctioned", String(v))} />
            <NumInput label="Recurring (Rs.)" value={toNumberOrUndefined(form.recurringAmount)} onChange={(v) => set("recurringAmount", String(v))} />
            <NumInput label="Non-Recurring (Rs.)" value={toNumberOrUndefined(form.nonRecurringAmount)} onChange={(v) => set("nonRecurringAmount", String(v))} />
          </div>
        </div>

        <div className="space-y-4">
          <SubLabel>Students &amp; Training</SubLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <NumInput label="Students Projects Executed - UG" value={toNumberOrUndefined(form.studentsProjectsUG)} onChange={(v) => set("studentsProjectsUG", String(v))} />
            <NumInput label="PG" value={toNumberOrUndefined(form.studentsProjectsPG)} onChange={(v) => set("studentsProjectsPG", String(v))} />
            <NumInput label="Ph.D." value={toNumberOrUndefined(form.studentsProjectsPhD)} onChange={(v) => set("studentsProjectsPhD", String(v))} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumInput label="No. of Students Trained" value={toNumberOrUndefined(form.studentsTrainedCount)} onChange={(v) => set("studentsTrainedCount", String(v))} />
            <NumInput label="No. of External Funded Proposals Applied" value={toNumberOrUndefined(form.externalFundedProposalsApplied)} onChange={(v) => set("externalFundedProposalsApplied", String(v))} />
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <RepeatingGroup
          title="Students Involved"
          items={form.students}
          empty={EMPTY_STUDENT}
          onChange={(v) => set("students", v)}
          addLabel="Add Student"
          renderRow={(item, update) => (
            <>
              <TextInput label="Name of Student" value={item.name} onChange={(v) => update({ name: v })} />
              <TextInput label="Regd. Number" value={item.regdNumber} onChange={(v) => update({ regdNumber: v })} />
              <TextInput label="Year of Study" value={item.yearOfStudy} onChange={(v) => update({ yearOfStudy: v })} />
            </>
          )}
        />

        <TableRepeatingGroup
          title="Equipment Procured"
          items={form.equipmentProcured}
          empty={EMPTY_EQUIPMENT}
          onChange={(v) => set("equipmentProcured", v)}
          addLabel="Add Equipment"
          columns={[
            { header: "Name of the Equipment", render: (item, update) => <Input className="h-8 text-sm" value={item.name} onChange={(e) => update({ name: e.target.value })} /> },
            { header: "Make/Model", render: (item, update) => <Input className="h-8 text-sm" value={item.makeModel} onChange={(e) => update({ makeModel: e.target.value })} /> },
            { header: "Software/Hardware", render: (item, update) => <Input className="h-8 text-sm" value={item.softwareOrHardware} onChange={(e) => update({ softwareOrHardware: e.target.value })} /> },
            { header: "Amount", render: (item, update) => <Input type="number" className="h-8 text-sm" value={item.amount ?? ""} onChange={(e) => update({ amount: e.target.value === "" ? undefined : Number(e.target.value) })} /> },
            { header: "Purpose", render: (item, update) => <Input className="h-8 text-sm" value={item.purpose} onChange={(e) => update({ purpose: e.target.value })} /> },
          ]}
        />

        <div className="space-y-2">
          <Label>Outcomes</Label>
          <Textarea value={form.outcomes} onChange={(e) => set("outcomes", e.target.value)} rows={3} />
        </div>

        <TableRepeatingGroup
          title="Papers Published"
          items={form.papersPublished}
          empty={EMPTY_PAPER}
          onChange={(v) => set("papersPublished", v)}
          addLabel="Add Paper"
          columns={[
            { header: "Title of the Paper", render: (item, update) => <Input className="h-8 text-sm" value={item.title} onChange={(e) => update({ title: e.target.value })} /> },
            { header: "Name of the Journal/Conference", render: (item, update) => <Input className="h-8 text-sm" value={item.journalOrConference} onChange={(e) => update({ journalOrConference: e.target.value })} /> },
            { header: "DoI", render: (item, update) => <Input className="h-8 text-sm" value={item.doi ?? ""} onChange={(e) => update({ doi: e.target.value })} /> },
            { header: "Quartile", render: (item, update) => <Input className="h-8 text-sm" value={item.quartile ?? ""} onChange={(e) => update({ quartile: e.target.value })} /> },
            { header: "IF", render: (item, update) => <Input className="h-8 text-sm" value={item.impactFactor ?? ""} onChange={(e) => update({ impactFactor: e.target.value })} /> },
            { header: "Indexed Scopus/WoS", render: (item, update) => <Input className="h-8 text-sm" value={item.indexedScopusWos ?? ""} onChange={(e) => update({ indexedScopusWos: e.target.value })} /> },
            { header: "Cite the Paper As", render: (item, update) => <Input className="h-8 text-sm" value={item.citeAs ?? ""} onChange={(e) => update({ citeAs: e.target.value })} /> },
          ]}
        />

        <TableRepeatingGroup
          title="Patents Published/Granted"
          items={form.patents}
          empty={EMPTY_PATENT}
          onChange={(v) => set("patents", v)}
          addLabel="Add Patent"
          columns={[
            { header: "Application No.", render: (item, update) => <Input className="h-8 text-sm" value={item.applicationNo} onChange={(e) => update({ applicationNo: e.target.value })} /> },
            { header: "Name of the Applicant", render: (item, update) => <Input className="h-8 text-sm" value={item.applicantName} onChange={(e) => update({ applicantName: e.target.value })} /> },
            { header: "Title of the Patent", render: (item, update) => <Input className="h-8 text-sm" value={item.patentTitle} onChange={(e) => update({ patentTitle: e.target.value })} /> },
            { header: "Inventor Details", render: (item, update) => <Input className="h-8 text-sm" value={item.inventorDetails} onChange={(e) => update({ inventorDetails: e.target.value })} /> },
            { header: "Status (Filed/Published/Granted)", render: (item, update) => <Input className="h-8 text-sm" value={item.status} onChange={(e) => update({ status: e.target.value })} placeholder="Filed / Published / Granted" /> },
          ]}
        />

        <div className="space-y-4">
          <SubLabel>Reports</SubLabel>
          <DocumentUploadField
            label="Progress Report"
            value={form.progressReportUrl}
            uploadEndpoint="/api/upload/seed-funding-doc"
            extraFields={{ kind: "progress-report" }}
            onUploaded={(url) => set("progressReportUrl", url)}
            onRemoved={() => set("progressReportUrl", "")}
          />
          <DocumentUploadField
            label="Utilization Certificate"
            value={form.utilizationCertificateUrl}
            uploadEndpoint="/api/upload/seed-funding-doc"
            extraFields={{ kind: "utilization-certificate" }}
            onUploaded={(url) => set("utilizationCertificateUrl", url)}
            onRemoved={() => set("utilizationCertificateUrl", "")}
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

function AddSeedFundingDialog({
  open, onOpenChange, editingProject, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingProject: SeedFundingProjectRequest | null;
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

// Seed Funding & Outcomes - self-submitted, same PENDING/APPROVED/REJECTED
// verification flow as Consultancy Projects/Research Publications (see
// /api/college/seed-funding), a repeating list per person.
export function SeedFundingModuleView({ uid, isOwnProfile }: { uid?: string; isOwnProfile?: boolean }) {
  const [projects, setProjects] = useState<SeedFundingProjectRequest[] | null>(null);

  function load() {
    const url = uid ? `/api/college/seed-funding?uid=${encodeURIComponent(uid)}` : "/api/college/seed-funding";
    fetch(url)
      .then((r) => r.json() as Promise<{ projects?: SeedFundingProjectRequest[] }>)
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => setProjects([]));
  }

  useEffect(() => { load(); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  return <SeedFundingSection projects={projects} isOwnProfile={isOwnProfile} onChanged={load} />;
}

export function SeedFundingSection({
  projects, isOwnProfile, onChanged,
}: {
  projects: SeedFundingProjectRequest[] | null;
  isOwnProfile?: boolean;
  onChanged?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<SeedFundingProjectRequest | null>(null);

  const sorted = (projects ?? []).slice();
  const visible = expanded ? sorted : sorted.slice(0, PREVIEW_COUNT);
  const hidden = sorted.length - PREVIEW_COUNT;

  function openAdd() {
    setEditingProject(null);
    setFormOpen(true);
  }

  function openEdit(project: SeedFundingProjectRequest) {
    setEditingProject(project);
    setFormOpen(true);
  }

  return (
    <Section number={3} title="Seed Funding & Outcomes">
      <div className="flex items-center justify-between">
        <SubLabel>Projects</SubLabel>
        {isOwnProfile && (
          <Button variant="outline" size="sm" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add Seed Funding Project
          </Button>
        )}
      </div>
      {projects === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">None recorded.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((project) => <SeedFundingRow key={project.id} project={project} isOwnProfile={isOwnProfile} onEdit={openEdit} />)}
          {sorted.length > PREVIEW_COUNT && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-medium text-primary hover:underline">
              {expanded ? "Show less" : `Show ${hidden} more`}
            </button>
          )}
        </div>
      )}

      {isOwnProfile && (
        <AddSeedFundingDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          editingProject={editingProject}
          onSaved={() => onChanged?.()}
        />
      )}
    </Section>
  );
}
