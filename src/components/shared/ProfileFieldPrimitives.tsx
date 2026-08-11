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
import type { DegreeDetail, StaffQualification } from "@/types";

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
  degree: "", branch: "", specialization: "", universityOrInstitute: "", percentageOrDivision: "",
  yearOfCompletion: new Date().getFullYear(), certificateUrl: "",
};

// A record fetched from Firestore may still have the pre-split shape
// (`degreeAndBranch` combined, no `degree`/`branch` yet) if it hasn't been
// re-saved since the split - auto-split it for display/editing here rather
// than in every caller, so the fallback applies wherever DegreeFields/
// DegreeView are used.
function resolveDegree(v: DegreeDetail | undefined): DegreeDetail {
  const raw = (v ?? EMPTY_DEGREE) as DegreeDetail & { degreeAndBranch?: string };
  if ((raw.degree || raw.branch) || !raw.degreeAndBranch) return { ...EMPTY_DEGREE, ...raw };
  const { degree, branch } = splitDegreeAndBranch(raw.degreeAndBranch);
  return { ...EMPTY_DEGREE, ...raw, degree, branch };
}

// ── Editable primitives ─────────────────────────────────────────────────────

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="pt-2 pb-1 border-t"><p className="text-sm font-medium text-muted-foreground">{children}</p></div>;
}

