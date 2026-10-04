import { describe, expect, it } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";
import { claimSubjectKey, isSubjectKeyTaken } from "./subjectKeys";

async function create(fake: FakeFirestore, code = "CS101", regulation = "R22") {
  const db = asFirestore(fake);
  const ref = db.collection("colleges").doc("c1").collection("subjects").doc();
  await db.runTransaction(async (tx) => {
    await claimSubjectKey(tx, db, "c1", { scope: "cat1", regulation, code }, ref);
    tx.set(ref, { code, regulation });
  });
}

describe("claimSubjectKey", () => {
  it("one of N concurrent identical subjects wins", async () => {
    const fake = new FakeFirestore({ latencyMs: 3, seed: 11 });
    const r = await Promise.allSettled(Array.from({ length: 6 }, () => create(fake)));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    for (const x of r) if (x.status === "rejected") expect(isSubjectKeyTaken(x.reason)).toBe(true);
  });
  it("another regulation or code is allowed", async () => {
    const fake = new FakeFirestore();
    await create(fake);
    await create(fake, "CS101", "R23");
    await create(fake, "CS102");
  });
});
