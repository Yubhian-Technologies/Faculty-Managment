import { EMPLOYEE_SCOPE_LABELS, type CircularAudience } from "@/types/circular";

// Shared by CircularCard and CircularViewer (both client components) so the
// audience line reads identically wherever a circular is shown. Client-safe
// - no firebase-admin import, unlike lib/circular/service.ts.
export function audienceSummary(audience: CircularAudience): string {
  const dept = audience.departmentNames?.length
    ? audience.departmentNames.join(", ")
    : audience.departmentIds?.length
      ? audience.departmentIds.join(", ")
      : "All departments";
  if (audience.recipientKind === "STUDENTS") {
    const years = audience.targetYears?.length ? `Year ${audience.targetYears.join(", ")}` : "All years";
    return `Students · ${years} · ${dept}`;
  }
  return `${EMPLOYEE_SCOPE_LABELS[audience.employeeType]} · ${dept}`;
}
