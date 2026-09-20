"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CertificateUploadField } from "@/components/shared/CertificateUploadField";
import { Trash2, ExternalLink, X } from "lucide-react";
import { splitDegreeAndBranch } from "@/lib/faculty/legacyProfileFallbacks";
import { migrateDegree, migrateStaffQualifications } from "@/lib/faculty/fieldRenames";
import { degreeYear } from "@/types";
import type { DegreeDetail, StaffQualification, PhdStatus, PhdMode } from "@/types";

const PHD_STATUS_OPTIONS: { value: PhdStatus; label: string }[] = [
  { value: "AWARDED", label: "Awarded" },
  { value: "PURSUING", label: "Pursuing" },
];
const PHD_MODE_OPTIONS: { value: PhdMode; label: string }[] = [
  { value: "FULL_TIME", label: "Full-Time" },
  { value: "PART_TIME", label: "Part-Time" },
];

// Education level a DegreeFields block represents. Graduation/Post Graduation/
// Doctoral go through the Domain -> Course cascade below; Post-Doctoral,
// Intermediate (12th) and High School (10th) don't have a "domain" in the
// same sense, so they keep a flat list (or plain text for the two school
// levels, which have no fixed course catalogue to offer).
export type DegreeLevel = "UG" | "PG" | "DOCTORAL" | "POST_DOCTORAL" | "INTERMEDIATE" | "HIGH_SCHOOL";
const DOMAIN_LEVELS: DegreeLevel[] = ["UG", "PG", "DOCTORAL"];
const FLAT_OPTIONS_BY_LEVEL: Partial<Record<DegreeLevel, string[]>> = {
  POST_DOCTORAL: ["Post-Doctoral Fellowship", "D.Sc"],
};

// The two school-level entries offer a fixed Qualification list instead of
// School's old free-text field - "Others" reveals a text box alongside it so
// a board/track not on the list can still be recorded.
const OTHER_QUALIFICATION = "Others";
const HIGH_SCHOOL_QUALIFICATION_OPTIONS = ["SSC", "CBSE", "ICSE", OTHER_QUALIFICATION];
const INTERMEDIATE_QUALIFICATION_OPTIONS = ["Intermediate", "ITI", "Diploma", OTHER_QUALIFICATION];

// Domain shown ahead of Course for Graduation/Post Graduation/Doctoral
// entries - picking a domain narrows the Course dropdown to that domain's
// catalogue (deduplicated across every college type this FMS serves:
// Engineering, Management, Arts & Science, Medicine, Law).
export type EducationDomain = "MANAGEMENT" | "ENGINEERING" | "ARTS_SCIENCE" | "MEDICINE" | "LAW" | "OTHERS";
export const EDUCATION_DOMAIN_LABELS: Record<EducationDomain, string> = {
  MANAGEMENT: "Management",
  ENGINEERING: "Engineering",
  ARTS_SCIENCE: "Arts and Science",
  MEDICINE: "Medicine",
  LAW: "Law",
  OTHERS: "Others",
};
const COURSES_BY_DOMAIN: Record<EducationDomain, string[]> = {
  ENGINEERING: [
    "B.Tech/BE", "M.Tech/ME", "B.Tech - M.Tech Integrated/Dual Degree", "BCA",
    "MCA (2-Year)", "MCA (3-Year)", "MCM", "Diploma in Engineering",
  ],
  MANAGEMENT: [
    "BBA", "B.Com", "M.Com", "BHM", "CA", "CS", "PGDM", "1-Year MBA", "2-Year MBA",
    "Executive MBA", "IPM",
  ],
  ARTS_SCIENCE: [
    "B.Sc.", "M.Sc.", "B.A.", "M.A.", "BS", "MS", "B.Ed", "M.Ed", "B.El.Ed", "B.P.Ed",
    "B.Des.", "M.Des.", "B.Arch.", "M.Arch.", "B.F.Tech.", "M.F.Tech.", "B.Plan", "M.Plan",
    "BFA", "MFA",
  ],
  MEDICINE: [
    "B.Pharma", "M.Pharma", "Pharma. D", "BUMS", "BAMS", "BDS", "BHMS", "MBBS",
    "BVSC", "MVSC", "MS/MD", "MDS", "DM",
  ],
  LAW: ["LLB", "LLM"],
  OTHERS: [],
};

