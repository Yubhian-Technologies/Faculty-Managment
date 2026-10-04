import { describe, expect, it } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";
import { isEmployeeIdReserved, reserveEmployeeId } from "./employeeIdKeys";

describe("reserveEmployeeId", () => {
  it("only one of N concurrent faculty creates with the same ID (case-insensitive) wins", async () => {
    const fake = new FakeFirestore({ latencyMs: 3, seed: 3 });
    const db = asFirestore(fake);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => reserveEmployeeId(db, i % 2 ? "c1" : "c2", i % 2 ? "emp0001" : "EMP0001", { collection: "facultyMembers", id: `f${i}` })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(isEmployeeIdReserved(r.reason)).toBe(true);
  });

  it("faculty and staff clash inside one college, but staff in another college does not block faculty", async () => {
    const fake = new FakeFirestore();
    const db = asFirestore(fake);
    await reserveEmployeeId(db, "c1", "X-1", { collection: "supportingStaff", id: "s1" });
    await expect(reserveEmployeeId(db, "c1", "X-1", { collection: "facultyMembers", id: "f1" })).rejects.toSatisfy(isEmployeeIdReserved);
    await expect(reserveEmployeeId(db, "c2", "X-1", { collection: "facultyMembers", id: "f2" })).resolves.toBeUndefined();
  });

  it("is idempotent for the same owner and frees a lock whose owner now holds another ID", async () => {
    const fake = new FakeFirestore();
    const db = asFirestore(fake);
    const owner = { collection: "facultyMembers" as const, id: "f1" };
    await reserveEmployeeId(db, "c1", "E1", owner);
    await reserveEmployeeId(db, "c1", "E1", owner);
    fake.seed("colleges/c1/facultyMembers/f1", { employeeId: "E9" });
    await expect(reserveEmployeeId(db, "c1", "E1", { collection: "facultyMembers", id: "f2" })).resolves.toBeUndefined();
  });

  it("a pending owner that never got created is taken over after the grace period", async () => {
    const fake = new FakeFirestore();
    const db = asFirestore(fake);
    await reserveEmployeeId(db, "c1", "E1", { collection: "facultyMembers", id: "ghost" });
    await expect(reserveEmployeeId(db, "c1", "E1", { collection: "facultyMembers", id: "f2" })).rejects.toSatisfy(isEmployeeIdReserved);
    for (const key of [...fake.docs.keys()].filter((k) => k.includes("employeeIdKeys/"))) {
      fake.docs.get(key)!.data.reservedAt = new Date(Date.now() - 10 * 60 * 1000);
    }
    await expect(reserveEmployeeId(db, "c1", "E1", { collection: "facultyMembers", id: "f2" })).resolves.toBeUndefined();
  });
});
