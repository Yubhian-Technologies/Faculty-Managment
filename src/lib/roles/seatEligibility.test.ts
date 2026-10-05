import { afterEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { seatBlockReason } from "@/lib/roles/seatEligibility";

// A counting fake: every facultyMembers query is a "read".
function fakeDb(opts: { status?: string; none?: boolean; fail?: boolean }) {
  const reads = { n: 0 };
  const db = {
    collection: () => ({ doc: () => ({ collection: () => ({ where: () => ({ limit: () => ({ get: async () => {
      reads.n++;
      if (opts.fail) throw new Error("firestore unavailable");
      return opts.none ? { empty: true, docs: [] } : { empty: false, docs: [{ data: () => ({ status: opts.status }) }] };
    } }) }) }) }) }),
  } as unknown as Firestore;
  return { db, reads };
}

afterEach(() => { delete process.env.READ_ONLY_FACULTY_COLLEGES; vi.restoreAllMocks(); });

describe("seatBlockReason", () => {
  it("applies to EVERY college: the old env switch is ignored and a RESIGNED person is refused anywhere", async () => {
    process.env.READ_ONLY_FACULTY_COLLEGES = "other";
    const { db, reads } = fakeDb({ status: "RESIGNED" });
    expect((await seatBlockReason(db, "any-college", "u1", "Dr X"))?.status).toBe(409);
    expect(reads.n).toBe(1);
  });

  it("a RESIGNED or RETIRED person is refused with a clear message (409)", async () => {
    for (const status of ["RESIGNED", "RETIRED"]) {
      const { db } = fakeDb({ status });
      const r = await seatBlockReason(db, "c1", "u1", "Dr X");
      expect(r?.status).toBe(409);
      expect(r?.message).toMatch(/Dr X is resigned or retired and has read-only access/);
      expect(r?.message).toMatch(/set them back to Active/);
    }
  });

  it("ACTIVE / ON_LEAVE / RETAINERSHIP / INTERVIEW_DONE and a login with no faculty record are allowed", async () => {
    for (const status of ["ACTIVE", "ON_LEAVE", "RETAINERSHIP", "INTERVIEW_DONE"]) expect(await seatBlockReason(fakeDb({ status }).db, "c1", "u1")).toBeNull();
    expect(await seatBlockReason(fakeDb({ none: true }).db, "c1", "principal")).toBeNull();
  });

  it("FAILS CLOSED: if the status lookup fails the appointment is refused (503, try again), never waved through", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await seatBlockReason(fakeDb({ fail: true }).db, "c1", "u1", "Dr X");
    expect(r?.status).toBe(503);
    expect(r?.message).toMatch(/try again/);
  });
});
