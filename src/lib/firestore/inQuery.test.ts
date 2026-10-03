import { describe, expect, it } from "vitest";
import { IN_QUERY_LIMIT, chunkValues, getInChunks, whereIn, type QueryLike } from "./inQuery";
import { FakeFirestore } from "@/test-support/fakeFirestore";

const asQuery = (q: unknown) => q as unknown as QueryLike;

function seedFaculty(fake: FakeFirestore, departments: number, perDept = 2) {
  for (let d = 0; d < departments; d++) {
    for (let i = 0; i < perDept; i++) {
      fake.seed(`colleges/c1/facultyMembers/f${d}_${i}`, { department: `Dept ${d}`, status: i === 0 ? "ACTIVE" : "RESIGNED", userUid: `u${d}_${i}` });
    }
  }
}
const names = (n: number) => Array.from({ length: n }, (_, i) => `Dept ${i}`);

describe("chunkValues", () => {
  it("splits into chunks of at most 30 and keeps order", () => {
    const chunks = chunkValues(Array.from({ length: 65 }, (_, i) => i));
    expect(chunks.map((c) => c.length)).toEqual([30, 30, 5]);
    expect(chunks.flat()).toEqual(Array.from({ length: 65 }, (_, i) => i));
  });
  it("is empty for no values", () => expect(chunkValues([])).toEqual([]));
  it("the Firestore limit it encodes is 30", () => expect(IN_QUERY_LIMIT).toBe(30));
});

describe("whereIn", () => {
  it("control: the old .slice(0, 30) silently loses the 31st+ department's rows", async () => {
    const fake = new FakeFirestore();
    seedFaculty(fake, 45);
    const old = await fake.collection("colleges/c1/facultyMembers").where("department", "in", names(45).slice(0, 30)).get();
    expect(old.docs).toHaveLength(60); // 45 departments x 2 faculty = 90 exist; 30 departments' worth returned
  });

  it("returns every department's rows when there are more than 30", async () => {
    const fake = new FakeFirestore();
    seedFaculty(fake, 45);
    const snap = await whereIn(asQuery(fake.collection("colleges/c1/facultyMembers")), "department", names(45)).get();
    expect(snap.docs).toHaveLength(90);
    expect(new Set(snap.docs.map((d) => d.id)).size).toBe(90);
  });

  it("applies later .where() filters to every chunk", async () => {
    const fake = new FakeFirestore();
    seedFaculty(fake, 45);
    const q = whereIn(asQuery(fake.collection("colleges/c1/facultyMembers")), "department", names(45))
      .where("status", "==", "ACTIVE")
      .where("userUid", "in", ["u0_0", "u44_0", "u31_1"]);
    expect((await q.get()).docs.map((d) => d.id).sort()).toEqual(["f0_0", "f44_0"]);
  });

  it("with 30 or fewer values it is the plain query (same result as before)", async () => {
    const fake = new FakeFirestore();
    seedFaculty(fake, 40);
    const snap = await whereIn(asQuery(fake.collection("colleges/c1/facultyMembers")), "department", names(30)).get();
    expect(snap.docs).toHaveLength(60);
  });

  it("drops duplicate values and never returns a document twice", async () => {
    const fake = new FakeFirestore();
    seedFaculty(fake, 3);
    const snap = await whereIn(asQuery(fake.collection("colleges/c1/facultyMembers")), "department", ["Dept 0", "Dept 0", "Dept 1"]).get();
    expect(snap.docs.map((d) => d.id).sort()).toEqual(["f0_0", "f0_1", "f1_0", "f1_1"]);
  });
});

describe("getInChunks", () => {
  it("unions results across chunks without duplicates, and runs nothing for no values", async () => {
    const fake = new FakeFirestore();
    seedFaculty(fake, 50, 1);
    const coll = fake.collection("colleges/c1/facultyMembers");
    const docs = await getInChunks(names(50), (chunk) => coll.where("department", "in", chunk) as never);
    expect(docs).toHaveLength(50);
    fake.readCount = 0;
    expect(await getInChunks([], (chunk) => coll.where("department", "in", chunk) as never)).toEqual([]);
    expect(fake.readCount).toBe(0);
  });
});
