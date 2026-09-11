"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Plus, Pencil } from "lucide-react";
import { Section, SubLabel, Field, TextInput, NumInput, DateInput, TableRepeatingGroup } from "@/components/shared/ProfileFieldPrimitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DocumentUploadField } from "@/components/shared/DocumentUploadField";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import type {
  PhdAwardNature, PhdAwardType, PhdFellowshipType, PhdGuideStatus, PhdRecognizedSupervisor,
  PhdSupervisionRequest, SeedFundingPaperItem, SeedFundingPatentItem,
} from "@/types";

const PREVIEW_COUNT = 3;
const EMPTY_PAPER: SeedFundingPaperItem = { title: "", journalOrConference: "" };
const EMPTY_PATENT: SeedFundingPatentItem = { applicationNo: "", applicantName: "", patentTitle: "", inventorDetails: "", status: "" };

function toNumberOrUndefined(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

function PhdSupervisionRow({
  record, isOwnProfile, onEdit,
}: {
  record: PhdSupervisionRequest;
  isOwnProfile?: boolean;
  onEdit?: (record: PhdSupervisionRequest) => void;
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
        <Field label="Name of the Scholar" value={record.scholarName} />
        <Field label="Status of Guide" value={record.guideStatus === "SUPERVISOR" ? "Supervisor" : "Co-Supervisor"} />
        <Field label="Recognized Supervisor" value={record.recognizedSupervisor === "JNTUK" ? "JNTUK" : record.otherUniversityName || "Other"} />
        <Field label="Department" value={record.scholarDepartment} />
        <Field label="Year of Allocation" value={record.yearOfAllocation} />
        <Field label="Years Completed" value={record.yearsCompleted} />
        <Field label="Degree Awarded" value={record.degreeAwarded} />
        <Field label="Date of Award" value={record.dateOfAward} />
      </div>
      <div className="flex flex-wrap gap-3">
        {record.allotmentOrderUrl && (
          <a href={record.allotmentOrderUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Allotment Order
          </a>
        )}
        {record.awardedDegreeProofUrl && (
          <a href={record.awardedDegreeProofUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Awarded Degree
          </a>
        )}
      </div>
    </div>
  );
}

interface RecordFormState {
  recognizedSupervisor: PhdRecognizedSupervisor | "";
  otherUniversityName: string;
  guideStatus: PhdGuideStatus | "";
  scholarName: string;
  scholarDepartment: string;
  scholarAffiliation: string;
  scholarPhone: string;
  yearOfAllocation: string;
  allotmentOrderUrl: string;
  yearsCompleted: string;
  degreeAwarded: "YES" | "NO" | "";
  dateOfAward: string;
  awardedDegreeProofUrl: string;
  papersPublished: SeedFundingPaperItem[];
  patents: SeedFundingPatentItem[];
  fellowshipReceived: "YES" | "NO" | "";
  fellowshipType: PhdFellowshipType | "";
  fellowshipName: string;
  fellowshipAmount: string;
  awardsReceived: "YES" | "NO" | "";
  awardName: string;
  awardType: PhdAwardType | "";
  awardNature: PhdAwardNature | "";
  awardDetails: string;
}

function initialFormState(editing: PhdSupervisionRequest | null): RecordFormState {
  const n = (v: number | undefined) => (v !== undefined ? String(v) : "");
  if (!editing) {
    return {
      recognizedSupervisor: "", otherUniversityName: "", guideStatus: "", scholarName: "", scholarDepartment: "",
      scholarAffiliation: "", scholarPhone: "", yearOfAllocation: "", allotmentOrderUrl: "", yearsCompleted: "",
      degreeAwarded: "", dateOfAward: "", awardedDegreeProofUrl: "", papersPublished: [], patents: [],
      fellowshipReceived: "", fellowshipType: "", fellowshipName: "", fellowshipAmount: "",
      awardsReceived: "", awardName: "", awardType: "", awardNature: "", awardDetails: "",
    };
  }
  return {
    recognizedSupervisor: editing.recognizedSupervisor, otherUniversityName: editing.otherUniversityName ?? "",
    guideStatus: editing.guideStatus, scholarName: editing.scholarName, scholarDepartment: editing.scholarDepartment ?? "",
    scholarAffiliation: editing.scholarAffiliation ?? "", scholarPhone: editing.scholarPhone ?? "",
    yearOfAllocation: editing.yearOfAllocation ?? "", allotmentOrderUrl: editing.allotmentOrderUrl ?? "",
    yearsCompleted: n(editing.yearsCompleted), degreeAwarded: editing.degreeAwarded ?? "",
    dateOfAward: editing.dateOfAward ?? "", awardedDegreeProofUrl: editing.awardedDegreeProofUrl ?? "",
    papersPublished: editing.papersPublished ?? [], patents: editing.patents ?? [],
    fellowshipReceived: editing.fellowshipReceived ?? "", fellowshipType: editing.fellowshipType ?? "",
    fellowshipName: editing.fellowshipName ?? "", fellowshipAmount: n(editing.fellowshipAmount),
    awardsReceived: editing.awardsReceived ?? "", awardName: editing.awardName ?? "",
    awardType: editing.awardType ?? "", awardNature: editing.awardNature ?? "", awardDetails: editing.awardDetails ?? "",
  };
}

function RecordFormFields({
  editingRecord, onCancel, onSaved,
}: {
  editingRecord: PhdSupervisionRequest | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<RecordFormState>(() => initialFormState(editingRecord));
  const [saving, setSaving] = useState(false);
  const editingId = editingRecord?.id ?? null;

  function set<K extends keyof RecordFormState>(key: K, value: RecordFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const isValid = !!form.recognizedSupervisor && !!form.guideStatus && form.scholarName.trim().length > 1;

  async function handleSubmit() {
    if (!isValid) return;
    setSaving(true);
    try {
      const body = {
        recognizedSupervisor: form.recognizedSupervisor || undefined,
        otherUniversityName: form.otherUniversityName.trim(),
        guideStatus: form.guideStatus || undefined,
        scholarName: form.scholarName.trim(),
        scholarDepartment: form.scholarDepartment.trim(),
        scholarAffiliation: form.scholarAffiliation.trim(),
        scholarPhone: form.scholarPhone.trim(),
        yearOfAllocation: form.yearOfAllocation.trim(),
        allotmentOrderUrl: form.allotmentOrderUrl || undefined,
        yearsCompleted: toNumberOrUndefined(form.yearsCompleted),
        degreeAwarded: form.degreeAwarded || undefined,
        dateOfAward: form.dateOfAward || undefined,
        awardedDegreeProofUrl: form.awardedDegreeProofUrl || undefined,
        papersPublished: form.papersPublished,
        patents: form.patents,
        fellowshipReceived: form.fellowshipReceived || undefined,
        fellowshipType: form.fellowshipType || undefined,
        fellowshipName: form.fellowshipName.trim(),
        fellowshipAmount: toNumberOrUndefined(form.fellowshipAmount),
        awardsReceived: form.awardsReceived || undefined,
        awardName: form.awardName.trim(),
        awardType: form.awardType || undefined,
        awardNature: form.awardNature || undefined,
        awardDetails: form.awardDetails.trim(),
      };
      const res = editingId
        ? await fetch(`/api/college/phd-supervision/${editingId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          })
        : await fetch("/api/college/phd-supervision", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        toast({ variant: "destructive", title: "Failed to save record", description: json.error });
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
        <DialogTitle>{editingId ? "Edit & Resubmit Ph.D. Supervision Record" : "Add Ph.D. Supervision Record"}</DialogTitle>
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
          <SubLabel>Supervision</SubLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Recognized Supervisor</Label>
              <Select value={form.recognizedSupervisor} onValueChange={(v) => set("recognizedSupervisor", v as PhdRecognizedSupervisor)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="JNTUK">JNTUK</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.recognizedSupervisor === "OTHER" && (
              <TextInput label="Mention the University" value={form.otherUniversityName} onChange={(v) => set("otherUniversityName", v)} />
            )}
          </div>
          <div className="space-y-2">
            <Label>Status of Guide</Label>
            <Select value={form.guideStatus} onValueChange={(v) => set("guideStatus", v as PhdGuideStatus)}>
              <SelectTrigger className="max-w-[220px]"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SUPERVISOR">Supervisor</SelectItem>
                <SelectItem value="CO_SUPERVISOR">Co-Supervisor</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-4">
          <SubLabel>Scholar Details</SubLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput label="Name of the Scholar" value={form.scholarName} onChange={(v) => set("scholarName", v)} />
            <TextInput label="Department of Scholar" value={form.scholarDepartment} onChange={(v) => set("scholarDepartment", v)} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput label="Affiliation of Scholar" value={form.scholarAffiliation} onChange={(v) => set("scholarAffiliation", v)} />
            <TextInput label="Phone Number of Scholar" value={form.scholarPhone} onChange={(v) => set("scholarPhone", v)} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput label="Year of Scholar Allocation" value={form.yearOfAllocation} onChange={(v) => set("yearOfAllocation", v)} placeholder="e.g. 2022" />
            <NumInput label="No. of Years Completed" value={toNumberOrUndefined(form.yearsCompleted)} onChange={(v) => set("yearsCompleted", String(v))} />
          </div>
          <DocumentUploadField
            label="Allotment Order"
            value={form.allotmentOrderUrl}
            uploadEndpoint="/api/upload/phd-doc"
            extraFields={{ kind: "allotment-order" }}
            onUploaded={(url) => set("allotmentOrderUrl", url)}
            onRemoved={() => set("allotmentOrderUrl", "")}
          />
        </div>

        <div className="space-y-4">
          <SubLabel>Degree Status</SubLabel>
          <div className="space-y-2 max-w-[200px]">
            <Label>Is the Degree Awarded</Label>
            <Select value={form.degreeAwarded} onValueChange={(v) => set("degreeAwarded", v as "YES" | "NO")}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="YES">Yes</SelectItem>
                <SelectItem value="NO">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.degreeAwarded === "YES" && (
            <div className="space-y-4 rounded-lg border p-3">
              <DateInput label="Date of Awarded" value={form.dateOfAward} onChange={(v) => set("dateOfAward", v)} />
              <DocumentUploadField
                label="Awarded Degree"
                value={form.awardedDegreeProofUrl}
                uploadEndpoint="/api/upload/phd-doc"
                extraFields={{ kind: "awarded-degree" }}
                onUploaded={(url) => set("awardedDegreeProofUrl", url)}
                onRemoved={() => set("awardedDegreeProofUrl", "")}
              />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-5">
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
          <SubLabel>Fellowship</SubLabel>
          <div className="space-y-2 max-w-[200px]">
            <Label>Any Fellowship Received</Label>
            <Select value={form.fellowshipReceived} onValueChange={(v) => set("fellowshipReceived", v as "YES" | "NO")}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="YES">Yes</SelectItem>
                <SelectItem value="NO">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.fellowshipReceived === "YES" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 rounded-lg border p-3">
              <div className="space-y-2">
                <Label>Type of Fellowship</Label>
                <Select value={form.fellowshipType} onValueChange={(v) => set("fellowshipType", v as PhdFellowshipType)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NATIONAL">National</SelectItem>
                    <SelectItem value="INTERNATIONAL">International</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <TextInput label="Name of Fellowship" value={form.fellowshipName} onChange={(v) => set("fellowshipName", v)} />
              <NumInput label="Amount Received (Rs.)" value={toNumberOrUndefined(form.fellowshipAmount)} onChange={(v) => set("fellowshipAmount", String(v))} />
            </div>
          )}
        </div>

        <div className="space-y-4">
          <SubLabel>Awards</SubLabel>
          <div className="space-y-2 max-w-[200px]">
            <Label>Awards Received by Scholar</Label>
            <Select value={form.awardsReceived} onValueChange={(v) => set("awardsReceived", v as "YES" | "NO")}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="YES">Yes</SelectItem>
                <SelectItem value="NO">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.awardsReceived === "YES" && (
            <div className="space-y-4 rounded-lg border p-3">
              <TextInput label="Name of the Award" value={form.awardName} onChange={(v) => set("awardName", v)} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Type of Award</Label>
                  <Select value={form.awardType} onValueChange={(v) => set("awardType", v as PhdAwardType)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NATIONAL">National</SelectItem>
                      <SelectItem value="INTERNATIONAL">International</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Nature of Award</Label>
                  <Select value={form.awardNature} onValueChange={(v) => set("awardNature", v as PhdAwardNature)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GOVERNMENT">Government</SelectItem>
                      <SelectItem value="PRIVATE">Private</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <TextInput label="Details of Award" value={form.awardDetails} onChange={(v) => set("awardDetails", v)} />
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

function AddPhdSupervisionDialog({
  open, onOpenChange, editingRecord, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingRecord: PhdSupervisionRequest | null;
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

// Ph.D. Supervision & Guidance - self-submitted, same PENDING/APPROVED/
// REJECTED verification flow as the other Research & Innovation tabs (see
// /api/college/phd-supervision), a repeating list per person (one entry per
// scholar guided).
export function PhdSupervisionModuleView({ uid, isOwnProfile }: { uid?: string; isOwnProfile?: boolean }) {
  const [records, setRecords] = useState<PhdSupervisionRequest[] | null>(null);

  function load() {
    const url = uid ? `/api/college/phd-supervision?uid=${encodeURIComponent(uid)}` : "/api/college/phd-supervision";
    fetch(url)
      .then((r) => r.json() as Promise<{ records?: PhdSupervisionRequest[] }>)
      .then((d) => setRecords(d.records ?? []))
      .catch(() => setRecords([]));
  }

  useEffect(() => { load(); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  return <PhdSupervisionSection records={records} isOwnProfile={isOwnProfile} onChanged={load} />;
}

export function PhdSupervisionSection({
  records, isOwnProfile, onChanged,
}: {
  records: PhdSupervisionRequest[] | null;
  isOwnProfile?: boolean;
  onChanged?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<PhdSupervisionRequest | null>(null);

  const sorted = (records ?? []).slice();
  const visible = expanded ? sorted : sorted.slice(0, PREVIEW_COUNT);
  const hidden = sorted.length - PREVIEW_COUNT;

  function openAdd() {
    setEditingRecord(null);
    setFormOpen(true);
  }

  function openEdit(record: PhdSupervisionRequest) {
    setEditingRecord(record);
    setFormOpen(true);
  }

  return (
    <Section number={3} title="Ph.D. Supervision & Guidance">
      <div className="flex items-center justify-between">
        <SubLabel>Scholars Guided</SubLabel>
        {isOwnProfile && (
          <Button variant="outline" size="sm" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add Scholar
          </Button>
        )}
      </div>
      {records === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">None recorded.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((record) => <PhdSupervisionRow key={record.id} record={record} isOwnProfile={isOwnProfile} onEdit={openEdit} />)}
          {sorted.length > PREVIEW_COUNT && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-medium text-primary hover:underline">
              {expanded ? "Show less" : `Show ${hidden} more`}
            </button>
          )}
        </div>
      )}

      {isOwnProfile && (
        <AddPhdSupervisionDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          editingRecord={editingRecord}
          onSaved={() => onChanged?.()}
        />
      )}
    </Section>
  );
}
