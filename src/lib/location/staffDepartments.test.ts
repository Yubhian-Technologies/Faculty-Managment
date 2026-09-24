import { describe, expect, it } from "vitest";
import { staffCoversLocationDept } from "./staffDepartments";

describe("staffCoversLocationDept", () => {
  it("a Dept Head covers only their exact one department", () => {
    const head = { role: "LOCATION_DEPT_HEAD", locationDeptId: "dept-1" };
    expect(staffCoversLocationDept(head, "dept-1")).toBe(true);
    expect(staffCoversLocationDept(head, "dept-2")).toBe(false);
  });

  it("allLocationDepts covers every department, regardless of locationDeptIds", () => {
    const staff = { role: "HR_ADMIN", allLocationDepts: true, locationDeptIds: [] };
    expect(staffCoversLocationDept(staff, "dept-1")).toBe(true);
    expect(staffCoversLocationDept(staff, "dept-anything")).toBe(true);
  });

  it("locationDeptIds covers exactly the listed departments when allLocationDepts is false", () => {
    const staff = { role: "ACCOUNTS", allLocationDepts: false, locationDeptIds: ["dept-1", "dept-3"] };
    expect(staffCoversLocationDept(staff, "dept-1")).toBe(true);
    expect(staffCoversLocationDept(staff, "dept-2")).toBe(false);
    expect(staffCoversLocationDept(staff, "dept-3")).toBe(true);
  });

  it("no departments set at all covers nothing", () => {
    expect(staffCoversLocationDept({ role: "ADMIN_OFFICE" }, "dept-1")).toBe(false);
  });
});
