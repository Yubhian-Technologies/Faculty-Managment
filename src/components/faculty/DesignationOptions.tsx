import { SelectGroup, SelectLabel, SelectItem, SelectSeparator } from "@/components/ui/select";
import { TEACHING_DESIGNATIONS, TECHNICAL_STAFF_DESIGNATIONS, DESIGNATION_LABELS } from "@/types";

// Shared designation option list for every FacultyMember designation picker
// (Faculty add/edit, Salary Structures) - keeps Teaching and Technical
// designations visually grouped and labeled rather than one undifferentiated
// list, so e.g. Lab Assistant reads clearly as Technical, not lost among
// Professor/Lecturer/etc.
export function DesignationOptions() {
  return (
    <>
      <SelectGroup>
        <SelectLabel>Teaching</SelectLabel>
        {TEACHING_DESIGNATIONS.map((v) => (
          <SelectItem key={v} value={v}>{DESIGNATION_LABELS[v]}</SelectItem>
        ))}
      </SelectGroup>
      <SelectSeparator />
      <SelectGroup>
        <SelectLabel>Technical</SelectLabel>
        {TECHNICAL_STAFF_DESIGNATIONS.map((v) => (
          <SelectItem key={v} value={v}>{DESIGNATION_LABELS[v]}</SelectItem>
        ))}
      </SelectGroup>
      <SelectSeparator />
      <SelectItem value="OTHER">{DESIGNATION_LABELS.OTHER}</SelectItem>
    </>
  );
}
