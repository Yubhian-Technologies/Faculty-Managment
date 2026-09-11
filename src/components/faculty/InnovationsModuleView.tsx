"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Plus, Pencil } from "lucide-react";
import { Section, SubLabel, Field, TextInput, NumInput, RepeatingGroup } from "@/components/shared/ProfileFieldPrimitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DocumentUploadField } from "@/components/shared/DocumentUploadField";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import type { InnovationFacultyItem, InnovationRequest, InnovationType, InnovatorType } from "@/types";

const PREVIEW_COUNT = 3;
const EMPTY_FACULTY: InnovationFacultyItem = { name: "", department: "", contribution: "" };
const TRL_LEVELS = Array.from({ length: 9 }, (_, i) => String(i + 1));

const INNOVATION_TYPE_LABELS: Record<InnovationType, string> = {
  IDEA: "Idea", PROTOTYPE: "Prototype", BUSINESS_MODEL: "Business Model", STARTUP: "Start-up",
  HACKATHON: "Hackathon", IDEATHON: "Ideathon",
};

function toNumberOrUndefined(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

function InnovationRow({
  record, isOwnProfile, onEdit,
}: {
  record: InnovationRequest;
  isOwnProfile?: boolean;
  onEdit?: (record: InnovationRequest) => void;
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
        <Field label="Title" value={record.innovationTitle} />
        <Field label="Type" value={INNOVATION_TYPE_LABELS[record.innovationType]} />
        <Field label="Innovator" value={record.innovatorType === "STUDENT" ? record.studentName : "Faculty"} />
        <Field label="A.Y." value={record.academicYear} />
        <Field label="TRL Level" value={record.trlLevel} />
        <Field label="Prototype Developed" value={record.prototypeDeveloped} />
        <Field label="Start-up Formed" value={record.startupFormed} />
        <Field label="Presented in Competition" value={record.presentedInCompetition} />
      </div>
      {record.briefDescription && (
        <div>
          <p className="text-xs text-muted-foreground">Brief Description</p>
          <p className="text-sm">{record.briefDescription}</p>
        </div>
      )}
      {record.yuktiScreenshotUrl && (
        <a href={record.yuktiScreenshotUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
          <ExternalLink className="h-3.5 w-3.5" />YUKTI Status Screenshot
        </a>
      )}
    </div>
  );
}

interface RecordFormState {
  academicYear: string;
  innovatorType: InnovatorType | "";
  facultyInvolvedCount: string;
  facultyMembers: InnovationFacultyItem[];
  studentName: string;
  studentRegdNo: string;
  studentYearOfStudy: string;
  studentDepartment: string;
  facultyMentorName: string;
  innovationTitle: string;
  innovationType: InnovationType | "";
  problemStatement: string;
  briefDescription: string;
  trlLevel: string;
  prototypeDeveloped: "YES" | "NO" | "";
  prototypeDetails: string;
  businessModelDeveloped: "YES" | "NO" | "";
  businessModelDetails: string;
  startupFormed: "YES" | "NO" | "";
  startupName: string;
  incubationName: string;
  yuktiId: string;
  verifiedRecommendedYukti: "YES" | "NO" | "";
  yuktiScreenshotUrl: string;
  presentedInCompetition: "YES" | "NO" | "";
  competitionName: string;
  organizedBy: string;
  remarks: string;
}

function initialFormState(editing: InnovationRequest | null): RecordFormState {
  const n = (v: number | undefined) => (v !== undefined ? String(v) : "");
  const s = (v: string | undefined) => v ?? "";
  if (!editing) {
    return {
      academicYear: "", innovatorType: "", facultyInvolvedCount: "", facultyMembers: [], studentName: "",
      studentRegdNo: "", studentYearOfStudy: "", studentDepartment: "", facultyMentorName: "",
      innovationTitle: "", innovationType: "", problemStatement: "", briefDescription: "", trlLevel: "",
      prototypeDeveloped: "", prototypeDetails: "", businessModelDeveloped: "", businessModelDetails: "",
      startupFormed: "", startupName: "", incubationName: "", yuktiId: "", verifiedRecommendedYukti: "",
      yuktiScreenshotUrl: "", presentedInCompetition: "", competitionName: "", organizedBy: "", remarks: "",
    };
  }
  return {
    academicYear: editing.academicYear, innovatorType: editing.innovatorType,
    facultyInvolvedCount: n(editing.facultyInvolvedCount), facultyMembers: editing.facultyMembers ?? [],
    studentName: s(editing.studentName), studentRegdNo: s(editing.studentRegdNo),
    studentYearOfStudy: s(editing.studentYearOfStudy), studentDepartment: s(editing.studentDepartment),
    facultyMentorName: s(editing.facultyMentorName), innovationTitle: editing.innovationTitle,
    innovationType: editing.innovationType, problemStatement: s(editing.problemStatement),
    briefDescription: s(editing.briefDescription), trlLevel: s(editing.trlLevel),
    prototypeDeveloped: editing.prototypeDeveloped ?? "", prototypeDetails: s(editing.prototypeDetails),
    businessModelDeveloped: editing.businessModelDeveloped ?? "", businessModelDetails: s(editing.businessModelDetails),
    startupFormed: editing.startupFormed ?? "", startupName: s(editing.startupName),
    incubationName: s(editing.incubationName), yuktiId: s(editing.yuktiId),
    verifiedRecommendedYukti: editing.verifiedRecommendedYukti ?? "", yuktiScreenshotUrl: s(editing.yuktiScreenshotUrl),
    presentedInCompetition: editing.presentedInCompetition ?? "", competitionName: s(editing.competitionName),
    organizedBy: s(editing.organizedBy), remarks: s(editing.remarks),
  };
}

function RecordFormFields({
  editingRecord, onCancel, onSaved,
}: {
  editingRecord: InnovationRequest | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<RecordFormState>(() => initialFormState(editingRecord));
  const [saving, setSaving] = useState(false);
  const editingId = editingRecord?.id ?? null;

  function set<K extends keyof RecordFormState>(key: K, value: RecordFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const isValid =
    form.academicYear.trim().length > 1 && !!form.innovatorType &&
    form.innovationTitle.trim().length > 1 && !!form.innovationType;

  async function handleSubmit() {
    if (!isValid) return;
    setSaving(true);
    try {
      const body = {
        academicYear: form.academicYear.trim(),
        innovatorType: form.innovatorType || undefined,
        facultyInvolvedCount: toNumberOrUndefined(form.facultyInvolvedCount),
        facultyMembers: form.facultyMembers,
        studentName: form.studentName.trim(),
        studentRegdNo: form.studentRegdNo.trim(),
        studentYearOfStudy: form.studentYearOfStudy.trim(),
        studentDepartment: form.studentDepartment.trim(),
        facultyMentorName: form.facultyMentorName.trim(),
        innovationTitle: form.innovationTitle.trim(),
        innovationType: form.innovationType || undefined,
        problemStatement: form.problemStatement.trim(),
        briefDescription: form.briefDescription.trim(),
        trlLevel: form.trlLevel,
        prototypeDeveloped: form.prototypeDeveloped || undefined,
        prototypeDetails: form.prototypeDetails.trim(),
        businessModelDeveloped: form.businessModelDeveloped || undefined,
        businessModelDetails: form.businessModelDetails.trim(),
        startupFormed: form.startupFormed || undefined,
        startupName: form.startupName.trim(),
        incubationName: form.incubationName.trim(),
        yuktiId: form.yuktiId.trim(),
        verifiedRecommendedYukti: form.verifiedRecommendedYukti || undefined,
        yuktiScreenshotUrl: form.yuktiScreenshotUrl || undefined,
        presentedInCompetition: form.presentedInCompetition || undefined,
        competitionName: form.competitionName.trim(),
        organizedBy: form.organizedBy.trim(),
        remarks: form.remarks.trim(),
      };
      const res = editingId
        ? await fetch(`/api/college/innovations/${editingId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          })
        : await fetch("/api/college/innovations", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        toast({ variant: "destructive", title: "Failed to save innovation record", description: json.error });
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
        <DialogTitle>{editingId ? "Edit & Resubmit Innovation Record" : "Add Innovation"}</DialogTitle>
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
            <TextInput label="Academic Year" value={form.academicYear} onChange={(v) => set("academicYear", v)} placeholder="e.g. 2024-25" />
            <div className="space-y-2">
              <Label>Type of Innovation</Label>
              <Select value={form.innovatorType} onValueChange={(v) => set("innovatorType", v as InnovatorType)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="STUDENT">Student</SelectItem>
                  <SelectItem value="FACULTY">Faculty</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.innovatorType === "FACULTY" && (
            <div className="space-y-4 rounded-lg border p-3">
              <NumInput label="No. of Faculty Involved" value={toNumberOrUndefined(form.facultyInvolvedCount)} onChange={(v) => set("facultyInvolvedCount", String(v))} />
              <RepeatingGroup
                title="Faculty Involved"
                items={form.facultyMembers}
                empty={EMPTY_FACULTY}
                onChange={(v) => set("facultyMembers", v)}
                addLabel="Add Faculty"
                renderRow={(item, update) => (
                  <>
                    <TextInput label="Name of the Faculty" value={item.name} onChange={(v) => update({ name: v })} />
                    <TextInput label="Dept. of Faculty" value={item.department} onChange={(v) => update({ department: v })} />
                    <TextInput label="Contribution" value={item.contribution} onChange={(v) => update({ contribution: v })} />
                  </>
                )}
              />
            </div>
          )}

          {form.innovatorType === "STUDENT" && (
            <div className="space-y-4 rounded-lg border p-3">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextInput label="Name of the Student" value={form.studentName} onChange={(v) => set("studentName", v)} />
                <TextInput label="Regd. No." value={form.studentRegdNo} onChange={(v) => set("studentRegdNo", v)} />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextInput label="Year of Study" value={form.studentYearOfStudy} onChange={(v) => set("studentYearOfStudy", v)} />
                <TextInput label="Department" value={form.studentDepartment} onChange={(v) => set("studentDepartment", v)} />
              </div>
              <TextInput label="Name of the Faculty Mentor" value={form.facultyMentorName} onChange={(v) => set("facultyMentorName", v)} />
            </div>
          )}
        </div>

        <div className="space-y-4">
          <SubLabel>Innovation Details</SubLabel>
          <TextInput label="Innovation Title" value={form.innovationTitle} onChange={(v) => set("innovationTitle", v)} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Innovation Type</Label>
              <Select value={form.innovationType} onValueChange={(v) => set("innovationType", v as InnovationType)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(INNOVATION_TYPE_LABELS) as InnovationType[]).map((t) => <SelectItem key={t} value={t}>{INNOVATION_TYPE_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>TRL Level</Label>
              <Select value={form.trlLevel} onValueChange={(v) => set("trlLevel", v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {TRL_LEVELS.map((l) => <SelectItem key={l} value={l}>TRL {l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Problem Statement</Label>
            <Textarea value={form.problemStatement} onChange={(e) => set("problemStatement", e.target.value)} rows={2} placeholder="Problem addressed by the idea" />
          </div>
          <div className="space-y-2">
            <Label>Brief Description</Label>
            <Textarea value={form.briefDescription} onChange={(e) => set("briefDescription", e.target.value)} rows={3} placeholder="Short description of the innovation" />
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <div className="space-y-4">
          <SubLabel>Development Status</SubLabel>
          <div className="space-y-2 max-w-[200px]">
            <Label>Prototype Developed</Label>
            <Select value={form.prototypeDeveloped} onValueChange={(v) => set("prototypeDeveloped", v as "YES" | "NO")}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="YES">Yes</SelectItem>
                <SelectItem value="NO">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.prototypeDeveloped === "YES" && (
            <div className="space-y-2">
              <Label>Prototype Details</Label>
              <Textarea value={form.prototypeDetails} onChange={(e) => set("prototypeDetails", e.target.value)} rows={2} placeholder="Description of developed prototype" />
            </div>
          )}

          <div className="space-y-2 max-w-[200px]">
            <Label>Business Model Developed</Label>
            <Select value={form.businessModelDeveloped} onValueChange={(v) => set("businessModelDeveloped", v as "YES" | "NO")}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="YES">Yes</SelectItem>
                <SelectItem value="NO">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.businessModelDeveloped === "YES" && (
            <div className="space-y-2">
              <Label>Business Model Details</Label>
              <Textarea value={form.businessModelDetails} onChange={(e) => set("businessModelDetails", e.target.value)} rows={2} placeholder="Description of Business Model" />
            </div>
          )}

          <div className="space-y-2 max-w-[200px]">
            <Label>Start-up Formed</Label>
            <Select value={form.startupFormed} onValueChange={(v) => set("startupFormed", v as "YES" | "NO")}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="YES">Yes</SelectItem>
                <SelectItem value="NO">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.startupFormed === "YES" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <TextInput label="Start-up Name" value={form.startupName} onChange={(v) => set("startupName", v)} />
              <TextInput label="Name of the Incubation" value={form.incubationName} onChange={(v) => set("incubationName", v)} />
              <TextInput label="YUKTI ID" value={form.yuktiId} onChange={(v) => set("yuktiId", v)} />
            </div>
          )}
        </div>

        <div className="space-y-4">
          <SubLabel>YUKTI</SubLabel>
          <div className="space-y-2 max-w-[200px]">
            <Label>Verified &amp; Recommended in YUKTI</Label>
            <Select value={form.verifiedRecommendedYukti} onValueChange={(v) => set("verifiedRecommendedYukti", v as "YES" | "NO")}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="YES">Yes</SelectItem>
                <SelectItem value="NO">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DocumentUploadField
            label="Screen Shot of YUKTI Status"
            value={form.yuktiScreenshotUrl}
            uploadEndpoint="/api/upload/innovation-doc"
            extraFields={{ kind: "yukti-screenshot" }}
            onUploaded={(url) => set("yuktiScreenshotUrl", url)}
            onRemoved={() => set("yuktiScreenshotUrl", "")}
          />
        </div>

        <div className="space-y-4">
          <SubLabel>Competition</SubLabel>
          <div className="space-y-2 max-w-[200px]">
            <Label>Presented in any Competition</Label>
            <Select value={form.presentedInCompetition} onValueChange={(v) => set("presentedInCompetition", v as "YES" | "NO")}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="YES">Yes</SelectItem>
                <SelectItem value="NO">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.presentedInCompetition === "YES" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextInput label="Name of the Competition" value={form.competitionName} onChange={(v) => set("competitionName", v)} />
              <TextInput label="Organized By" value={form.organizedBy} onChange={(v) => set("organizedBy", v)} />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Remarks</Label>
          <Textarea value={form.remarks} onChange={(e) => set("remarks", e.target.value)} rows={2} placeholder="Additional information" />
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

function AddInnovationDialog({
  open, onOpenChange, editingRecord, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingRecord: InnovationRequest | null;
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

// Innovations - self-submitted, same PENDING/APPROVED/REJECTED verification
// flow as the other Research & Innovation tabs (see /api/college/
// innovations), a repeating list per person.
export function InnovationsModuleView({ uid, isOwnProfile }: { uid?: string; isOwnProfile?: boolean }) {
  const [records, setRecords] = useState<InnovationRequest[] | null>(null);

  function load() {
    const url = uid ? `/api/college/innovations?uid=${encodeURIComponent(uid)}` : "/api/college/innovations";
    fetch(url)
      .then((r) => r.json() as Promise<{ records?: InnovationRequest[] }>)
      .then((d) => setRecords(d.records ?? []))
      .catch(() => setRecords([]));
  }

  useEffect(() => { load(); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  return <InnovationsSection records={records} isOwnProfile={isOwnProfile} onChanged={load} />;
}

export function InnovationsSection({
  records, isOwnProfile, onChanged,
}: {
  records: InnovationRequest[] | null;
  isOwnProfile?: boolean;
  onChanged?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<InnovationRequest | null>(null);

  const sorted = (records ?? []).slice();
  const visible = expanded ? sorted : sorted.slice(0, PREVIEW_COUNT);
  const hidden = sorted.length - PREVIEW_COUNT;

  function openAdd() {
    setEditingRecord(null);
    setFormOpen(true);
  }

  function openEdit(record: InnovationRequest) {
    setEditingRecord(record);
    setFormOpen(true);
  }

  return (
    <Section number={3} title="Innovations">
      <div className="flex items-center justify-between">
        <SubLabel>Records</SubLabel>
        {isOwnProfile && (
          <Button variant="outline" size="sm" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add Innovation
          </Button>
        )}
      </div>
      {records === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">None recorded.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((record) => <InnovationRow key={record.id} record={record} isOwnProfile={isOwnProfile} onEdit={openEdit} />)}
          {sorted.length > PREVIEW_COUNT && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-medium text-primary hover:underline">
              {expanded ? "Show less" : `Show ${hidden} more`}
            </button>
          )}
        </div>
      )}

      {isOwnProfile && (
        <AddInnovationDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          editingRecord={editingRecord}
          onSaved={() => onChanged?.()}
        />
      )}
    </Section>
  );
}
