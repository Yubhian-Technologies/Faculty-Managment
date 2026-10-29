// Faculty roster order used across every dashboard that lists a department's
// faculty (HOD's own roster, Principal's department page, College Office,
// Management/Administration college views): the department's HOD first (when
// known), then everyone else by Date of Joining (earliest first - seniority),
// falling back to name for faculty with no joiningDate on file.
import { toDate } from "./facultyTimeline";
import { facultyDisplayName } from "./facultyDisplayName";
import { compareOrderRank } from "./listOrder";

type SortableFaculty = {
  userUid?: unknown;
  joiningDate?: unknown;
  legalName?: string;
  honorific?: string;
};

// Parameters are typed `unknown` (not `SortableFaculty` directly) so this
// comparator is assignable to Array<T>.sort() for every faculty row shape
// used across the call sites (each adds its own unrelated fields) without a
// cast at every call site.
export function compareFacultyForList(hodUid?: string | null) {
  return (x: unknown, y: unknown): number => {
    const a = x as SortableFaculty;
    const b = y as SortableFaculty;
    const arranged = compareOrderRank(a, b); // the HOD's own arrangement wins over every default below
    if (arranged !== 0) return arranged;
    if (hodUid) {
      const aIsHod = a.userUid === hodUid;
      const bIsHod = b.userUid === hodUid;
      if (aIsHod !== bIsHod) return aIsHod ? -1 : 1;
    }
    const aDate = toDate(a.joiningDate);
    const bDate = toDate(b.joiningDate);
    if (aDate && bDate) {
      const diff = aDate.getTime() - bDate.getTime();
      if (diff !== 0) return diff;
    } else if (aDate || bDate) {
      return aDate ? -1 : 1;
    }
    return facultyDisplayName(a).localeCompare(facultyDisplayName(b));
  };
}
