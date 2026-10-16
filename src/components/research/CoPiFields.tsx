"use client";

import { InternalFacultyPicker } from "@/components/research/InternalFacultyPicker";
import { Checkbox } from "@/components/ui/checkbox";
import { TextInput } from "@/components/shared/ProfileFieldPrimitives";
import type { SponsoredProjectCoPI } from "@/types";

/** A fresh Co-PI row: from this college, nobody picked yet. */
export const EMPTY_COPI: SponsoredProjectCoPI = { name: "", department: "", affiliation: "", isInternal: true, facultyId: "" };

/** Whether one Co-PI row is complete - the same rule validateSponsoredProjectBody applies on the server. */
export function isCoPiComplete(c: SponsoredProjectCoPI): boolean {
  return c.isInternal === true
    ? !!c.facultyId?.trim()
    : !!c.name.trim() && !!c.department.trim() && !!c.affiliation.trim();
}

// One Co-PI. By default the Co-PI is one of this college's own faculty: pick the department, then
// the person from that department. Ticking "Other" is for a Co-PI from another institution, who
// is typed in (name, department, affiliation) the way every Co-PI used to be. A record saved
// before this option existed has no isInternal flag and so opens as "Other" with its typed
// details intact.
export function CoPiFields({
  index, coPi, onChange,
}: {
  index: number;
  coPi: SponsoredProjectCoPI;
  onChange: (patch: Partial<SponsoredProjectCoPI>) => void;
}) {
  const isOther = coPi.isInternal !== true;

  function setOther(other: boolean) {
    if (other) {
      // Leaving a picked person: drop what came from their record so it is not mistaken for typed details.
      onChange(coPi.facultyId?.trim()
        ? { isInternal: false, facultyId: undefined, name: "", department: "", affiliation: "" }
        : { isInternal: false, facultyId: undefined });
    } else {
      onChange({ isInternal: true, facultyId: "" });
    }
  }

  return (
    <div className="space-y-3 rounded-md bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Co-PI {index + 1}</p>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox checked={isOther} onCheckedChange={(v) => setOther(v === true)} />
          Other (not from this college)
        </label>
      </div>

      {isOther ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextInput label={`Name of Co-PI ${index + 1}`} value={coPi.name} onChange={(v) => onChange({ name: v })} required />
          <TextInput label={`Dept of Co-PI ${index + 1}`} value={coPi.department} onChange={(v) => onChange({ department: v })} required />
          <TextInput label={`Affiliation of Co-PI ${index + 1}`} value={coPi.affiliation} onChange={(v) => onChange({ affiliation: v })} required />
        </div>
      ) : (
        <div className="grid grid-cols-1">
          <InternalFacultyPicker
            facultyId={coPi.facultyId ?? ""}
            allowFormer
            required
            label="Faculty"
            onPick={(p) => onChange({ facultyId: p.facultyId, name: p.name, ...(p.department ? { department: p.department } : {}) })}
          />
        </div>
      )}
    </div>
  );
}
