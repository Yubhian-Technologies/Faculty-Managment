import { computeFacultyProfileCompletion } from "@/lib/faculty/profileCompletion";
import type { ProfileModuleKey } from "@/lib/faculty/profileModules";
import type { FacultyMember } from "@/types";

// "Has anything at all been entered in this tab?" - decides whether a tab shows its details or an invitation to
// enter them. Reuses the profile-completion rule (a field counts when the full-detail export would show a non-blank
// cell for it), so a tab is empty exactly when its completion is 0%.
//
//  - Research & Innovation is never "empty": its records live in separate collections and the tab has its own
//    sub-tabs with their own Add buttons.
//  - Teaching Load is not part of completion; the caller says whether its tables have no rows.
//  - Anything unexpected (a record this cannot read) counts as NOT empty: the tab is then shown as it always was.

export function isModuleEmpty(moduleKey: ProfileModuleKey, faculty: unknown, opts: { teachingEmpty?: boolean } = {}): boolean {
  if (moduleKey === "research") return false;
  if (moduleKey === "teaching-load") return opts.teachingEmpty === true;
  if (typeof faculty !== "object" || faculty === null) return false;
  try {
    const section = computeFacultyProfileCompletion(faculty as FacultyMember).sections.find((s) => s.key === moduleKey);
    return !!section && section.totalCount > 0 && section.filledCount === 0;
  } catch {
    return false;
  }
}

/** The sentence under an empty tab's heading. With an Edit link it invites the person to enter the details. */
export function emptyModuleMessage(noun: string, canEdit: boolean): { title: string; hint: string } {
  return canEdit
    ? { title: `Please enter the ${noun} details here.`, hint: "Nothing has been entered in this section yet." }
    : { title: `No ${noun} details have been entered yet.`, hint: "They will appear here once they are added." };
}
