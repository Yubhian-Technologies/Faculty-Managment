import { describe, expect, it } from "vitest";
import { fakeFs } from "@/lib/testing/fakeFirestore.testutil";
import { STALE_CLAIM_AFTER_MS, claimStudentRoll, peekRollHolder, rollTakenMessage } from "@/lib/students/rollIdentity";
import { checkRosterDetails, normalizeRosterDetails, rosterFieldFormValue, ROSTER_FIELDS } from "@/lib/students/rosterFields";
import { resolveStudentCourse, type CourseRow, type DepartmentRow } from "@/lib/students/courseForStudent";
import { editFieldLabel, fieldErrorMap, problemsFromResponse, savedSummary } from "@/lib/students/editFormResult";

// The pieces the Edit Student save is built from, on their own.

describe("checkRosterDetails: what is reported instead of dropped", () => {
  it("strict mode holds a CHANGED date / email / closed-list choice to its rules", () => {
    const r = checkRosterDetails({ dateOfBirth: "31-02-2004", email: "x", gender: "Robot", studentType: "Visitor" }, {}, { strict: true });
    expect(r.rejected.map((x) => x.field).sort()).toEqual(["dateOfBirth", "email", "gender", "studentType"]);
    expect(r.values).toEqual({});
  });

  it("Yes/No, number and handicapped-type problems are reported in either mode", () => {
    const r = checkRosterDetails({ scholarship: "perhaps", distanceFromResidenceKm: "far", handicappedType: "Z" });
    expect(r.rejected.map((x) => x.field).sort()).toEqual(["distanceFromResidenceKm", "handicappedType", "scholarship"]);
  });

  it("a value the form just re-sends unchanged is never a problem, even if it would not pass today", () => {
    const current = { dateOfBirth: "12/08/2004", gender: "male", email: "legacy", scholarship: undefined } as never;
    const r = checkRosterDetails({ dateOfBirth: "12/08/2004", gender: "male", email: "legacy" }, current, { strict: true });
    expect(r.rejected).toEqual([]);
    expect(r.values).toMatchObject({ dateOfBirth: "12/08/2004", gender: "male", email: "legacy" });
  });

  it("valid values are cleaned and listed choices are stored as listed", () => {
    const r = checkRosterDetails({ gender: "female", studentType: "lateral", email: "A@B.CO", dateOfBirth: "2004-02-29", scholarship: "y" }, {}, { strict: true });
    expect(r.rejected).toEqual([]);
    expect(r.values).toEqual({ gender: "Female", studentType: "Lateral", email: "a@b.co", dateOfBirth: "2004-02-29", scholarship: true });
  });

  it("Caste is not held to its list: the form's box also takes a typed value", () => {
    const r = checkRosterDetails({ caste: "Typed in by hand" }, {}, { strict: true });
    expect(r.rejected).toEqual([]);
    expect(r.values.caste).toBe("Typed in by hand");
  });

  it("an explicit null still clears, and a blank string is still skipped", () => {
    const r = checkRosterDetails({ fatherName: null, motherName: "  ", gender: null }, {}, { strict: true });
    expect(r.values).toEqual({ fatherName: null, gender: null });
    expect(r.rejected).toEqual([]);
  });

  it("normalizeRosterDetails (Add Student, the student's own profile) behaves exactly as before: nothing new is refused", () => {
    expect(normalizeRosterDetails({ dateOfBirth: "12/08/2004", email: "no-at", gender: "Robot", scholarship: "perhaps", caste: "Custom" }))
      .toEqual({ dateOfBirth: "12/08/2004", email: "no-at", gender: "Robot", caste: "Custom" });
  });

  it("every field the form can send is either accepted or reported - none disappears", () => {
    // One deliberately unusable value per field kind; the field must show up in values OR rejected, never in neither.
    const bad: Record<string, unknown> = {};
    for (const f of ROSTER_FIELDS) {
      if (["name", "department", "year", "rollNumber"].includes(f.key)) continue;
      bad[f.key] = f.kind === "yesno" ? "perhaps" : f.kind === "number" ? "far" : f.kind === "date" ? "nope" : f.key === "handicappedType" ? "Z" : f.key === "email" ? "no-at" : "ok";
    }
    const r = checkRosterDetails(bad, {}, { strict: true });
    for (const key of Object.keys(bad)) {
      expect(key in r.values || r.rejected.some((x) => x.field === key), `${key} was neither saved nor reported`).toBe(true);
    }
  });

  it("rosterFieldFormValue and the unchanged test agree for booleans and numbers", () => {
    const field = ROSTER_FIELDS.find((f) => f.key === "scholarship")!;
    expect(rosterFieldFormValue(field, { scholarship: true } as never)).toBe("Yes");
    expect(checkRosterDetails({ scholarship: true }, { scholarship: true } as never, { strict: true }).rejected).toEqual([]);
  });
});