// Shared building blocks for the NBA/AICTE-style profile forms (Teaching Faculty's
// AcademicProfileFields/ProfileFieldsView and Supporting Staff's SupportingStaffProfileFields/
// SupportingStaffProfileView) - extracted so both modules render identical section/field/
// repeating-list UI instead of maintaining two near-duplicate copies.

export const EMPTY_DEGREE: DegreeDetail = {
  course: "", branch: "", specialization: "", institutionName: "", place: "", percentageCgpa: "",
  yearOfPassing: new Date().getFullYear(), hallTicketNumber: "", certificateUrl: "",
};

// A record fetched from Firestore may still carry a legacy shape:
//  - the pre-rename key names (degree/universityOrInstitute/yearOfCompletion...) -
//    lifted through the shared registry (migrateDegree) so DegreeFields/DegreeView
//    work on un-migrated docs wherever they are used;
//  - the older pre-split shape (`degreeAndBranch` combined, no course/branch) -
//    auto-split here rather than in every caller.
// `doctoral` picks which year key applies (yearOfAward vs yearOfPassing); the
// other is dropped so a Doctoral entry never persists a stray yearOfPassing
// (and vice versa) from the shared EMPTY_DEGREE default.
function resolveDegree(v: DegreeDetail | undefined, doctoral: boolean): DegreeDetail {
  const migrated = migrateDegree((v ?? {}) as Record<string, unknown>, doctoral) as Partial<DegreeDetail> & { degreeAndBranch?: string };
  const { degreeAndBranch, ...raw } = migrated;
  const { yearOfPassing: defaultYear, ...emptyBase } = EMPTY_DEGREE;
  const base: DegreeDetail = doctoral ? { ...emptyBase, yearOfAward: defaultYear } : { ...EMPTY_DEGREE };
  const merged: DegreeDetail = { ...base, ...raw };
  if (!merged.course && !merged.branch && degreeAndBranch) {
    const { course, branch } = splitDegreeAndBranch(degreeAndBranch);
    merged.course = course;
    merged.branch = branch;
  }
  if (doctoral) delete merged.yearOfPassing;
  else delete merged.yearOfAward;
  return merged;
}

// ── Editable primitives ─────────────────────────────────────────────────────

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="pt-2 pb-1 border-t"><p className="text-sm font-medium text-muted-foreground">{children}</p></div>;
}

/**
 * The required marker used by the field primitives below. Opt-in per field:
 * a caller that passes nothing renders exactly as before, so adding this
 * changed no existing form.
 */
function RequiredMark({ required }: { required?: boolean }) {
  if (!required) return null;
  return <span className="text-destructive"> *</span>;
}

