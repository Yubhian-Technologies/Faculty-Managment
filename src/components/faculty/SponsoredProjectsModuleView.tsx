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
  SponsoredProjectCoPI, SponsoredProjectRequest, SponsoredProjectSanctionedStatus,
  SponsoredProjectStatus, SponsoredProjectType,
} from "@/types";

const PREVIEW_COUNT = 3;

const EMPTY_COPI: SponsoredProjectCoPI = { name: "", department: "", affiliation: "" };
const EMPTY_EQUIPMENT: SeedFundingEquipmentItem = { name: "", makeModel: "", softwareOrHardware: "", amount: undefined, purpose: "" };
const EMPTY_PAPER: SeedFundingPaperItem = { title: "", journalOrConference: "" };
const EMPTY_PATENT: SeedFundingPatentItem = { applicationNo: "", applicantName: "", patentTitle: "", inventorDetails: "", status: "" };

const PROJECT_TYPE_LABELS: Record<SponsoredProjectType, string> = {
  TRAINING: "Training", TECHNICAL: "Technical", SOCIETY: "Society", INFRASTRUCTURE: "Infrastructure",
};

function toNumberOrUndefined(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

function SponsoredProjectRow({
  project, isOwnProfile, onEdit,
}: {
  project: SponsoredProjectRequest;
  isOwnProfile?: boolean;
  onEdit?: (project: SponsoredProjectRequest) => void;
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
        <Field label="Agency" value={project.agencyName} />
        <Field label="Scheme" value={project.schemeName} />
        <Field label="Application No." value={project.applicationNumber} />
        <Field label="Type" value={PROJECT_TYPE_LABELS[project.projectType]} />
        <Field label="PI" value={project.piName} />
        <Field label="Status" value={project.projectStatus === "APPLIED" ? "Applied" : `Sanctioned - ${project.sanctionedStatus === "COMPLETED" ? "Completed" : "Ongoing"}`} />
        <Field label="Amount Sanctioned (Rs.)" value={project.totalAmountSanctioned ?? project.amountApplied} />
      </div>
      {project.objectives && (
        <div>
          <p className="text-xs text-muted-foreground">Objectives</p>
          <p className="text-sm">{project.objectives}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {project.progressReportUrl && (
          <a href={project.progressReportUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Progress Report
          </a>
        )}
        {project.completionReportUrl && (
          <a href={project.completionReportUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Completion Report
          </a>
        )}
        {project.utilizationCertificateUrl && (
          <a href={project.utilizationCertificateUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Utilization Certificate
          </a>
        )}
        {project.statementOfExpenditureUrl && (
          <a href={project.statementOfExpenditureUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Statement of Expenditure
          </a>
        )}
      </div>
    </div>
  );
}

interface ProjectFormState {
  agencyName: string;
  schemeName: string;
  applicationNumber: string;
  title: string;
  projectType: SponsoredProjectType | "";
  durationMonths: string;
  objectives: string;
  tentativeOutcomes: string;
  piName: string;
  piDepartment: string;
  piAffiliation: string;
  coPiCount: string;
  coPis: SponsoredProjectCoPI[];
  projectStatus: SponsoredProjectStatus | "";
  dateProposalSubmitted: string;
  amountApplied: string;
  extendedToSeedFund: "YES" | "NO" | "";
  sanctionedStatus: SponsoredProjectSanctionedStatus | "";
  dateProjectSanctioned: string;
  dateOfStart: string;
  financialYearOfStart: string;
  totalAmountSanctioned: string;
  recurringAmountSanctioned: string;
  nonRecurringAmountSanctioned: string;
  instituteContributionSanctioned: string;
  noOfYears: string;
  totalAmountReceived: string;
  recurringAmountReceived: string;
  nonRecurringAmountReceived: string;
  instituteContributionReceived: string;
  dateOfCompletion: string;
  financialYearOfCompletion: string;
  infrastructureProcured: SeedFundingEquipmentItem[];
  outcomes: string;
  papersPublished: SeedFundingPaperItem[];
  papersPublishedCitations: string;
  patents: SeedFundingPatentItem[];
  studentsProjectsUG: string;
  studentsProjectsPG: string;
  studentsProjectsPhD: string;
  studentsTrainedCount: string;
  technicalStaffTrainedCount: string;
  personsTrainedCount: string;
  progressReportUrl: string;
  completionReportUrl: string;
  utilizationCertificateUrl: string;
  statementOfExpenditureUrl: string;
  submittedRequiredDocs: "YES" | "NO" | "";
  dateOfSubmission: string;
}

function initialFormState(editing: SponsoredProjectRequest | null): ProjectFormState {
  const n = (v: number | undefined) => (v !== undefined ? String(v) : "");
  if (!editing) {
    return {
      agencyName: "", schemeName: "", applicationNumber: "", title: "", projectType: "", durationMonths: "",
      objectives: "", tentativeOutcomes: "", piName: "", piDepartment: "", piAffiliation: "", coPiCount: "",
      coPis: [], projectStatus: "", dateProposalSubmitted: "", amountApplied: "", extendedToSeedFund: "",
      sanctionedStatus: "", dateProjectSanctioned: "", dateOfStart: "", financialYearOfStart: "",
      totalAmountSanctioned: "", recurringAmountSanctioned: "", nonRecurringAmountSanctioned: "",
      instituteContributionSanctioned: "", noOfYears: "", totalAmountReceived: "", recurringAmountReceived: "",
      nonRecurringAmountReceived: "", instituteContributionReceived: "", dateOfCompletion: "",
      financialYearOfCompletion: "", infrastructureProcured: [], outcomes: "", papersPublished: [],
      papersPublishedCitations: "", patents: [], studentsProjectsUG: "", studentsProjectsPG: "",
      studentsProjectsPhD: "", studentsTrainedCount: "", technicalStaffTrainedCount: "", personsTrainedCount: "",
      progressReportUrl: "", completionReportUrl: "", utilizationCertificateUrl: "", statementOfExpenditureUrl: "",
      submittedRequiredDocs: "", dateOfSubmission: "",
    };
  }
  return {
    agencyName: editing.agencyName, schemeName: editing.schemeName, applicationNumber: editing.applicationNumber,
    title: editing.title, projectType: editing.projectType, durationMonths: n(editing.durationMonths),
    objectives: editing.objectives, tentativeOutcomes: editing.tentativeOutcomes ?? "", piName: editing.piName,
    piDepartment: editing.piDepartment ?? "", piAffiliation: editing.piAffiliation ?? "", coPiCount: n(editing.coPiCount),
    coPis: editing.coPis ?? [], projectStatus: editing.projectStatus, dateProposalSubmitted: editing.dateProposalSubmitted ?? "",
    amountApplied: n(editing.amountApplied), extendedToSeedFund: editing.extendedToSeedFund ?? "",
    sanctionedStatus: editing.sanctionedStatus ?? "", dateProjectSanctioned: editing.dateProjectSanctioned ?? "",
    dateOfStart: editing.dateOfStart ?? "", financialYearOfStart: editing.financialYearOfStart ?? "",
    totalAmountSanctioned: n(editing.totalAmountSanctioned), recurringAmountSanctioned: n(editing.recurringAmountSanctioned),
    nonRecurringAmountSanctioned: n(editing.nonRecurringAmountSanctioned),
    instituteContributionSanctioned: n(editing.instituteContributionSanctioned), noOfYears: editing.noOfYears ?? "",
    totalAmountReceived: n(editing.totalAmountReceived), recurringAmountReceived: n(editing.recurringAmountReceived),
    nonRecurringAmountReceived: n(editing.nonRecurringAmountReceived),
    instituteContributionReceived: n(editing.instituteContributionReceived), dateOfCompletion: editing.dateOfCompletion ?? "",
    financialYearOfCompletion: editing.financialYearOfCompletion ?? "", infrastructureProcured: editing.infrastructureProcured ?? [],
    outcomes: editing.outcomes ?? "", papersPublished: editing.papersPublished ?? [],
    papersPublishedCitations: editing.papersPublishedCitations ?? "", patents: editing.patents ?? [],
    studentsProjectsUG: n(editing.studentsProjectsUG), studentsProjectsPG: n(editing.studentsProjectsPG),
    studentsProjectsPhD: n(editing.studentsProjectsPhD), studentsTrainedCount: n(editing.studentsTrainedCount),
    technicalStaffTrainedCount: n(editing.technicalStaffTrainedCount), personsTrainedCount: n(editing.personsTrainedCount),
    progressReportUrl: editing.progressReportUrl ?? "", completionReportUrl: editing.completionReportUrl ?? "",
    utilizationCertificateUrl: editing.utilizationCertificateUrl ?? "", statementOfExpenditureUrl: editing.statementOfExpenditureUrl ?? "",
    submittedRequiredDocs: editing.submittedRequiredDocs ?? "", dateOfSubmission: editing.dateOfSubmission ?? "",
  };
}

function ProjectFormFields({
  editingProject, onCancel, onSaved,
}: {
  editingProject: SponsoredProjectRequest | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ProjectFormState>(() => initialFormState(editingProject));
  const [saving, setSaving] = useState(false);
  const editingId = editingProject?.id ?? null;

  function set<K extends keyof ProjectFormState>(key: K, value: ProjectFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const isValid =
    form.agencyName.trim().length > 1 && form.schemeName.trim().length > 1 && form.applicationNumber.trim().length > 1 &&
    form.title.trim().length > 1 && !!form.projectType && form.objectives.trim().length > 1 &&
    form.piName.trim().length > 1 && !!form.projectStatus;

  const isSanctioned = form.projectStatus === "SANCTIONED";
  const isOngoing = isSanctioned && form.sanctionedStatus === "ONGOING";
  const isCompleted = isSanctioned && form.sanctionedStatus === "COMPLETED";

  async function handleSubmit() {
    if (!isValid) return;
    setSaving(true);
    try {
      const body = {
        agencyName: form.agencyName.trim(),
        schemeName: form.schemeName.trim(),
        applicationNumber: form.applicationNumber.trim(),
        title: form.title.trim(),
        projectType: form.projectType || undefined,
        durationMonths: toNumberOrUndefined(form.durationMonths),
        objectives: form.objectives.trim(),
        tentativeOutcomes: form.tentativeOutcomes.trim(),
        piName: form.piName.trim(),
        piDepartment: form.piDepartment.trim(),
        piAffiliation: form.piAffiliation.trim(),
        coPiCount: toNumberOrUndefined(form.coPiCount),
        coPis: form.coPis,
        projectStatus: form.projectStatus || undefined,
        dateProposalSubmitted: form.dateProposalSubmitted || undefined,
        amountApplied: toNumberOrUndefined(form.amountApplied),
        extendedToSeedFund: form.extendedToSeedFund || undefined,
        sanctionedStatus: form.sanctionedStatus || undefined,
        dateProjectSanctioned: form.dateProjectSanctioned || undefined,
        dateOfStart: form.dateOfStart || undefined,
        financialYearOfStart: form.financialYearOfStart || undefined,
        totalAmountSanctioned: toNumberOrUndefined(form.totalAmountSanctioned),
        recurringAmountSanctioned: toNumberOrUndefined(form.recurringAmountSanctioned),
        nonRecurringAmountSanctioned: toNumberOrUndefined(form.nonRecurringAmountSanctioned),
        instituteContributionSanctioned: toNumberOrUndefined(form.instituteContributionSanctioned),
        noOfYears: form.noOfYears.trim(),
        totalAmountReceived: toNumberOrUndefined(form.totalAmountReceived),
        recurringAmountReceived: toNumberOrUndefined(form.recurringAmountReceived),
        nonRecurringAmountReceived: toNumberOrUndefined(form.nonRecurringAmountReceived),
        instituteContributionReceived: toNumberOrUndefined(form.instituteContributionReceived),
        dateOfCompletion: form.dateOfCompletion || undefined,
        financialYearOfCompletion: form.financialYearOfCompletion || undefined,
        infrastructureProcured: form.infrastructureProcured,
        outcomes: form.outcomes.trim(),
        papersPublished: form.papersPublished,
        papersPublishedCitations: form.papersPublishedCitations.trim(),
        patents: form.patents,
        studentsProjectsUG: toNumberOrUndefined(form.studentsProjectsUG),
        studentsProjectsPG: toNumberOrUndefined(form.studentsProjectsPG),
        studentsProjectsPhD: toNumberOrUndefined(form.studentsProjectsPhD),
        studentsTrainedCount: toNumberOrUndefined(form.studentsTrainedCount),
        technicalStaffTrainedCount: toNumberOrUndefined(form.technicalStaffTrainedCount),
        personsTrainedCount: toNumberOrUndefined(form.personsTrainedCount),
        progressReportUrl: form.progressReportUrl || undefined,
        completionReportUrl: form.completionReportUrl || undefined,
        utilizationCertificateUrl: form.utilizationCertificateUrl || undefined,
        statementOfExpenditureUrl: form.statementOfExpenditureUrl || undefined,
        submittedRequiredDocs: form.submittedRequiredDocs || undefined,
        dateOfSubmission: form.dateOfSubmission || undefined,
      };
      const res = editingId
        ? await fetch(`/api/college/sponsored-projects/${editingId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          })
        : await fetch("/api/college/sponsored-projects", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        toast({ variant: "destructive", title: "Failed to save sponsored project", description: json.error });
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
        <DialogTitle>{editingId ? "Edit & Resubmit Sponsored Project" : "Add Sponsored Research Project"}</DialogTitle>
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput label="Name of the Agency" value={form.agencyName} onChange={(v) => set("agencyName", v)} />
            <TextInput label="Name of the Scheme" value={form.schemeName} onChange={(v) => set("schemeName", v)} />
          </div>
          <TextInput label="Application Number" value={form.applicationNumber} onChange={(v) => set("applicationNumber", v)} />
          <TextInput label="Title of the Project" value={form.title} onChange={(v) => set("title", v)} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Type of Project</Label>
              <Select value={form.projectType} onValueChange={(v) => set("projectType", v as SponsoredProjectType)}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROJECT_TYPE_LABELS) as SponsoredProjectType[]).map((t) => (
                    <SelectItem key={t} value={t}>{PROJECT_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <NumInput label="Duration (Months)" value={toNumberOrUndefined(form.durationMonths)} onChange={(v) => set("durationMonths", String(v))} />
          </div>
          <div className="space-y-2">
            <Label>Objectives of the Project</Label>
            <Textarea value={form.objectives} onChange={(e) => set("objectives", e.target.value)} rows={3} />
          </div>
          <div className="space-y-2">
            <Label>Tentative Outcomes of Project</Label>
            <Textarea value={form.tentativeOutcomes} onChange={(e) => set("tentativeOutcomes", e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextInput label="Name of the PI" value={form.piName} onChange={(v) => set("piName", v)} />
            <TextInput label="Dept. of PI" value={form.piDepartment} onChange={(v) => set("piDepartment", v)} />
            <TextInput label="Affiliation of PI" value={form.piAffiliation} onChange={(v) => set("piAffiliation", v)} />
          </div>
          <NumInput label="No. of Co-PI's" value={toNumberOrUndefined(form.coPiCount)} onChange={(v) => set("coPiCount", String(v))} />
          <RepeatingGroup
            title="Co-PIs"
            items={form.coPis}
            empty={EMPTY_COPI}
            onChange={(v) => set("coPis", v)}
            addLabel="Add Co-PI"
            renderRow={(item, update) => (
              <>
                <TextInput label="Name of Co-PI" value={item.name} onChange={(v) => update({ name: v })} />
                <TextInput label="Dept of Co-PI" value={item.department} onChange={(v) => update({ department: v })} />
                <TextInput label="Affiliation of Co-PI" value={item.affiliation} onChange={(v) => update({ affiliation: v })} />
              </>
            )}
          />
        </div>

        <div className="space-y-4">
          <SubLabel>Status</SubLabel>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={form.projectStatus} onValueChange={(v) => set("projectStatus", v as SponsoredProjectStatus)}>
              <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="APPLIED">Applied</SelectItem>
                <SelectItem value="SANCTIONED">Sanctioned</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.projectStatus === "APPLIED" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 rounded-lg border p-3">
              <DateInput label="Date of Proposal Submitted" value={form.dateProposalSubmitted} onChange={(v) => set("dateProposalSubmitted", v)} />
              <NumInput label="Amount Applied (Rs.)" value={toNumberOrUndefined(form.amountApplied)} onChange={(v) => set("amountApplied", String(v))} />
              <div className="space-y-2 sm:col-span-2">
                <Label>Is the Proposal Extended to Seed Fund</Label>
                <Select value={form.extendedToSeedFund} onValueChange={(v) => set("extendedToSeedFund", v as "YES" | "NO")}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YES">Yes</SelectItem>
                    <SelectItem value="NO">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {isSanctioned && (
            <div className="space-y-4 rounded-lg border p-3">
              <div className="space-y-2">
                <Label>Ongoing / Completed</Label>
                <Select value={form.sanctionedStatus} onValueChange={(v) => set("sanctionedStatus", v as SponsoredProjectSanctionedStatus)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ONGOING">Ongoing</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <DateInput label="Date of Project Sanctioned" value={form.dateProjectSanctioned} onChange={(v) => set("dateProjectSanctioned", v)} />
                <DateInput label="Date of Start" value={form.dateOfStart} onChange={(v) => set("dateOfStart", v)} />
                <TextInput label="F.Y. of Start" value={form.financialYearOfStart} onChange={(v) => set("financialYearOfStart", v)} placeholder="e.g. 2024-25" />
              </div>
              {isCompleted && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <DateInput label="Date of Completion" value={form.dateOfCompletion} onChange={(v) => set("dateOfCompletion", v)} />
                  <TextInput label="F.Y. of Completion" value={form.financialYearOfCompletion} onChange={(v) => set("financialYearOfCompletion", v)} placeholder="e.g. 2025-26" />
                </div>
              )}
              {isOngoing && (
                <TextInput label="No. of Years (e.g. First Year)" value={form.noOfYears} onChange={(v) => set("noOfYears", v)} />
              )}
              <div className="space-y-2">
                <SubLabel>Amount Sanctioned</SubLabel>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <NumInput label="Total Amount (Rs.)" value={toNumberOrUndefined(form.totalAmountSanctioned)} onChange={(v) => set("totalAmountSanctioned", String(v))} />
                  <NumInput label="Recurring (Rs.)" value={toNumberOrUndefined(form.recurringAmountSanctioned)} onChange={(v) => set("recurringAmountSanctioned", String(v))} />
                  <NumInput label="Non-Recurring (Rs.)" value={toNumberOrUndefined(form.nonRecurringAmountSanctioned)} onChange={(v) => set("nonRecurringAmountSanctioned", String(v))} />
                </div>
                <NumInput label="Institute Contribution (Rs.)" value={toNumberOrUndefined(form.instituteContributionSanctioned)} onChange={(v) => set("instituteContributionSanctioned", String(v))} />
              </div>
              <div className="space-y-2">
                <SubLabel>Amount Received</SubLabel>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <NumInput label="Total Amount (Rs.)" value={toNumberOrUndefined(form.totalAmountReceived)} onChange={(v) => set("totalAmountReceived", String(v))} />
                  <NumInput label="Recurring (Rs.)" value={toNumberOrUndefined(form.recurringAmountReceived)} onChange={(v) => set("recurringAmountReceived", String(v))} />
                  <NumInput label="Non-Recurring (Rs.)" value={toNumberOrUndefined(form.nonRecurringAmountReceived)} onChange={(v) => set("nonRecurringAmountReceived", String(v))} />
                </div>
                <NumInput label="Institute Contribution (Rs.)" value={toNumberOrUndefined(form.instituteContributionReceived)} onChange={(v) => set("instituteContributionReceived", String(v))} />
              </div>
            </div>
          )}
        </div>

        {isSanctioned && (
          <div className="space-y-4">
            <SubLabel>Students &amp; Training</SubLabel>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <NumInput label="Students Projects Executed - UG" value={toNumberOrUndefined(form.studentsProjectsUG)} onChange={(v) => set("studentsProjectsUG", String(v))} />
              <NumInput label="PG" value={toNumberOrUndefined(form.studentsProjectsPG)} onChange={(v) => set("studentsProjectsPG", String(v))} />
              <NumInput label="Ph.D." value={toNumberOrUndefined(form.studentsProjectsPhD)} onChange={(v) => set("studentsProjectsPhD", String(v))} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <NumInput label="No. of Students Trained" value={toNumberOrUndefined(form.studentsTrainedCount)} onChange={(v) => set("studentsTrainedCount", String(v))} />
              <NumInput label="No. of Technical Staff Trained" value={toNumberOrUndefined(form.technicalStaffTrainedCount)} onChange={(v) => set("technicalStaffTrainedCount", String(v))} />
              <NumInput label="No. of Persons Trained" value={toNumberOrUndefined(form.personsTrainedCount)} onChange={(v) => set("personsTrainedCount", String(v))} />
            </div>
          </div>
        )}
      </div>

      {isSanctioned && (
        <div className="space-y-5">
          <TableRepeatingGroup
            title="Infrastructure Procured"
            items={form.infrastructureProcured}
            empty={EMPTY_EQUIPMENT}
            onChange={(v) => set("infrastructureProcured", v)}
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

          {isCompleted ? (
            <div className="space-y-2">
              <Label>No. of Papers Published (Citation Format)</Label>
              <Textarea value={form.papersPublishedCitations} onChange={(e) => set("papersPublishedCitations", e.target.value)} rows={4} placeholder="One citation per line" />
            </div>
          ) : (
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
          )}

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
            {isOngoing ? (
              <DocumentUploadField
                label="Progress Report"
                value={form.progressReportUrl}
                uploadEndpoint="/api/upload/sponsored-project-doc"
                extraFields={{ kind: "progress-report" }}
                onUploaded={(url) => set("progressReportUrl", url)}
                onRemoved={() => set("progressReportUrl", "")}
              />
            ) : (
              <DocumentUploadField
                label="Completion Report"
                value={form.completionReportUrl}
                uploadEndpoint="/api/upload/sponsored-project-doc"
                extraFields={{ kind: "completion-report" }}
                onUploaded={(url) => set("completionReportUrl", url)}
                onRemoved={() => set("completionReportUrl", "")}
              />
            )}
            <DocumentUploadField
              label="Utilization Certificate"
              value={form.utilizationCertificateUrl}
              uploadEndpoint="/api/upload/sponsored-project-doc"
              extraFields={{ kind: "utilization-certificate" }}
              onUploaded={(url) => set("utilizationCertificateUrl", url)}
              onRemoved={() => set("utilizationCertificateUrl", "")}
            />
            <DocumentUploadField
              label="Statement of Expenditure"
              value={form.statementOfExpenditureUrl}
              uploadEndpoint="/api/upload/sponsored-project-doc"
              extraFields={{ kind: "statement-of-expenditure" }}
              onUploaded={(url) => set("statementOfExpenditureUrl", url)}
              onRemoved={() => set("statementOfExpenditureUrl", "")}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Submitted All Required Documents to Sponsoring Agency</Label>
                <Select value={form.submittedRequiredDocs} onValueChange={(v) => set("submittedRequiredDocs", v as "YES" | "NO")}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YES">Yes</SelectItem>
                    <SelectItem value="NO">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.submittedRequiredDocs === "YES" && (
                <DateInput label="Date of Submission" value={form.dateOfSubmission} onChange={(v) => set("dateOfSubmission", v)} />
              )}
            </div>
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

function AddSponsoredProjectDialog({
  open, onOpenChange, editingProject, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingProject: SponsoredProjectRequest | null;
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

// Sponsored Research Projects - self-submitted, same PENDING/APPROVED/REJECTED
// verification flow as Seed Funding/Consultancy Projects (see /api/college/
// sponsored-projects), a repeating list per person.
export function SponsoredProjectsModuleView({ uid, isOwnProfile }: { uid?: string; isOwnProfile?: boolean }) {
  const [projects, setProjects] = useState<SponsoredProjectRequest[] | null>(null);

  function load() {
    const url = uid ? `/api/college/sponsored-projects?uid=${encodeURIComponent(uid)}` : "/api/college/sponsored-projects";
    fetch(url)
      .then((r) => r.json() as Promise<{ projects?: SponsoredProjectRequest[] }>)
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => setProjects([]));
  }

  useEffect(() => { load(); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  return <SponsoredProjectsSection projects={projects} isOwnProfile={isOwnProfile} onChanged={load} />;
}

export function SponsoredProjectsSection({
  projects, isOwnProfile, onChanged,
}: {
  projects: SponsoredProjectRequest[] | null;
  isOwnProfile?: boolean;
  onChanged?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<SponsoredProjectRequest | null>(null);

  const sorted = (projects ?? []).slice();
  const visible = expanded ? sorted : sorted.slice(0, PREVIEW_COUNT);
  const hidden = sorted.length - PREVIEW_COUNT;

  function openAdd() {
    setEditingProject(null);
    setFormOpen(true);
  }

  function openEdit(project: SponsoredProjectRequest) {
    setEditingProject(project);
    setFormOpen(true);
  }

  return (
    <Section number={3} title="Sponsored Research Projects">
      <div className="flex items-center justify-between">
        <SubLabel>Projects</SubLabel>
        {isOwnProfile && (
          <Button variant="outline" size="sm" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add Sponsored Project
          </Button>
        )}
      </div>
      {projects === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">None recorded.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((project) => <SponsoredProjectRow key={project.id} project={project} isOwnProfile={isOwnProfile} onEdit={openEdit} />)}
          {sorted.length > PREVIEW_COUNT && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-medium text-primary hover:underline">
              {expanded ? "Show less" : `Show ${hidden} more`}
            </button>
          )}
        </div>
      )}

      {isOwnProfile && (
        <AddSponsoredProjectDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          editingProject={editingProject}
          onSaved={() => onChanged?.()}
        />
      )}
    </Section>
  );
}
