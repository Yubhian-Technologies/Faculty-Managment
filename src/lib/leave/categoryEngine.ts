import type { EmployeeLeaveProfile, EffectiveLeaveCategory } from "@/types/leave";
import { yearsOfService } from "./dayCounter";

// The category that actually governs which leave types a profile can use right
// now. Never stored - always derived, so a new-joining employee's leave types
// unlock the moment they cross newJoiningYears with no manual conversion step.
export function computeEffectiveCategory(
  profile: Pick<EmployeeLeaveProfile, "dateOfJoining" | "staffCategory">,
  newJoiningYears: number,
  asOf: Date = new Date()
): EffectiveLeaveCategory {
  const doj = profile.dateOfJoining.toDate?.() ?? new Date(profile.dateOfJoining as unknown as string);
  const yrs = yearsOfService(doj, asOf);
  if (yrs < newJoiningYears) return "new-joining";
  return profile.staffCategory;
}
