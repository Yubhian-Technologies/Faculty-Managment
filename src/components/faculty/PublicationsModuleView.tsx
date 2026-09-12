"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Plus, Pencil } from "lucide-react";
import { Section, SubLabel, Field } from "@/components/shared/ProfileFieldPrimitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import { PublicationDetailsForm, emptyPublicationDetails, isPublicationDetailsValid } from "@/components/research/PublicationDetailsForm";
import type { FacultyProfileFields, ResearchPublication, PublicationDetails } from "@/types";

const PREVIEW_COUNT = 3;

const AUTHOR_CATEGORY_LABELS: Record<string, string> = {
  FIRST_AUTHOR: "First Author", CO_AUTHOR: "Co-Author", CORRESPONDING_AUTHOR: "Corresponding Author",
};

// Bibliometric/report fields (from R&D's import) are only shown when
// present, so older hand-entered records don't sprout a wall of "-".
function PublicationRow({
  pub, isOwnProfile, viewerUid, onEdit,
}: {
  pub: ResearchPublication;
  isOwnProfile?: boolean;
  viewerUid?: string;
  onEdit?: (pub: ResearchPublication) => void;
}) {
  // Shows on both the submitter's own profile AND every verified Internal
  // co-author's profile (see internalAuthorUids, api/college/publications
  // GET) - so "isOwnProfile" alone doesn't mean "I submitted this"; check
  // which one it actually is to word things correctly and decide who may edit.
  const isSubmitter = pub.uid === viewerUid;
  const isCoAuthorHere = !!viewerUid && (pub.internalAuthorUids ?? []).includes(viewerUid);
  const canEdit = isOwnProfile && (isSubmitter || isCoAuthorHere);
  const extras: { label: string; value: string | number | undefined }[] = [
    { label: "Dept.", value: pub.department },
    { label: "Author Position", value: pub.authorPosition },
    { label: "Indexed", value: pub.indexing },
    { label: "Journal / Conference / Book Chapter", value: pub.venueType },
    { label: "Faculty / Student", value: pub.facultyOrStudent },
    { label: "Impact Factor", value: pub.impactFactor },
    { label: "SJR", value: pub.sjr },
    { label: "Quartile", value: pub.quartile },
    { label: "ISBN / ISSN", value: pub.isbnIssn },
  ].filter((f) => f.value !== undefined && f.value !== "");

  return (
    <div className="rounded-md border bg-muted/20 shadow-sm p-2 space-y-2">
      {isOwnProfile && !isSubmitter && (
        <p className="text-xs text-muted-foreground">Submitted by {pub.ownerName}</p>
      )}
      {(isOwnProfile && pub.status && pub.status !== "APPROVED") || canEdit ? (
        <div className="flex items-center gap-2">
          {pub.status === "PENDING" && <Badge variant="pending" className="text-xs">Pending Verification</Badge>}
          {pub.status === "REJECTED" && <Badge variant="rejected" className="text-xs">Rejected</Badge>}
          {canEdit && onEdit && (
            <button type="button" onClick={() => onEdit(pub)} className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1">
              <Pencil className="h-3 w-3" />
              {pub.status === "REJECTED" ? "Edit & Resubmit" : pub.status === "PENDING" ? "Edit" : "Edit (sends for re-verification)"}
            </button>
          )}
        </div>
      ) : null}
      {pub.status === "REJECTED" && pub.rejectionReason && (
        <p className="text-xs text-destructive">Reason: {pub.rejectionReason}</p>
      )}
      {pub.changeLog && pub.changeLog.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Last edited by {pub.changeLog[pub.changeLog.length - 1].changedByName}: {pub.changeLog[pub.changeLog.length - 1].changes.join(", ")}
        </p>
      )}
      {pub.citation ? (
        // "Publication Details" - the full citation, exactly as imported -
        // is the primary, display-ready version of this record.
        <p className="text-sm leading-snug">{pub.citation}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Title" value={pub.title} />
          <Field label="Co-Authors" value={pub.coAuthors} />
          <Field label="Journal / Conference" value={pub.journalOrConference} />
          <Field label="Year" value={pub.publicationYear} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {pub.citation && <Field label="Year" value={pub.publicationYear} />}
        {pub.citation && <Field label="Journal / Conference" value={pub.journalOrConference} />}
        {extras.map((f) => <Field key={f.label} label={f.label} value={f.value} />)}
      </div>
      {pub.details && (
        <div className="space-y-1.5 border-t pt-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Type" value={pub.details.type} />
            <Field label="Research Domain" value={pub.details.researchDomain} />
            <Field label="Quartile" value={pub.details.quartile} />
            <Field label="Internal / External Authors" value={`${pub.details.internalAuthorsCount} / ${pub.details.externalAuthorsCount}`} />
          </div>
          {pub.details.authors.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Authors</p>
              <div className="flex flex-wrap gap-1.5">
                {pub.details.authors.map((a, i) => (
                  <Badge key={i} variant={a.isInternal ? "approved" : "secondary"} className="text-xs font-normal">
                    {a.name || "Unnamed"} &middot; {AUTHOR_CATEGORY_LABELS[a.category] ?? a.category} &middot; {a.affiliationCollegeName || "—"}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {pub.driveLink && (
        <a
          href={pub.driveLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />View Publication
        </a>
      )}
    </div>
  );
}

// Self-submit form - the same rich Journal/Conference/Book Chapter/Text Book
// fields R&D's own Add Publication page collects (src/app/(dashboard)/
// r-and-d/publications/new/page.tsx), minus the staff picker (the server
// infers the submitter from their own session). Also reused to edit-and-
// resubmit a REJECTED entry - same fields, PATCH instead of POST.
function initialDetails(editingPub: ResearchPublication | null): PublicationDetails {
  return editingPub?.details ?? { ...emptyPublicationDetails(), title: editingPub?.title ?? "" };
}

// The actual form fields + their state, split out and only ever mounted
// while the dialog is open (see AddPublicationDialog below) - remounting
// fresh on every open is what resets the fields for a new "Add" after a
// previous edit, without needing an effect to re-sync state from props.
function PublicationFormFields({
  editingPub, onCancel, onSaved,
}: {
  editingPub: ResearchPublication | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const ownCollegeId = useAuthStore((s) => s.user?.collegeId ?? "");
  const [details, setDetails] = useState<PublicationDetails>(() => initialDetails(editingPub));
  const [saving, setSaving] = useState(false);
  const editingId = editingPub?.id ?? null;

  const isValid = isPublicationDetailsValid(details);

  async function handleSubmit() {
    if (!isValid) return;
    setSaving(true);
    try {
      const body = { details };
      const res = editingId
        ? await fetch(`/api/college/publications/${editingId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          })
        : await fetch("/api/college/publications", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        toast({ variant: "destructive", title: "Failed to save publication", description: json.error });
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
        <DialogTitle>{editingId ? "Edit & Resubmit Publication" : "Add Publication"}</DialogTitle>
        <DialogDescription>
          {editingId
            ? "Correct the details below and resubmit - this goes back to R&D for verification."
            : "This is submitted to R&D for verification before it shows as an official record."}
        </DialogDescription>
      </DialogHeader>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <PublicationDetailsForm value={details} onChange={setDetails} ownCollegeId={ownCollegeId} />
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

// Self-submit form - the same fields R&D's own Add Publication page collects
// (src/app/(dashboard)/r-and-d/publications/new/page.tsx), minus the staff
// picker (the server infers the submitter from their own session). Also
// reused to edit-and-resubmit a REJECTED entry - same fields, PATCH instead
// of POST.
function AddPublicationDialog({
  open, onOpenChange, editingPub, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingPub: ResearchPublication | null;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[1400px] h-[90vh] max-h-[90vh] flex flex-col overflow-hidden">
        {open && (
          <PublicationFormFields
            editingPub={editingPub}
            onCancel={() => onOpenChange(false)}
            onSaved={() => { onOpenChange(false); onSaved(); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// Research Publications module - the paper list itself is now R&D-managed
// (see /api/college/publications), read-only here for everyone but R&D -
// except the profile's own owner, who can submit their own (pending R&D
// verification) or edit-and-resubmit a rejected one. The surrounding
// bibliometric stats/IDs stay self-reported on academicProfile.
// Split from PublicationsSection below so callers that already have the list
// (e.g. Management dashboards, which fetch it server-side via a different API
// surface - see ProfileFieldsView.tsx's ResearchModule) can skip the fetch.
export function PublicationsModuleView({ uid, academicProfile, isOwnProfile }: { uid?: string; academicProfile: Partial<FacultyProfileFields> | undefined; isOwnProfile?: boolean }) {
  const [publications, setPublications] = useState<ResearchPublication[] | null>(null);

  function load() {
    const url = uid ? `/api/college/publications?uid=${encodeURIComponent(uid)}` : "/api/college/publications";
    fetch(url)
      .then((r) => r.json() as Promise<{ publications?: ResearchPublication[] }>)
      .then((d) => setPublications(d.publications ?? []))
      .catch(() => setPublications([]));
  }

  useEffect(() => { load(); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  return <PublicationsSection publications={publications} academicProfile={academicProfile} isOwnProfile={isOwnProfile} onChanged={load} />;
}

export function PublicationsSection({
  publications, academicProfile, isOwnProfile, onChanged,
}: {
  publications: ResearchPublication[] | null;
  academicProfile: Partial<FacultyProfileFields> | undefined;
  isOwnProfile?: boolean;
  onChanged?: () => void;
}) {
  const viewerUid = useAuthStore((s) => s.user?.uid);
  const [expanded, setExpanded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPub, setEditingPub] = useState<ResearchPublication | null>(null);

  const sorted = (publications ?? []).slice().sort((a, b) => (b.publicationYear ?? 0) - (a.publicationYear ?? 0));
  const visible = expanded ? sorted : sorted.slice(0, PREVIEW_COUNT);
  const hidden = sorted.length - PREVIEW_COUNT;

  function openAdd() {
    setEditingPub(null);
    setFormOpen(true);
  }

  function openEdit(pub: ResearchPublication) {
    setEditingPub(pub);
    setFormOpen(true);
  }

  return (
    <Section number={3} title="Research Publications">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <SubLabel>Publications</SubLabel>
          {isOwnProfile && (
            <Button variant="outline" size="sm" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5 mr-1" />Add Publication
            </Button>
          )}
        </div>
        {publications === null ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="text-xs text-muted-foreground">None recorded.</p>
        ) : (
          <div className="space-y-2">
            {visible.map((pub) => <PublicationRow key={pub.id} pub={pub} isOwnProfile={isOwnProfile} viewerUid={viewerUid} onEdit={openEdit} />)}
            {sorted.length > PREVIEW_COUNT && (
              <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-medium text-primary hover:underline">
                {expanded ? "Show less" : `Show ${hidden} more`}
              </button>
            )}
          </div>
        )}
      </div>
      {/* Hidden for now - Research Publications is getting a proper field
          redesign (see ResearchInnovationModule's sub-tabs); re-enable once
          that's in and these are re-decided as part of it, not before.
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="First/Corresponding Author Pubs" value={p.publicationsFirstOrCorrespondingAuthor} />
        <Field label="Q1 / IF > 4.0 Pubs" value={p.publicationsQ1OrHighImpact} />
        <Field label="SCI/Scopus Count" value={p.sciScopusCount} />
        <Field label="WoS (SCIE/ESCI) Count" value={p.wosCount} />
        <Field label="Conference Papers" value={p.conferencePapersCount} />
        <Field label="Book Chapters" value={p.bookChaptersCount} />
        <Field label="Review Publications" value={p.reviewPublicationsCount} />
        <Field label="Total Publications" value={p.totalPublications} />
        <Field label="Total Citations" value={p.totalCitations} />
        <Field label="H-Index" value={p.hIndex} />
        <Field label="i10-Index" value={p.i10Index} />
      </div>
      */}

      {isOwnProfile && (
        <AddPublicationDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          editingPub={editingPub}
          onSaved={() => onChanged?.()}
        />
      )}
    </Section>
  );
}
