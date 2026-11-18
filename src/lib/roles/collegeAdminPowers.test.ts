import { describe, expect, it } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";
import { activeDelegatedRoles } from "@/lib/leave/roleDelegation";

// A College Admin login always holds HOD of every department and the office roles; nobody else does.
const db = () => new FakeFirestore({
  "colleges/c1/users/admin": { role: "COLLEGE_ADMIN", isActive: true },
  "colleges/c1/users/office": { role: "COLLEGE_OFFICE", seatRoles: ["COLLEGE_ADMIN"] },
  "colleges/c1/users/off": { role: "COLLEGE_ADMIN", isActive: false },
  "colleges/c1/users/hod": { role: "PANEL_MEMBER", seatRoles: ["HOD"] },
  "colleges/c1/departments/d1": { name: "CSE" },
  "colleges/c1/departments/d2": { name: "ECE" },
  "colleges/c1/departments/d3": { name: "OLD", isActive: false },
}) as unknown as FirebaseFirestore.Firestore;

describe("College Admin always has every role", () => {
  it("a College Admin login (own role or seat) gets HOD of every active department + the office roles", async () => {
    for (const uid of ["admin", "office"]) {
      const d = await activeDelegatedRoles(db(), "c1", uid);
      expect(d.roles).toEqual(expect.arrayContaining(["HOD", "EXAM_CELL", "ACADEMICS"]));
      expect(d.departments.sort()).toEqual(["CSE", "ECE"]);
    }
  });

  it("anyone else - or a deactivated College Admin - gets nothing extra", async () => {
    for (const uid of ["hod", "off", "nobody"]) {
      expect(await activeDelegatedRoles(db(), "c1", uid)).toEqual({ roles: [], departments: [] });
    }
  });
});
