import { SelectGroup, SelectLabel, SelectItem, SelectSeparator } from "@/components/ui/select";
import { getTeachingDesignations, getSupportingDesignations, designationLabel } from "@/lib/designations/config";
import type { CollegeType } from "@/types";

interface Props {
  collegeType: CollegeType | undefined;
  // Faculty (FacultyMember) is teaching-only; Supporting Staff is supporting-
  // only; Salary Structures cover both under one designation picker.
  kind?: "teaching" | "supporting" | "both";
}

// Shared designation option list, sourced from the per-college-type
// catalogues in src/lib/designations/config.ts (Faculty add/edit, Supporting
// Staff add/edit, Salary Structures) - keeps Teaching and Supporting
// designations visually grouped and labeled rather than one undifferentiated
// list. Always ends with a free-text "Other" escape hatch.
export function DesignationOptions({ collegeType, kind = "both" }: Props) {
  const teaching = kind !== "supporting" ? getTeachingDesignations(collegeType) : [];
  const supporting = kind !== "teaching" ? getSupportingDesignations(collegeType) : [];
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
