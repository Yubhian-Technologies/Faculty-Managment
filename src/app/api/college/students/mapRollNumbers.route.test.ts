import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAuth, FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// "Import Roll Nos": set Roll No on students who already exist, matched on
// Student Mobile No. Real routes against in-memory fakes only.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeFirestore,
  auth: null as unknown as FakeAuth,
  session: null as null | { collegeId: string; uid: string; role: string },
}));
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async (...roles: string[]) => {
    if (!h.session) throw new Error("UNAUTHORIZED");
    if (roles.length && !roles.includes(h.session.role)) throw new Error("UNAUTHORIZED");
    return h.session;
  },
}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db, getAdminAuth: async () => h.auth }));

import { POST as PREVIEW } from "./map-roll-numbers/preview/route";
import { POST as APPLY } from "./map-roll-numbers/apply/route";

const C = "colleges/c1";
type Row = { rowNumber?: number; mobile: string; roll: string; name?: string };

const call = (fn: typeof PREVIEW, rows: Row[], replaceExisting = false) =>
  fn(new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows, replaceExisting }),
  }));

const preview = async (rows: Row[], replaceExisting = false) =>
  (await (await call(PREVIEW, rows, replaceExisting)).json()) as {
    results: { rowNumber: number; outcome: string; studentId?: string; message: string; nameMismatch?: boolean }[];
    summary: Record<string, number>;
  };

const apply = async (rows: Row[], replaceExisting = false) =>
  (await (await call(APPLY, rows, replaceExisting)).json()) as {
    appliedCount: number; failedCount: number; skippedCount: number;
    failed: { rowNumber: number; error: string }[];
  };

const student = (id: string) => h.db.docs.get(`${C}/students/${id}`) as { rollNumber?: string; name?: string } | undefined;
const audits = () => [...h.db.docs.entries()].filter(([p]) => p.startsWith(`${C}/auditLogs/`)).map(([, d]) => d as { action: string });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.auth = new FakeAuth();
  h.session = { collegeId: "c1", uid: "office1", role: "COLLEGE_OFFICE" };
  h.db = new FakeFirestore({
    [`${C}/users/office1`]: { name: "Office" },
    // No roll yet - the case this feature exists for.
    [`${C}/students/s1`]: { name: "Ana Rao", status: "REGULAR", department: "CSE", mobileNo: "9876501001" },
    // Already has a roll.
    [`${C}/students/s2`]: { name: "Bob Rao", rollNumber: "22A1", rollNumberUpper: "22A1", status: "REGULAR", department: "CSE", mobileNo: "9876501002" },
    "studentUsernames/22A1": { collegeId: "c1", studentDocId: "s2", name: "Bob Rao", rollKey: "22a1", active: true, createdAt: new Date() },
    // Another college holds this roll - uniqueness is global.
    "colleges/c9/students/z1": { name: "Zed", rollNumber: "Z9" },
    "studentUsernames/Z9": { collegeId: "c9", studentDocId: "z1", name: "Zed", rollKey: "z9", active: true, createdAt: new Date() },
  });
});

describe("preview classifies without writing", () => {
  it("reports every outcome and leaves the students untouched", async () => {
    const twinA = { name: "Twin A", status: "REGULAR", department: "CSE", mobileNo: "9876501009" };
    const twinB = { name: "Twin B", status: "REGULAR", department: "CSE", mobileNo: "9876501009" };
    h.db.docs.set(`${C}/students/t1`, twinA);
    h.db.docs.set(`${C}/students/t2`, twinB);

    const { results, summary } = await preview([
      { rowNumber: 2, mobile: "9876501001", roll: "22B5" },  // WILL_SET
      { rowNumber: 3, mobile: "9876501002", roll: "22A1" },  // ALREADY_SET
      { rowNumber: 4, mobile: "9876501002", roll: "22C7" },  // DIFFERENT_ROLL (same student, other roll)
      { rowNumber: 5, mobile: "9999999999", roll: "22D1" },  // NO_MATCH
      { rowNumber: 6, mobile: "9876501009", roll: "22E1" },  // MOBILE_SHARED
      { rowNumber: 7, mobile: "9876501001", roll: "Z9" },    // ROLL_TAKEN (other college)
      { rowNumber: 8, mobile: "9876501001", roll: "DUP1" },  // DUPLICATE_IN_FILE
      { rowNumber: 9, mobile: "9876501002", roll: "dup1" },  // DUPLICATE_IN_FILE
      { rowNumber: 10, mobile: "9876501001", roll: "" },     // BAD_ROLL
      { rowNumber: 11, mobile: "123", roll: "22F1" },        // BAD_MOBILE
    ]);

    expect(results.map((r) => r.outcome)).toEqual([
      "WILL_SET", "ALREADY_SET", "DIFFERENT_ROLL", "NO_MATCH", "MOBILE_SHARED",
      "ROLL_TAKEN", "DUPLICATE_IN_FILE", "DUPLICATE_IN_FILE", "BAD_ROLL", "BAD_MOBILE",
    ]);
    expect(summary.WILL_SET).toBe(1);

    // Nothing was written.
    expect(student("s1")?.rollNumber).toBeUndefined();
    expect(audits()).toHaveLength(0);
  });

  it("warns about a name mismatch without changing the outcome", async () => {
    const { results } = await preview([{ rowNumber: 2, mobile: "9876501001", roll: "22B5", name: "Totally Different" }]);
    expect(results[0].outcome).toBe("WILL_SET");
    expect(results[0].nameMismatch).toBe(true);
  });
});