export function NumInput({ label, value, onChange, required }: { label: string; value: number | undefined; onChange: (v: number) => void; required?: boolean }) {
  return (
    <div className="space-y-2">
      <Label>{label}<RequiredMark required={required} /></Label>
      {/* Empty rather than 0 when unset, so a field nobody has filled in reads
          as blank instead of asserting a value of zero. The leading-zero
          cleanup when typing over an actual 0 lives in Input itself. */}
      <Input type="number" value={value ?? ""} onFocus={(e) => e.target.select()} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function DateInput({
  label, value, onChange, min, max, hint, required,
}: { label: string; value: string | undefined; onChange: (v: string) => void; min?: string; max?: string; hint?: string; required?: boolean }) {
  return (
    <div className="space-y-2">
      <Label>{label}<RequiredMark required={required} /></Label>
      {/* min/max only steer the native picker's own UI - a typed/pasted value
          outside that range still reaches onChange, so a caller enforcing an
          order (e.g. To Date >= From Date) must still re-check it there. */}
      <Input type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value)} min={min} max={max} />
      {/* Helper text (e.g. "leave blank if ongoing") stays out of the label so the
          label itself always equals the stored field's name. */}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function MonthInput({ label, value, onChange, required }: { label: string; value: string | undefined; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div className="space-y-2">
      <Label>{label}<RequiredMark required={required} /></Label>
      {/* "YYYY-MM" - the native month picker, no day component. */}
      <Input type="month" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function TextInput({ label, value, onChange, placeholder, required }: { label: string; value: string | undefined; onChange: (v: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <div className="space-y-2">
      <Label>{label}<RequiredMark required={required} /></Label>
      <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function DegreeFields({
  label, level, value, onChange,
}: {
  label: string; level: DegreeLevel; value: DegreeDetail | undefined; onChange: (v: DegreeDetail) => void;
}) {
  const v = resolveDegree(value, level === "DOCTORAL" || level === "POST_DOCTORAL");
  const hasDomain = DOMAIN_LEVELS.includes(level);
  const domain = v.domain as EducationDomain | undefined;
  // "Others" is a sentinel in v.domain itself (same pattern as Course's own
  // "Other" below) until the user types the real domain name - a legacy
  // value that matches none of the fixed domains also falls into this so it
  // surfaces for correction rather than silently hiding behind an unselected
  // dropdown.
  const domainIsOther = !!domain && !(domain in EDUCATION_DOMAIN_LABELS);
  const courseOptions = hasDomain ? (domain ? (COURSES_BY_DOMAIN[domain] ?? []) : []) : (FLAT_OPTIONS_BY_LEVEL[level] ?? []);
  const courseIsOther = !!v.course && !courseOptions.includes(v.course);
  // Intermediate (12th) and High School (10th) have no fixed course
  // catalogue to offer - just let the qualification name be typed directly.
  const isSchoolLevel = level === "INTERMEDIATE" || level === "HIGH_SCHOOL";
  // Doctoral entries have no Course catalogue of their own (that's what the
  // UG/PG Course dropdowns are for) - they take a free-text Specialization
  // instead, and skip Branch/Percentage-CGPA which don't apply to a PhD.
  const isDoctoral = level === "DOCTORAL";
  const isDoctoralOrPostDoc = level === "DOCTORAL" || level === "POST_DOCTORAL";
  const isUgOrPg = level === "UG" || level === "PG";
  // Records saved before Specialization existed have this in Branch instead -
  // fall back to it (same legacy-migration idea as resolveDegree's
  // degreeAndBranch handling above) so existing PhD entries don't appear to
  // have silently lost their data the moment this field was added.
  const doctoralSpecialization = v.specialization || (isDoctoral ? v.branch : "");
  // The fixed Course list for whichever school-level entry this is -
  // "Others" is a sentinel value in v.course itself (same pattern as the
  // Course dropdown's own "Other" below) until the user types a custom one,
  // so a legacy free-typed value that matches none of these options also
  // falls into it, surfacing the existing text in the box for correction
  // rather than silently hiding it behind an unselected dropdown.
  const schoolQualificationOptions = level === "HIGH_SCHOOL" ? HIGH_SCHOOL_QUALIFICATION_OPTIONS : INTERMEDIATE_QUALIFICATION_OPTIONS;
  const schoolQualificationIsOther = v.course === OTHER_QUALIFICATION || (!!v.course && !schoolQualificationOptions.includes(v.course));

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {isDoctoralOrPostDoc && (
          <>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={v.status ?? ""} onValueChange={(x) => onChange({ ...v, status: x as PhdStatus })}>
                <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>
                  {PHD_STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Mode</Label>
              <Select value={v.mode ?? ""} onValueChange={(x) => onChange({ ...v, mode: x as PhdMode })}>
                <SelectTrigger><SelectValue placeholder="Select mode" /></SelectTrigger>
                <SelectContent>
                  {PHD_MODE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
        {hasDomain && (
          <div className="space-y-2">
            <Label>Domain</Label>
            <Select
              value={domainIsOther ? "OTHERS" : (domain ?? "")}
              onValueChange={(x) => onChange({ ...v, domain: x, course: "" })}
            >
              <SelectTrigger><SelectValue placeholder="Select domain" /></SelectTrigger>
              <SelectContent>
                {Object.entries(EDUCATION_DOMAIN_LABELS).map(([k, lbl]) => <SelectItem key={k} value={k}>{lbl}</SelectItem>)}
              </SelectContent>
            </Select>
            {(domain === "OTHERS" || domainIsOther) && (
              <Input
                value={domain === "OTHERS" ? "" : domain}
                onChange={(e) => onChange({ ...v, domain: e.target.value || "OTHERS" })}
                placeholder="Please specify domain"
              />
            )}
          </div>
        )}
        {isSchoolLevel ? (
          <div className="space-y-2">
            <Label>Course</Label>
            <Select
              value={schoolQualificationIsOther ? OTHER_QUALIFICATION : v.course}
              onValueChange={(x) => onChange({ ...v, course: x })}
            >
              <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
              <SelectContent>
                {schoolQualificationOptions.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
              </SelectContent>
            </Select>
            {schoolQualificationIsOther && (
              <Input
                value={v.course === OTHER_QUALIFICATION ? "" : v.course}
                onChange={(e) => onChange({ ...v, course: e.target.value || OTHER_QUALIFICATION })}
                placeholder="Please specify"
              />
            )}
          </div>
        ) : isDoctoral ? (
          <TextInput label="Specialization" value={doctoralSpecialization} onChange={(x) => onChange({ ...v, specialization: x })} placeholder="e.g. Machine Learning" />
        ) : (
          <div className="space-y-2">
            <Label>Course</Label>
            <Select
              value={courseIsOther ? "Other" : v.course}
              onValueChange={(x) => onChange({ ...v, course: x })}
              disabled={hasDomain && !domain}
            >
              <SelectTrigger><SelectValue placeholder={hasDomain && !domain ? "Select domain first" : "Select course"} /></SelectTrigger>
              <SelectContent>
                {courseOptions.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
            {courseIsOther && (
              <Input
                value={v.course === "Other" ? "" : v.course}
                onChange={(e) => onChange({ ...v, course: e.target.value || "Other" })}
                placeholder="Please specify"
              />
            )}
          </div>
        )}
        {/* Board sits second, right after Course - School/Intermediate
            only, no fixed catalogue, so no equivalent for UG/PG/Doctoral. */}
        {isSchoolLevel && (
          <TextInput label="Board" value={v.board} onChange={(x) => onChange({ ...v, board: x })} placeholder="e.g. State Board" />
        )}
        {!isSchoolLevel && !isDoctoral && (
          <TextInput label="Branch" value={v.branch} onChange={(x) => onChange({ ...v, branch: x })} placeholder="e.g. CSE" />
        )}
        {isUgOrPg ? (
          <>
            <div className="space-y-2">
              <Label>Institution Type</Label>
              <Select
                value={v.institutionType ?? ""}
                onValueChange={(x) => onChange({ ...v, institutionType: x as DegreeDetail["institutionType"] })}
              >
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNIVERSITY">University</SelectItem>
                  <SelectItem value="INSTITUTE">Institute</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <TextInput
              label="Institution Name"
              value={v.institutionName}
              onChange={(x) => onChange({ ...v, institutionName: x })}
            />
            {/* Only when Institute is picked - an Institute is typically
                affiliated to a University, which a plain University entry
                has no separate concept of. */}
            {v.institutionType === "INSTITUTE" && (
              <TextInput
                label="Affiliated University"
                value={v.affiliatedUniversity}
                onChange={(x) => onChange({ ...v, affiliatedUniversity: x })}
                placeholder="Affiliating university"
              />
            )}
          </>
        ) : (
          <TextInput
            label="Institution Name"
            value={v.institutionName}
            onChange={(x) => onChange({ ...v, institutionName: x })}
          />
        )}
        <TextInput label="Place" value={v.place} onChange={(x) => onChange({ ...v, place: x })} placeholder="e.g. Bhimavaram" />
        {!isDoctoral && (
          <TextInput label="Percentage / CGPA" value={v.percentageCgpa} onChange={(x) => onChange({ ...v, percentageCgpa: x })} />
        )}
        {/* Registration precedes the award/pass date - Doctoral/Post-Doctoral
            only, where the two can be years apart. */}
        {isDoctoralOrPostDoc && (
          <NumInput label="Year of Registration" value={v.yearOfRegistration} onChange={(x) => onChange({ ...v, yearOfRegistration: x })} />
        )}
        {isDoctoralOrPostDoc ? (
          // Which of the two shows depends on this entry's own Status above -
          // not yet awarded means no year yet, but a guide/supervisor instead.
          v.status === "AWARDED" ? (
            <NumInput label="Year of Award" value={v.yearOfAward} onChange={(x) => onChange({ ...v, yearOfAward: x })} />
          ) : v.status === "PURSUING" ? (
            <TextInput label="Name of the Guide / Supervisor" value={v.nameOfTheGuideSupervisor} onChange={(x) => onChange({ ...v, nameOfTheGuideSupervisor: x })} />
          ) : null
        ) : (
          <NumInput label="Year of Passing" value={v.yearOfPassing} onChange={(x) => onChange({ ...v, yearOfPassing: x })} />
        )}
        <TextInput label="Hall Ticket Number" value={v.hallTicketNumber} onChange={(x) => onChange({ ...v, hallTicketNumber: x })} />
      </div>
      {isDoctoral && v.percentageCgpa && (
        <p className="text-xs text-muted-foreground italic">Legacy note: Percentage/CGPA on file for this entry - {v.percentageCgpa}</p>
      )}
      <CertificateUploadField
        label="Certificate"
        value={v.certificateUrl}
        onUploaded={(url) => onChange({ ...v, certificateUrl: url })}
        onRemoved={() => onChange({ ...v, certificateUrl: "" })}
      />
    </div>
  );
}

// A list of DegreeFields blocks with Add More / remove - for qualification
// levels a person can hold more than one of (e.g. two Master's degrees or
// two doctorates). Each entry is a full DegreeDetail, same shape as the
// single-block DegreeFields above.
export function DegreeFieldsList({ label, level, items, onChange }: {
  label: string; level: DegreeLevel; items: DegreeDetail[] | undefined; onChange: (v: DegreeDetail[]) => void;
}) {
  const list = items ?? [];
  return (
    <div className="space-y-3">
      {list.map((item, i) => (
        <div key={i} className="relative">
          <DegreeFields
            label={`${label} ${i + 2}`}
            level={level}
            value={item}
            onChange={(v) => { const next = [...list]; next[i] = v; onChange(next); }}
          />
          <Button
            type="button" variant="ghost" size="sm"
            className="absolute right-2 top-2 h-7 w-7 p-0 text-destructive hover:text-destructive"
            onClick={() => onChange(list.filter((_, idx) => idx !== i))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...list, { ...EMPTY_DEGREE }])}>
        Add another {label}
      </Button>
    </div>
  );
}

export function RepeatingGroup<T>({
  title, items, empty, onChange, renderRow, addLabel = "Add More",
}: {
  title: string;
  items: T[] | undefined;
  // A plain object is reused as-is for every new row (existing behavior).
  // Pass a function instead when each new row needs its own unique value
  // (e.g. a fresh id) rather than sharing one object reference - see the
  // FDP/Workshop/MOOC training-entries list, whose rows need a stable id
  // for cross-profile co-conductor sync.
  empty: T | (() => T);
  onChange: (next: T[]) => void;
  renderRow: (item: T, update: (patch: Partial<T>) => void) => React.ReactNode;
  addLabel?: string;
}) {
  const list = items ?? [];
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...list, typeof empty === "function" ? (empty as () => T)() : empty])}>
          {addLabel}
        </Button>
      </div>
      {list.length === 0 && <p className="text-xs text-muted-foreground">None added yet.</p>}
      {list.map((item, i) => (
        <div key={i} className="flex items-start gap-2 rounded-md bg-muted/30 p-3">
          <div className="flex-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {renderRow(item, (patch) => {
              const next = [...list];
              next[i] = { ...next[i], ...patch };
              onChange(next);
            })}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(list.filter((_, idx) => idx !== i))}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ))}
    </div>
  );
}

// A repeating list edited as an actual table (Sl. No. + one column per
// field) rather than RepeatingGroup's stacked cards - used wherever the
// source spec calls for a literal table (e.g. Equipment Procured / Papers
// Published / Patents under Research & Innovation's Seed Funding and
// Sponsored Research Projects tabs).
export function TableRepeatingGroup<T>({
  title, items, empty, onChange, addLabel = "Add Row", columns,
}: {
  title: string;
  items: T[];
  empty: T;
  onChange: (next: T[]) => void;
  addLabel?: string;
  columns: { header: string; render: (item: T, update: (patch: Partial<T>) => void) => React.ReactNode }[];
}) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, empty])}>
          {addLabel}
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">None added yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left font-medium text-muted-foreground p-1.5 w-10">Sl. No.</th>
                {columns.map((c) => (
                  <th key={c.header} className="text-left font-medium text-muted-foreground p-1.5 min-w-[140px]">{c.header}</th>
                ))}
                <th className="p-1.5 w-8" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="p-1.5 align-top text-muted-foreground">{i + 1}</td>
                  {columns.map((c) => (
                    <td key={c.header} className="p-1.5 align-top">
                      {c.render(item, (patch) => {
                        const next = [...items];
                        next[i] = { ...next[i], ...patch };
                        onChange(next);
                      })}
                    </td>
                  ))}
                  <td className="p-1.5 align-top">
                    <Button type="button" variant="ghost" size="sm" onClick={() => onChange(items.filter((_, idx) => idx !== i))}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Shared by Supporting Staff (every college type) and Faculty at School-type
// colleges (see College.type, src/lib/designations/config.ts) - a repeating
// list of {level, course/institution/year/certificate} entries, standing in
// for the fixed UG/PG/PhD DegreeFields slots when the qualification
// vocabulary doesn't fit that shape (e.g. SSC/Intermediate/Degree/PG/BEd-
// DEd-MEd/APTET/CTET/Pandit Training Certificate for school teachers).
// `levelOptions` drives the Level dropdown; a value outside that list (e.g.
// from data entered before the option list changed) still displays/edits via
// the "Other" free-text fallback, same pattern as DegreeFields' Course field.
export function QualificationsFields({
  items: rawItems, levelOptions, onChange, title = "Educational Qualifications",
}: {
  items: StaffQualification[] | undefined;
  levelOptions: string[];
  onChange: (next: StaffQualification[]) => void;
  title?: string;
}) {
  // Lift legacy key names (degree/yearOfCompletion/...) so the form shows
  // un-migrated data and onChange always emits the new shape.
  const items = migrateStaffQualifications(rawItems) as StaffQualification[] | undefined;
  const empty: StaffQualification = {
    level: "", course: "", branch: "", institutionName: "", place: "", percentageCgpa: "",
    yearOfPassing: new Date().getFullYear(), hallTicketNumber: "", certificateUrl: "",
  };
  return (
    <RepeatingGroup
      title={title}
      items={items}
      empty={empty}
      onChange={onChange}
      renderRow={(item, update) => {
        const levelIsOther = !!item.level && !levelOptions.includes(item.level);
        return (
          <>
            <div className="space-y-2">
              <Label>Level</Label>
              <Select value={levelIsOther ? "Other" : item.level} onValueChange={(v) => update({ level: v })}>
                <SelectTrigger><SelectValue placeholder="Select level" /></SelectTrigger>
                <SelectContent>
                  {levelOptions.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
              {levelIsOther && (
                <Input
                  value={item.level === "Other" ? "" : item.level}
                  onChange={(e) => update({ level: e.target.value || "Other" })}
                  placeholder="Please specify"
                />
              )}
            </div>
            <TextInput label="Course" value={item.course} onChange={(v) => update({ course: v })} />
            <TextInput label="Institution Name" value={item.institutionName} onChange={(v) => update({ institutionName: v })} />
            <TextInput label="Place" value={item.place} onChange={(v) => update({ place: v })} placeholder="e.g. Bhimavaram" />
            <TextInput label="Percentage / CGPA" value={item.percentageCgpa} onChange={(v) => update({ percentageCgpa: v })} />
            <NumInput label="Year of Passing" value={item.yearOfPassing} onChange={(v) => update({ yearOfPassing: v })} />
            <TextInput label="Hall Ticket Number" value={item.hallTicketNumber} onChange={(v) => update({ hallTicketNumber: v })} />
            <div className="sm:col-span-2">
              <CertificateUploadField
                label="Certificate"
                value={item.certificateUrl}
                onUploaded={(url) => update({ certificateUrl: url })}
                onRemoved={() => update({ certificateUrl: "" })}
              />
            </div>
          </>
        );
      }}
    />
  );
}

export function QualificationsView({ items, title = "Educational Qualifications" }: { items: StaffQualification[] | undefined; title?: string }) {
  const list = (migrateStaffQualifications(items) as StaffQualification[] | undefined) ?? [];
  return (
    <div className="space-y-2">
      <SubLabel>{title}</SubLabel>
      {list.length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
        list.map((item, i) => (
          <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Field label="Level" value={item.level} />
            <Field label="Course" value={item.course} />
            <Field label="Institution Name" value={item.institutionName} />
            <Field label="Place" value={item.place} />
            <Field label="Percentage / CGPA" value={item.percentageCgpa} />
            <Field label="Year of Passing" value={item.yearOfPassing} />
            <Field label="Hall Ticket Number" value={item.hallTicketNumber} />
            {item.certificateUrl && (
              <div className="col-span-2 sm:col-span-3"><DocLink url={item.certificateUrl} label="View Certificate" /></div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// Checkbox group for a fixed enum of options (e.g. responsibilities, professional bodies).
export function CheckboxGroup<T extends string>({
  title, options, selected, onChange,
}: {
  title: string;
  options: { value: T; label: string }[];
  selected: T[] | undefined;
  onChange: (next: T[]) => void;
}) {
  const list = selected ?? [];
  function toggle(value: T, checked: boolean) {
    onChange(checked ? [...list, value] : list.filter((v) => v !== value));
  }
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((opt) => (
          <label key={opt.value} className="flex items-center gap-1.5 text-sm">
            <Checkbox checked={list.includes(opt.value)} onCheckedChange={(c) => toggle(opt.value, !!c)} />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  );
}

// Free-form list of strings (e.g. programming languages, operating systems) - type a
// value, press Enter or click Add, remove via the chip's x.
export function StringListInput({ label, values, onChange, placeholder }: {
  label: string; values: string[] | undefined; onChange: (next: string[]) => void; placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const list = values ?? [];
  function add() {
    const v = draft.trim();
    if (v && !list.includes(v)) onChange([...list, v]);
    setDraft("");
  }
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder}
        />
        <Button type="button" variant="outline" onClick={add}>Add</Button>
      </div>
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
              {v}
              <button type="button" onClick={() => onChange(list.filter((x) => x !== v))} className="hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Read-only primitives ────────────────────────────────────────────────────

export function Section({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 pt-5 border-t first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          {number}
        </span>
        <p className="text-sm font-semibold">{title}</p>
      </div>
      {children}
    </div>
  );
}

export function SubLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{children}</p>;
}

export function Field({ label, value }: { label: string; value: string | number | undefined | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value === undefined || value === null || value === "" ? "-" : value}</p>
    </div>
  );
}

const PHD_STATUS_VIEW_LABELS: Record<PhdStatus, string> = { AWARDED: "Awarded", PURSUING: "Pursuing" };
const PHD_MODE_VIEW_LABELS: Record<PhdMode, string> = { FULL_TIME: "Full-Time", PART_TIME: "Part-Time" };

export function DegreeView({
  label, degree: degreeInput, level,
}: { label: string; degree: DegreeDetail | undefined; level?: DegreeLevel }) {
  const degree = resolveDegree(degreeInput, level === "DOCTORAL" || level === "POST_DOCTORAL");
  const isDoctoral = level === "DOCTORAL";
  const isDoctoralOrPostDoc = level === "DOCTORAL" || level === "POST_DOCTORAL";
  const isUgOrPg = level === "UG" || level === "PG";
  const isSchoolLevel = level === "INTERMEDIATE" || level === "HIGH_SCHOOL";
  // Records saved before Specialization existed have this in Branch instead -
  // same legacy fallback as DegreeFields, so it doesn't just disappear.
  const doctoralSpecialization = degree?.specialization || (isDoctoral ? degree?.branch : "");
  return (
    <div className="rounded-lg border bg-muted/20 shadow-sm p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
      <p className="col-span-2 sm:col-span-4 text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      {isDoctoralOrPostDoc && (
        <>
          <Field label="Status" value={degree?.status ? PHD_STATUS_VIEW_LABELS[degree.status] : undefined} />
          <Field label="Mode" value={degree?.mode ? PHD_MODE_VIEW_LABELS[degree.mode] : undefined} />
        </>
      )}
      {degree?.domain && <Field label="Domain" value={EDUCATION_DOMAIN_LABELS[degree.domain as EducationDomain] ?? degree.domain} />}
      {/* Doctoral has no Course input - only render the row when a value exists. */}
      {degree?.course && <Field label="Course" value={degree.course} />}
      {isDoctoral ? (
        <Field label="Specialization" value={doctoralSpecialization} />
      ) : !isSchoolLevel ? (
        <Field label="Branch" value={degree?.branch} />
      ) : null}
      {isSchoolLevel && <Field label="Board" value={degree?.board} />}
      {isUgOrPg ? (
        <>
          <Field label="Institution Type" value={degree?.institutionType === "INSTITUTE" ? "Institute" : degree?.institutionType === "UNIVERSITY" ? "University" : undefined} />
          <Field label="Institution Name" value={degree?.institutionName} />
          {degree?.institutionType === "INSTITUTE" && <Field label="Affiliated University" value={degree?.affiliatedUniversity} />}
        </>
      ) : (
        <Field label="Institution Name" value={degree?.institutionName} />
      )}
      <Field label="Place" value={degree?.place} />
      {!isDoctoral && <Field label="Percentage / CGPA" value={degree?.percentageCgpa} />}
      {isDoctoral && degree?.percentageCgpa && <Field label="Percentage / CGPA (legacy)" value={degree.percentageCgpa} />}
      {isDoctoralOrPostDoc && <Field label="Year of Registration" value={degree?.yearOfRegistration} />}
      {isDoctoralOrPostDoc ? (
        degree?.status === "AWARDED" ? (
          <Field label="Year of Award" value={degreeYear(degree, true)} />
        ) : degree?.status === "PURSUING" ? (
          <Field label="Name of the Guide / Supervisor" value={degree?.nameOfTheGuideSupervisor} />
        ) : null
      ) : (
        <Field label="Year of Passing" value={degreeYear(degree, false)} />
      )}
      <Field label="Hall Ticket Number" value={degree?.hallTicketNumber} />
      {degree?.certificateUrl && (
        <div className="col-span-2 sm:col-span-4">
          <a
            href={degree.certificateUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />View Certificate
          </a>
        </div>
      )}
    </div>
  );
}

export function DocLink({ url, label = "View Document" }: { url: string | undefined; label?: string }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
    >
      <ExternalLink className="h-3.5 w-3.5" />{label}
    </a>
  );
}

// A labelled document link for the read-only views: the label is the stored
// field's own name (e.g. "Promotion Order"), the link text just says "View".
export function DocField({ label, url }: { label: string; url: string | undefined }) {
  if (!url) return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <DocLink url={url} label="View" />
    </div>
  );
}

export function ChipList({ values }: { values: string[] | undefined }) {
  const list = values ?? [];
  if (list.length === 0) return <p className="text-xs text-muted-foreground">None recorded.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((v) => (
        <span key={v} className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs">{v}</span>
      ))}
    </div>
  );
}
