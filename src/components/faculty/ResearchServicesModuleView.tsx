"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Plus, Pencil } from "lucide-react";
import { Section, SubLabel, Field, TextInput, NumInput, DateInput, RepeatingGroup } from "@/components/shared/ProfileFieldPrimitives";
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
import type {
  ConferenceWorkshopNature, ConferenceWorkshopType, ConvenerCoordinatorItem, EditorPublicationType, EditorialRole,
  OrganizingCommitteeMemberItem, PublicationScope, ResearchServiceFundNature, ResearchServiceRequest,
  ResearchServiceType, ResourcePersonItem, ReviewerType,
} from "@/types";

const PREVIEW_COUNT = 3;
const EMPTY_CONVENER: ConvenerCoordinatorItem = { name: "", department: "", type: "" };
const EMPTY_COMMITTEE_MEMBER: OrganizingCommitteeMemberItem = { name: "", department: "" };
const EMPTY_RESOURCE_PERSON: ResourcePersonItem = { name: "", affiliation: "" };

const SERVICE_TYPE_LABELS: Record<ResearchServiceType, string> = {
  CONFERENCE: "Conference", WORKSHOP: "Workshop", REVIEWER: "Reviewer", EDITOR: "Editor",
};
const EDITORIAL_ROLE_LABELS: Record<EditorialRole, string> = {
  EDITOR: "Editor", CHIEF_EDITOR: "Chief Editor", ASSOCIATE_EDITOR: "Associate Editor",
  GUEST_EDITOR: "Guest Editor", SECTION_EDITOR: "Section Editor",
};
const EDITOR_PUBLICATION_TYPE_LABELS: Record<EditorPublicationType, string> = {
  JOURNAL: "Journal", BOOK: "Book", EDITED_BOOK: "Edited Book",
  CONFERENCE_PROCEEDINGS: "Conference Proceedings", SPECIAL_ISSUE: "Special Issue",
};
const PUBLISHER_OPTIONS = ["IEEE", "Springer", "Elsevier", "Wiley", "Taylor & Francis", "Other"];

