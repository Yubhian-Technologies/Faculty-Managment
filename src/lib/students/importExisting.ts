import type { Firestore } from "firebase-admin/firestore";
import { normalizeStudentMobile } from "@/lib/students/studentMobile";

// The students a bulk import has to compare its rows against - and ONLY those.
//
// The importer used to read EVERY student in the college (projected, but still
// one billed read per student) on every call, so importing a 3,000-student
// college in six 500-row files read the whole roster six times. What it
// actually compares a row with is small and known from the rows themselves:
//   - anyone already holding one of the roll numbers in the file,
//   - anyone already holding one of the file's Admission / Hall Ticket numbers,
//     emails or Student Mobile Nos,
//   - the still-UNASSIGNED students of the departments and years the file names
//     (the name-based "same person" check applies to unassigned rows only).
// Each of those is a plain equality / `in` query, served by Firestore's
// automatic single-field indexes (no composite index).
//
// Matching stays case-insensitive: a roll is looked up by `rollNumberUpper` and,
// for documents that predate that field, by the spellings they can hold on
// `rollNumber` (as typed, upper, lower). Admission / Hall Ticket / email are
// looked up by the same three spellings (emails are stored lower-case). A stored
// value in some OTHER mixed case with no stamped key can slip past the
// look-up - the backfill script (scripts/backfill-student-roll-keys.mjs) closes
// that for rolls.

export interface ImportRowKeys {
  rollNumber?: string;
  department?: string;
  secondaryDepartment?: string;
  year?: number;
  admissionNo?: string;
  hallTicketNo?: string;
  email?: string;
  mobileNo?: string;
}

export interface ExistingStudentDoc {
  id: string;
  data(): Record<string, unknown>;
  get(field: string): unknown;
}

const IN_LIMIT = 30;
const PARALLEL = 10;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function spellings(value: string | undefined): string[] {
  const v = (value ?? "").trim();
  if (!v) return [];
  return Array.from(new Set([v, v.toUpperCase(), v.toLowerCase()]));
}

async function inParallel<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = [];
  for (const group of chunk(tasks, PARALLEL)) out.push(...(await Promise.all(group.map((t) => t()))));
  return out;
}

export async function loadExistingStudentsForImport(
  db: Firestore,
  collegeId: string,
  rows: ImportRowKeys[],
  resolveDepartment: (raw: string) => string | undefined
): Promise<ExistingStudentDoc[]> {
  const students = db.collection("colleges").doc(collegeId).collection("students");
  const found = new Map<string, ExistingStudentDoc>();
  const keep = (docs: { id: string; data(): FirebaseFirestore.DocumentData; get(f: string): unknown }[]) => {
    for (const d of docs) if (!found.has(d.id)) found.set(d.id, { id: d.id, data: () => d.data() as Record<string, unknown>, get: (f) => d.get(f) });
  };

  const tasks: (() => Promise<void>)[] = [];
  const lookupIn = (field: string, values: Set<string>) => {
    for (const group of chunk(Array.from(values), IN_LIMIT)) {
      tasks.push(async () => keep((await students.where(field, "in", group).get()).docs));
    }
  };

  const rollsUpper = new Set<string>();
  const rollSpellings = new Set<string>();
  const admission = new Set<string>();
  const hallTicket = new Set<string>();
  const emails = new Set<string>();
  const mobiles = new Set<string>();
  const departments = new Set<string>();
  const years = new Set<number>();
  for (const row of rows) {
    const roll = (row.rollNumber ?? "").trim();
    if (roll) {
      rollsUpper.add(roll.toUpperCase());
      for (const s of spellings(roll)) rollSpellings.add(s);
    }
    for (const s of spellings(row.admissionNo)) admission.add(s);
    for (const s of spellings(row.hallTicketNo)) hallTicket.add(s);
    for (const s of spellings(row.email)) emails.add(s);
    // Stored as the 10 digits (see studentMobile.ts); the typed form is looked up too for numbers saved as typed.
    const mobile = normalizeStudentMobile(row.mobileNo);
    if (mobile) mobiles.add(mobile);
    if (row.mobileNo?.trim()) mobiles.add(row.mobileNo.trim());
    for (const raw of [row.department, row.secondaryDepartment]) {
      const name = raw?.trim() ? resolveDepartment(raw) : undefined;
      if (name) departments.add(name);
    }
    if (row.year) years.add(Number(row.year));
  }

  lookupIn("rollNumberUpper", rollsUpper);
  lookupIn("rollNumber", rollSpellings);
  lookupIn("admissionNo", admission);
  lookupIn("hallTicketNo", hallTicket);
  lookupIn("email", emails);
  lookupIn("mobileNo", mobiles);

  // Unassigned students of the named departments, per year (under either the
  // department or the secondary department field - see the importer's note on why).
  for (const year of years) {
    for (const group of chunk(Array.from(departments), IN_LIMIT)) {
      for (const field of ["department", "secondaryDepartment"]) {
        tasks.push(async () =>
          keep((await students.where("section", "==", "").where("year", "==", year).where(field, "in", group).get()).docs)
        );
      }
    }
  }

  await inParallel(tasks);
  return Array.from(found.values());
}