describe("resolveStudentCourse: the same course rules as the importer", () => {
  const departments = [
    { id: "d-cse", name: "CSE", hasSubDepartments: true },
    { id: "d-cs", name: "CSE-CS", parentDepartmentId: "d-cse" },
    { id: "d-bs", name: "Basic Science", managedDepartments: ["IT"], assignedYears: [1] },
    { id: "d-it", name: "IT" },
    { id: "d-me", name: "ME" },
  ] as unknown as DepartmentRow[];
  const courses: CourseRow[] = [
    { id: "c-cse", name: "BTech", code: "BTECH", departmentId: "d-cse", catalogId: "btech" },
    { id: "c-cse-m", name: "MTech", code: "MTECH", departmentId: "d-cse", catalogId: "mtech" },
    { id: "c-bs", name: "BTech", code: "BTECH", departmentId: "d-bs", catalogId: "btech" },
    { id: "c-it", name: "BTech", code: "BTECH", departmentId: "d-it", catalogId: "btech" },
    { id: "c-me", name: "BPharm", code: "BPHARM", departmentId: "d-me", catalogId: "bpharm" },
  ];
  const resolve = (departmentName: string, year: number, input: string) => resolveStudentCourse({ departments, courses, departmentName, year, input });

  it("resolves by name or code, case-insensitively, to the canonical name and the department's own Course record", () => {
    expect(resolve("CSE", 2, "mtech")).toEqual({ ok: true, name: "MTech", courseId: "c-cse-m" });
    expect(resolve("CSE", 2, "BTech")).toEqual({ ok: true, name: "BTech", courseId: "c-cse" });
  });

  it("a sub-department uses its parent's courses", () => {
    expect(resolve("CSE-CS", 3, "MTech")).toEqual({ ok: true, name: "MTech", courseId: "c-cse-m" });
  });

  it("a branch's shared first year belongs to the department that manages it", () => {
    expect(resolve("IT", 1, "BTech")).toEqual({ ok: true, name: "BTech", courseId: "c-bs" });
    expect(resolve("IT", 2, "BTech")).toEqual({ ok: true, name: "BTech", courseId: "c-it" });
  });

  it("a course the department does not offer is refused with what it does offer", () => {
    const r = resolve("CSE", 2, "BPharm");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/not a course CSE offers \(it offers: BTech, MTech\)/);
  });

  it("an unknown department is refused", () => {
    const r = resolve("Nope", 1, "BTech");
    expect(!r.ok && r.reason).toMatch(/was not found/);
  });
});

