"use client";

import {
  Select, SelectContent, SelectTrigger, SelectValue,
  SelectGroup, SelectLabel, SelectItem, SelectSeparator,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  getTeachingDesignations, getSupportingDesignations, getNonTechnicalDesignations, designationLabel,
} from "@/lib/designations/config";
import type { CollegeType } from "@/types";

// Faculty (FacultyMember) is teaching-only; "supporting" is the full
// Supporting Staff list (Salary Structures, Budget line items - covers
// both Technical and Non-Technical since those cover the whole payroll);
// "non-technical" is College Office/Principal's Non-Technical-only picker
// (excludes whatever HOD's Technical module owns, for the college types
// that split - Degree/Polytechnic; identical to "supporting" everywhere
// else); "both" combines teaching + the full supporting list.
type DesignationKind = "teaching" | "supporting" | "non-technical" | "both";

interface Props {
  collegeType: CollegeType | undefined;
  kind?: DesignationKind;
}

// Which catalogues a `kind` draws from. Shared by the option list and by
// DesignationSelect's "is this value off-catalogue?" test, so the two can
// never disagree about what counts as a known designation.
function designationsForKind(collegeType: CollegeType | undefined, kind: DesignationKind) {
  const teaching = kind !== "supporting" && kind !== "non-technical" ? getTeachingDesignations(collegeType) : [];
  const supporting = kind === "teaching"
    ? []
    : kind === "non-technical"
      ? getNonTechnicalDesignations(collegeType)
      : getSupportingDesignations(collegeType);
  return { teaching, supporting };
}

// Shared designation option list, sourced from the per-college-type
// catalogues in src/lib/designations/config.ts (Faculty add/edit, Supporting
// Staff add/edit, Salary Structures) - keeps Teaching and Supporting
// designations visually grouped and labeled rather than one undifferentiated
// list. Always ends with a free-text "Other" escape hatch.
export function DesignationOptions({ collegeType, kind = "both" }: Props) {
  const { teaching, supporting } = designationsForKind(collegeType, kind);
  return (
    <>
      {teaching.length > 0 && (
        <SelectGroup>
          <SelectLabel>Teaching</SelectLabel>
          {teaching.map((v) => (
            <SelectItem key={v} value={v}>{designationLabel(v)}</SelectItem>
          ))}
        </SelectGroup>
      )}
      {teaching.length > 0 && supporting.length > 0 && <SelectSeparator />}
      {supporting.length > 0 && (
        <SelectGroup>
          <SelectLabel>Supporting</SelectLabel>
          {supporting.map((v) => (
            <SelectItem key={v} value={v}>{designationLabel(v)}</SelectItem>
          ))}
        </SelectGroup>
      )}
      <SelectSeparator />
      <SelectItem value="OTHER">Other</SelectItem>
    </>
  );
}

// A complete designation field - label + dropdown + "Other" free-text escape
// hatch - for the places that record a designation outside the Faculty/
// Supporting Staff add forms (currently Promotion History's From/To, which
// used to be plain text boxes).
//
// Two things force the fallback: promotion records written before this picker
// existed hold arbitrary free text, and the catalogue itself varies by college
// type, so a value valid at one college won't appear in another's list.
// Rather than silently dropping such a value, anything the current catalogue
// doesn't contain selects "Other" and keeps the original text in the input
// beside it - the same pattern DegreeFields uses for Course.
export function DesignationSelect({
  label, value, onChange, collegeType, kind = "both",
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  collegeType: CollegeType | undefined;
  kind?: DesignationKind;
}) {
  const { teaching, supporting } = designationsForKind(collegeType, kind);
  const known = [...teaching, ...supporting];
  const isOther = !!value && !known.includes(value);
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={isOther ? "OTHER" : (value ?? "")} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
        <SelectContent><DesignationOptions collegeType={collegeType} kind={kind} /></SelectContent>
      </Select>
      {isOther && (
        <Input
          value={value === "OTHER" ? "" : value}
          onChange={(e) => onChange(e.target.value || "OTHER")}
          placeholder="Please specify"
        />
      )}
    </div>
  );
}
