import { describe, expect, it } from "vitest";
import { officeCatalogHrefs, officeHiddenHrefs, officeModuleCatalog, sanitizeOfficeHrefs } from "./officeAccess";

describe("department office access", () => {
  it("never makes the dashboard, personal pages or the appointment page configurable", () => {
    const all = officeCatalogHrefs();
    expect(all).not.toContain("/hod");
    expect(all).not.toContain("/hod/leave");
    expect(all).not.toContain("/hod/profile");
    expect(all).not.toContain("/hod/settings/department-office");
    expect(all.length).toBeGreaterThan(5);
  });
  it("is unrestricted until the HOD saves a list", () => {
    expect(officeHiddenHrefs(null)).toEqual([]);
    expect(officeHiddenHrefs(undefined)).toEqual([]);
  });
  it("hides every module that isn't allowed", () => {
    const all = officeCatalogHrefs();
    const hidden = officeHiddenHrefs([all[0]]);
    expect(hidden).not.toContain(all[0]);
    expect(hidden.length).toBe(all.length - 1);
    expect(officeHiddenHrefs([])).toEqual(all);
  });
  it("catalog covers exactly the configurable hrefs", () => {
    expect(officeModuleCatalog().flatMap((g) => g.items.map((i) => i.href)).sort()).toEqual([...officeCatalogHrefs()].sort());
  });
  it("rejects unknown or malformed lists", () => {
    const one = officeCatalogHrefs()[0];
    expect(sanitizeOfficeHrefs([one, one])).toEqual([one]);
    expect(sanitizeOfficeHrefs([one, "/super-admin"])).toBeNull();
    expect(sanitizeOfficeHrefs("x")).toBeNull();
    expect(sanitizeOfficeHrefs([1])).toBeNull();
  });
});
