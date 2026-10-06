import { describe, it, expect } from "vitest";
import { fakeFs } from "@/lib/testing/fakeFirestore.testutil";
import { findFacultyLoginUid } from "@/lib/faculty/loginLookup";

describe("findFacultyLoginUid", () => {
  const seed = {
    "colleges/c1/facultyMembers/f1": { employeeId: "EMP0007", userUid: "u7" },
    "colleges/c2/facultyMembers/f2": { employeeId: "EMP0008" },
  };

  it("finds the login in any college, ignoring case and spaces", async () => {
    const { firestore } = fakeFs(seed);
    expect(await findFacultyLoginUid(firestore, "EMP0007")).toBe("u7");
    expect(await findFacultyLoginUid(firestore, " emp0007 ")).toBe("u7");
  });

  it("is null for unknown ids, blank ids, and faculty with no login", async () => {
    const { firestore } = fakeFs(seed);
    expect(await findFacultyLoginUid(firestore, "EMP9999")).toBeNull();
    expect(await findFacultyLoginUid(firestore, "  ")).toBeNull();
    expect(await findFacultyLoginUid(firestore, "EMP0008")).toBeNull();
  });
});
