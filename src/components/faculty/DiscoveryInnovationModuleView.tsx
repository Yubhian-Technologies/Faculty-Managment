"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Plus, Pencil } from "lucide-react";
import { Section, SubLabel, Field, TextInput, NumInput, DateInput } from "@/components/shared/ProfileFieldPrimitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { DocumentUploadField } from "@/components/shared/DocumentUploadField";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import type {
  DiscoveryInnovationRequest, IprApplicant, IprApplicantType, IprCommercializationStatus,
  IprCommercializationType, IprInventor, IprStatus, IprType,
} from "@/types";

const PREVIEW_COUNT = 3;
const COUNT_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);

const EMPTY_APPLICANT: IprApplicant = { name: "", type: "INDIVIDUAL" };
const EMPTY_INVENTOR: IprInventor = { name: "", affiliation: "", state: "", country: "" };

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
// with `empty` - backs the "No. of Applicants/Inventors" dropdowns, which
// drive how many detail rows show rather than a free Add/Remove button.
function resizeArray<T>(arr: T[], count: number, empty: T): T[] {
  if (arr.length === count) return arr;
  if (arr.length > count) return arr.slice(0, count);
  return [...arr, ...Array.from({ length: count - arr.length }, () => ({ ...empty }))];
}

function DiscoveryInnovationRow({
  record, isOwnProfile, onEdit,
}: {
  record: DiscoveryInnovationRequest;
  isOwnProfile?: boolean;
  onEdit?: (record: DiscoveryInnovationRequest) => void;
}) {
  return (
    <div className="rounded-md border bg-muted/20 shadow-sm p-2 space-y-2">
      {isOwnProfile && record.status !== "APPROVED" && (
        <div className="flex items-center gap-2">
          {record.status === "PENDING" ? (
            <Badge variant="pending" className="text-xs">Pending Verification</Badge>
          ) : (
            <>
              <Badge variant="rejected" className="text-xs">Rejected</Badge>
              {onEdit && (
                <button type="button" onClick={() => onEdit(record)} className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1">
                  <Pencil className="h-3 w-3" />Edit &amp; Resubmit
                </button>
              )}
            </>
          )}
        </div>
      )}
      {record.status === "REJECTED" && record.rejectionReason && (
        <p className="text-xs text-destructive">Reason: {record.rejectionReason}</p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Title" value={record.title} />
        <Field label="Type of IPR" value={IPR_TYPE_LABELS[record.iprType]} />
        <Field label="Status" value={record.iprStatus === "GRANTED" ? "Granted" : "Published"} />
        <Field label="Application Number" value={record.applicationNumber} />
        <Field label="Date of Filing" value={record.dateOfFiling} />
        <Field label="Student Patent" value={record.isStudentPatent} />
        <Field label="Commercialized" value={record.isCommercialized} />
        <Field label="SDGs Mapped" value={record.sdgGoals.length > 0 ? record.sdgGoals.join(", ") : undefined} />
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
  isStudentPatent: "YES" | "NO" | "";
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
      isStudentPatent: "", publishedProofUrl: "", grantedProofUrl: "", isCommercialized: "",
      commercializationStatus: "", commercializationDate: "", licenseePartner: "", commercializationType: "",
      commercializationValue: "", revenueGenerated: "", commercializedProofUrl: "", revenueGeneratedProofUrl: "",
    };
  }
  return {
    iprType: editing.iprType, iprStatus: editing.iprStatus, applicationNumber: editing.applicationNumber,
    title: editing.title, sdgGoals: editing.sdgGoals ?? [], dateOfFiling: editing.dateOfFiling,
    datePublished: editing.datePublished ?? "", dateGranted: editing.dateGranted ?? "",
    applicantsCount: n(editing.applicantsCount), applicants: editing.applicants ?? [],
    inventorsCount: n(editing.inventorsCount), inventors: editing.inventors ?? [],
    isStudentPatent: editing.isStudentPatent ?? "", publishedProofUrl: editing.publishedProofUrl ?? "",
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

  function set<K extends keyof RecordFormState>(key: K, value: RecordFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setApplicantsCount(v: string) {
    const count = toNumberOrUndefined(v) ?? 0;
    setForm((f) => ({ ...f, applicantsCount: v, applicants: resizeArray(f.applicants, count, EMPTY_APPLICANT) }));
  }

  function setInventorsCount(v: string) {
    const count = toNumberOrUndefined(v) ?? 0;
    setForm((f) => ({ ...f, inventorsCount: v, inventors: resizeArray(f.inventors, count, EMPTY_INVENTOR) }));
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

  const isValid =
    !!form.iprType && !!form.iprStatus && form.applicationNumber.trim().length > 1 &&
    form.title.trim().length > 1 && !!form.dateOfFiling;

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
        isStudentPatent: form.isStudentPatent || undefined,
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
              <Label>Type of IPR</Label>
              <Select value={form.iprType} onValueChange={(v) => set("iprType", v as IprType)}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(IPR_TYPE_LABELS) as IprType[]).map((t) => <SelectItem key={t} value={t}>{IPR_TYPE_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status of IPR</Label>
              <Select value={form.iprStatus} onValueChange={(v) => set("iprStatus", v as IprStatus)}>
                <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PUBLISHED">Published</SelectItem>
                  <SelectItem value="GRANTED">Granted</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <TextInput label="Application Number of IPR" value={form.applicationNumber} onChange={(v) => set("applicationNumber", v)} />
          <TextInput label="Title of the IPR" value={form.title} onChange={(v) => set("title", v)} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <DateInput label="Date of Filing" value={form.dateOfFiling} onChange={(v) => set("dateOfFiling", v)} />
            <DateInput label="Date of Published" value={form.datePublished} onChange={(v) => set("datePublished", v)} />
            {form.iprStatus === "GRANTED" && (
              <DateInput label="Date of Granted" value={form.dateGranted} onChange={(v) => set("dateGranted", v)} />
            )}
          </div>
          <div className="space-y-2">
            <Label>Is this Student Patent</Label>
            <Select value={form.isStudentPatent} onValueChange={(v) => set("isStudentPatent", v as "YES" | "NO")}>
              <SelectTrigger className="max-w-[200px]"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="YES">Yes</SelectItem>
                <SelectItem value="NO">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>SDG Mapped</Label>
          <SdgPicker selected={form.sdgGoals} onChange={(v) => set("sdgGoals", v)} />
        </div>

        <div className="space-y-4">
          <SubLabel>Applicants</SubLabel>
          <div className="space-y-2 max-w-[200px]">
            <Label>No. of Applicants</Label>
            <Select value={form.applicantsCount} onValueChange={setApplicantsCount}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {COUNT_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {form.applicants.map((a, i) => (
            <div key={i} className="grid grid-cols-1 gap-3 sm:grid-cols-2 rounded-md bg-muted/30 p-3">
              <TextInput label={`Name of Applicant ${i + 1}`} value={a.name} onChange={(v) => updateApplicant(i, { name: v })} />
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
            <Label>No. of Inventors</Label>
            <Select value={form.inventorsCount} onValueChange={setInventorsCount}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {COUNT_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {form.inventors.map((inv, i) => (
            <div key={i} className="grid grid-cols-1 gap-3 sm:grid-cols-2 rounded-md bg-muted/30 p-3">
              <TextInput label={`Name of Inventor ${i + 1}`} value={inv.name} onChange={(v) => updateInventor(i, { name: v })} />
              <TextInput label="Affiliation" value={inv.affiliation} onChange={(v) => updateInventor(i, { affiliation: v })} />
              <TextInput label="State" value={inv.state} onChange={(v) => updateInventor(i, { state: v })} />
              <TextInput label="Country" value={inv.country} onChange={(v) => updateInventor(i, { country: v })} />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-5">
        <div className="space-y-4">
          <SubLabel>Proof of Filing</SubLabel>
          <DocumentUploadField
            label="Published Proof"
            value={form.publishedProofUrl}
            uploadEndpoint="/api/upload/ipr-doc"
            extraFields={{ kind: "published-proof" }}
            onUploaded={(url) => set("publishedProofUrl", url)}
            onRemoved={() => set("publishedProofUrl", "")}
          />
          {form.iprStatus === "GRANTED" && (
            <DocumentUploadField
              label="Granted Proof"
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
                <NumInput label="Commercialization Value (Rs.)" value={toNumberOrUndefined(form.commercializationValue)} onChange={(v) => set("commercializationValue", String(v))} />
                <NumInput label="Revenue Generated (Rs.)" value={toNumberOrUndefined(form.revenueGenerated)} onChange={(v) => set("revenueGenerated", String(v))} />
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
