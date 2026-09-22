"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Plus, Pencil } from "lucide-react";
import {
  Section, SubLabel, Field, TextInput, NumInput, DateInput, TableRepeatingGroup,
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
import { isValidDdMmYyyy } from "@/lib/research/validateSponsoredProject";
import type {
  SeedFundingEquipmentItem, SeedFundingPaperItem, SeedFundingPatentItem,
  SponsoredProjectCoPI, SponsoredProjectRequest, SponsoredProjectSanctionedStatus,
  SponsoredProjectStatus, SponsoredProjectType, SponsoredProjectYearData,
} from "@/types";

const PREVIEW_COUNT = 3;
// Guards against a typo like 1000 spawning a thousand Co-PI rows.
const MAX_COPIS = 50;

const EMPTY_COPI: SponsoredProjectCoPI = { name: "", department: "", affiliation: "" };
const EMPTY_EQUIPMENT: SeedFundingEquipmentItem = { name: "", makeModel: "", softwareOrHardware: "", amount: undefined, purpose: "" };
const EMPTY_PAPER: SeedFundingPaperItem = { title: "", journalOrConference: "" };
const EMPTY_PATENT: SeedFundingPatentItem = { applicationNo: "", applicantName: "", patentTitle: "", inventorDetails: "", status: "" };

// Resizes a list to exactly `count` items, trimming from the end or padding
// with `empty` - backs the "No. of Years" numeric field, which drives how
// many yearly Amount Received/Infrastructure/Outcomes groups show.
function resizeArray<T>(arr: T[], count: number, empty: T): T[] {
  if (arr.length === count) return arr;
  if (arr.length > count) return arr.slice(0, count);
  return [...arr, ...Array.from({ length: count - arr.length }, () => ({ ...empty }))];
}

function yearOrdinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

const PROJECT_TYPE_LABELS: Record<SponsoredProjectType, string> = {
  TRAINING: "Training", TECHNICAL: "Technical", SOCIETY: "Society", INFRASTRUCTURE: "Infrastructure",
};

function toNumberOrUndefined(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

// A browser's native date picker shows the viewer's own locale (often
// MM/DD/YYYY), which can't be forced - so this is a masked text box that always
// reads DD-MM-YYYY, inserting the dashes as digits are typed.
function DdMmYyyyInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  function format(raw: string): string {
    const d = raw.replace(/\D/g, "").slice(0, 8);
    if (d.length <= 2) return d;
    if (d.length <= 4) return `${d.slice(0, 2)}-${d.slice(2)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`;
  }
  const invalid = value.length === 10 && !isValidDdMmYyyy(value);
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        value={value} onChange={(e) => onChange(format(e.target.value))}
        placeholder="DD-MM-YYYY" inputMode="numeric" maxLength={10} aria-invalid={invalid}
      />
      {invalid && <p className="text-xs text-destructive">Enter a valid date as DD-MM-YYYY</p>}
    </div>
  );
}

