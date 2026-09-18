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
  HackathonEvaluatorItem, HackathonEventType, HackathonFacultyCoordinatorItem, HackathonLevel,
  HackathonRequest, YuktiReferenceItem, YuktiReferenceStatus,
} from "@/types";

const PREVIEW_COUNT = 3;
const EMPTY_EVALUATOR: HackathonEvaluatorItem = { name: "", affiliation: "" };
const EMPTY_COORDINATOR: HackathonFacultyCoordinatorItem = { name: "", designation: "", departmentOrCell: "" };
const EMPTY_YUKTI: YuktiReferenceItem = { teamName: "", yuktiId: "", ideaOrPrototypeTitle: "", submittedOn: "", status: "" };

const EVENT_TYPE_LABELS: Record<HackathonEventType, string> = {
  HACKATHON: "Hackathon", IDEATHON: "Ideathon", INNOVATION_CHALLENGE: "Innovation Challenge",
  BUSINESS_PLAN_COMPETITION: "Business Plan Competition",
};
const LEVEL_LABELS: Record<HackathonLevel, string> = {
  INSTITUTION: "Institution", INTER_COLLEGE: "Inter-college", STATE: "State", NATIONAL: "National",
};
const YUKTI_STATUS_LABELS: Record<YuktiReferenceStatus, string> = {
  SUBMITTED: "Submitted", RECOMMENDED: "Recommended", NOT_RECOMMENDED: "Not Recommended",
};