describe("roll registry: peekRollHolder and the message", () => {
  const claim = (roll: string, collegeId: string, studentDocId: string, extra: Record<string, unknown> = {}) => ({ roll, collegeId, studentDocId, name: `${collegeId}/${studentDocId}`, ...extra });

  it("is null for a free roll and for a roll that is already this student's", async () => {
    const { firestore } = fakeFs({ "colleges/c1/students/s1": { name: "Anil" } });
    expect(await peekRollHolder(firestore, claim("R9", "c1", "s1"))).toBeNull();
    await claimStudentRoll(firestore, claim("R1", "c1", "s1"));
    expect(await peekRollHolder(firestore, claim("R1", "c1", "s1"))).toBeNull();
  });

  it("names the holder, and whether it is the caller's own college", async () => {
    const { firestore } = fakeFs({ "colleges/c1/students/s1": { name: "Anil" }, "colleges/c9/students/z1": { name: "Zed" } });
    await claimStudentRoll(firestore, claim("R1", "c1", "s1", { name: "Anil" }));
    await claimStudentRoll(firestore, claim("Z9", "c9", "z1", { name: "Zed" }));
    expect(await peekRollHolder(firestore, claim("r-1", "c1", "s2"))).toMatchObject({ sameCollege: true, name: "Anil" });
    expect(await peekRollHolder(firestore, claim("z-9", "c1", "s2"))).toMatchObject({ sameCollege: false, collegeId: "c9" });
  });

  it("makes no write at all, and ignores a retired or stale holder just as the real claim does", async () => {
    const old = new Date(Date.now() - STALE_CLAIM_AFTER_MS - 1000);
    const { db, firestore } = fakeFs({
      "studentUsernames/RETIRED": { collegeId: "c9", studentDocId: "gone", rollKey: "retired", active: false, createdAt: new Date() },
      "studentUsernames/STALE": { collegeId: "c9", studentDocId: "gone", rollKey: "stale", active: true, createdAt: old },
    });
    const writes = db.writeLog.length;
    expect(await peekRollHolder(firestore, claim("retired", "c1", "s1"))).toBeNull();
    expect(await peekRollHolder(firestore, claim("stale", "c1", "s1"))).toBeNull();
    expect(db.writeLog.length).toBe(writes);
  });

  it("the message names another college only when given its name, and never a student of that college", () => {
    const other = { collegeId: "c9", name: "Zed", sameCollege: false };
    expect(rollTakenMessage("Z9", other)).toBe("Regd. No Z9 is already registered to a student in another college. Regd. Nos must be unique across all colleges.");
    const named = rollTakenMessage("Z9", other, "Other College");
    expect(named).toContain("(Other College)");
    expect(named).not.toContain("Zed");
    expect(rollTakenMessage("R1", { name: "Anil", sameCollege: true }, "Ignored College")).toContain("Anil");
  });
});

describe("editFormResult: how the form reads the server's answer", () => {
  it("reads the problems from `rejected`, or from `fieldErrors` of an older answer, or none", () => {
    expect(problemsFromResponse({ rejected: [{ field: "name", label: "Name", message: "Name is required" }] })).toHaveLength(1);
    expect(problemsFromResponse({ fieldErrors: { mobileNo: "taken" } })).toEqual([{ field: "mobileNo", label: "Student Mobile No", message: "taken" }]);
    expect(problemsFromResponse({ error: "Outside your department" })).toEqual([]);
    expect(problemsFromResponse(null)).toEqual([]);
  });

  it("maps problems to the boxes to mark", () => {
    expect(fieldErrorMap([{ field: "a", label: "A", message: "x" }, { field: "b", label: "B", message: "y" }])).toEqual({ a: "x", b: "y" });
  });

  it("summarises what was saved with the form's own labels, without repeating", () => {
    expect(savedSummary(["name", "mobileNo"])).toBe("Name (as per SSC), Student Mobile No");
    expect(savedSummary(["course", "courseId"])).toBe("Course");
    expect(savedSummary(["a", "b", "c", "d", "e", "f"].map(() => "gender"))).toBe("Gender");
    expect(savedSummary(["name", "gender", "caste", "email", "remarks", "state"])).toBe("Name (as per SSC), Gender, Caste, Email and 2 more");
    expect(savedSummary([])).toBe("");
    expect(editFieldLabel("unknownKey")).toBe("unknownKey");
  });
});
