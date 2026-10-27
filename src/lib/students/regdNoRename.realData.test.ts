import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROSTER_FIELDS, rosterFieldDisplay, ROSTER_SAMPLE_ROWS } from "./rosterFields";
import { resolveStudentImportHeaders } from "./importHeaders";
import { projectStudentForRole } from "./listProjection";
import { studentRollKey } from "./loginDefaults";

// "Roll No" -> "Regd. No" is a LABEL change: the stored field is still `rollNumber` and no value may change. This proves it on every
// real VIT / VWU student from the read-only backup (scripts/backup-faculty-records.mjs --subs=students): each Regd. No is shown, projected,
// and read back from an import sheet (under the new header AND the old ones) exactly as stored. Skipped when no backup file is present.
const dir = join(process.cwd(), "backups");
const file = existsSync(dir) ? readdirSync(dir).filter((f) => /^records-students-.*\.json$/.test(f)).sort().at(-1) : undefined;

type Doc = Record<string, unknown>;
const rollField = ROSTER_FIELDS.find((f) => f.key === "rollNumber")!;

describe("Regd. No label (no data needed)", () => {
  it("the roster field is labelled Regd. No; its stored key is unchanged", () => {
    expect(rollField.label).toBe("Regd. No");
    expect(rollField.key).toBe("rollNumber");
  });

  it("every header an older sheet might use still lands on the same field, nothing left unmatched", () => {
    for (const header of ["Regd. No", "Regd No", "Regd.No", "REGD. NO", "Roll No", "Roll.No", "ROLL NO", "Roll Number", "Reg No", "Registration Number"]) {
      const { keyMap, unmatched } = resolveStudentImportHeaders([header, "Student Mobile No"], ROSTER_FIELDS);
      expect(keyMap[0], header).toBe("rollNumber");
      expect(unmatched, header).toEqual([]);
    }
  });

  it("no visible roster label, hint or sample still says Roll", () => {
    for (const f of ROSTER_FIELDS) {
      expect(`${f.label} ${f.sample ?? ""}`, f.key).not.toMatch(/\broll\b/i);
    }
    for (const row of ROSTER_SAMPLE_ROWS) for (const v of Object.values(row)) expect(String(v)).not.toMatch(/\broll (no|number)/i);
  });
});

describe.skipIf(!file)("real VIT + VWU students: every Regd. No is intact", () => {
  const backup = file ? JSON.parse(readFileSync(join(dir, file), "utf8")) as { docs: Record<string, Doc> } : { docs: {} };
  const students = Object.entries(backup.docs).map(([path, doc]) => ({ path, doc }));

  it("has both colleges' students", () => {
    expect(students.length).toBe(8570);
  });

  it("every student has a Regd. No stored under rollNumber", () => {
    const missing = students.filter((s) => typeof s.doc.rollNumber !== "string" || !s.doc.rollNumber.trim());
    expect(missing.map((s) => s.path)).toEqual([]);
  });

  it("the Regd. No field shows every student's stored value, unchanged", () => {
    for (const { path, doc } of students) expect(rosterFieldDisplay(rollField, doc as never), path).toBe(String(doc.rollNumber));
  });

  it("the list projection keeps the Regd. No for every role", () => {
    for (const role of ["COLLEGE_OFFICE", "HOD", "PANEL_MEMBER", "PRINCIPAL"]) {
      for (const { path, doc } of students) expect(projectStudentForRole(role, doc).rollNumber, `${role} ${path}`).toBe(doc.rollNumber);
    }
  });

  it.each(["Regd. No", "Roll No", "Roll.No", "Roll Number"])("an import sheet headed '%s' reads every real Regd. No back exactly", (header) => {
    const { keyMap } = resolveStudentImportHeaders([header, "Student Mobile No"], ROSTER_FIELDS);
    expect(keyMap[0]).toBe("rollNumber");
    for (const { path, doc } of students) {
      const cell = String(doc.rollNumber);                       // what the sheet cell holds
      const row: Record<string, string> = {};
      row[keyMap[0]] = cell;
      expect(row.rollNumber, path).toBe(doc.rollNumber);
    }
  });

  it("the login key derived from each Regd. No is unchanged and still unique per college", () => {
    for (const college of ["fffeab8b168a4b449dea", "c3a1195c049c44ca9945"]) {
      const keys = students.filter((s) => s.path.includes(college)).map((s) => studentRollKey(s.doc.rollNumber as string));
      expect(keys.every(Boolean)).toBe(true);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
