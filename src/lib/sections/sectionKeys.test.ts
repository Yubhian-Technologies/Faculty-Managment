import { describe, expect, it } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";
import { claimSectionKey, isSectionKeyTaken, sectionKeyDocId, type SectionIdentity } from "./sectionKeys";

const id = { department: "CSE", courseId: "co1", year: 2, name: "A" };

async function create(fake: FakeFirestore, identity: SectionIdentity = id) {
  const db = asFirestore(fake);
  const ref = db.collection("colleges").doc("c1").collection("sections").doc();
  await db.runTransaction(async (tx) => {
    await claimSectionKey(tx, db, "c1", identity, ref);
    tx.set(ref, { department: identity.department, courseId: identity.courseId, year: identity.year, name: identity.name });
  });
  return ref.id;
}

describe("claimSectionKey", () => {
  it("normalises case/spacing in the key", () => {
    expect(sectionKeyDocId(id)).toBe(sectionKeyDocId({ ...id, name: " a ", department: "cse", year: "2" }));
    expect(sectionKeyDocId(id)).not.toBe(sectionKeyDocId({ ...id, secondaryDepartment: "ECE" }));
  });

  it("only one of N concurrent identical creates wins", async () => {
    const fake = new FakeFirestore({ latencyMs: 3, seed: 7 });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => create(fake)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(isSectionKeyTaken(r.reason)).toBe(true);
    const sections = [...fake.docs.keys()].filter((k) => k.includes("/sections/"));
    expect(sections).toHaveLength(1);
  });

  it("different identities do not collide", async () => {
    const fake = new FakeFirestore();
    await create(fake);
    await expect(create(fake, { ...id, name: "B" })).resolves.toBeTruthy();
    await expect(create(fake, { ...id, secondaryDepartment: "ECE" })).resolves.toBeTruthy();
  });

  it("a deleted or renamed owner no longer blocks the identity", async () => {
    const fake = new FakeFirestore();
    const first = await create(fake);
    fake.docs.delete(`colleges/c1/sections/${first}`);
    const second = await create(fake);
    fake.docs.set(`colleges/c1/sections/${second}`, { ...fake.docs.get(`colleges/c1/sections/${second}`)!, data: { department: "CSE", courseId: "co1", year: 2, name: "Z" }, version: 99 });
    await expect(create(fake)).resolves.toBeTruthy();
  });
});
