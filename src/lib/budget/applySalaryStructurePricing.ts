import type { Firestore } from "firebase-admin/firestore";
import type { BudgetCategoryGroup } from "@/types";

// Staff Salaries items whose HOD picked a designation (extras.salaryStructureId)
// must use that structure's server-recorded grossSalary, not whatever price the
// client submitted — closes the gap where a tampered payload could otherwise
// set an arbitrary salary that later feeds Finance's allocatedAmount.
export async function applySalaryStructurePricing(
  db: Firestore,
  collegeId: string,
  groups: BudgetCategoryGroup[]
): Promise<BudgetCategoryGroup[]> {
  const structureIds = new Set<string>();
  for (const group of groups) {
    if (group.category !== "Staff Salaries") continue;
    for (const item of group.items ?? []) {
      const id = item.extras?.salaryStructureId;
      if (id) structureIds.add(id);
    }
  }
  if (structureIds.size === 0) return groups;

  const structuresRef = db.collection("colleges").doc(collegeId).collection("salaryStructures");
  const entries = await Promise.all(
    Array.from(structureIds).map(async (id) => {
      const snap = await structuresRef.doc(id).get();
      const data = snap.data() as { grossSalary?: number; isActive?: boolean } | undefined;
      return [id, data && data.isActive ? data.grossSalary : undefined] as const;
    })
  );
  const grossSalaryById = new Map(entries);

  return groups.map((group) => {
    if (group.category !== "Staff Salaries") return group;
    return {
      ...group,
      items: (group.items ?? []).map((item) => {
        const id = item.extras?.salaryStructureId;
        const grossSalary = id ? grossSalaryById.get(id) : undefined;
        return grossSalary !== undefined ? { ...item, price: grossSalary } : item;
      }),
    };
  });
}
