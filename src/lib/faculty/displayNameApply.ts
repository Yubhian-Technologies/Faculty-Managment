// Settings > Website Display Name, for screens and downloads that print names COPIED into other records
// (timetable slots, teaching assignments, a section's class in-charge ...). These return display-only COPIES with
// the faculty name swapped for the person's Display Name; the stored records are never changed, and nothing built
// here may be sent back to a save route.

import type { NameFor } from "@/hooks/useFacultyDisplayNames";
import type { DisplayNameSurfaceKey } from "@/lib/faculty/displayNameSettings";

type NamedSlot = { facultyId?: string; facultyName?: string; substituteFacultyId?: string; substituteFacultyName?: string };

/** Slots with each faculty (and a substitute) shown by Display Name; the same array when nothing changes. */
export function slotsWithDisplayNames<T extends NamedSlot>(slots: T[], place: DisplayNameSurfaceKey, nameFor: NameFor): T[] {
  let changed = false;
  const out = slots.map((s) => {
    const name = s.facultyName ? nameFor(place, { facultyId: s.facultyId }, s.facultyName) : s.facultyName;
    const sub = s.substituteFacultyName ? nameFor(place, { facultyId: s.substituteFacultyId }, s.substituteFacultyName) : s.substituteFacultyName;
    if (name === s.facultyName && sub === s.substituteFacultyName) return s;
    changed = true;
    return { ...s, facultyName: name, substituteFacultyName: sub };
  });
  return changed ? out : slots;
}

/** Records that carry one faculty (teaching assignments ...) shown by Display Name. */
export function assignmentsWithDisplayNames<T extends { facultyId?: string; facultyName?: string }>(rows: T[], place: DisplayNameSurfaceKey, nameFor: NameFor): T[] {
  let changed = false;
  const out = rows.map((r) => {
    const name = r.facultyName ? nameFor(place, { facultyId: r.facultyId }, r.facultyName) : r.facultyName;
    if (name === r.facultyName) return r;
    changed = true;
    return { ...r, facultyName: name };
  });
  return changed ? out : rows;
}