export function NumInput({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {/* Empty rather than 0 when unset, so a field nobody has filled in reads
          as blank instead of asserting a value of zero. The leading-zero
          cleanup when typing over an actual 0 lives in Input itself. */}
      <Input type="number" value={value ?? ""} onFocus={(e) => e.target.select()} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function TextInput({ label, value, onChange, placeholder }: { label: string; value: string | undefined; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function DegreeFields({ label, level, value, onChange }: { label: string; level: DegreeLevel; value: DegreeDetail | undefined; onChange: (v: DegreeDetail) => void }) {
  const v = resolveDegree(value);
  const hasDomain = DOMAIN_LEVELS.includes(level);
  const domain = v.domain as EducationDomain | undefined;
  const courseOptions = hasDomain ? (domain ? (COURSES_BY_DOMAIN[domain] ?? []) : []) : (FLAT_OPTIONS_BY_LEVEL[level] ?? []);
  const degreeIsOther = !!v.degree && !courseOptions.includes(v.degree);
  // Intermediate (12th) and High School (10th) have no fixed course
  // catalogue to offer - just let the qualification name be typed directly.
  const isSchoolLevel = level === "INTERMEDIATE" || level === "HIGH_SCHOOL";
  // Doctoral entries have no Course catalogue of their own (that's what the
  // UG/PG Course dropdowns are for) - they take a free-text Specialization
  // instead, and skip Branch/Percentage-CGPA which don't apply to a PhD.
  const isDoctoral = level === "DOCTORAL";
  // Records saved before Specialization existed have this in Branch instead -
  // fall back to it (same legacy-migration idea as resolveDegree's
  // degreeAndBranch handling above) so existing PhD entries don't appear to
  // have silently lost their data the moment this field was added.
  const doctoralSpecialization = v.specialization || (isDoctoral ? v.branch : "");

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {hasDomain && (
          <div className="space-y-2">
            <Label>Domain</Label>
            <Select
              value={domain ?? ""}
              onValueChange={(x) => onChange({ ...v, domain: x, degree: "" })}
            >
              <SelectTrigger><SelectValue placeholder="Select domain" /></SelectTrigger>
              <SelectContent>
                {Object.entries(EDUCATION_DOMAIN_LABELS).map(([k, lbl]) => <SelectItem key={k} value={k}>{lbl}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {isSchoolLevel ? (
          <TextInput label="Qualification" value={v.degree} onChange={(x) => onChange({ ...v, degree: x })} placeholder={level === "HIGH_SCHOOL" ? "e.g. SSC / State Board" : "e.g. MPC, State Board"} />
        ) : isDoctoral ? (
          <TextInput label="Specialization" value={doctoralSpecialization} onChange={(x) => onChange({ ...v, specialization: x })} placeholder="e.g. Machine Learning" />
        ) : (
          <div className="space-y-2">
            <Label>Course</Label>
            <Select
              value={degreeIsOther ? "Other" : v.degree}
              onValueChange={(x) => onChange({ ...v, degree: x })}
              disabled={hasDomain && !domain}
            >
              <SelectTrigger><SelectValue placeholder={hasDomain && !domain ? "Select domain first" : "Select course"} /></SelectTrigger>
              <SelectContent>
                {courseOptions.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
            {degreeIsOther && (
              <Input
                value={v.degree === "Other" ? "" : v.degree}
                onChange={(e) => onChange({ ...v, degree: e.target.value || "Other" })}
                placeholder="Please specify"
              />
            )}
          </div>
        )}
        {!isSchoolLevel && !isDoctoral && (
          <TextInput label="Branch" value={v.branch} onChange={(x) => onChange({ ...v, branch: x })} placeholder="e.g. CSE" />
        )}
        <TextInput label="University / Institute" value={v.universityOrInstitute} onChange={(x) => onChange({ ...v, universityOrInstitute: x })} />
        {!isDoctoral && (
          <TextInput label="Percentage / CGPA" value={v.percentageOrDivision} onChange={(x) => onChange({ ...v, percentageOrDivision: x })} />
        )}
        <NumInput label="Year of Completion" value={v.yearOfCompletion} onChange={(x) => onChange({ ...v, yearOfCompletion: x })} />
      </div>
      {isDoctoral && v.percentageOrDivision && (
        <p className="text-xs text-muted-foreground italic">Legacy note: Percentage/CGPA on file for this entry - {v.percentageOrDivision}</p>
      )}
      <CertificateUploadField
        value={v.certificateUrl}
        onUploaded={(url) => onChange({ ...v, certificateUrl: url })}
        onRemoved={() => onChange({ ...v, certificateUrl: "" })}
      />
    </div>
  );
}

export function RepeatingGroup<T>({
  title, items, empty, onChange, renderRow, addLabel = "Add More",
}: {
  title: string;
  items: T[] | undefined;
  empty: T;
  onChange: (next: T[]) => void;
  renderRow: (item: T, update: (patch: Partial<T>) => void) => React.ReactNode;
  addLabel?: string;
}) {
  const list = items ?? [];
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...list, empty])}>
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

// Shared by Supporting Staff (every college type) and Faculty at School-type
// colleges (see College.type, src/lib/designations/config.ts) - a repeating
// list of {level, degree/university/year/certificate} entries, standing in
// for the fixed UG/PG/PhD DegreeFields slots when the qualification
// vocabulary doesn't fit that shape (e.g. SSC/Intermediate/Degree/PG/BEd-
// DEd-MEd/APTET/CTET/Pandit Training Certificate for school teachers).
// `levelOptions` drives the Level dropdown; a value outside that list (e.g.
// from data entered before the option list changed) still displays/edits via
// the "Other" free-text fallback, same pattern as DegreeFields' Course field.
export function QualificationsFields({
  items, levelOptions, onChange, title = "Educational Qualifications",
}: {
  items: StaffQualification[] | undefined;
  levelOptions: string[];
  onChange: (next: StaffQualification[]) => void;
  title?: string;
}) {
  const empty: StaffQualification = {
    level: "", degree: "", branch: "", universityOrInstitute: "", percentageOrDivision: "",
    yearOfCompletion: new Date().getFullYear(), certificateUrl: "",
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
            <TextInput label="Degree / Certificate Name" value={item.degree} onChange={(v) => update({ degree: v })} />
            <TextInput label="University / Institute / Board" value={item.universityOrInstitute} onChange={(v) => update({ universityOrInstitute: v })} />
            <TextInput label="Percentage / CGPA" value={item.percentageOrDivision} onChange={(v) => update({ percentageOrDivision: v })} />
            <NumInput label="Year of Completion" value={item.yearOfCompletion} onChange={(v) => update({ yearOfCompletion: v })} />
            <div className="sm:col-span-2">
              <Label className="text-xs">Certificate</Label>
              <CertificateUploadField
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
  const list = items ?? [];
  return (
    <div className="space-y-2">
      <SubLabel>{title}</SubLabel>
      {list.length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
        list.map((item, i) => (
          <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Field label="Level" value={item.level} />
            <Field label="Degree / Certificate Name" value={item.degree} />
            <Field label="University / Institute / Board" value={item.universityOrInstitute} />
            <Field label="Percentage / CGPA" value={item.percentageOrDivision} />
            <Field label="Year of Completion" value={item.yearOfCompletion} />
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

export function DegreeView({ label, degree: degreeInput, level }: { label: string; degree: DegreeDetail | undefined; level?: DegreeLevel }) {
  const degree = resolveDegree(degreeInput);
  const isDoctoral = level === "DOCTORAL";
  // Records saved before Specialization existed have this in Branch instead -
  // same legacy fallback as DegreeFields, so it doesn't just disappear.
  const doctoralSpecialization = degree?.specialization || (isDoctoral ? degree?.branch : "");
  return (
    <div className="rounded-lg border bg-muted/20 shadow-sm p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
      <p className="col-span-2 sm:col-span-4 text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      {degree?.domain && <Field label="Domain" value={EDUCATION_DOMAIN_LABELS[degree.domain as EducationDomain] ?? degree.domain} />}
      <Field label="Degree" value={degree?.degree} />
      {isDoctoral ? (
        <Field label="Specialization" value={doctoralSpecialization} />
      ) : (
        <Field label="Branch" value={degree?.branch} />
      )}
      <Field label="University / Institute" value={degree?.universityOrInstitute} />
      {!isDoctoral && <Field label="Percentage / CGPA" value={degree?.percentageOrDivision} />}
      {isDoctoral && degree?.percentageOrDivision && <Field label="Percentage / CGPA (legacy)" value={degree.percentageOrDivision} />}
      <Field label="Year of Completion" value={degree?.yearOfCompletion} />
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