function toNumberOrUndefined(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

function HackathonRow({
  record, isOwnProfile, onEdit,
}: {
  record: HackathonRequest;
  isOwnProfile?: boolean;
  onEdit?: (record: HackathonRequest) => void;
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
        <Field label="Event Title" value={record.eventTitle} />
        <Field label="Type" value={EVENT_TYPE_LABELS[record.eventType]} />
        <Field label="Level" value={LEVEL_LABELS[record.levelOfEvent]} />
        <Field label="A.Y." value={record.academicYear} />
        <Field label="Dates" value={record.startDate && record.endDate ? `${record.startDate} – ${record.endDate}` : record.startDate} />
        <Field label="Venue" value={record.venue} />
        <Field label="Theme/Domain" value={record.themeDomain} />
        <Field label="Teams (Int/Ext)" value={`${record.teamsRegisteredInternal ?? 0} / ${record.teamsRegisteredExternal ?? 0}`} />
      </div>
      <div className="flex flex-wrap gap-3">
        {record.sanctionedLetterUrl && (
          <a href={record.sanctionedLetterUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Sanctioned Letter
          </a>
        )}
        {record.brochureUrl && (
          <a href={record.brochureUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Brochure
          </a>
        )}
        {record.expenditureProofUrl && (
          <a href={record.expenditureProofUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Expenditure Proof
          </a>
        )}
        {record.eventReportUrl && (
          <a href={record.eventReportUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Event Report
          </a>
        )}
      </div>
    </div>
  );
}

interface RecordFormState {
  academicYear: string;
  eventTitle: string;
  eventType: HackathonEventType | "";
  organizingDeptCell: string;
  startDate: string;
  endDate: string;
  durationHours: string;
  venue: string;
  levelOfEvent: HackathonLevel | "";
  themeDomain: string;
  noOfProblemStatements: string;
  teamsRegisteredInternal: string;
  teamsRegisteredExternal: string;
  participantsInternal: string;
  participantsExternal: string;
  ideasPresentedCount: string;
  pocsPresentedCount: string;
  productsPresentedCount: string;
  evaluators: HackathonEvaluatorItem[];
  facultyCoordinators: HackathonFacultyCoordinatorItem[];
  ideasUploadedYukti: string;
  ideasVerifiedRecommendedYukti: string;
  prototypesUploadedYukti: string;
  prototypesVerifiedRecommendedYukti: string;
  yuktiReferences: YuktiReferenceItem[];
  sanctionedLetterUrl: string;
  brochureUrl: string;
  expenditureProofUrl: string;
  eventReportUrl: string;
  remarks: string;
}

function initialFormState(editing: HackathonRequest | null): RecordFormState {
  const n = (v: number | undefined) => (v !== undefined ? String(v) : "");
  const s = (v: string | undefined) => v ?? "";
  if (!editing) {
    return {
      academicYear: "", eventTitle: "", eventType: "", organizingDeptCell: "", startDate: "", endDate: "",
      durationHours: "", venue: "", levelOfEvent: "", themeDomain: "", noOfProblemStatements: "",
      teamsRegisteredInternal: "", teamsRegisteredExternal: "", participantsInternal: "", participantsExternal: "",
      ideasPresentedCount: "", pocsPresentedCount: "", productsPresentedCount: "", evaluators: [],
      facultyCoordinators: [], ideasUploadedYukti: "", ideasVerifiedRecommendedYukti: "",
      prototypesUploadedYukti: "", prototypesVerifiedRecommendedYukti: "", yuktiReferences: [],
      sanctionedLetterUrl: "", brochureUrl: "", expenditureProofUrl: "", eventReportUrl: "", remarks: "",
    };
  }
  return {
    academicYear: editing.academicYear, eventTitle: editing.eventTitle, eventType: editing.eventType,
    organizingDeptCell: s(editing.organizingDeptCell), startDate: s(editing.startDate), endDate: s(editing.endDate),
    durationHours: n(editing.durationHours), venue: s(editing.venue), levelOfEvent: editing.levelOfEvent,
    themeDomain: s(editing.themeDomain), noOfProblemStatements: n(editing.noOfProblemStatements),
    teamsRegisteredInternal: n(editing.teamsRegisteredInternal), teamsRegisteredExternal: n(editing.teamsRegisteredExternal),
    participantsInternal: n(editing.participantsInternal), participantsExternal: n(editing.participantsExternal),
    ideasPresentedCount: n(editing.ideasPresentedCount), pocsPresentedCount: n(editing.pocsPresentedCount),
    productsPresentedCount: n(editing.productsPresentedCount), evaluators: editing.evaluators ?? [],
    facultyCoordinators: editing.facultyCoordinators ?? [], ideasUploadedYukti: n(editing.ideasUploadedYukti),
    ideasVerifiedRecommendedYukti: n(editing.ideasVerifiedRecommendedYukti),
    prototypesUploadedYukti: n(editing.prototypesUploadedYukti),
    prototypesVerifiedRecommendedYukti: n(editing.prototypesVerifiedRecommendedYukti),
    yuktiReferences: editing.yuktiReferences ?? [], sanctionedLetterUrl: s(editing.sanctionedLetterUrl),
    brochureUrl: s(editing.brochureUrl), expenditureProofUrl: s(editing.expenditureProofUrl),
    eventReportUrl: s(editing.eventReportUrl), remarks: s(editing.remarks),
  };
}

function RecordFormFields({
  editingRecord, onCancel, onSaved,
}: {
  editingRecord: HackathonRequest | null;
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
    form.academicYear.trim().length > 1 && form.eventTitle.trim().length > 1 &&
    !!form.eventType && !!form.levelOfEvent;

  async function handleSubmit() {
    if (!isValid) return;
    setSaving(true);
    try {
      const body = {
        academicYear: form.academicYear.trim(),
        eventTitle: form.eventTitle.trim(),
        eventType: form.eventType || undefined,
        organizingDeptCell: form.organizingDeptCell.trim(),
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
        durationHours: toNumberOrUndefined(form.durationHours),
        venue: form.venue.trim(),
        levelOfEvent: form.levelOfEvent || undefined,
        themeDomain: form.themeDomain.trim(),
        noOfProblemStatements: toNumberOrUndefined(form.noOfProblemStatements),
        teamsRegisteredInternal: toNumberOrUndefined(form.teamsRegisteredInternal),
        teamsRegisteredExternal: toNumberOrUndefined(form.teamsRegisteredExternal),
        participantsInternal: toNumberOrUndefined(form.participantsInternal),
        participantsExternal: toNumberOrUndefined(form.participantsExternal),
        ideasPresentedCount: toNumberOrUndefined(form.ideasPresentedCount),
        pocsPresentedCount: toNumberOrUndefined(form.pocsPresentedCount),
        productsPresentedCount: toNumberOrUndefined(form.productsPresentedCount),
        evaluators: form.evaluators,
        facultyCoordinators: form.facultyCoordinators,
        ideasUploadedYukti: toNumberOrUndefined(form.ideasUploadedYukti),
        ideasVerifiedRecommendedYukti: toNumberOrUndefined(form.ideasVerifiedRecommendedYukti),
        prototypesUploadedYukti: toNumberOrUndefined(form.prototypesUploadedYukti),
        prototypesVerifiedRecommendedYukti: toNumberOrUndefined(form.prototypesVerifiedRecommendedYukti),
        yuktiReferences: form.yuktiReferences,
        sanctionedLetterUrl: form.sanctionedLetterUrl || undefined,
        brochureUrl: form.brochureUrl || undefined,
        expenditureProofUrl: form.expenditureProofUrl || undefined,
        eventReportUrl: form.eventReportUrl || undefined,
        remarks: form.remarks.trim(),
      };
      const res = editingId
        ? await fetch(`/api/college/hackathons/${editingId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          })
        : await fetch("/api/college/hackathons", {
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
        <DialogTitle>{editingId ? "Edit & Resubmit Hackathon Record" : "Add Hackathon / Competition"}</DialogTitle>
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
            <TextInput label="Event Title" value={form.eventTitle} onChange={(v) => set("eventTitle", v)} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Event Type</Label>
              <Select value={form.eventType} onValueChange={(v) => set("eventType", v as HackathonEventType)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(EVENT_TYPE_LABELS) as HackathonEventType[]).map((t) => <SelectItem key={t} value={t}>{EVENT_TYPE_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Level of Event</Label>
              <Select value={form.levelOfEvent} onValueChange={(v) => set("levelOfEvent", v as HackathonLevel)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(LEVEL_LABELS) as HackathonLevel[]).map((l) => <SelectItem key={l} value={l}>{LEVEL_LABELS[l]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <TextInput label="Organizing Department / Cell" value={form.organizingDeptCell} onChange={(v) => set("organizingDeptCell", v)} placeholder="Department / IIC / Incubation Cell / Idea Lab / EDC" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DateInput label="Start Date" value={form.startDate} onChange={(v) => set("startDate", v)} />
            <DateInput label="End Date" value={form.endDate} onChange={(v) => set("endDate", v)} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumInput label="Duration (Hrs)" value={toNumberOrUndefined(form.durationHours)} onChange={(v) => set("durationHours", String(v))} />
            <TextInput label="Venue" value={form.venue} onChange={(v) => set("venue", v)} />
          </div>
          <TextInput label="Theme / Domain" value={form.themeDomain} onChange={(v) => set("themeDomain", v)} placeholder="AI, Healthcare, Agriculture, Women Safety, Sustainability, etc." />
        </div>

        <div className="space-y-4">
          <SubLabel>Participation</SubLabel>
          <NumInput label="No. of Problem Statements" value={toNumberOrUndefined(form.noOfProblemStatements)} onChange={(v) => set("noOfProblemStatements", String(v))} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumInput label="Teams Registered - Internal" value={toNumberOrUndefined(form.teamsRegisteredInternal)} onChange={(v) => set("teamsRegisteredInternal", String(v))} />
            <NumInput label="Teams Registered - External" value={toNumberOrUndefined(form.teamsRegisteredExternal)} onChange={(v) => set("teamsRegisteredExternal", String(v))} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumInput label="Participants - Internal" value={toNumberOrUndefined(form.participantsInternal)} onChange={(v) => set("participantsInternal", String(v))} />
            <NumInput label="Participants - External" value={toNumberOrUndefined(form.participantsExternal)} onChange={(v) => set("participantsExternal", String(v))} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <NumInput label="Ideas Presented" value={toNumberOrUndefined(form.ideasPresentedCount)} onChange={(v) => set("ideasPresentedCount", String(v))} />
            <NumInput label="PoC's Presented" value={toNumberOrUndefined(form.pocsPresentedCount)} onChange={(v) => set("pocsPresentedCount", String(v))} />
            <NumInput label="Products/Prototypes Presented" value={toNumberOrUndefined(form.productsPresentedCount)} onChange={(v) => set("productsPresentedCount", String(v))} />
          </div>
        </div>

        <RepeatingGroup
          title="Evaluator Details"
          items={form.evaluators}
          empty={EMPTY_EVALUATOR}
          onChange={(v) => set("evaluators", v)}
          addLabel="Add Evaluator"
          renderRow={(item, update) => (
            <>
              <TextInput label="Name of the Evaluator" value={item.name} onChange={(v) => update({ name: v })} />
              <TextInput label="Affiliation of the Evaluator" value={item.affiliation} onChange={(v) => update({ affiliation: v })} />
            </>
          )}
        />

        <RepeatingGroup
          title="Faculty Coordinators"
          items={form.facultyCoordinators}
          empty={EMPTY_COORDINATOR}
          onChange={(v) => set("facultyCoordinators", v)}
          addLabel="Add Coordinator"
          renderRow={(item, update) => (
            <>
              <TextInput label="Name" value={item.name} onChange={(v) => update({ name: v })} />
              <TextInput label="Designation" value={item.designation} onChange={(v) => update({ designation: v })} />
              <TextInput label="Department/Cell" value={item.departmentOrCell} onChange={(v) => update({ departmentOrCell: v })} />
            </>
          )}
        />
      </div>

      <div className="space-y-5">
        <div className="space-y-4">
          <SubLabel>YUKTI</SubLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumInput label="Ideas Uploaded in YUKTI" value={toNumberOrUndefined(form.ideasUploadedYukti)} onChange={(v) => set("ideasUploadedYukti", String(v))} />
            <NumInput label="Ideas Verified & Recommended" value={toNumberOrUndefined(form.ideasVerifiedRecommendedYukti)} onChange={(v) => set("ideasVerifiedRecommendedYukti", String(v))} />
            <NumInput label="Prototypes Uploaded in YUKTI" value={toNumberOrUndefined(form.prototypesUploadedYukti)} onChange={(v) => set("prototypesUploadedYukti", String(v))} />
            <NumInput label="Prototypes Verified & Recommended" value={toNumberOrUndefined(form.prototypesVerifiedRecommendedYukti)} onChange={(v) => set("prototypesVerifiedRecommendedYukti", String(v))} />
          </div>
          <TableRepeatingGroup
            title="YUKTI Reference / Proof"
            items={form.yuktiReferences}
            empty={EMPTY_YUKTI}
            onChange={(v) => set("yuktiReferences", v)}
            addLabel="Add Row"
            columns={[
              { header: "Team Name", render: (item, update) => <Input className="h-8 text-sm" value={item.teamName} onChange={(e) => update({ teamName: e.target.value })} /> },
              { header: "YUKTI ID", render: (item, update) => <Input className="h-8 text-sm" value={item.yuktiId} onChange={(e) => update({ yuktiId: e.target.value })} /> },
              { header: "Title of the Idea/Prototype", render: (item, update) => <Input className="h-8 text-sm" value={item.ideaOrPrototypeTitle} onChange={(e) => update({ ideaOrPrototypeTitle: e.target.value })} /> },
              { header: "Submitted On", render: (item, update) => <Input type="date" className="h-8 text-sm" value={item.submittedOn} onChange={(e) => update({ submittedOn: e.target.value })} /> },
              {
                header: "Status", render: (item, update) => (
                  <Select value={item.status} onValueChange={(v) => update({ status: v as YuktiReferenceStatus })}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(YUKTI_STATUS_LABELS) as YuktiReferenceStatus[]).map((s) => <SelectItem key={s} value={s}>{YUKTI_STATUS_LABELS[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ),
              },
            ]}
          />
        </div>

        <div className="space-y-4">
          <SubLabel>Documents</SubLabel>
          <DocumentUploadField
            label="Sanctioned Letter"
            value={form.sanctionedLetterUrl}
            uploadEndpoint="/api/upload/hackathon-doc"
            extraFields={{ kind: "sanctioned-letter" }}
            onUploaded={(url) => set("sanctionedLetterUrl", url)}
            onRemoved={() => set("sanctionedLetterUrl", "")}
          />
          <DocumentUploadField
            label="Brochure"
            value={form.brochureUrl}
            uploadEndpoint="/api/upload/hackathon-doc"
            extraFields={{ kind: "brochure" }}
            onUploaded={(url) => set("brochureUrl", url)}
            onRemoved={() => set("brochureUrl", "")}
          />
          <DocumentUploadField
            label="Expenditure"
            value={form.expenditureProofUrl}
            uploadEndpoint="/api/upload/hackathon-doc"
            extraFields={{ kind: "expenditure-proof" }}
            onUploaded={(url) => set("expenditureProofUrl", url)}
            onRemoved={() => set("expenditureProofUrl", "")}
          />
          <DocumentUploadField
            label="Report of the Event"
            value={form.eventReportUrl}
            uploadEndpoint="/api/upload/hackathon-doc"
            extraFields={{ kind: "event-report" }}
            onUploaded={(url) => set("eventReportUrl", url)}
            onRemoved={() => set("eventReportUrl", "")}
          />
          <div className="space-y-2">
            <Label>Remarks</Label>
            <Textarea value={form.remarks} onChange={(e) => set("remarks", e.target.value)} rows={2} placeholder="Any additional information" />
          </div>
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

function AddHackathonDialog({
  open, onOpenChange, editingRecord, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingRecord: HackathonRequest | null;
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

// Organizing Hackathons / Competitions - self-submitted, same PENDING/
// APPROVED/REJECTED verification flow as the other Research & Innovation
// tabs (see /api/college/hackathons), a repeating list per person.
export function HackathonsModuleView({ uid, isOwnProfile }: { uid?: string; isOwnProfile?: boolean }) {
  const [records, setRecords] = useState<HackathonRequest[] | null>(null);

  function load() {
    const url = uid ? `/api/college/hackathons?uid=${encodeURIComponent(uid)}` : "/api/college/hackathons";
    fetch(url)
      .then((r) => r.json() as Promise<{ records?: HackathonRequest[] }>)
      .then((d) => setRecords(d.records ?? []))
      .catch(() => setRecords([]));
  }

  useEffect(() => { load(); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  return <HackathonsSection records={records} isOwnProfile={isOwnProfile} onChanged={load} />;
}

export function HackathonsSection({
  records, isOwnProfile, onChanged,
}: {
  records: HackathonRequest[] | null;
  isOwnProfile?: boolean;
  onChanged?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<HackathonRequest | null>(null);

  const sorted = (records ?? []).slice();
  const visible = expanded ? sorted : sorted.slice(0, PREVIEW_COUNT);
  const hidden = sorted.length - PREVIEW_COUNT;

  function openAdd() {
    setEditingRecord(null);
    setFormOpen(true);
  }

  function openEdit(record: HackathonRequest) {
    setEditingRecord(record);
    setFormOpen(true);
  }

  return (
    <Section number={3} title="Organizing Hackathons / Competitions">
      <div className="flex items-center justify-between">
        <SubLabel>Events</SubLabel>
        {isOwnProfile && (
          <Button variant="outline" size="sm" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add Event
          </Button>
        )}
      </div>
      {records === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">None recorded.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((record) => <HackathonRow key={record.id} record={record} isOwnProfile={isOwnProfile} onEdit={openEdit} />)}
          {sorted.length > PREVIEW_COUNT && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-medium text-primary hover:underline">
              {expanded ? "Show less" : `Show ${hidden} more`}
            </button>
          )}
        </div>
      )}

      {isOwnProfile && (
        <AddHackathonDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          editingRecord={editingRecord}
          onSaved={() => onChanged?.()}
        />
      )}
    </Section>
  );
}
