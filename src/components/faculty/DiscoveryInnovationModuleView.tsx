"use client";

import { InternalFacultyPicker } from "@/components/research/InternalFacultyPicker";
import { useEffect, useState } from "react";
import { ExternalLink, Plus, Pencil } from "lucide-react";
import { Section, SubLabel, Field, TextInput, NumField, DateInput, RequiredMark } from "@/components/shared/ProfileFieldPrimitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { DocumentUploadField } from "@/components/shared/DocumentUploadField";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import type {
  AuthorCategory, AuthorRoleType, DiscoveryInnovationRequest, IprApplicant, IprApplicantType,
  IprCommercializationStatus, IprCommercializationType, IprInventor, IprStatus, IprType,
} from "@/types";
import { FACT_GRID_COLS_4 } from "@/components/shared/factGrid";

const PREVIEW_COUNT = 3;
// Guards against a typo like 1000 spawning a thousand form rows.
const MAX_COUNT = 50;
const OTHERS_COLLEGE_ID = "OTHERS";

const EMPTY_APPLICANT: IprApplicant = { name: "", type: "INDIVIDUAL" };
const EMPTY_INVENTOR: IprInventor = { name: "", category: "CO_AUTHOR", authorType: "FACULTY", affiliationCollegeName: "", isInternal: true };

// AuthorCategory is shared with Publications, which does have a Corresponding
// Author - an IPR inventor only ever is a First Inventor or a Co-Inventor.
type InventorCategory = Exclude<AuthorCategory, "CORRESPONDING_AUTHOR">;
const INVENTOR_CATEGORY_LABELS: Record<InventorCategory, string> = {
  FIRST_AUTHOR: "First Inventor", CO_AUTHOR: "Co-Inventor",
};
const INVENTOR_TYPE_LABELS: Record<AuthorRoleType, string> = { FACULTY: "Faculty", STUDENT: "Student" };

interface CollegeOption { id: string; name: string }

// Fetches once - shared by every inventor row rather than each row fetching
// its own copy. Same pattern as PublicationDetailsForm.tsx's useCollegeOptions
// (kept as its own copy here since that one isn't exported).
function useCollegeOptions() {
  const [colleges, setColleges] = useState<CollegeOption[]>([]);
  useEffect(() => {
    fetch("/api/college/colleges-directory")
      .then((r) => r.json() as Promise<{ colleges?: CollegeOption[] }>)
      .then((d) => setColleges(d.colleges ?? []))
      .catch(() => setColleges([]));
  }, []);
  return colleges;
}

// Same SDG list/labels and dropdown-picker pattern as Research Publications'
// SdgPicker (PublicationDetailsForm.tsx) - kept as its own copy here since
// that component isn't exported and is under active development elsewhere.
const SDG_NAMES: Record<number, string> = {
  1: "No Poverty", 2: "Zero Hunger", 3: "Good Health and Well-being", 4: "Quality Education",
  5: "Gender Equality", 6: "Clean Water and Sanitation", 7: "Affordable and Clean Energy",
  8: "Decent Work and Economic Growth", 9: "Industry, Innovation and Infrastructure",
  10: "Reduced Inequalities", 11: "Sustainable Cities and Communities",
  12: "Responsible Consumption and Production", 13: "Climate Action", 14: "Life Below Water",
  15: "Life on Land", 16: "Peace, Justice and Strong Institutions", 17: "Partnerships for the Goals",
};
const SDG_GOALS = Array.from({ length: 17 }, (_, i) => i + 1);