describe("apply writes only what it said it would", () => {
  it("sets the roll, claims it globally, and logs one audit entry", async () => {
    const res = await apply([{ rowNumber: 2, mobile: "9876501001", roll: "22B5" }]);
    expect(res.appliedCount).toBe(1);
    expect(res.failedCount).toBe(0);
    expect(student("s1")?.rollNumber).toBe("22B5");
    // The cross-college registry now holds it for this student.
    expect(h.db.docs.get("studentUsernames/22B5")).toMatchObject({ collegeId: "c1", studentDocId: "s1" });
    expect(audits().map((a) => a.action)).toEqual(["STUDENT_ROLL_CHANGED"]);
  });

  it("is idempotent - a second run applies nothing", async () => {
    const rows = [{ rowNumber: 2, mobile: "9876501001", roll: "22B5" }];
    await apply(rows);
    const second = await apply(rows);
    expect(second.appliedCount).toBe(0);
    expect(second.skippedCount).toBe(1);
    expect(student("s1")?.rollNumber).toBe("22B5");
    expect(audits()).toHaveLength(1); // no second entry
  });

  it("skips a student who already has a different roll, and replaces only when asked", async () => {
    const rows = [{ rowNumber: 2, mobile: "9876501002", roll: "22C7" }];
    expect((await apply(rows)).appliedCount).toBe(0);
    expect(student("s2")?.rollNumber).toBe("22A1");

    expect((await apply(rows, true)).appliedCount).toBe(1);
    expect(student("s2")?.rollNumber).toBe("22C7");
  });

  // Would have passed even with the registry lookup broken, unless the id
  // convention is right - studentUsernames ids are the UPPERCASED key.
  it("refuses a roll held by a student in another college", async () => {
    const res = await apply([{ rowNumber: 2, mobile: "9876501001", roll: "Z9" }]);
    expect(res.appliedCount).toBe(0);
    expect(res.skippedCount).toBe(1);
    expect(student("s1")?.rollNumber).toBeUndefined();
  });

  it("never clears a roll, whatever the file says", async () => {
    const res = await apply([{ rowNumber: 2, mobile: "9876501002", roll: "" }], true);
    expect(res.appliedCount).toBe(0);
    expect(student("s2")?.rollNumber).toBe("22A1");
  });

  // A preview is a snapshot; apply re-reads and must refuse what has since
  // become a conflict rather than forcing it through.
  it("re-checks at write time and refuses a roll claimed since the preview", async () => {
    const rows = [{ rowNumber: 2, mobile: "9876501001", roll: "22NEW" }];
    const before = await preview(rows);
    expect(before.results[0].outcome).toBe("WILL_SET");

    // Someone else claims it in between.
    h.db.docs.set("studentUsernames/22NEW", {
      collegeId: "c9", studentDocId: "z2", name: "Latecomer", rollKey: "22new", active: true, createdAt: new Date(),
    });

    const res = await apply(rows);
    expect(res.appliedCount).toBe(0);
    expect(student("s1")?.rollNumber).toBeUndefined();
  });

  it("applies the good rows and reports the rest, rather than aborting", async () => {
    const res = await apply([
      { rowNumber: 2, mobile: "9876501001", roll: "22B5" },
      { rowNumber: 3, mobile: "9999999999", roll: "22D1" },
      { rowNumber: 4, mobile: "123", roll: "22F1" },
    ]);
    expect(res.appliedCount).toBe(1);
    expect(res.skippedCount).toBe(2);
    expect(student("s1")?.rollNumber).toBe("22B5");
  });

  it("reclaims a retired roll", async () => {
    h.db.docs.set("studentUsernames/OLD1", {
      collegeId: "c1", studentDocId: "gone", rollKey: "old1", active: false, createdAt: new Date(),
    });
    const res = await apply([{ rowNumber: 2, mobile: "9876501001", roll: "OLD1" }]);
    expect(res.appliedCount).toBe(1);
    expect(student("s1")?.rollNumber).toBe("OLD1");
  });
});

describe("guards", () => {
  it("is College Office only", async () => {
    h.session = { collegeId: "c1", uid: "p1", role: "PRINCIPAL" };
    expect((await call(PREVIEW, [{ mobile: "9876501001", roll: "22B5" }])).status).toBe(401);
    expect((await call(APPLY, [{ mobile: "9876501001", roll: "22B5" }])).status).toBe(401);
  });

  it("refuses an empty file and one that is too large", async () => {
    expect((await call(PREVIEW, [])).status).toBe(400);
    const huge = Array.from({ length: 2001 }, (_, i) => ({ mobile: "9876501001", roll: `R${i}` }));
    expect((await call(PREVIEW, huge)).status).toBe(400);
  });
});
