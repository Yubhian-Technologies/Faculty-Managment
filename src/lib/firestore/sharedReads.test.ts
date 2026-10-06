import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { cachedCollectionDocs, mapLimit } from "./sharedReads";

describe("mapLimit", () => {
  it("keeps input order and never exceeds the limit", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 6 - n));
      running--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("handles an empty list", async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});

describe("cachedCollectionDocs", () => {
  it("reads a collection once within the TTL and serves id + data()", async () => {
    let reads = 0;
    const db = {
      collection: () => ({ doc: () => ({ collection: () => ({ get: async () => { reads++; return { docs: [{ id: "d1", data: () => ({ name: "CSE" }) }] }; } }) }) }),
    } as unknown as Firestore;
    const a = await cachedCollectionDocs(db, "college-x", "departments");
    const b = await cachedCollectionDocs(db, "college-x", "departments");
    expect(reads).toBe(1);
    expect(a[0].id).toBe("d1");
    expect(b[0].data()).toEqual({ name: "CSE" });
  });
});
