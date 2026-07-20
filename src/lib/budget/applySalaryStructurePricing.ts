import type { Firestore } from "firebase-admin/firestore";
import type { BudgetCategoryGroup } from "@/types";

interface StructureInfo {
  grossSalary: number;
  designation: string;
  employmentType: string;
}

// Staff Salaries items whose HOD picked a designation (extras.salaryStructureId)
// must use that structure's server-recorded grossSalary, not whatever price the
// client submitted — closes the gap where a tampered payload could otherwise
// set an arbitrary salary that later feeds Finance's allocatedAmount. The
// headcount (how many active faculty hold that designation in the department)
// is re-derived the same way, for the same reason — a tampered headcount would
// silently inflate the annual total just as much as a tampered price would.
export async function applySalaryStructurePricing(
  db: Firestore,
  collegeId: string,
  groups: BudgetCategoryGroup[],
  department: string
): Promise<BudgetCategoryGroup[]> {
  const structureIds = new Set<string>();
  let hasStaffSalariesItems = false;
  for (const group of groups) {
    if (group.category !== "Staff Salaries") continue;
    hasStaffSalariesItems = true;
    for (const item of group.items ?? []) {
      const id = item.extras?.salaryStructureId;
      if (id) structureIds.add(id);
    }
  }
  if (!hasStaffSalariesItems) return groups;

  const structuresRef = db.collection("colleges").doc(collegeId).collection("salaryStructures");
  const structureEntries = await Promise.all(
    Array.from(structureIds).map(async (id) => {
      const snap = await structuresRef.doc(id).get();
      const data = snap.data() as { grossSalary?: number; designation?: string; employmentType?: string; isActive?: boolean } | undefined;
      const info: StructureInfo | undefined =
        data && data.isActive && data.grossSalary !== undefined && data.designation && data.employmentType
          ? { grossSalary: data.grossSalary, designation: data.designation, employmentType: data.employmentType }
          : undefined;
      return [id, info] as const;
    })
  );
  const structureById = new Map(structureEntries);

  const facultyRef = db.collection("colleges").doc(collegeId).collection("facultyMembers");
  const headcountByStructureId = new Map<string, number>();
  await Promise.all(
    Array.from(structureById.entries()).map(async ([id, info]) => {
      if (!info) return;
      const snap = await facultyRef
        .where("department", "==", department)
        .where("designation", "==", info.designation)
        .where("employmentType", "==", info.employmentType)
        .where("status", "==", "ACTIVE")
        .get();
      headcountByStructureId.set(id, snap.size);
    })
  );

  return groups.map((group) => {
    if (group.category !== "Staff Salaries") return group;
    return {
      ...group,
      items: (group.items ?? []).map((item) => {
        const id = item.extras?.salaryStructureId;
        const info = id ? structureById.get(id) : undefined;
        if (!info) {
          // No verified structure match (Custom pricing, or a stale/inactive
          // structure id) — never trust a client-supplied headcount multiplier
          // without server verification; it collapses to the default of 1.
          return { ...item, extras: { ...item.extras, headcount: "" } };
        }
        return {
          ...item,
          price: info.grossSalary,
          extras: { ...item.extras, headcount: String(headcountByStructureId.get(id) ?? 0) },
        };
      }),
    };
  });
}
