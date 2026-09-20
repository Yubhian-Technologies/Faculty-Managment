import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { facultyMobileNo, mobileNoFromBody } from "./mobileNo";
import { planMobileNo, mobileNoChange } from "./mobileNoMigration";
import { migrateFacultyDoc, migrateUserDoc, migrateSupportingStaffDoc } from "./fieldRenames";
import { withLegacyFacultyKeysDeleted } from "./legacyKeyDeletes";
import { EXPORT_FIELDS, getFacultyImportColumns, getFacultyImportSampleRows } from "./csvColumns";

const DEL = Symbol("delete");

describe("planMobileNo", () => {
  it("renames a lone phone, verbatim (empty and odd values included)", () => {
    expect(planMobileNo({ phone: "9876543210" })).toEqual({ kind: "rename", mobileNo: "9876543210" });
    expect(planMobileNo({ phone: "" })).toEqual({ kind: "rename", mobileNo: "" });
    expect(planMobileNo({ phone: "001" })).toEqual({ kind: "rename", mobileNo: "001" });
  });
  it("leaves docs with no phone key alone (never invents mobileNo)", () => {
    expect(planMobileNo({ name: "x" })).toEqual({ kind: "none" });
    expect(planMobileNo({ mobileNo: "9876543210" })).toEqual({ kind: "none" });
  });
  it("handles both keys present", () => {
    expect(planMobileNo({ phone: "9", mobileNo: "9 " })).toEqual({ kind: "drop-phone" });
    expect(planMobileNo({ phone: "9", mobileNo: "" })).toEqual({ kind: "fill", mobileNo: "9" });
    expect(planMobileNo({ phone: "", mobileNo: "9" })).toEqual({ kind: "drop-phone" });
    expect(planMobileNo({ phone: "1", mobileNo: "2" })).toEqual({ kind: "conflict" });
  });
  it("refuses non-string values", () => {
    expect(planMobileNo({ phone: 9876543210 })).toEqual({ kind: "non-string" });
    expect(planMobileNo({ phone: "9", mobileNo: 5 })).toEqual({ kind: "non-string" });
  });
  it("is idempotent: the state a plan produces plans nothing further", () => {
    for (const doc of [{ phone: "9" }, { phone: "" }, { phone: "9", mobileNo: "" }, { phone: "9", mobileNo: "9" }]) {
      const change = mobileNoChange(planMobileNo(doc))!;
      const next: Record<string, unknown> = { ...doc, ...(change.mobileNo !== undefined ? { mobileNo: change.mobileNo } : {}) };
      if (change.deletePhone) delete next.phone;
      expect(planMobileNo(next)).toEqual({ kind: "none" });
    }
  });
  it("mobileNoChange is null for conflicts and non-strings", () => {
    expect(mobileNoChange({ kind: "conflict" })).toBeNull();
    expect(mobileNoChange({ kind: "non-string" })).toBeNull();
    expect(mobileNoChange({ kind: "none" })).toBeNull();
  });
});

describe("facultyMobileNo / mobileNoFromBody", () => {
  it("reads mobileNo, falling back to phone (users docs and unmigrated faculty docs)", () => {
    expect(facultyMobileNo({ mobileNo: "1", phone: "2" })).toBe("1");
    expect(facultyMobileNo({ phone: "2" })).toBe("2");
    expect(facultyMobileNo({ mobileNo: "", phone: "2" })).toBe("2");
    expect(facultyMobileNo({ mobileNo: "" })).toBe("");
    expect(facultyMobileNo(undefined)).toBeUndefined();
  });
  it("accepts a legacy phone body key for one release, mobileNo wins", () => {
    expect(mobileNoFromBody({ phone: "2" })).toBe("2");
    expect(mobileNoFromBody({ mobileNo: "1", phone: "2" })).toBe("1");
    expect(mobileNoFromBody({})).toBeUndefined();
  });
});

describe("key rename scope", () => {
  it("lifts phone on facultyMembers docs only", () => {
    expect(migrateFacultyDoc({ phone: "9" })).toEqual({ mobileNo: "9" });
    expect(migrateFacultyDoc({ phone: "old", mobileNo: "new" })).toEqual({ mobileNo: "new" });
    expect(migrateFacultyDoc(migrateFacultyDoc({ phone: "9" }))).toEqual({ mobileNo: "9" });
    expect(migrateUserDoc({ phone: "9" })).toEqual({ phone: "9" });
    expect(migrateSupportingStaffDoc({ phone: "9" })).toEqual({ phone: "9" });
  });
  it("deletes the old phone twin only when mobileNo is part of the write", () => {
    expect(withLegacyFacultyKeysDeleted({ mobileNo: "9" }, DEL)).toEqual({ mobileNo: "9", phone: DEL });
    expect(withLegacyFacultyKeysDeleted({ bankName: "SBI" }, DEL)).toEqual({ bankName: "SBI" });
  });
});

describe("CSV export / import", () => {
  it("exports Mobile No under the mobileNo key", () => {
    const f = EXPORT_FIELDS.find((x) => x.label === "Mobile No");
    expect(f?.key).toBe("mobileNo");
    expect(EXPORT_FIELDS.some((x) => x.key === "phone")).toBe(false);
  });
  it("imports Mobile No as mobileNo and still recognises the old header names", () => {
    const col = getFacultyImportColumns([]).find((c) => c.label === "Mobile No")!;
    expect(col.key).toBe("mobileNo");
    for (const alias of ["Phone", "Mobile", "Mobile Number", "Phone Number", "Contact Number"]) expect(col.aliases).toContain(alias);
    expect(getFacultyImportColumns([]).some((c) => c.key === "phone")).toBe(false);
    for (const row of getFacultyImportSampleRows([])) {
      expect(row.mobileNo).toBeTruthy();
      expect(row).not.toHaveProperty("phone");
    }
  });
});

// Guard: none of the faculty create/update/import/provisioning paths may write `phone`.
describe("no faculty write path uses `phone`", () => {
  const FILES = [
    "src/app/api/college/faculty/route.ts",
    "src/app/api/college/faculty/[id]/route.ts",
    "src/app/api/college/faculty/me/route.ts",
    "src/app/api/college/faculty/link-hod/route.ts",
    "src/app/api/college/faculty/import/route.ts",
    "src/lib/firestore/facultyProvisioning.ts",
  ];
  it.each(FILES)("%s", (file) => {
    const src = readFileSync(file, "utf8");
    // `userUpdates.phone` (users.phone) and candidate.phone reads are legitimate.
    expect(src).not.toMatch(/facultyUpdates\.phone|\bupdates\.phone\b|\bphone: (body\.|checkPhone|mobileNoFromBody)|row\.phone/);
    expect(src).not.toMatch(/^\s*phone: candidate\.phone/m);
    expect(src).not.toMatch(/"phone"/);
  });
});
