import { describe, it, expect } from "vitest";
import { matchHeaders } from "@/lib/utils/csv";
import { getFacultyImportColumns } from "./csvColumns";

const cols = getFacultyImportColumns(["Professor"]);

describe("faculty import name columns", () => {
  it("legalName is the only required name column; nameAsPerPan is optional", () => {
    expect(cols.find((c) => c.key === "legalName")?.required).toBe(true);
    expect(cols.find((c) => c.key === "nameAsPerPan")?.required).toBe(false);
    expect(cols.some((c) => c.key === "name")).toBe(false);
  });

  it("template labels map to their own keys", () => {
    const keyMap = matchHeaders(["Full Name (as per SSC)", "Name (as per PAN)"], cols);
    expect(Object.values(keyMap)).toEqual(["legalName", "nameAsPerPan"]);
  });

  // Historical meaning: the legacy `name` key was the PAN name, so generic
  // headers in older files stay mapped to Name (as per PAN), never legalName.
  it("generic legacy headers stay on nameAsPerPan", () => {
    const keyMap = matchHeaders(["Faculty Name", "Employee Name"], cols);
    expect(Object.values(keyMap)).toEqual(["nameAsPerPan", "nameAsPerPan"]);
    expect(Object.values(matchHeaders(["Name"], cols))).toEqual(["nameAsPerPan"]);
  });
});
