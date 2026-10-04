import { describe, expect, it } from "vitest";
import { scopedLocationId } from "./scope";

describe("scopedLocationId", () => {
  it("holds every location role to its own location", () => {
    for (const role of ["LOCATION_DEPT_HEAD", "LOCATION_STAFF_ADMIN", "ADMINISTRATION", "HR_ADMIN"]) {
      expect(scopedLocationId({ role, locationId: "locA" }, "locB")).toBe("locA");
      expect(scopedLocationId({ role, locationId: "locA" }, undefined)).toBe("locA");
    }
  });
  it("lets a Super Admin name any location", () => {
    expect(scopedLocationId({ role: "SUPER_ADMIN", locationId: "" }, "locB")).toBe("locB");
    expect(scopedLocationId({ role: "SUPER_ADMIN", locationId: "locA" }, undefined)).toBe("locA");
  });
  it("returns empty when there is no location at all", () => {
    expect(scopedLocationId({ role: "LOCATION_DEPT_HEAD", locationId: null }, "locB")).toBe("");
  });
});
