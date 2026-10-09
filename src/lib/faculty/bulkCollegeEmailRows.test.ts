import { describe, expect, it } from "vitest";
import { validateBulkRows } from "./bulkCollegeEmailRows";

describe("validateBulkRows", () => {
  it("cleans good rows: trims the Employee ID, lower-cases the email, numbers rows from 2", () => {
    const { ok, rejected } = validateBulkRows([{ employeeId: " E001 ", newEmail: " Asha@College.TEST " }, { employeeId: 7, newEmail: "b@c.test" }]);
    expect(rejected).toEqual([]);
    expect(ok).toEqual([{ fileRow: 2, employeeId: "E001", newEmail: "asha@college.test" }, { fileRow: 3, employeeId: "7", newEmail: "b@c.test" }]);
  });
  it("keeps the file's own row numbers when given", () => {
    expect(validateBulkRows([{ fileRow: 9, employeeId: "E1", newEmail: "a@b.test" }]).ok[0].fileRow).toBe(9);
  });
  it("refuses blank Employee ID, blank email and invalid email, with a reason", () => {
    const { ok, rejected } = validateBulkRows([{ employeeId: "", newEmail: "a@b.test" }, { employeeId: "E2", newEmail: "  " }, { employeeId: "E3", newEmail: "nope" }, { employeeId: "E4", newEmail: "a@b" }]);
    expect(ok).toEqual([]);
    expect(rejected.map((r) => r.code)).toEqual(["MISSING_EMPLOYEE_ID", "MISSING_EMAIL", "INVALID_EMAIL", "INVALID_EMAIL"]);
    expect(rejected.every((r) => r.status === "FAILED" && r.message)).toBe(true);
  });
  it("the FIRST row of a repeated Employee ID or new email wins; later ones are refused", () => {
    const { ok, rejected } = validateBulkRows([
      { employeeId: "E1", newEmail: "a@b.test" }, { employeeId: "e1", newEmail: "c@d.test" },
      { employeeId: "E2", newEmail: "A@B.test" }, { employeeId: "E3", newEmail: "e@f.test" },
    ]);
    expect(ok.map((r) => r.employeeId)).toEqual(["E1", "E3"]);
    expect(rejected.map((r) => [r.fileRow, r.code])).toEqual([[3, "DUPLICATE_ROW"], [4, "DUPLICATE_EMAIL_IN_FILE"]]);
  });
  it("a refused row never blocks the rows after it", () => {
    const { ok } = validateBulkRows([{ employeeId: "", newEmail: "" }, { employeeId: "E1", newEmail: "a@b.test" }]);
    expect(ok).toHaveLength(1);
  });
});
