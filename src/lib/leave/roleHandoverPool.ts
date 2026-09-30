import type { Firestore } from "firebase-admin/firestore";

export interface DepartmentPerson {
  uid: string;
  name: string;
  role: string;
}

// Everyone in a department (any role) who can be handed a seat: active
// accounts whose own department, or one of their `departments`, matches.
export async function listDepartmentPeople(
  db: Firestore,
  collegeId: string,
  department: string,
  excludeUid: string
): Promise<DepartmentPerson[]> {
  const users = db.collection("colleges").doc(collegeId).collection("users");
  const [own, multi] = await Promise.all([
    users.where("department", "==", department).get(),
    users.where("departments", "array-contains", department).get(),
  ]);
  const byUid = new Map<string, DepartmentPerson>();
  for (const d of [...own.docs, ...multi.docs]) {
    if (d.id === excludeUid || byUid.has(d.id)) continue;
    const u = d.data() as { name?: string; role?: string; isActive?: boolean };
    if (u.isActive === false) continue;
    byUid.set(d.id, { uid: d.id, name: u.name ?? "Unknown", role: u.role ?? "" });
  }
  return Array.from(byUid.values()).sort((a, b) => a.name.localeCompare(b.name));
}
