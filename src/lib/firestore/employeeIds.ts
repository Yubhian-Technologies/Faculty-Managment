import type { Firestore } from "firebase-admin/firestore";

// Employee IDs for faculty and supporting staff.
//
// UNIQUENESS RULE (one rule, both people types): an employee ID may be held by
// only one faculty member anywhere (the public faculty-profile link is keyed on
// the ID alone - /api/public/faculty-public - so it can't repeat even across
// colleges) AND may not clash with any supporting-staff member of the same
// college. Both checks go through employeeIdTaken so the two create/edit paths
// can't drift apart again.
//
// GENERATION: the offer-provisioning flow used to number new faculty
// "EMP" + (faculty count + 1). After any deletion that REPEATS an existing ID, and
// two concurrent provisionings got the same one. IDs now come from a counter
// document incremented in a transaction (colleges/{id}/counters/employeeId),
// seeded once from the highest EMP number already in use, and each candidate is
// still checked against employeeIdTaken before it is handed out.

export type EmployeeIdHolder = "faculty" | "staff";

export interface EmployeeIdCheck {
  taken: boolean;
  heldBy?: EmployeeIdHolder;
}

/** Another record (not `except`) already holds this employee ID. */
export async function employeeIdTaken(
  db: Firestore,
  collegeId: string,
  employeeId: string,
  except?: { collection: "facultyMembers" | "supportingStaff"; id: string }
): Promise<EmployeeIdCheck> {
  const id = employeeId.trim();
  if (!id) return { taken: false };

  const [faculty, staff] = await Promise.all([
    db.collectionGroup("facultyMembers").where("employeeId", "==", id).limit(2).get(),
    db.collection("colleges").doc(collegeId).collection("supportingStaff").where("employeeId", "==", id).limit(2).get(),
  ]);
  if (faculty.docs.some((d) => !(except?.collection === "facultyMembers" && d.id === except.id))) {
    return { taken: true, heldBy: "faculty" };
  }
  if (staff.docs.some((d) => !(except?.collection === "supportingStaff" && d.id === except.id))) {
    return { taken: true, heldBy: "staff" };
  }
  return { taken: false };
}

export function employeeIdTakenMessage(check: EmployeeIdCheck): string {
  return check.heldBy === "staff"
    ? "Employee ID already exists (held by a supporting staff member)"
    : "Employee ID already exists";
}

const PREFIX = "EMP";
const MAX_ATTEMPTS = 25;

function formatEmployeeId(n: number): string {
  return `${PREFIX}${String(n).padStart(4, "0")}`;
}

function numberOf(employeeId: unknown): number {
  const m = typeof employeeId === "string" ? /^EMP(\d+)$/i.exec(employeeId.trim()) : null;
  return m ? Number(m[1]) : 0;
}

/** Highest EMP number in use by this college's faculty or staff (the counter's one-time seed). */
async function highestEmpNumber(db: Firestore, collegeId: string): Promise<number> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const [faculty, staff] = await Promise.all([
    collegeRef.collection("facultyMembers").select("employeeId").get(),
    collegeRef.collection("supportingStaff").select("employeeId").get(),
  ]);
  let max = 0;
  for (const d of [...faculty.docs, ...staff.docs]) max = Math.max(max, numberOf(d.get("employeeId")));
  return max;
}

/**
 * The next unused employee ID ("EMP0007"), never repeating one in use. Each call
 * takes a fresh number from the counter in a transaction, so concurrent callers
 * get different IDs; a number already taken by hand (someone typed EMP0008 into a
 * form) is simply skipped.
 */
export async function nextEmployeeId(db: Firestore, collegeId: string): Promise<string> {
  const counterRef = db.collection("colleges").doc(collegeId).collection("counters").doc("employeeId");
  let seed: number | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const current = (await counterRef.get()).data() as { next?: number } | undefined;
    if (current?.next === undefined && seed === null) seed = await highestEmpNumber(db, collegeId);

    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      const stored = (snap.data() as { next?: number } | undefined)?.next;
      const n = stored ?? (seed ?? 0) + 1;
      tx.set(counterRef, { next: n + 1, updatedAt: new Date() });
      return n;
    });

    const candidate = formatEmployeeId(claimed);
    if (!(await employeeIdTaken(db, collegeId, candidate)).taken) return candidate;
  }
  throw new Error("Could not allocate an employee ID - too many are already in use");
}

/**
 * Which of these employee IDs are already taken (by the rule above), as a
 * lower-cased set - for the bulk importers, which compare case-insensitively.
 * Only the IDs in the file are looked up, in `in` queries; the faculty importer
 * used to read every faculty member of every college just to build this set.
 */
export async function loadTakenEmployeeIds(db: Firestore, collegeId: string, employeeIds: string[]): Promise<Set<string>> {
  const variants = new Set<string>();
  for (const raw of employeeIds) {
    const id = (raw ?? "").trim();
    if (!id) continue;
    variants.add(id);
    variants.add(id.toUpperCase());
    variants.add(id.toLowerCase());
  }
  const taken = new Set<string>();
  const staff = db.collection("colleges").doc(collegeId).collection("supportingStaff");
  const groups: string[][] = [];
  const all = Array.from(variants);
  for (let i = 0; i < all.length; i += 30) groups.push(all.slice(i, i + 30));

  await Promise.all(
    groups.map(async (group) => {
      const [faculty, staffSnap] = await Promise.all([
        db.collectionGroup("facultyMembers").where("employeeId", "in", group).get(),
        staff.where("employeeId", "in", group).get(),
      ]);
      for (const d of [...faculty.docs, ...staffSnap.docs]) {
        const v = d.get("employeeId");
        if (typeof v === "string" && v) taken.add(v.toLowerCase());
      }
    })
  );
  return taken;
}