function SdgPicker({ selected, onChange }: { selected: number[]; onChange: (next: number[]) => void }) {
  const set = new Set(selected);
  function toggle(goal: number) {
    const next = new Set(set);
    if (next.has(goal)) next.delete(goal); else next.add(goal);
    onChange(Array.from(next).sort((a, b) => a - b));
  }
  const summary = set.size === 0 ? "Select SDG(s)" : Array.from(set).sort((a, b) => a - b).map((g) => `SDG ${g}`).join(", ");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-start font-normal">
          <span className="truncate">{summary}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2 max-h-72 overflow-y-auto" align="start">
        <div className="space-y-1">
          {SDG_GOALS.map((goal) => (
            <label key={goal} className="flex items-center gap-2 text-sm rounded px-1.5 py-1 hover:bg-muted cursor-pointer">
              <Checkbox checked={set.has(goal)} onCheckedChange={() => toggle(goal)} />
              <span className="text-muted-foreground w-14 shrink-0">SDG {goal}</span>
              <span>{SDG_NAMES[goal]}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const IPR_TYPE_LABELS: Record<IprType, string> = {
  UTILITY_PATENT: "Utility Patent", DESIGN_PATENT: "Design Patent", COPYRIGHT: "Copy Right",
};
const APPLICANT_TYPE_LABELS: Record<IprApplicantType, string> = {
  INDIVIDUAL: "Individual", INSTITUTION: "Institution", INDUSTRY: "Industry",
};
const COMMERCIALIZATION_STATUS_LABELS: Record<IprCommercializationStatus, string> = {
  COMMERCIALIZED: "Commercialized", LICENSED: "Licensed", TECHNOLOGY_TRANSFERRED: "Technology Transferred",
};
const COMMERCIALIZATION_TYPE_LABELS: Record<IprCommercializationType, string> = {
  EXCLUSIVE_LICENSE: "Exclusive License", NON_EXCLUSIVE_LICENSE: "Non-Exclusive License", ASSIGNMENT: "Assignment",
  TECHNOLOGY_TRANSFER: "Technology Transfer", STARTUP_COMMERCIALIZATION: "Startup Commercialization",
};

function toNumberOrUndefined(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

// Resizes a list to exactly `count` items, trimming from the end or padding
// with `empty` - backs the "No. of Applicants/Inventors" number boxes, which
// drive how many detail rows show rather than a free Add/Remove button.
function resizeArray<T>(arr: T[], count: number, empty: T): T[] {
  if (arr.length === count) return arr;
  if (arr.length > count) return arr.slice(0, count);
  return [...arr, ...Array.from({ length: count - arr.length }, () => ({ ...empty }))];
}

// Exact copy of PublicationDetailsForm.tsx's AuthorFields, Author renamed to
// Inventor throughout - same Nature of Inventor (Internal/External) split,
// same Faculty ID lookup for Internal, same two-step Affiliation (a college
// elsewhere in this project, or "Others" free text + country) for External.
function InventorFields({
  inventor, update, colleges, ownCollegeId,
}: {
  inventor: IprInventor;
  update: (patch: Partial<IprInventor>) => void;
  colleges: CollegeOption[];
  ownCollegeId: string;
}) {
  const otherColleges = colleges.filter((c) => c.id !== ownCollegeId);
  // The list only offers colleges of this college's own Main/Test category. An affiliation saved earlier for a college
  // that is no longer offered keeps showing (from its stored name) instead of turning blank - display only, never rewritten.
  const savedCollegeId = inventor.affiliationCollegeId;
  const selectableColleges =
    savedCollegeId && savedCollegeId !== OTHERS_COLLEGE_ID && savedCollegeId !== ownCollegeId && inventor.affiliationCollegeName && !otherColleges.some((c) => c.id === savedCollegeId)
      ? [...otherColleges, { id: savedCollegeId, name: inventor.affiliationCollegeName }]
      : otherColleges;
  const scope: "PROJECT" | "OTHERS" = inventor.affiliationCollegeId === OTHERS_COLLEGE_ID ? "OTHERS" : "PROJECT";

  function onAffiliationScopeChange(next: "PROJECT" | "OTHERS") {
    if (next === "OTHERS") {
      update({ affiliationCollegeId: OTHERS_COLLEGE_ID, affiliationCollegeName: "" });
    } else {
      update({ affiliationCollegeId: undefined, affiliationCollegeName: "", affiliationCountry: undefined });
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label className="text-xs">Inventor Position</Label>
        <Select value={inventor.category} onValueChange={(v) => update({ category: v as AuthorCategory })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(INVENTOR_CATEGORY_LABELS) as InventorCategory[]).map((c) => <SelectItem key={c} value={c}>{INVENTOR_CATEGORY_LABELS[c]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Nature of Inventor</Label>
        <Select
          value={inventor.isInternal ? "INTERNAL" : "EXTERNAL"}
          onValueChange={(v) => update(
            v === "INTERNAL"
              ? { isInternal: true, name: "", facultyId: "", studentRegistrationNumber: "", authorType: "FACULTY", affiliationCollegeId: undefined, affiliationCollegeName: "", affiliationCountry: undefined }
              : { isInternal: false, name: "", facultyId: undefined, studentRegistrationNumber: undefined }
          )}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="INTERNAL">Internal Inventor</SelectItem>
            <SelectItem value="EXTERNAL">External Inventor</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {inventor.isInternal ? (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Inventor Type</Label>
            <Select
              value={inventor.authorType}
              onValueChange={(v) => update({ authorType: v as AuthorRoleType, name: "", facultyId: "", studentRegistrationNumber: "" })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(INVENTOR_TYPE_LABELS) as AuthorRoleType[]).map((t) => <SelectItem key={t} value={t}>{INVENTOR_TYPE_LABELS[t]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {inventor.authorType === "FACULTY" ? (
            <InternalFacultyPicker
              facultyId={inventor.facultyId ?? ""}
              allowFormer
              label={<>Faculty<RequiredMark required /></>}
              onPick={(p) => update({ facultyId: p.facultyId, name: p.name })}
            />
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Name of the Inventor<RequiredMark required /></Label>
                <Input value={inventor.name} onChange={(e) => update({ name: e.target.value })} placeholder="Student name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Student Registration Number <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input value={inventor.studentRegistrationNumber ?? ""} onChange={(e) => update({ studentRegistrationNumber: e.target.value })} />
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Name of the Inventor<RequiredMark required /></Label>
            <Input value={inventor.name} onChange={(e) => update({ name: e.target.value })} placeholder="Inventor name" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Affiliation</Label>
            <Select value={scope} onValueChange={(v) => onAffiliationScopeChange(v as "PROJECT" | "OTHERS")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PROJECT">SVES</SelectItem>
                <SelectItem value="OTHERS">Others</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scope === "PROJECT" ? (
            <div className="space-y-1.5">
              <Label className="text-xs">College<RequiredMark required /></Label>
              <Select
                value={inventor.affiliationCollegeId ?? ""}
                onValueChange={(id) => update({ affiliationCollegeId: id, affiliationCollegeName: otherColleges.find((c) => c.id === id)?.name ?? "" })}
              >
                <SelectTrigger><SelectValue placeholder="Select college" /></SelectTrigger>
                <SelectContent>
                  {selectableColleges.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Affiliation Name<RequiredMark required /></Label>
                <Input value={inventor.affiliationCollegeName} onChange={(e) => update({ affiliationCollegeName: e.target.value })} placeholder="College/university name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Country</Label>
                <Input value={inventor.affiliationCountry ?? ""} onChange={(e) => update({ affiliationCountry: e.target.value })} placeholder="Country" />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function DiscoveryInnovationRow({
  record, isOwnProfile, onEdit,
}: {
  record: DiscoveryInnovationRequest;
  isOwnProfile?: boolean;
  onEdit?: (record: DiscoveryInnovationRequest) => void;
}) {
  // Also listed for a Co-PI / inventor named on it: they see it (and where it stands) but only the submitter edits.
  const viewerUid = useAuthStore((s) => s.user?.uid);
  const isSubmitter = record.uid === viewerUid;
  return (
    <div className="rounded-md border bg-muted/20 shadow-sm p-2 space-y-2">
      {isOwnProfile && !isSubmitter && (
        <p className="text-xs text-muted-foreground">Submitted by {record.ownerName}</p>
      )}
      {isOwnProfile && (
        <div className="flex items-center gap-2">
          {record.status === "PENDING" && <Badge variant="pending" className="text-xs">Pending Verification</Badge>}
          {record.status === "COORDINATOR_REVIEW" && <Badge variant="pending" className="text-xs">With R&amp;D Coordinator</Badge>}
          {record.status === "REJECTED" && <Badge variant="rejected" className="text-xs">Rejected</Badge>}
          {record.status === "SENT_BACK" && <Badge variant="rejected" className="text-xs">Sent Back</Badge>}
          {onEdit && isSubmitter && (
            <button type="button" onClick={() => onEdit(record)} className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1">
              <Pencil className="h-3 w-3" />
              {record.status === "REJECTED" || record.status === "SENT_BACK"
                ? "Edit & Resubmit"
                : record.status === "PENDING" || record.status === "COORDINATOR_REVIEW"
                  ? "Edit"
                  : "Edit (sends for re-verification)"}
            </button>
          )}
        </div>
      )}
      {record.status === "REJECTED" && record.rejectionReason && (
        <p className="text-xs text-destructive">Reason: {record.rejectionReason}</p>
      )}
      {record.status === "SENT_BACK" && record.sentBackReason && (
        <p className="text-xs text-destructive">Sent back: {record.sentBackReason}</p>
      )}
      <div className="@container">
        <div className={`grid gap-2 ${FACT_GRID_COLS_4}`}>
          <Field label="Title" value={record.title} />
          <Field label="Type of IPR" value={IPR_TYPE_LABELS[record.iprType]} />
          <Field label="Status" value={record.iprStatus === "GRANTED" ? "Granted" : "Published"} />
          <Field label="Application Number" value={record.applicationNumber} />
          <Field label="Date of Filing" value={record.dateOfFiling} />
          <Field label="Commercialized" value={record.isCommercialized} />
          <Field label="SDGs Mapped" value={record.sdgGoals.length > 0 ? record.sdgGoals.join(", ") : undefined} />
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        {record.publishedProofUrl && (
          <a href={record.publishedProofUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Published Proof
          </a>
        )}
        {record.grantedProofUrl && (
          <a href={record.grantedProofUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Granted Proof
          </a>
        )}
        {record.commercializedProofUrl && (
          <a href={record.commercializedProofUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Commercialized Proof
          </a>
        )}
        {record.revenueGeneratedProofUrl && (
          <a href={record.revenueGeneratedProofUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Revenue Proof
          </a>
        )}
      </div>
    </div>
  );
}

interface RecordFormState {
  iprType: IprType | "";
  iprStatus: IprStatus | "";
  applicationNumber: string;
  title: string;
  sdgGoals: number[];
  dateOfFiling: string;
  datePublished: string;
  dateGranted: string;
  applicantsCount: string;
  applicants: IprApplicant[];
  inventorsCount: string;
  inventors: IprInventor[];
  publishedProofUrl: string;
  grantedProofUrl: string;
  isCommercialized: "YES" | "NO" | "";
  commercializationStatus: IprCommercializationStatus | "";
  commercializationDate: string;
  licenseePartner: string;
  commercializationType: IprCommercializationType | "";
  commercializationValue: string;
  revenueGenerated: string;
  commercializedProofUrl: string;
  revenueGeneratedProofUrl: string;
}

function initialFormState(editing: DiscoveryInnovationRequest | null): RecordFormState {
  const n = (v: number | undefined) => (v !== undefined ? String(v) : "");
  if (!editing) {
    return {
      iprType: "", iprStatus: "", applicationNumber: "", title: "", sdgGoals: [], dateOfFiling: "",
      datePublished: "", dateGranted: "", applicantsCount: "", applicants: [], inventorsCount: "", inventors: [],
      publishedProofUrl: "", grantedProofUrl: "", isCommercialized: "",
      commercializationStatus: "", commercializationDate: "", licenseePartner: "", commercializationType: "",
      commercializationValue: "", revenueGenerated: "", commercializedProofUrl: "", revenueGeneratedProofUrl: "",
    };
  }
  return {
    iprType: editing.iprType, iprStatus: editing.iprStatus, applicationNumber: editing.applicationNumber,
    title: editing.title, sdgGoals: editing.sdgGoals ?? [], dateOfFiling: editing.dateOfFiling,
    datePublished: editing.datePublished ?? "", dateGranted: editing.dateGranted ?? "",
    applicantsCount: n(editing.applicantsCount), applicants: editing.applicants ?? [],
    inventorsCount: n(editing.inventorsCount),
    // A record saved before "Corresponding Inventor" was removed would otherwise
    // open with a blank Inventor Position.
    inventors: (editing.inventors ?? []).map((inv) => (
      inv.category === "CORRESPONDING_AUTHOR" ? { ...inv, category: "CO_AUTHOR" as const } : inv
    )),
    publishedProofUrl: editing.publishedProofUrl ?? "",
    grantedProofUrl: editing.grantedProofUrl ?? "", isCommercialized: editing.isCommercialized ?? "",
    commercializationStatus: editing.commercializationStatus ?? "", commercializationDate: editing.commercializationDate ?? "",
    licenseePartner: editing.licenseePartner ?? "", commercializationType: editing.commercializationType ?? "",
    commercializationValue: n(editing.commercializationValue), revenueGenerated: n(editing.revenueGenerated),
    commercializedProofUrl: editing.commercializedProofUrl ?? "", revenueGeneratedProofUrl: editing.revenueGeneratedProofUrl ?? "",
  };
}

function RecordFormFields({
  editingRecord, onCancel, onSaved,
}: {
  editingRecord: DiscoveryInnovationRequest | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<RecordFormState>(() => initialFormState(editingRecord));
  const [saving, setSaving] = useState(false);
  const editingId = editingRecord?.id ?? null;
  const colleges = useCollegeOptions();
  const ownCollegeId = useAuthStore((s) => s.user?.collegeId ?? "");

  function set<K extends keyof RecordFormState>(key: K, value: RecordFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Digits only, clamped to MAX_COUNT. Clearing the box keeps the rows already
  // filled in (so backspace-and-retype doesn't wipe them) - the empty count
  // itself is what keeps the form invalid.
  function normalizeCount(raw: string): string {
    const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
    return digits === "" ? "" : String(Math.min(Number(digits), MAX_COUNT));
  }

  function setApplicantsCount(raw: string) {
    const v = normalizeCount(raw);
    setForm((f) => ({
      ...f, applicantsCount: v,
      applicants: v === "" ? f.applicants : resizeArray(f.applicants, Number(v), EMPTY_APPLICANT),
    }));
  }

  function setInventorsCount(raw: string) {
    const v = normalizeCount(raw);
    setForm((f) => ({
      ...f, inventorsCount: v,
      inventors: v === "" ? f.inventors : resizeArray(f.inventors, Number(v), EMPTY_INVENTOR),
    }));
  }

  function updateApplicant(i: number, patch: Partial<IprApplicant>) {
    setForm((f) => {
      const next = [...f.applicants];
      next[i] = { ...next[i], ...patch };
      return { ...f, applicants: next };
    });
  }

  function updateInventor(i: number, patch: Partial<IprInventor>) {
    setForm((f) => {
      const next = [...f.inventors];
      next[i] = { ...next[i], ...patch };
      return { ...f, inventors: next };
    });
  }

  // Every field is compulsory except Commercialization (isCommercialized and
  // everything under it) - mirrors the server-side check in
  // validateDiscoveryInnovationBody (src/lib/research/validateDiscoveryInnovation.ts).
  const applicantsValid = form.applicants.length > 0 && form.applicants.every((a) => a.name.trim().length > 0);
  const inventorsValid = form.inventors.length > 0 && form.inventors.every((inv) => {
    if (!inv.name.trim()) return false;
    // A student inventor needs only a name (the registration number is optional), an internal faculty one a picked person.
    if (inv.isInternal) return inv.authorType === "FACULTY" ? !!inv.facultyId?.trim() : true;
    return !!inv.affiliationCollegeName.trim();
  });
  const isValid =
    !!form.iprType && !!form.iprStatus && form.applicationNumber.trim().length > 1 &&
    form.title.trim().length > 1 && !!form.dateOfFiling && !!form.datePublished &&
    (form.iprStatus !== "GRANTED" || !!form.dateGranted) &&
    form.sdgGoals.length > 0 &&
    !!form.applicantsCount && applicantsValid &&
    !!form.inventorsCount && inventorsValid &&
    !!form.publishedProofUrl && (form.iprStatus !== "GRANTED" || !!form.grantedProofUrl);

  async function handleSubmit() {
    if (!isValid) return;
    setSaving(true);
    try {
      const body = {
        iprType: form.iprType || undefined,
        iprStatus: form.iprStatus || undefined,
        applicationNumber: form.applicationNumber.trim(),
        title: form.title.trim(),
        sdgGoals: form.sdgGoals,
        dateOfFiling: form.dateOfFiling,
        datePublished: form.datePublished || undefined,
        dateGranted: form.dateGranted || undefined,
        applicantsCount: toNumberOrUndefined(form.applicantsCount),
        applicants: form.applicants,
        inventorsCount: toNumberOrUndefined(form.inventorsCount),
        inventors: form.inventors,
        publishedProofUrl: form.publishedProofUrl || undefined,
        grantedProofUrl: form.grantedProofUrl || undefined,
        isCommercialized: form.isCommercialized || undefined,
        commercializationStatus: form.commercializationStatus || undefined,
        commercializationDate: form.commercializationDate || undefined,
        licenseePartner: form.licenseePartner.trim(),
        commercializationType: form.commercializationType || undefined,
        commercializationValue: toNumberOrUndefined(form.commercializationValue),
        revenueGenerated: toNumberOrUndefined(form.revenueGenerated),
        commercializedProofUrl: form.commercializedProofUrl || undefined,
        revenueGeneratedProofUrl: form.revenueGeneratedProofUrl || undefined,
      };
      const res = editingId
        ? await fetch(`/api/college/discovery-innovation/${editingId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          })
        : await fetch("/api/college/discovery-innovation", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        toast({ variant: "destructive", title: "Failed to save IPR record", description: json.error });
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
        <DialogTitle>{editingId ? "Edit & Resubmit IPR Record" : "Add Discovery & Innovation (IPR)"}</DialogTitle>
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
            <div className="space-y-2">
              <Label>Type of IPR<RequiredMark required /></Label>
              <Select value={form.iprType} onValueChange={(v) => set("iprType", v as IprType)}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(IPR_TYPE_LABELS) as IprType[]).map((t) => <SelectItem key={t} value={t}>{IPR_TYPE_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status of IPR<RequiredMark required /></Label>
              <Select value={form.iprStatus} onValueChange={(v) => set("iprStatus", v as IprStatus)}>
                <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PUBLISHED">Published</SelectItem>
                  <SelectItem value="GRANTED">Granted</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <TextInput label="Application Number of IPR" value={form.applicationNumber} onChange={(v) => set("applicationNumber", v)} required />
          <TextInput label="Title of the IPR" value={form.title} onChange={(v) => set("title", v)} required />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <DateInput label="Date of Filing" value={form.dateOfFiling} onChange={(v) => set("dateOfFiling", v)} required />
            <DateInput label="Date of Published" value={form.datePublished} onChange={(v) => set("datePublished", v)} required />
            {form.iprStatus === "GRANTED" && (
              <DateInput label="Date of Granted" value={form.dateGranted} onChange={(v) => set("dateGranted", v)} required />
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label>SDG Mapped<RequiredMark required /></Label>
          <SdgPicker selected={form.sdgGoals} onChange={(v) => set("sdgGoals", v)} />
        </div>

        <div className="space-y-4">
          <SubLabel>Applicants</SubLabel>
          <div className="space-y-2 max-w-[200px]">
            <Label>No. of Applicants<RequiredMark required /></Label>
            <Input
              type="number" inputMode="numeric" min={1} max={MAX_COUNT} step={1}
              value={form.applicantsCount} onChange={(e) => setApplicantsCount(e.target.value)}
              placeholder="Enter number"
            />
          </div>
          {form.applicants.map((a, i) => (
            <div key={i} className="grid grid-cols-1 gap-3 sm:grid-cols-2 rounded-md bg-muted/30 p-3">
              <TextInput label={`Name of Applicant ${i + 1}`} value={a.name} onChange={(v) => updateApplicant(i, { name: v })} required />
              <div className="space-y-2">
                <Label>Type of Applicant</Label>
                <Select value={a.type} onValueChange={(v) => updateApplicant(i, { type: v as IprApplicantType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(APPLICANT_TYPE_LABELS) as IprApplicantType[]).map((t) => <SelectItem key={t} value={t}>{APPLICANT_TYPE_LABELS[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <SubLabel>Inventors</SubLabel>
          <div className="space-y-2 max-w-[200px]">
            <Label>No. of Inventors<RequiredMark required /></Label>
            <Input
              type="number" inputMode="numeric" min={1} max={MAX_COUNT} step={1}
              value={form.inventorsCount} onChange={(e) => setInventorsCount(e.target.value)}
              placeholder="Enter number"
            />
          </div>
          {form.inventors.map((inv, i) => (
            <div key={i} className="rounded-md bg-muted/30 p-3">
              <InventorFields inventor={inv} update={(patch) => updateInventor(i, patch)} colleges={colleges} ownCollegeId={ownCollegeId} />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-5">
        <div className="space-y-4">
          <SubLabel>Proof of Filing</SubLabel>
          <DocumentUploadField
            label="Published Proof"
            required
            value={form.publishedProofUrl}
            uploadEndpoint="/api/upload/ipr-doc"
            extraFields={{ kind: "published-proof" }}
            onUploaded={(url) => set("publishedProofUrl", url)}
            onRemoved={() => set("publishedProofUrl", "")}
          />
          {form.iprStatus === "GRANTED" && (
            <DocumentUploadField
              label="Granted Proof"
              required
              value={form.grantedProofUrl}
              uploadEndpoint="/api/upload/ipr-doc"
              extraFields={{ kind: "granted-proof" }}
              onUploaded={(url) => set("grantedProofUrl", url)}
              onRemoved={() => set("grantedProofUrl", "")}
            />
          )}
        </div>

        <div className="space-y-4">
          <SubLabel>Commercialization</SubLabel>
          <div className="space-y-2 max-w-[200px]">
            <Label>Is the Patent Commercialized</Label>
            <Select value={form.isCommercialized} onValueChange={(v) => set("isCommercialized", v as "YES" | "NO")}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="YES">Yes</SelectItem>
                <SelectItem value="NO">No</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.isCommercialized === "YES" && (
            <div className="space-y-4 rounded-lg border p-3">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Commercialization Status</Label>
                  <Select value={form.commercializationStatus} onValueChange={(v) => set("commercializationStatus", v as IprCommercializationStatus)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(COMMERCIALIZATION_STATUS_LABELS) as IprCommercializationStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>{COMMERCIALIZATION_STATUS_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DateInput label="Commercialization Date" value={form.commercializationDate} onChange={(v) => set("commercializationDate", v)} />
              </div>
              <TextInput label="Licensee / Industry Partner" value={form.licenseePartner} onChange={(v) => set("licenseePartner", v)} placeholder="Company, startup, MSME, or organization" />
              <div className="space-y-2">
                <Label>Type of Commercialization</Label>
                <Select value={form.commercializationType} onValueChange={(v) => set("commercializationType", v as IprCommercializationType)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(COMMERCIALIZATION_TYPE_LABELS) as IprCommercializationType[]).map((t) => (
                      <SelectItem key={t} value={t}>{COMMERCIALIZATION_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <NumField label="Commercialization Value (Rs.)" value={form.commercializationValue} onChange={(v) => set("commercializationValue", v)} />
                <NumField label="Revenue Generated (Rs.)" value={form.revenueGenerated} onChange={(v) => set("revenueGenerated", v)} />
              </div>
              <DocumentUploadField
                label="Commercialized Proof"
                value={form.commercializedProofUrl}
                uploadEndpoint="/api/upload/ipr-doc"
                extraFields={{ kind: "commercialized-proof" }}
                onUploaded={(url) => set("commercializedProofUrl", url)}
                onRemoved={() => set("commercializedProofUrl", "")}
              />
              <DocumentUploadField
                label="Revenue Generated Proof"
                value={form.revenueGeneratedProofUrl}
                uploadEndpoint="/api/upload/ipr-doc"
                extraFields={{ kind: "revenue-proof" }}
                onUploaded={(url) => set("revenueGeneratedProofUrl", url)}
                onRemoved={() => set("revenueGeneratedProofUrl", "")}
              />
            </div>
          )}
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

function AddDiscoveryInnovationDialog({
  open, onOpenChange, editingRecord, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingRecord: DiscoveryInnovationRequest | null;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[1400px] h-[90vh] max-h-[90vh] flex flex-col overflow-hidden">
        {open && (
          <RecordFormFields
            editingRecord={editingRecord}
            onCancel={() => onOpenChange(false)}
            onSaved={() => { onOpenChange(false); onSaved(); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// Discovery & Innovation (IPR) - self-submitted, same PENDING/APPROVED/
// REJECTED verification flow as the other Research & Innovation tabs (see
// /api/college/discovery-innovation), a repeating list per person.
export function DiscoveryInnovationModuleView({ uid, isOwnProfile }: { uid?: string; isOwnProfile?: boolean }) {
  const [records, setRecords] = useState<DiscoveryInnovationRequest[] | null>(null);

  function load() {
    const url = uid ? `/api/college/discovery-innovation?uid=${encodeURIComponent(uid)}` : "/api/college/discovery-innovation";
    fetch(url)
      .then((r) => r.json() as Promise<{ records?: DiscoveryInnovationRequest[] }>)
      .then((d) => setRecords(d.records ?? []))
      .catch(() => setRecords([]));
  }

  useEffect(() => { load(); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  return <DiscoveryInnovationSection records={records} isOwnProfile={isOwnProfile} onChanged={load} />;
}

export function DiscoveryInnovationSection({
  records, isOwnProfile, onChanged,
}: {
  records: DiscoveryInnovationRequest[] | null;
  isOwnProfile?: boolean;
  onChanged?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<DiscoveryInnovationRequest | null>(null);

  const sorted = (records ?? []).slice();
  const visible = expanded ? sorted : sorted.slice(0, PREVIEW_COUNT);
  const hidden = sorted.length - PREVIEW_COUNT;

  function openAdd() {
    setEditingRecord(null);
    setFormOpen(true);
  }

  function openEdit(record: DiscoveryInnovationRequest) {
    setEditingRecord(record);
    setFormOpen(true);
  }

  return (
    <Section number={3} title="Discovery & Innovation (IPR)">
      <div className="flex items-center justify-between">
        <SubLabel>Records</SubLabel>
        {isOwnProfile && (
          <Button variant="outline" size="sm" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add IPR Record
          </Button>
        )}
      </div>
      {records === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">None recorded.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((record) => <DiscoveryInnovationRow key={record.id} record={record} isOwnProfile={isOwnProfile} onEdit={openEdit} />)}
          {sorted.length > PREVIEW_COUNT && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-medium text-primary hover:underline">
              {expanded ? "Show less" : `Show ${hidden} more`}
            </button>
          )}
        </div>
      )}

      {isOwnProfile && (
        <AddDiscoveryInnovationDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          editingRecord={editingRecord}
          onSaved={() => onChanged?.()}
        />
      )}
    </Section>
  );
}