function toNumberOrUndefined(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

function ResearchServiceRow({
  record, isOwnProfile, onEdit,
}: {
  record: ResearchServiceRequest;
  isOwnProfile?: boolean;
  onEdit?: (record: ResearchServiceRequest) => void;
}) {
  const label = record.title || record.reviewerPaperTitle || record.editorPublicationName || SERVICE_TYPE_LABELS[record.serviceType];
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
        <Field label="Type" value={SERVICE_TYPE_LABELS[record.serviceType]} />
        <Field label="Title" value={label} />
        {(record.serviceType === "CONFERENCE" || record.serviceType === "WORKSHOP") && (
          <>
            <Field label="Event Type" value={record.eventType} />
            <Field label="Dates" value={record.startDate && record.endDate ? `${record.startDate} – ${record.endDate}` : record.startDate} />
          </>
        )}
        {record.serviceType === "REVIEWER" && (
          <>
            <Field label="Journal/Conference" value={record.reviewerPublicationName} />
            <Field label="Review Date" value={record.reviewerReviewDate} />
          </>
        )}
        {record.serviceType === "EDITOR" && (
          <>
            <Field label="Editorial Role" value={record.editorialRole ? EDITORIAL_ROLE_LABELS[record.editorialRole] : undefined} />
            <Field label="Publisher" value={record.editorPublisher} />
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        {[
          { url: record.sanctionedLetterUrl, label: "Sanctioned Letter" },
          { url: record.brochureUrl, label: "Brochure" },
          { url: record.scheduleUrl, label: "Schedule" },
          { url: record.completionReportUrl, label: "Completion Report" },
          { url: record.conferenceProceedingsUrl, label: "Conference Proceedings" },
          { url: record.reviewerCertificateUrl, label: "Review Certificate" },
          { url: record.editorAppointmentLetterUrl, label: "Appointment Letter" },
        ].filter((d) => d.url).map((d) => (
          <a key={d.label} href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />{d.label}
          </a>
        ))}
      </div>
    </div>
  );
}

interface RecordFormState {
  serviceType: ResearchServiceType | "";
  organized: "YES" | "NO" | "";
  eventType: ConferenceWorkshopType | "";
  eventNature: ConferenceWorkshopNature | "";
  fundNature: ResearchServiceFundNature | "";
  title: string;
  convenersCount: string;
  conveners: ConvenerCoordinatorItem[];
  committeeMembersCount: string;
  committeeMembers: OrganizingCommitteeMemberItem[];
  noOfDays: string;
  academicYear: string;
  startDate: string;
  endDate: string;
  amountSanctioned: string;
  amountReceived: string;
  expenditureMade: string;
  sanctionedLetterUrl: string;
  brochureUrl: string;
  scheduleUrl: string;
  resourcePersonsCount: string;
  resourcePersons: ResourcePersonItem[];
  completionReportUrl: string;
  papersReceived: string;
  papersAccepted: string;
  papersPublishedCount: string;
  papersIndexedCount: string;
  conferenceProceedingsUrl: string;
  participantsRegisteredInternal: string;
  participantsRegisteredExternal: string;
  papersAttendedInternal: string;
  papersAttendedExternal: string;
  reviewerType: ReviewerType | "";
  reviewerPublicationName: string;
  reviewerPublisherName: string;
  reviewerPaperTitle: string;
  reviewerReviewDate: string;
  reviewerCertificateUrl: string;
  editorialRole: EditorialRole | "";
  editorPublicationType: EditorPublicationType | "";
  editorPublicationName: string;
  editorPublisher: string;
  editorPublisherOther: string;
  editorIssnIsbn: string;
  editorScope: PublicationScope | "";
  editorIndexedIn: string;
  editorResponsibilities: string;
  editorPapersChaptersHandled: string;
  editorAppointmentLetterUrl: string;
  editorPublicationUrl: string;
  editorRemarks: string;
}

function initialFormState(editing: ResearchServiceRequest | null): RecordFormState {
  const n = (v: number | undefined) => (v !== undefined ? String(v) : "");
  const s = (v: string | undefined) => v ?? "";
  if (!editing) {
    return {
      serviceType: "", organized: "", eventType: "", eventNature: "", fundNature: "", title: "",
      convenersCount: "", conveners: [], committeeMembersCount: "", committeeMembers: [], noOfDays: "",
      academicYear: "", startDate: "", endDate: "", amountSanctioned: "", amountReceived: "", expenditureMade: "",
      sanctionedLetterUrl: "", brochureUrl: "", scheduleUrl: "", resourcePersonsCount: "", resourcePersons: [],
      completionReportUrl: "", papersReceived: "", papersAccepted: "", papersPublishedCount: "",
      papersIndexedCount: "", conferenceProceedingsUrl: "", participantsRegisteredInternal: "",
      participantsRegisteredExternal: "", papersAttendedInternal: "", papersAttendedExternal: "",
      reviewerType: "", reviewerPublicationName: "", reviewerPublisherName: "", reviewerPaperTitle: "",
      reviewerReviewDate: "", reviewerCertificateUrl: "", editorialRole: "", editorPublicationType: "",
      editorPublicationName: "", editorPublisher: "", editorPublisherOther: "", editorIssnIsbn: "",
      editorScope: "", editorIndexedIn: "", editorResponsibilities: "", editorPapersChaptersHandled: "",
      editorAppointmentLetterUrl: "", editorPublicationUrl: "", editorRemarks: "",
    };
  }
  return {
    serviceType: editing.serviceType, organized: editing.organized ?? "", eventType: editing.eventType ?? "",
    eventNature: editing.eventNature ?? "", fundNature: editing.fundNature ?? "", title: s(editing.title),
    convenersCount: n(editing.convenersCount), conveners: editing.conveners ?? [],
    committeeMembersCount: n(editing.committeeMembersCount), committeeMembers: editing.committeeMembers ?? [],
    noOfDays: n(editing.noOfDays), academicYear: s(editing.academicYear), startDate: s(editing.startDate),
    endDate: s(editing.endDate), amountSanctioned: n(editing.amountSanctioned), amountReceived: n(editing.amountReceived),
    expenditureMade: n(editing.expenditureMade), sanctionedLetterUrl: s(editing.sanctionedLetterUrl),
    brochureUrl: s(editing.brochureUrl), scheduleUrl: s(editing.scheduleUrl),
    resourcePersonsCount: n(editing.resourcePersonsCount), resourcePersons: editing.resourcePersons ?? [],
    completionReportUrl: s(editing.completionReportUrl), papersReceived: n(editing.papersReceived),
    papersAccepted: n(editing.papersAccepted), papersPublishedCount: n(editing.papersPublishedCount),
    papersIndexedCount: n(editing.papersIndexedCount), conferenceProceedingsUrl: s(editing.conferenceProceedingsUrl),
    participantsRegisteredInternal: n(editing.participantsRegisteredInternal),
    participantsRegisteredExternal: n(editing.participantsRegisteredExternal),
    papersAttendedInternal: n(editing.papersAttendedInternal), papersAttendedExternal: n(editing.papersAttendedExternal),
    reviewerType: editing.reviewerType ?? "", reviewerPublicationName: s(editing.reviewerPublicationName),
    reviewerPublisherName: s(editing.reviewerPublisherName), reviewerPaperTitle: s(editing.reviewerPaperTitle),
    reviewerReviewDate: s(editing.reviewerReviewDate), reviewerCertificateUrl: s(editing.reviewerCertificateUrl),
    editorialRole: editing.editorialRole ?? "", editorPublicationType: editing.editorPublicationType ?? "",
    editorPublicationName: s(editing.editorPublicationName), editorPublisher: s(editing.editorPublisher),
    editorPublisherOther: s(editing.editorPublisherOther), editorIssnIsbn: s(editing.editorIssnIsbn),
    editorScope: editing.editorScope ?? "", editorIndexedIn: s(editing.editorIndexedIn),
    editorResponsibilities: s(editing.editorResponsibilities), editorPapersChaptersHandled: n(editing.editorPapersChaptersHandled),
    editorAppointmentLetterUrl: s(editing.editorAppointmentLetterUrl), editorPublicationUrl: s(editing.editorPublicationUrl),
    editorRemarks: s(editing.editorRemarks),
  };
}

function RecordFormFields({
  editingRecord, onCancel, onSaved,
}: {
  editingRecord: ResearchServiceRequest | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<RecordFormState>(() => initialFormState(editingRecord));
  const [saving, setSaving] = useState(false);
  const editingId = editingRecord?.id ?? null;

  function set<K extends keyof RecordFormState>(key: K, value: RecordFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const isConference = form.serviceType === "CONFERENCE";
  const isWorkshop = form.serviceType === "WORKSHOP";
  const isConferenceOrWorkshop = isConference || isWorkshop;

  const isValid =
    !!form.serviceType &&
    (isConferenceOrWorkshop ? form.organized === "YES" : true) &&
    (form.serviceType === "REVIEWER" ? form.reviewerPaperTitle.trim().length > 1 : true) &&
    (form.serviceType === "EDITOR" ? form.editorPublicationName.trim().length > 1 : true);

  async function handleSubmit() {
    if (!isValid) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        serviceType: form.serviceType || undefined,
        organized: form.organized || undefined,
        eventType: form.eventType || undefined,
        eventNature: form.eventNature || undefined,
        fundNature: form.fundNature || undefined,
        title: form.title.trim(),
        convenersCount: toNumberOrUndefined(form.convenersCount),
        conveners: form.conveners,
        committeeMembersCount: toNumberOrUndefined(form.committeeMembersCount),
        committeeMembers: form.committeeMembers,
        noOfDays: toNumberOrUndefined(form.noOfDays),
        academicYear: form.academicYear.trim(),
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
        amountSanctioned: toNumberOrUndefined(form.amountSanctioned),
        amountReceived: toNumberOrUndefined(form.amountReceived),
        expenditureMade: toNumberOrUndefined(form.expenditureMade),
        sanctionedLetterUrl: form.sanctionedLetterUrl || undefined,
        brochureUrl: form.brochureUrl || undefined,
        scheduleUrl: form.scheduleUrl || undefined,
        resourcePersonsCount: toNumberOrUndefined(form.resourcePersonsCount),
        resourcePersons: form.resourcePersons,
        completionReportUrl: form.completionReportUrl || undefined,
        papersReceived: toNumberOrUndefined(form.papersReceived),
        papersAccepted: toNumberOrUndefined(form.papersAccepted),
        papersPublishedCount: toNumberOrUndefined(form.papersPublishedCount),
        papersIndexedCount: toNumberOrUndefined(form.papersIndexedCount),
        conferenceProceedingsUrl: form.conferenceProceedingsUrl || undefined,
        participantsRegisteredInternal: toNumberOrUndefined(form.participantsRegisteredInternal),
        participantsRegisteredExternal: toNumberOrUndefined(form.participantsRegisteredExternal),
        papersAttendedInternal: toNumberOrUndefined(form.papersAttendedInternal),
        papersAttendedExternal: toNumberOrUndefined(form.papersAttendedExternal),
        reviewerType: form.reviewerType || undefined,
        reviewerPublicationName: form.reviewerPublicationName.trim(),
        reviewerPublisherName: form.reviewerPublisherName.trim(),
        reviewerPaperTitle: form.reviewerPaperTitle.trim(),
        reviewerReviewDate: form.reviewerReviewDate || undefined,
        reviewerCertificateUrl: form.reviewerCertificateUrl || undefined,
        editorialRole: form.editorialRole || undefined,
        editorPublicationType: form.editorPublicationType || undefined,
        editorPublicationName: form.editorPublicationName.trim(),
        editorPublisher: form.editorPublisher.trim(),
        editorPublisherOther: form.editorPublisherOther.trim(),
        editorIssnIsbn: form.editorIssnIsbn.trim(),
        editorScope: form.editorScope || undefined,
        editorIndexedIn: form.editorIndexedIn.trim(),
        editorResponsibilities: form.editorResponsibilities.trim(),
        editorPapersChaptersHandled: toNumberOrUndefined(form.editorPapersChaptersHandled),
        editorAppointmentLetterUrl: form.editorAppointmentLetterUrl || undefined,
        editorPublicationUrl: form.editorPublicationUrl.trim(),
        editorRemarks: form.editorRemarks.trim(),
      };
      const res = editingId
        ? await fetch(`/api/college/research-services/${editingId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          })
        : await fetch("/api/college/research-services", {
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
        <DialogTitle>{editingId ? "Edit & Resubmit Research Service Record" : "Add Research Service / Contribution"}</DialogTitle>
        <DialogDescription>
          {editingId
            ? "Correct the details below and resubmit - this goes back to R&D for verification."
            : "This is submitted to R&D for verification before it shows as an official record."}
        </DialogDescription>
      </DialogHeader>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-5">
        <div className="space-y-2 max-w-xs">
          <Label>Type of Contribution</Label>
          <Select value={form.serviceType} onValueChange={(v) => set("serviceType", v as ResearchServiceType)}>
            <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
            <SelectContent>
              {(Object.keys(SERVICE_TYPE_LABELS) as ResearchServiceType[]).map((t) => (
                <SelectItem key={t} value={t}>{SERVICE_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isConferenceOrWorkshop && (
          <div className="space-y-2 max-w-xs">
            <Label>{isConference ? "Organized Conference" : "Organized Research Workshop"}</Label>
            <Select value={form.organized} onValueChange={(v) => set("organized", v as "YES" | "NO")}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="YES">Yes</SelectItem>
                <SelectItem value="NO">No</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {isConferenceOrWorkshop && form.organized === "YES" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5 items-start">
            <div className="space-y-5">
              <div className="space-y-4">
                <SubLabel>Overview</SubLabel>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Type of {isConference ? "Conference" : "Workshop"}</Label>
                    <Select value={form.eventType} onValueChange={(v) => set("eventType", v as ConferenceWorkshopType)}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NATIONAL">National</SelectItem>
                        <SelectItem value="INTERNATIONAL">International</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Nature of {isConference ? "Conference" : "Workshop"}</Label>
                    <Select value={form.eventNature} onValueChange={(v) => set("eventNature", v as ConferenceWorkshopNature)}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ONLINE">Online</SelectItem>
                        <SelectItem value="OFFLINE">Offline</SelectItem>
                        <SelectItem value="HYBRID">Hybrid</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Nature of Fund</Label>
                  <Select value={form.fundNature} onValueChange={(v) => set("fundNature", v as ResearchServiceFundNature)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EXTERNAL_GRANT">External Grant</SelectItem>
                      <SelectItem value="INSTITUTIONAL_GRANT">Institutional Grant</SelectItem>
                      <SelectItem value="SANCTIONED_PROJECT_GRANT">Sanctioned Project Grant</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <TextInput label={`Title of the ${isConference ? "Conference" : "Workshop"}`} value={form.title} onChange={(v) => set("title", v)} />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <NumInput label="No. of Days" value={toNumberOrUndefined(form.noOfDays)} onChange={(v) => set("noOfDays", String(v))} />
                  <TextInput label="A.Y." value={form.academicYear} onChange={(v) => set("academicYear", v)} placeholder="e.g. 2024-25" />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <DateInput label="Start Date" value={form.startDate} onChange={(v) => set("startDate", v)} />
                  <DateInput label="End Date" value={form.endDate} onChange={(v) => set("endDate", v)} />
                </div>
              </div>

              <div className="space-y-4">
                <SubLabel>Finances</SubLabel>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <NumInput label="Amount Sanctioned (Rs.)" value={toNumberOrUndefined(form.amountSanctioned)} onChange={(v) => set("amountSanctioned", String(v))} />
                  <NumInput label="Amount Received (Rs.)" value={toNumberOrUndefined(form.amountReceived)} onChange={(v) => set("amountReceived", String(v))} />
                  <NumInput label="Expenditure Made (Rs.)" value={toNumberOrUndefined(form.expenditureMade)} onChange={(v) => set("expenditureMade", String(v))} />
                </div>
                <DocumentUploadField
                  label="Sanctioned Letter"
                  value={form.sanctionedLetterUrl}
                  uploadEndpoint="/api/upload/research-service-doc"
                  extraFields={{ kind: "sanctioned-letter" }}
                  onUploaded={(url) => set("sanctionedLetterUrl", url)}
                  onRemoved={() => set("sanctionedLetterUrl", "")}
                />
                <DocumentUploadField
                  label={`${isConference ? "Conference" : "Workshop"} Brochure`}
                  value={form.brochureUrl}
                  uploadEndpoint="/api/upload/research-service-doc"
                  extraFields={{ kind: "brochure" }}
                  onUploaded={(url) => set("brochureUrl", url)}
                  onRemoved={() => set("brochureUrl", "")}
                />
                <DocumentUploadField
                  label="Schedule"
                  value={form.scheduleUrl}
                  uploadEndpoint="/api/upload/research-service-doc"
                  extraFields={{ kind: "schedule" }}
                  onUploaded={(url) => set("scheduleUrl", url)}
                  onRemoved={() => set("scheduleUrl", "")}
                />
              </div>

              <NumInput label="No. of Convener / Coordinators" value={toNumberOrUndefined(form.convenersCount)} onChange={(v) => set("convenersCount", String(v))} />
              <RepeatingGroup
                title="Convener / Coordinators"
                items={form.conveners}
                empty={EMPTY_CONVENER}
                onChange={(v) => set("conveners", v)}
                addLabel="Add Convener/Coordinator"
                renderRow={(item, update) => (
                  <>
                    <TextInput label="Name of the Faculty" value={item.name} onChange={(v) => update({ name: v })} />
                    <TextInput label="Dept. of Faculty" value={item.department} onChange={(v) => update({ department: v })} />
                    <TextInput label="Type" value={item.type} onChange={(v) => update({ type: v })} placeholder="Convener / Co-Convener / Coordinator / Co-Coordinator" />
                  </>
                )}
              />

              <NumInput label="No. of Organizing Committee Members" value={toNumberOrUndefined(form.committeeMembersCount)} onChange={(v) => set("committeeMembersCount", String(v))} />
              <RepeatingGroup
                title="Organizing Committee Members"
                items={form.committeeMembers}
                empty={EMPTY_COMMITTEE_MEMBER}
                onChange={(v) => set("committeeMembers", v)}
                addLabel="Add Member"
                renderRow={(item, update) => (
                  <>
                    <TextInput label="Name of the Faculty" value={item.name} onChange={(v) => update({ name: v })} />
                    <TextInput label="Dept. of the Faculty" value={item.department} onChange={(v) => update({ department: v })} />
                  </>
                )}
              />
            </div>

            <div className="space-y-5">
              <NumInput label="No. of Resource Person/Keynote Speakers/Session Chairs" value={toNumberOrUndefined(form.resourcePersonsCount)} onChange={(v) => set("resourcePersonsCount", String(v))} />
              <RepeatingGroup
                title="Resource Persons"
                items={form.resourcePersons}
                empty={EMPTY_RESOURCE_PERSON}
                onChange={(v) => set("resourcePersons", v)}
                addLabel="Add Resource Person"
                renderRow={(item, update) => (
                  <>
                    <TextInput label="Name of the Resource Person" value={item.name} onChange={(v) => update({ name: v })} />
                    <TextInput label="Affiliation of Resource Person" value={item.affiliation} onChange={(v) => update({ affiliation: v })} />
                  </>
                )}
              />

              {isConference ? (
                <div className="space-y-4">
                  <SubLabel>Papers</SubLabel>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <NumInput label="No. of Papers Received" value={toNumberOrUndefined(form.papersReceived)} onChange={(v) => set("papersReceived", String(v))} />
                    <NumInput label="No. of Papers Accepted" value={toNumberOrUndefined(form.papersAccepted)} onChange={(v) => set("papersAccepted", String(v))} />
                    <NumInput label="No. of Papers Published" value={toNumberOrUndefined(form.papersPublishedCount)} onChange={(v) => set("papersPublishedCount", String(v))} />
                    <NumInput label="No. of Papers Indexed" value={toNumberOrUndefined(form.papersIndexedCount)} onChange={(v) => set("papersIndexedCount", String(v))} />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <SubLabel>Participation</SubLabel>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <NumInput label="Participants Registered - Internal" value={toNumberOrUndefined(form.participantsRegisteredInternal)} onChange={(v) => set("participantsRegisteredInternal", String(v))} />
                    <NumInput label="Participants Registered - External" value={toNumberOrUndefined(form.participantsRegisteredExternal)} onChange={(v) => set("participantsRegisteredExternal", String(v))} />
                    <NumInput label="Papers Attended - Internal" value={toNumberOrUndefined(form.papersAttendedInternal)} onChange={(v) => set("papersAttendedInternal", String(v))} />
                    <NumInput label="Papers Attended - External" value={toNumberOrUndefined(form.papersAttendedExternal)} onChange={(v) => set("papersAttendedExternal", String(v))} />
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <SubLabel>Closing Documents</SubLabel>
                <DocumentUploadField
                  label="Completion Report"
                  value={form.completionReportUrl}
                  uploadEndpoint="/api/upload/research-service-doc"
                  extraFields={{ kind: "completion-report" }}
                  onUploaded={(url) => set("completionReportUrl", url)}
                  onRemoved={() => set("completionReportUrl", "")}
                />
                {isConference && (
                  <DocumentUploadField
                    label="Conference Proceedings"
                    value={form.conferenceProceedingsUrl}
                    uploadEndpoint="/api/upload/research-service-doc"
                    extraFields={{ kind: "conference-proceedings" }}
                    onUploaded={(url) => set("conferenceProceedingsUrl", url)}
                    onRemoved={() => set("conferenceProceedingsUrl", "")}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {form.serviceType === "REVIEWER" && (
          <div className="space-y-4 max-w-2xl">
            <SubLabel>Reviewer Details</SubLabel>
            <div className="space-y-2 max-w-xs">
              <Label>Reviewer Type</Label>
              <Select value={form.reviewerType} onValueChange={(v) => set("reviewerType", v as ReviewerType)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="JOURNAL">Journal</SelectItem>
                  <SelectItem value="CONFERENCE">Conference</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <TextInput label="Name of the Journal/Conference" value={form.reviewerPublicationName} onChange={(v) => set("reviewerPublicationName", v)} />
            <TextInput label="Publisher Name" value={form.reviewerPublisherName} onChange={(v) => set("reviewerPublisherName", v)} />
            <TextInput label="Title of the Paper Reviewed" value={form.reviewerPaperTitle} onChange={(v) => set("reviewerPaperTitle", v)} />
            <DateInput label="Review Date" value={form.reviewerReviewDate} onChange={(v) => set("reviewerReviewDate", v)} />
            <DocumentUploadField
              label="Review Certificate / Mail"
              value={form.reviewerCertificateUrl}
              uploadEndpoint="/api/upload/research-service-doc"
              extraFields={{ kind: "reviewer-certificate" }}
              onUploaded={(url) => set("reviewerCertificateUrl", url)}
              onRemoved={() => set("reviewerCertificateUrl", "")}
            />
          </div>
        )}

        {form.serviceType === "EDITOR" && (
          <div className="space-y-4 max-w-2xl">
            <SubLabel>Editorial Details</SubLabel>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Editorial Role</Label>
                <Select value={form.editorialRole} onValueChange={(v) => set("editorialRole", v as EditorialRole)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(EDITORIAL_ROLE_LABELS) as EditorialRole[]).map((r) => <SelectItem key={r} value={r}>{EDITORIAL_ROLE_LABELS[r]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Publication Type</Label>
                <Select value={form.editorPublicationType} onValueChange={(v) => set("editorPublicationType", v as EditorPublicationType)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(EDITOR_PUBLICATION_TYPE_LABELS) as EditorPublicationType[]).map((t) => <SelectItem key={t} value={t}>{EDITOR_PUBLICATION_TYPE_LABELS[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <TextInput label="Name of the Publication" value={form.editorPublicationName} onChange={(v) => set("editorPublicationName", v)} placeholder="Journal / Book / Proceedings Title" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Publisher</Label>
                <Select value={form.editorPublisher} onValueChange={(v) => set("editorPublisher", v)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {PUBLISHER_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {form.editorPublisher === "Other" && (
                <TextInput label="Mention Publisher Name" value={form.editorPublisherOther} onChange={(v) => set("editorPublisherOther", v)} />
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextInput label="ISSN / ISBN" value={form.editorIssnIsbn} onChange={(v) => set("editorIssnIsbn", v)} />
              <div className="space-y-2">
                <Label>National / International</Label>
                <Select value={form.editorScope} onValueChange={(v) => set("editorScope", v as PublicationScope)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NATIONAL">National</SelectItem>
                    <SelectItem value="INTERNATIONAL">International</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <TextInput label="Indexed In" value={form.editorIndexedIn} onChange={(v) => set("editorIndexedIn", v)} placeholder="Scopus / Web of Science" />
            <div className="space-y-2">
              <Label>Editorial Responsibilities</Label>
              <Textarea value={form.editorResponsibilities} onChange={(e) => set("editorResponsibilities", e.target.value)} rows={2} placeholder="Brief description of work handled" />
            </div>
            <NumInput label="Number of Papers / Chapters Handled" value={toNumberOrUndefined(form.editorPapersChaptersHandled)} onChange={(v) => set("editorPapersChaptersHandled", String(v))} />
            <TextInput label="Publication URL" value={form.editorPublicationUrl} onChange={(v) => set("editorPublicationUrl", v)} />
            <DocumentUploadField
              label="Appointment Letter / Certificate"
              value={form.editorAppointmentLetterUrl}
              uploadEndpoint="/api/upload/research-service-doc"
              extraFields={{ kind: "appointment-letter" }}
              onUploaded={(url) => set("editorAppointmentLetterUrl", url)}
              onRemoved={() => set("editorAppointmentLetterUrl", "")}
            />
            <div className="space-y-2">
              <Label>Remarks</Label>
              <Textarea value={form.editorRemarks} onChange={(e) => set("editorRemarks", e.target.value)} rows={2} placeholder="Additional information" />
            </div>
          </div>
        )}
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

function AddResearchServiceDialog({
  open, onOpenChange, editingRecord, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingRecord: ResearchServiceRequest | null;
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

// Research Services & Contributions - self-submitted, same PENDING/APPROVED/
// REJECTED verification flow as the other Research & Innovation tabs (see
// /api/college/research-services), a repeating list per person covering
// Conference/Workshop organizing, Reviewer, and Editor contributions.
export function ResearchServicesModuleView({ uid, isOwnProfile }: { uid?: string; isOwnProfile?: boolean }) {
  const [records, setRecords] = useState<ResearchServiceRequest[] | null>(null);

  function load() {
    const url = uid ? `/api/college/research-services?uid=${encodeURIComponent(uid)}` : "/api/college/research-services";
    fetch(url)
      .then((r) => r.json() as Promise<{ records?: ResearchServiceRequest[] }>)
      .then((d) => setRecords(d.records ?? []))
      .catch(() => setRecords([]));
  }

  useEffect(() => { load(); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  return <ResearchServicesSection records={records} isOwnProfile={isOwnProfile} onChanged={load} />;
}

export function ResearchServicesSection({
  records, isOwnProfile, onChanged,
}: {
  records: ResearchServiceRequest[] | null;
  isOwnProfile?: boolean;
  onChanged?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ResearchServiceRequest | null>(null);

  const sorted = (records ?? []).slice();
  const visible = expanded ? sorted : sorted.slice(0, PREVIEW_COUNT);
  const hidden = sorted.length - PREVIEW_COUNT;

  function openAdd() {
    setEditingRecord(null);
    setFormOpen(true);
  }

  function openEdit(record: ResearchServiceRequest) {
    setEditingRecord(record);
    setFormOpen(true);
  }

  return (
    <Section number={3} title="Research Services & Contributions">
      <div className="flex items-center justify-between">
        <SubLabel>Records</SubLabel>
        {isOwnProfile && (
          <Button variant="outline" size="sm" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add Contribution
          </Button>
        )}
      </div>
      {records === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">None recorded.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((record) => <ResearchServiceRow key={record.id} record={record} isOwnProfile={isOwnProfile} onEdit={openEdit} />)}
          {sorted.length > PREVIEW_COUNT && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-medium text-primary hover:underline">
              {expanded ? "Show less" : `Show ${hidden} more`}
            </button>
          )}
        </div>
      )}

      {isOwnProfile && (
        <AddResearchServiceDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          editingRecord={editingRecord}
          onSaved={() => onChanged?.()}
        />
      )}
    </Section>
  );
}