function SponsoredProjectRow({
  project, isOwnProfile, onEdit,
}: {
  project: SponsoredProjectRequest;
  isOwnProfile?: boolean;
  onEdit?: (project: SponsoredProjectRequest) => void;
}) {
  // Reports are filed per year; the project-level ones only exist on records
  // saved before that. "Year N" is only worth prefixing when there's more than one.
  const years = project.yearlyData ?? [];
  const reportLinks: { label: string; url: string }[] = [];
  const addReports = (prefix: string, src: { progressReportUrl?: string; completionReportUrl?: string; utilizationCertificateUrl?: string; statementOfExpenditureUrl?: string }) => {
    const items: [string, string | undefined][] = [
      ["Progress Report", src.progressReportUrl], ["Completion Report", src.completionReportUrl],
      ["Utilization Certificate", src.utilizationCertificateUrl], ["Statement of Expenditure", src.statementOfExpenditureUrl],
    ];
    for (const [label, url] of items) if (url) reportLinks.push({ label: `${prefix}${label}`, url });
  };
  addReports("", project);
  years.forEach((y, i) => addReports(years.length > 1 ? `${yearOrdinal(i + 1)} Year - ` : "", y));

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
        <Field label={project.totalAmountSanctioned !== undefined ? "Total Amount Sanctioned (Rs.)" : "Amount Applied (Rs.)"} value={project.totalAmountSanctioned ?? project.amountApplied} />
      </div>
      {project.objectives && (
        <div>
          <p className="text-xs text-muted-foreground">Objectives</p>
          <p className="text-sm">{project.objectives}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {reportLinks.map((l) => (
          <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />{l.label}
          </a>
        ))}
      </div>
    </div>
  );
}

interface YearFormData {
  totalAmountReceived: string;
  recurringAmountReceived: string;
  nonRecurringAmountReceived: string;
  instituteContributionReceived: string;
  infrastructureProcured: SeedFundingEquipmentItem[];
  papersPublished: SeedFundingPaperItem[];
  patents: SeedFundingPatentItem[];
  studentsProjectsUG: string;
  studentsProjectsPG: string;
  studentsProjectsPhD: string;
  studentsTrainedCount: string;
  teachingStaffTrainedCount: string;
  nonTeachingStaffTrainedCount: string;
  externalPersonsTrainedCount: string;
  submittedRequiredDocs: "YES" | "NO" | "";
  dateOfSubmission: string;
  progressReportUrl: string;
  completionReportUrl: string;
  utilizationCertificateUrl: string;
  statementOfExpenditureUrl: string;
}

const EMPTY_YEAR_DATA: YearFormData = {
  totalAmountReceived: "", recurringAmountReceived: "", nonRecurringAmountReceived: "", instituteContributionReceived: "",
  infrastructureProcured: [], papersPublished: [], patents: [],
  studentsProjectsUG: "", studentsProjectsPG: "", studentsProjectsPhD: "",
  studentsTrainedCount: "", teachingStaffTrainedCount: "", nonTeachingStaffTrainedCount: "", externalPersonsTrainedCount: "",
  submittedRequiredDocs: "", dateOfSubmission: "", progressReportUrl: "", completionReportUrl: "",
  utilizationCertificateUrl: "", statementOfExpenditureUrl: "",
};

function yearFormFromData(y?: SponsoredProjectYearData): YearFormData {
  const n = (v: number | undefined) => (v !== undefined ? String(v) : "");
  return {
    totalAmountReceived: n(y?.totalAmountReceived), recurringAmountReceived: n(y?.recurringAmountReceived),
    nonRecurringAmountReceived: n(y?.nonRecurringAmountReceived), instituteContributionReceived: n(y?.instituteContributionReceived),
    infrastructureProcured: y?.infrastructureProcured ?? [],
    papersPublished: y?.papersPublished ?? [], patents: y?.patents ?? [],
    studentsProjectsUG: n(y?.studentsProjectsUG), studentsProjectsPG: n(y?.studentsProjectsPG), studentsProjectsPhD: n(y?.studentsProjectsPhD),
    studentsTrainedCount: n(y?.studentsTrainedCount), teachingStaffTrainedCount: n(y?.teachingStaffTrainedCount),
    nonTeachingStaffTrainedCount: n(y?.nonTeachingStaffTrainedCount), externalPersonsTrainedCount: n(y?.externalPersonsTrainedCount),
    submittedRequiredDocs: y?.submittedRequiredDocs ?? "", dateOfSubmission: y?.dateOfSubmission ?? "",
    progressReportUrl: y?.progressReportUrl ?? "", completionReportUrl: y?.completionReportUrl ?? "",
    utilizationCertificateUrl: y?.utilizationCertificateUrl ?? "", statementOfExpenditureUrl: y?.statementOfExpenditureUrl ?? "",
  };
}

function yearDataToPayload(y: YearFormData): SponsoredProjectYearData {
  return {
    totalAmountReceived: toNumberOrUndefined(y.totalAmountReceived), recurringAmountReceived: toNumberOrUndefined(y.recurringAmountReceived),
    nonRecurringAmountReceived: toNumberOrUndefined(y.nonRecurringAmountReceived), instituteContributionReceived: toNumberOrUndefined(y.instituteContributionReceived),
    infrastructureProcured: y.infrastructureProcured,
    papersPublished: y.papersPublished, patents: y.patents,
    studentsProjectsUG: toNumberOrUndefined(y.studentsProjectsUG), studentsProjectsPG: toNumberOrUndefined(y.studentsProjectsPG),
    studentsProjectsPhD: toNumberOrUndefined(y.studentsProjectsPhD), studentsTrainedCount: toNumberOrUndefined(y.studentsTrainedCount),
    teachingStaffTrainedCount: toNumberOrUndefined(y.teachingStaffTrainedCount),
    nonTeachingStaffTrainedCount: toNumberOrUndefined(y.nonTeachingStaffTrainedCount),
    externalPersonsTrainedCount: toNumberOrUndefined(y.externalPersonsTrainedCount),
    submittedRequiredDocs: y.submittedRequiredDocs || undefined,
    // Only the answer "Yes" carries a date/reports - flipping to No drops any left over.
    dateOfSubmission: y.submittedRequiredDocs === "YES" ? y.dateOfSubmission || undefined : undefined,
    progressReportUrl: y.submittedRequiredDocs === "YES" ? y.progressReportUrl || undefined : undefined,
    completionReportUrl: y.submittedRequiredDocs === "YES" ? y.completionReportUrl || undefined : undefined,
    utilizationCertificateUrl: y.submittedRequiredDocs === "YES" ? y.utilizationCertificateUrl || undefined : undefined,
    statementOfExpenditureUrl: y.submittedRequiredDocs === "YES" ? y.statementOfExpenditureUrl || undefined : undefined,
  };
}

// Every field of a yearly group is compulsory (Amount Received, at least one
// Infrastructure/Paper/Patent row, Students & Training, and the
// submitted-documents answer with its reports when Yes) - mirrors the
// compulsory-everything treatment of Discovery & Innovation's Applicants/
// Inventors. `isOngoing` picks Progress Report vs Completion Report.
function isYearDataValid(y: YearFormData, isOngoing: boolean): boolean {
  const numFields = [
    y.totalAmountReceived, y.recurringAmountReceived, y.nonRecurringAmountReceived, y.instituteContributionReceived,
    y.studentsProjectsUG, y.studentsProjectsPG, y.studentsProjectsPhD, y.studentsTrainedCount,
    y.teachingStaffTrainedCount, y.nonTeachingStaffTrainedCount, y.externalPersonsTrainedCount,
  ];
  if (numFields.some((v) => v.trim() === "" || Number.isNaN(Number(v)))) return false;
  if (y.infrastructureProcured.length === 0 || y.infrastructureProcured.some((it) => !it.name.trim())) return false;
  if (y.papersPublished.length === 0 || y.papersPublished.some((p) => !p.title.trim())) return false;
  if (y.patents.length === 0 || y.patents.some((p) => !p.patentTitle.trim())) return false;
  if (!y.submittedRequiredDocs) return false;
  if (y.submittedRequiredDocs === "YES") {
    if (!y.dateOfSubmission) return false;
    if (isOngoing ? !y.progressReportUrl : !y.completionReportUrl) return false;
    if (!y.utilizationCertificateUrl || !y.statementOfExpenditureUrl) return false;
  }
  return true;
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
  seedFundTitle: string;
  seedFundAmountSanctioned: string;
  seedFundSanctionDate: string;
  sanctionedStatus: SponsoredProjectSanctionedStatus | "";
  dateProjectSanctioned: string;
  dateOfStart: string;
  financialYearOfStart: string;
  totalAmountSanctioned: string;
  recurringAmountSanctioned: string;
  nonRecurringAmountSanctioned: string;
  instituteContributionSanctioned: string;
  dateOfCompletion: string;
  financialYearOfCompletion: string;
  noOfYears: string;
  yearlyData: YearFormData[];
}

function initialFormState(editing: SponsoredProjectRequest | null): ProjectFormState {
  const n = (v: number | undefined) => (v !== undefined ? String(v) : "");
  if (!editing) {
    return {
      agencyName: "", schemeName: "", applicationNumber: "", title: "", projectType: "", durationMonths: "",
      objectives: "", tentativeOutcomes: "", piName: "", piDepartment: "", piAffiliation: "", coPiCount: "",
      coPis: [], projectStatus: "", dateProposalSubmitted: "", amountApplied: "", extendedToSeedFund: "",
      seedFundTitle: "", seedFundAmountSanctioned: "", seedFundSanctionDate: "",
      sanctionedStatus: "", dateProjectSanctioned: "", dateOfStart: "", financialYearOfStart: "",
      totalAmountSanctioned: "", recurringAmountSanctioned: "", nonRecurringAmountSanctioned: "",
      instituteContributionSanctioned: "", dateOfCompletion: "", financialYearOfCompletion: "",
      noOfYears: "", yearlyData: [],
    };
  }
  return {
    agencyName: editing.agencyName, schemeName: editing.schemeName, applicationNumber: editing.applicationNumber,
    title: editing.title, projectType: editing.projectType, durationMonths: n(editing.durationMonths),
    objectives: editing.objectives, tentativeOutcomes: editing.tentativeOutcomes ?? "", piName: editing.piName,
    piDepartment: editing.piDepartment ?? "", piAffiliation: editing.piAffiliation ?? "",
    // Records added with the old "Add Co-PI" button may have rows but no count.
    coPiCount: n(editing.coPiCount ?? ((editing.coPis?.length ?? 0) || undefined)),
    coPis: editing.coPis ?? [], projectStatus: editing.projectStatus, dateProposalSubmitted: editing.dateProposalSubmitted ?? "",
    amountApplied: n(editing.amountApplied), extendedToSeedFund: editing.extendedToSeedFund ?? "",
    seedFundTitle: editing.seedFundTitle ?? "", seedFundAmountSanctioned: n(editing.seedFundAmountSanctioned ?? undefined),
    seedFundSanctionDate: editing.seedFundSanctionDate ?? "",
    sanctionedStatus: editing.sanctionedStatus ?? "", dateProjectSanctioned: editing.dateProjectSanctioned ?? "",
    dateOfStart: editing.dateOfStart ?? "", financialYearOfStart: editing.financialYearOfStart ?? "",
    totalAmountSanctioned: n(editing.totalAmountSanctioned), recurringAmountSanctioned: n(editing.recurringAmountSanctioned),
    nonRecurringAmountSanctioned: n(editing.nonRecurringAmountSanctioned),
    instituteContributionSanctioned: n(editing.instituteContributionSanctioned),
    dateOfCompletion: editing.dateOfCompletion ?? "", financialYearOfCompletion: editing.financialYearOfCompletion ?? "",
    noOfYears: n(editing.noOfYears),
    yearlyData: (editing.yearlyData ?? []).map((y, i, all) => {
      const form = yearFormFromData(y);
      // Before this was asked per year, the documents answer and reports sat on
      // the project and showed only under the last year - carry them onto that
      // year so an older record still opens with them filled in.
      if (i !== all.length - 1 || form.submittedRequiredDocs || !editing.submittedRequiredDocs) return form;
      return {
        ...form,
        submittedRequiredDocs: editing.submittedRequiredDocs,
        dateOfSubmission: editing.dateOfSubmission ?? "",
        progressReportUrl: editing.progressReportUrl ?? "", completionReportUrl: editing.completionReportUrl ?? "",
        utilizationCertificateUrl: editing.utilizationCertificateUrl ?? "",
        statementOfExpenditureUrl: editing.statementOfExpenditureUrl ?? "",
      };
    }),
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

  // Digits only, clamped to MAX_COPIS. Clearing the box keeps rows already
  // filled in, so backspace-and-retype doesn't wipe them; the submit payload
  // drops them when the count is empty.
  function setCoPiCount(raw: string) {
    const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
    const v = digits === "" ? "" : String(Math.min(Number(digits), MAX_COPIS));
    setForm((f) => ({
      ...f, coPiCount: v,
      coPis: v === "" ? f.coPis : resizeArray(f.coPis, Number(v), EMPTY_COPI),
    }));
  }

  function updateCoPi(i: number, patch: Partial<SponsoredProjectCoPI>) {
    setForm((f) => {
      const next = [...f.coPis];
      next[i] = { ...next[i], ...patch };
      return { ...f, coPis: next };
    });
  }

  function setNoOfYears(v: string) {
    const count = toNumberOrUndefined(v) ?? 0;
    setForm((f) => ({ ...f, noOfYears: v, yearlyData: resizeArray(f.yearlyData, count, EMPTY_YEAR_DATA) }));
  }

  function updateYear(i: number, patch: Partial<YearFormData>) {
    setForm((f) => {
      const next = [...f.yearlyData];
      next[i] = { ...next[i], ...patch };
      return { ...f, yearlyData: next };
    });
  }

  const isSanctioned = form.projectStatus === "SANCTIONED";
  const isOngoing = isSanctioned && form.sanctionedStatus === "ONGOING";
  const isCompleted = isSanctioned && form.sanctionedStatus === "COMPLETED";

  // Almost every field is compulsory (mirrors Discovery & Innovation /
  // Citation Metrics) - Applied vs Sanctioned each validate their own branch,
  // and a Sanctioned project's yearly groups + reports are required too.
  const coPisValid = (toNumberOrUndefined(form.coPiCount) ?? 0) === 0
    || (form.coPis.length > 0 && form.coPis.every((c) => c.name.trim() && c.department.trim() && c.affiliation.trim()));

  const appliedValid = isSanctioned || (
    !!form.dateProposalSubmitted && form.amountApplied.trim() !== "" && !Number.isNaN(Number(form.amountApplied)) && !!form.extendedToSeedFund &&
    (form.extendedToSeedFund !== "YES" || (
      !!form.seedFundTitle.trim() &&
      form.seedFundAmountSanctioned.trim() !== "" && !Number.isNaN(Number(form.seedFundAmountSanctioned)) &&
      isValidDdMmYyyy(form.seedFundSanctionDate)
    ))
  );

  const sanctionedValid = !isSanctioned || (
    !!form.sanctionedStatus &&
    !!form.dateProjectSanctioned && !!form.dateOfStart && form.financialYearOfStart.trim() !== "" &&
    (!isCompleted || (!!form.dateOfCompletion && form.financialYearOfCompletion.trim() !== "")) &&
    [form.totalAmountSanctioned, form.recurringAmountSanctioned, form.nonRecurringAmountSanctioned, form.instituteContributionSanctioned]
      .every((v) => v.trim() !== "" && !Number.isNaN(Number(v))) &&
    form.noOfYears.trim() !== "" && !Number.isNaN(Number(form.noOfYears)) && Number(form.noOfYears) > 0 &&
    form.yearlyData.length === Number(form.noOfYears) && form.yearlyData.every((y) => isYearDataValid(y, isOngoing))
  );

  const isValid =
    form.agencyName.trim().length > 1 && form.schemeName.trim().length > 1 && form.applicationNumber.trim().length > 1 &&
    form.title.trim().length > 1 && !!form.projectType &&
    form.durationMonths.trim() !== "" && !Number.isNaN(Number(form.durationMonths)) &&
    form.objectives.trim().length > 1 && form.tentativeOutcomes.trim().length > 1 &&
    form.piName.trim().length > 1 && form.piDepartment.trim().length > 1 && form.piAffiliation.trim().length > 1 &&
    coPisValid && !!form.projectStatus && appliedValid && sanctionedValid;

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
        coPis: (toNumberOrUndefined(form.coPiCount) ?? 0) > 0 ? form.coPis : [],
        projectStatus: form.projectStatus || undefined,
        dateProposalSubmitted: form.dateProposalSubmitted || undefined,
        amountApplied: toNumberOrUndefined(form.amountApplied),
        extendedToSeedFund: form.extendedToSeedFund || undefined,
        // Cleared (not omitted) when not "Yes" so an edit flipping Yes -> No drops the old values.
        seedFundTitle: form.extendedToSeedFund === "YES" ? form.seedFundTitle.trim() : "",
        seedFundAmountSanctioned: form.extendedToSeedFund === "YES" ? toNumberOrUndefined(form.seedFundAmountSanctioned) : null,
        seedFundSanctionDate: form.extendedToSeedFund === "YES" ? form.seedFundSanctionDate : "",
        sanctionedStatus: form.sanctionedStatus || undefined,
        dateProjectSanctioned: form.dateProjectSanctioned || undefined,
        dateOfStart: form.dateOfStart || undefined,
        financialYearOfStart: form.financialYearOfStart || undefined,
        totalAmountSanctioned: toNumberOrUndefined(form.totalAmountSanctioned),
        recurringAmountSanctioned: toNumberOrUndefined(form.recurringAmountSanctioned),
        nonRecurringAmountSanctioned: toNumberOrUndefined(form.nonRecurringAmountSanctioned),
        instituteContributionSanctioned: toNumberOrUndefined(form.instituteContributionSanctioned),
        dateOfCompletion: form.dateOfCompletion || undefined,
        financialYearOfCompletion: form.financialYearOfCompletion || undefined,
        noOfYears: toNumberOrUndefined(form.noOfYears),
        yearlyData: form.yearlyData.map(yearDataToPayload),
        // Cleared explicitly so an older record's project-level values (now
        // carried onto its last year) don't linger and show twice.
        progressReportUrl: "", completionReportUrl: "", utilizationCertificateUrl: "",
        statementOfExpenditureUrl: "", submittedRequiredDocs: "", dateOfSubmission: "",
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
          <div className="space-y-2 max-w-[200px]">
            <Label>No. of Co-PI&apos;s</Label>
            <Input
              type="number" inputMode="numeric" min={0} max={MAX_COPIS} step={1}
              value={form.coPiCount} onChange={(e) => setCoPiCount(e.target.value)}
              placeholder="Enter number"
            />
          </div>
          {(toNumberOrUndefined(form.coPiCount) ?? 0) > 0 && form.coPis.map((c, i) => (
            <div key={i} className="grid grid-cols-1 gap-3 sm:grid-cols-3 rounded-md bg-muted/30 p-3">
              <TextInput label={`Name of Co-PI ${i + 1}`} value={c.name} onChange={(v) => updateCoPi(i, { name: v })} />
              <TextInput label={`Dept of Co-PI ${i + 1}`} value={c.department} onChange={(v) => updateCoPi(i, { department: v })} />
              <TextInput label={`Affiliation of Co-PI ${i + 1}`} value={c.affiliation} onChange={(v) => updateCoPi(i, { affiliation: v })} />
            </div>
          ))}
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
              {form.extendedToSeedFund === "YES" && (
                <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-3 rounded-md bg-muted/30 p-3">
                  <TextInput label="Title of Seed Funding" value={form.seedFundTitle} onChange={(v) => set("seedFundTitle", v)} />
                  <NumInput label="Amount Sanctioned (Rs.)" value={toNumberOrUndefined(form.seedFundAmountSanctioned)} onChange={(v) => set("seedFundAmountSanctioned", String(v))} />
                  <DdMmYyyyInput label="Year of Sanctioning" value={form.seedFundSanctionDate} onChange={(v) => set("seedFundSanctionDate", v)} />
                </div>
              )}
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
              <div className="space-y-2">
                <SubLabel>Total Amount Sanctioned</SubLabel>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <NumInput label="Total Amount (Rs.)" value={toNumberOrUndefined(form.totalAmountSanctioned)} onChange={(v) => set("totalAmountSanctioned", String(v))} />
                  <NumInput label="Recurring (Rs.)" value={toNumberOrUndefined(form.recurringAmountSanctioned)} onChange={(v) => set("recurringAmountSanctioned", String(v))} />
                  <NumInput label="Non-Recurring (Rs.)" value={toNumberOrUndefined(form.nonRecurringAmountSanctioned)} onChange={(v) => set("nonRecurringAmountSanctioned", String(v))} />
                </div>
                <NumInput label="Institute Contribution (Rs.)" value={toNumberOrUndefined(form.instituteContributionSanctioned)} onChange={(v) => set("instituteContributionSanctioned", String(v))} />
              </div>
              <NumInput label="No. of Years" value={toNumberOrUndefined(form.noOfYears)} onChange={(v) => setNoOfYears(String(v))} />
            </div>
          )}
        </div>
      </div>

      {isSanctioned && (
        <div className="space-y-5">
          {form.yearlyData.map((yr, i) => (
            <div key={i} className="space-y-4 rounded-lg border p-3">
              <SubLabel>{yearOrdinal(i + 1)} Year</SubLabel>

              <div className="space-y-2">
                <SubLabel>Amount Received</SubLabel>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <NumInput label="Total Amount (Rs.)" value={toNumberOrUndefined(yr.totalAmountReceived)} onChange={(v) => updateYear(i, { totalAmountReceived: String(v) })} />
                  <NumInput label="Recurring (Rs.)" value={toNumberOrUndefined(yr.recurringAmountReceived)} onChange={(v) => updateYear(i, { recurringAmountReceived: String(v) })} />
                  <NumInput label="Non-Recurring (Rs.)" value={toNumberOrUndefined(yr.nonRecurringAmountReceived)} onChange={(v) => updateYear(i, { nonRecurringAmountReceived: String(v) })} />
                </div>
                <NumInput label="Institute Contribution (Rs.)" value={toNumberOrUndefined(yr.instituteContributionReceived)} onChange={(v) => updateYear(i, { instituteContributionReceived: String(v) })} />
              </div>

              <TableRepeatingGroup
                title="Infrastructure Procured"
                items={yr.infrastructureProcured}
                empty={EMPTY_EQUIPMENT}
                onChange={(v) => updateYear(i, { infrastructureProcured: v })}
                addLabel="Add Equipment"
                columns={[
                  { header: "Name of the Equipment", render: (item, update) => <Input className="h-8 text-sm" value={item.name} onChange={(e) => update({ name: e.target.value })} /> },
                  { header: "Make/Model", render: (item, update) => <Input className="h-8 text-sm" value={item.makeModel} onChange={(e) => update({ makeModel: e.target.value })} /> },
                  { header: "Software/Hardware", render: (item, update) => <Input className="h-8 text-sm" value={item.softwareOrHardware} onChange={(e) => update({ softwareOrHardware: e.target.value })} /> },
                  { header: "Amount", render: (item, update) => <Input type="number" className="h-8 text-sm" value={item.amount ?? ""} onChange={(e) => update({ amount: e.target.value === "" ? undefined : Number(e.target.value) })} /> },
                  { header: "Purpose", render: (item, update) => <Input className="h-8 text-sm" value={item.purpose} onChange={(e) => update({ purpose: e.target.value })} /> },
                ]}
              />

              <div className="space-y-4">
                <SubLabel>Outcomes</SubLabel>

                <TableRepeatingGroup
                  title="Papers Published"
                  items={yr.papersPublished}
                  empty={EMPTY_PAPER}
                  onChange={(v) => updateYear(i, { papersPublished: v })}
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
                  items={yr.patents}
                  empty={EMPTY_PATENT}
                  onChange={(v) => updateYear(i, { patents: v })}
                  addLabel="Add Patent"
                  columns={[
                    { header: "Application No.", render: (item, update) => <Input className="h-8 text-sm" value={item.applicationNo} onChange={(e) => update({ applicationNo: e.target.value })} /> },
                    { header: "Name of the Applicant", render: (item, update) => <Input className="h-8 text-sm" value={item.applicantName} onChange={(e) => update({ applicantName: e.target.value })} /> },
                    { header: "Title of the Patent", render: (item, update) => <Input className="h-8 text-sm" value={item.patentTitle} onChange={(e) => update({ patentTitle: e.target.value })} /> },
                    { header: "Inventor Details", render: (item, update) => <Input className="h-8 text-sm" value={item.inventorDetails} onChange={(e) => update({ inventorDetails: e.target.value })} /> },
                    { header: "Status (Filed/Published/Granted)", render: (item, update) => <Input className="h-8 text-sm" value={item.status} onChange={(e) => update({ status: e.target.value })} placeholder="Filed / Published / Granted" /> },
                  ]}
                />

                <div className="space-y-2">
                  <SubLabel>Students Projects Executed</SubLabel>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <NumInput label="UG" value={toNumberOrUndefined(yr.studentsProjectsUG)} onChange={(v) => updateYear(i, { studentsProjectsUG: String(v) })} />
                    <NumInput label="PG" value={toNumberOrUndefined(yr.studentsProjectsPG)} onChange={(v) => updateYear(i, { studentsProjectsPG: String(v) })} />
                    <NumInput label="Ph.D." value={toNumberOrUndefined(yr.studentsProjectsPhD)} onChange={(v) => updateYear(i, { studentsProjectsPhD: String(v) })} />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <NumInput label="No. of Students Trained" value={toNumberOrUndefined(yr.studentsTrainedCount)} onChange={(v) => updateYear(i, { studentsTrainedCount: String(v) })} />
                    <NumInput label="Teaching Staff Trained" value={toNumberOrUndefined(yr.teachingStaffTrainedCount)} onChange={(v) => updateYear(i, { teachingStaffTrainedCount: String(v) })} />
                    <NumInput label="Non-Teaching Staff Trained" value={toNumberOrUndefined(yr.nonTeachingStaffTrainedCount)} onChange={(v) => updateYear(i, { nonTeachingStaffTrainedCount: String(v) })} />
                    <NumInput label="External Persons Trained" value={toNumberOrUndefined(yr.externalPersonsTrainedCount)} onChange={(v) => updateYear(i, { externalPersonsTrainedCount: String(v) })} />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2 max-w-[280px]">
                  <Label>Submitted All Required Documents to Sponsoring Agency</Label>
                  <Select value={yr.submittedRequiredDocs} onValueChange={(v) => updateYear(i, { submittedRequiredDocs: v as "YES" | "NO" })}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="YES">Yes</SelectItem>
                      <SelectItem value="NO">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {yr.submittedRequiredDocs === "YES" && (
                  <div className="space-y-4 rounded-lg border p-3">
                    <SubLabel>Reports</SubLabel>
                    <DateInput label="Date of Submission" value={yr.dateOfSubmission} onChange={(v) => updateYear(i, { dateOfSubmission: v })} />
                    {isOngoing ? (
                      <DocumentUploadField
                        label="Progress Report"
                        value={yr.progressReportUrl}
                        uploadEndpoint="/api/upload/sponsored-project-doc"
                        extraFields={{ kind: "progress-report" }}
                        onUploaded={(url) => updateYear(i, { progressReportUrl: url })}
                        onRemoved={() => updateYear(i, { progressReportUrl: "" })}
                      />
                    ) : (
                      <DocumentUploadField
                        label="Completion Report"
                        value={yr.completionReportUrl}
                        uploadEndpoint="/api/upload/sponsored-project-doc"
                        extraFields={{ kind: "completion-report" }}
                        onUploaded={(url) => updateYear(i, { completionReportUrl: url })}
                        onRemoved={() => updateYear(i, { completionReportUrl: "" })}
                      />
                    )}
                    <DocumentUploadField
                      label="Utilization Certificate"
                      value={yr.utilizationCertificateUrl}
                      uploadEndpoint="/api/upload/sponsored-project-doc"
                      extraFields={{ kind: "utilization-certificate" }}
                      onUploaded={(url) => updateYear(i, { utilizationCertificateUrl: url })}
                      onRemoved={() => updateYear(i, { utilizationCertificateUrl: "" })}
                    />
                    <DocumentUploadField
                      label="Statement of Expenditure"
                      value={yr.statementOfExpenditureUrl}
                      uploadEndpoint="/api/upload/sponsored-project-doc"
                      extraFields={{ kind: "statement-of-expenditure" }}
                      onUploaded={(url) => updateYear(i, { statementOfExpenditureUrl: url })}
                      onRemoved={() => updateYear(i, { statementOfExpenditureUrl: "" })}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
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
