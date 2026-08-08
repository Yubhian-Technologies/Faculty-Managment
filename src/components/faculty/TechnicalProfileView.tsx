"use client";

import { SubLabel, Field, DocLink, ChipList } from "@/components/shared/ProfileFieldPrimitives";
import {
  TECHNICAL_RESPONSIBILITY_LABELS, VENDOR_CERTIFICATION_LABELS, TRAINING_ENTRY_TYPE_LABELS, AWARD_CATEGORY_LABELS,
} from "@/types";
import type { TechnicalProfile } from "@/types";

interface Props {
  profile: Partial<TechnicalProfile> | undefined;
}

// Read-only counterpart to TechnicalStaffProfileFields - for TECHNICAL_STAFF_DESIGNATIONS
// faculty (Lab Assistant/Programmer/System Administrator/Network Engineer), who have a
// technicalProfile instead of an academicProfile (see ProfileFieldsView for that side).
export function TechnicalProfileView({ profile }: Props) {
  const p = profile ?? {};
  const skills = p.skills;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <SubLabel>Technical Skills</SubLabel>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><p className="text-xs text-muted-foreground mb-1">Programming Languages</p><ChipList values={skills?.programmingLanguages} /></div>
          <div><p className="text-xs text-muted-foreground mb-1">Operating Systems</p><ChipList values={skills?.operatingSystems} /></div>
          <div><p className="text-xs text-muted-foreground mb-1">Networking</p><ChipList values={skills?.networking} /></div>
          <div><p className="text-xs text-muted-foreground mb-1">Database</p><ChipList values={skills?.databases} /></div>
          <div><p className="text-xs text-muted-foreground mb-1">Cloud</p><ChipList values={skills?.cloud} /></div>
          <div><p className="text-xs text-muted-foreground mb-1">Hardware</p><ChipList values={skills?.hardware} /></div>
          <div><p className="text-xs text-muted-foreground mb-1">Software Tools</p><ChipList values={skills?.softwareTools} /></div>
        </div>
      </div>

      <div className="space-y-2">
        <SubLabel>Responsibilities</SubLabel>
        <ChipList values={(p.responsibilities ?? []).map((r) => TECHNICAL_RESPONSIBILITY_LABELS[r] ?? r)} />
        {p.otherResponsibility && <Field label="Other Responsibility" value={p.otherResponsibility} />}
      </div>

      <div className="space-y-2">
        <SubLabel>Vendor Certifications</SubLabel>
        {(p.certifications ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          p.certifications?.map((c, i) => (
            <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Field label="Vendor" value={c.vendor === "OTHER" ? c.otherVendorName : VENDOR_CERTIFICATION_LABELS[c.vendor]} />
              <Field label="Certification" value={c.certificationName} />
              <Field label="Year" value={c.year} />
              {c.certificateUrl && (
                <div className="col-span-2 sm:col-span-4"><DocLink url={c.certificateUrl} label="View Certificate" /></div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <SubLabel>Training</SubLabel>
        {(p.training ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          p.training?.map((t, i) => (
            <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Field label="Type" value={TRAINING_ENTRY_TYPE_LABELS[t.type]} />
              <Field label="Title" value={t.title} />
              <Field label="Organizer" value={t.organizer} />
              <Field label="Year" value={t.year} />
              {t.certificateUrl && (
                <div className="col-span-2 sm:col-span-4"><DocLink url={t.certificateUrl} label="View Certificate" /></div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <SubLabel>Innovations / Automation Developed</SubLabel>
        <p className="text-sm whitespace-pre-wrap">{p.innovationsAndAutomation || "-"}</p>
      </div>

      <div className="space-y-2">
        <SubLabel>Achievements</SubLabel>
        {(p.achievements ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          p.achievements?.map((a, i) => (
            <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Field label="Category" value={AWARD_CATEGORY_LABELS[a.category]} />
              <Field label="Title" value={a.title} />
              <Field label="Awarding Body" value={a.awardingBody} />
              <Field label="Year" value={a.year} />
              {a.certificateUrl && (
                <div className="col-span-2 sm:col-span-4"><DocLink url={a.certificateUrl} label="View Certificate" /></div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
