import { describe, expect, it, vi } from "vitest";

// The service module pulls in firebase-admin for its class; only the pure
// ownership rule is under test here.
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => ({}) }));

import { courseOwnershipError } from "./CourseStructureImportService";
import type { Department } from "@/types";

type Dept = Department & { id: string };
const dept = (d: Partial<Dept> & { id: string; name: string }): Dept => d as Dept;

const cse = dept({ id: "cse", name: "CSE" });
const ai = dept({ id: "ai", name: "AI", hasSubDepartments: true });
const aiDs = dept({ id: "ai-ds", name: "AI-DS", parentDepartmentId: "ai" });
const bs = dept({ id: "bs", name: "Basic Science", hasSubDepartments: true, parentRunsOwnSections: false });
const it_ = dept({ id: "it", name: "IT" });
const feeder = dept({ id: "bsm", name: "BS Maths", parentDepartmentId: "bs", secondaryDepartments: ["IT"] });
const all = [cse, ai, aiDs, bs, it_, feeder];

const course = (id: string, departmentId: string) => ({ id, departmentId, name: "B.Tech", isActive: true });

describe("courseOwnershipError", () => {
  it("accepts a department's own course", () => {
    expect(courseOwnershipError(course("c-cse", "cse"), cse, all, [course("c-cse", "cse"), course("c-ai", "ai")])).toBeNull();
  });
  it("rejects another department's course", () => {
    expect(courseOwnershipError(course("c-ai", "ai"), cse, all, [course("c-cse", "cse"), course("c-ai", "ai")])).toMatch(/own copy/);
  });
  it("lets a sub-department use its parent's course when it has no copy", () => {
    expect(courseOwnershipError(course("c-ai", "ai"), aiDs, all, [course("c-ai", "ai")])).toBeNull();
  });
  it("requires a sub-department's own customised copy when it has one", () => {
    const docs = [course("c-ai", "ai"), course("c-aids", "ai-ds")];
    expect(courseOwnershipError(course("c-ai", "ai"), aiDs, all, docs)).toMatch(/own copy/);
    expect(courseOwnershipError(course("c-aids", "ai-ds"), aiDs, all, docs)).toBeNull();
  });
  it("lets a fed department use its feeder's course", () => {
    expect(courseOwnershipError(course("c-bsm", "bsm"), it_, all, [course("c-bsm", "bsm")])).toBeNull();
  });
  it("rejects a parent that runs no sections of its own", () => {
    expect(courseOwnershipError(course("c-bs", "bs"), bs, all, [course("c-bs", "bs")])).toMatch(/doesn't run sections/);
  });
});
