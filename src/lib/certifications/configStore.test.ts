import { describe, expect, it, vi } from "vitest";
import { resolveRecipientUids } from "./configStore";
import { findUsersByRoles } from "@/lib/roles/findUsersByRoles";
import { canHodEditDepartment, getHodDepartmentScope } from "@/lib/departments/scope";

vi.mock("@/lib/roles/findUsersByRoles");
vi.mock("@/lib/departments/scope");

const db = {} as never;

describe("resolveRecipientUids", () => {
  it("ROLE resolver returns every uid findUsersByRoles finds for that role", async () => {
    vi.mocked(findUsersByRoles).mockResolvedValue([{ id: "lib1" }, { id: "lib2" }] as never);
    const uids = await resolveRecipientUids(db, "c1", { kind: "ROLE", role: "LIBRARY" }, { studentDepartment: "CSE" });
    expect(uids).toEqual(["lib1", "lib2"]);
    expect(findUsersByRoles).toHaveBeenCalledWith(db, "c1", ["LIBRARY"]);
  });

  it("STUDENT_DEPARTMENT_HOD includes an HOD held as a SEAT, not just a primary-role login", async () => {
    // Regression test: the original implementation queried
    // users.where("role","=="," HOD") directly, which only ever finds a
    // primary-role HOD account and silently drops every HOD who holds the
    // role as a seat on top of a different primary role (e.g. PANEL_MEMBER
    // with seatRoles including "HOD") - every certificate request for that
    // department's students then vanished from the HOD's inbox.
    vi.mocked(findUsersByRoles).mockResolvedValue([{ id: "seatHod1" }, { id: "otherDeptHod" }] as never);
    vi.mocked(getHodDepartmentScope).mockImplementation(async (_db, _collegeId, uid) =>
      (uid === "seatHod1" ? { ownDepartmentNames: ["CSE"] } : { ownDepartmentNames: ["ECE"] }) as never
    );
    vi.mocked(canHodEditDepartment).mockImplementation((scope: any, dept: string) =>
      (scope as { ownDepartmentNames: string[] }).ownDepartmentNames.includes(dept)
    );

    const uids = await resolveRecipientUids(db, "c1", { kind: "STUDENT_DEPARTMENT_HOD" }, { studentDepartment: "CSE" });

    expect(findUsersByRoles).toHaveBeenCalledWith(db, "c1", ["HOD"]);
    expect(uids).toEqual(["seatHod1"]);
  });

  it("STUDENT_DEPARTMENT_HOD excludes an HOD who doesn't head the student's department", async () => {
    vi.mocked(findUsersByRoles).mockResolvedValue([{ id: "otherDeptHod" }] as never);
    vi.mocked(getHodDepartmentScope).mockResolvedValue({ ownDepartmentNames: ["ECE"] } as never);
    vi.mocked(canHodEditDepartment).mockReturnValue(false);

    const uids = await resolveRecipientUids(db, "c1", { kind: "STUDENT_DEPARTMENT_HOD" }, { studentDepartment: "CSE" });
    expect(uids).toEqual([]);
  });
});
