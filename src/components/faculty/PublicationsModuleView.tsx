"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Plus, Pencil } from "lucide-react";
import { Section, SubLabel, Field } from "@/components/shared/ProfileFieldPrimitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import type { FacultyProfileFields, ResearchPublication } from "@/types";

const PREVIEW_COUNT = 3;

// Bibliometric/report fields (from R&D's import) are only shown when
// present, so older hand-entered records don't sprout a wall of "-".
function PublicationRow({ pub, isOwnProfile, onEdit }: { pub: ResearchPublication; isOwnProfile?: boolean; onEdit?: (pub: ResearchPublication) => void }) {
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
      {isOwnProfile && pub.status && pub.status !== "APPROVED" && (
        <div className="flex items-center gap-2">
          {pub.status === "PENDING" ? (
            <Badge variant="pending" className="text-xs">Pending Verification</Badge>
          ) : (
            <>
              <Badge variant="rejected" className="text-xs">Rejected</Badge>
              {onEdit && (
                <button type="button" onClick={() => onEdit(pub)} className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1">
                  <Pencil className="h-3 w-3" />Edit &amp; Resubmit
                </button>
              )}
            </>
          )}
        </div>
      )}
      {pub.status === "REJECTED" && pub.rejectionReason && (
        <p className="text-xs text-destructive">Reason: {pub.rejectionReason}</p>
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

interface PublicationFormState {
  title: string;
  coAuthors: string;
  journalOrConference: string;
  publicationYear: string;
  indexing: string;
  driveLink: string;
}

const EMPTY_FORM: PublicationFormState = {
  title: "", coAuthors: "", journalOrConference: "", publicationYear: String(new Date().getFullYear()), indexing: "", driveLink: "",
};

// Self-submit form - the same fields R&D's own Add Publication page collects
// (src/app/(dashboard)/r-and-d/publications/new/page.tsx), minus the staff
// picker (the server infers the submitter from their own session). Also
// reused to edit-and-resubmit a REJECTED entry - same fields, PATCH instead
// of POST.
function initialFormState(editingPub: ResearchPublication | null): PublicationFormState {
  return editingPub
    ? {
        title: editingPub.title, coAuthors: editingPub.coAuthors, journalOrConference: editingPub.journalOrConference,
        publicationYear: String(editingPub.publicationYear), indexing: editingPub.indexing ?? "", driveLink: editingPub.driveLink ?? "",
      }
    : EMPTY_FORM;
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
  const [form, setForm] = useState<PublicationFormState>(() => initialFormState(editingPub));
  const [saving, setSaving] = useState(false);
  const editingId = editingPub?.id ?? null;

  function set<K extends keyof PublicationFormState>(key: K, value: PublicationFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const isValid = form.title.trim().length > 1 && form.journalOrConference.trim().length > 1 && !!form.publicationYear;

  async function handleSubmit() {
    if (!isValid) return;
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        coAuthors: form.coAuthors.trim(),
        journalOrConference: form.journalOrConference.trim(),
        publicationYear: Number(form.publicationYear),
        indexing: form.indexing.trim(),
        driveLink: form.driveLink.trim(),
      };
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
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Title <span className="text-destructive">*</span></Label>
          <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Paper title" />
        </div>
        <div className="space-y-2">
          <Label>Co-Authors</Label>
          <Input value={form.coAuthors} onChange={(e) => set("coAuthors", e.target.value)} placeholder="Comma-separated names" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Journal / Conference <span className="text-destructive">*</span></Label>
            <Input value={form.journalOrConference} onChange={(e) => set("journalOrConference", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Year <span className="text-destructive">*</span></Label>
            <Input type="number" value={form.publicationYear} onChange={(e) => set("publicationYear", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Indexing</Label>
            <Input value={form.indexing} onChange={(e) => set("indexing", e.target.value)} placeholder="e.g. SCI, Scopus, WoS, UGC-CARE" />
          </div>
          <div className="space-y-2">
            <Label>Publication Link</Label>
            <Input value={form.driveLink} onChange={(e) => set("driveLink", e.target.value)} placeholder="DOI / Scopus / Drive link" />
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
      <DialogContent className="max-w-lg">
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
  const p = academicProfile ?? {};
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
            {visible.map((pub) => <PublicationRow key={pub.id} pub={pub} isOwnProfile={isOwnProfile} onEdit={openEdit} />)}
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Google Scholar ID" value={p.googleScholarId} />
        <Field label="Scopus Author ID" value={p.scopusAuthorId} />
        <Field label="ORCID iD" value={p.orcidId} />
      </div>

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
