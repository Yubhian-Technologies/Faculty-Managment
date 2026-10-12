import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// "Update student data" through the REAL preview / apply routes on a real Firestore (the local emulator): the preview
// writes nothing, apply changes ONLY the picked fields, every old value is backed up with the write, nothing else on any
// document moves, and a re-run is a no-op. Skipped unless the emulator is running:
//   firebase emulators:exec --config <cfg> --only firestore --project demo-bu "npx vitest run src/lib/students/bulkUpdate.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const who = { uid: "office1", role: "COLLEGE_OFFICE" as string };

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-bu" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => ({}) };
});
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async (...roles: string[]) => {
    if (roles.length && !roles.includes(who.role)) throw new Error("UNAUTHORIZED");
    return { uid: who.uid, email: "office@x.test", role: who.role, realRole: who.role, roles: [who.role], collegeId: "c1" };
  },
}));

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- loose JSON of a route response in a test
const C = "c1";
const row = (rowNumber: number, mobile: string, values: Record<string, string>) => ({ rowNumber, mobile, values });

describe.skipIf(!EMULATOR)("Update student data (real Firestore)", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-bu" }));
  const col = (n: string, college = C) => db().collection("colleges").doc(college).collection(n);
  const stu = async (id: string, college = C) => (await col("students", college).doc(id).get()).data() as Record<string, unknown>;

  // Everything that could possibly move, as plain JSON, to prove "nothing else changed".
  const everything = async () => {
    const out: Record<string, unknown> = {};
    for (const college of [C, "c2"]) {
      for (const n of ["students", "users", "departments"]) for (const d of (await col(n, college).get()).docs) out[`${college}/${n}/${d.id}`] = JSON.parse(JSON.stringify(d.data()));
    }
    for (const n of ["studentMobileKeys", "studentUsernames", "systemUsers"]) for (const d of (await db().collection(n).get()).docs) out[`${n}/${d.id}`] = JSON.parse(JSON.stringify(d.data()));
    return out;
  };

  const call = async (which: "preview" | "apply", body: unknown) => {
    const { POST } = which === "preview"
      ? await import("@/app/api/college/students/bulk-update/preview/route")
      : await import("@/app/api/college/students/bulk-update/apply/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
    return { status: res.status, json: (await res.json()) as Json };
  };
  const RUN = "run00000000000000000000000001";

  beforeEach(async () => {
    for (const college of [C, "c2"]) for (const n of ["students", "users", "auditLogs", "departments", "studentBulkUpdates"]) {
      for (const d of (await col(n, college).get()).docs) {
        for (const sub of await d.ref.listCollections()) for (const x of (await sub.get()).docs) await x.ref.delete();
        await d.ref.delete();
      }
    }
    for (const n of ["studentMobileKeys", "studentUsernames", "systemUsers"]) for (const d of (await db().collection(n).get()).docs) await d.ref.delete();
    who.uid = "office1"; who.role = "COLLEGE_OFFICE";
    vi.spyOn(console, "error").mockImplementation(() => {});

    await col("students").doc("s1").set({
      collegeId: C, uid: "stu1", name: "ASHA KUMARI", rollNumber: "24A001", rollNumberUpper: "24A001", mobileNo: "9876500001", department: "CSE", section: "A", year: 2,
      status: "REGULAR", course: "Bachelor of Technology", fatherName: "RAMU", email: "asha@x.test", aadharNo: "123412341234", caste: "OC", remarks: "staff note",
      loginEmail: "24a001@students.test", physicallyHandicapped: true, handicappedType: "H",
    });
    await col("students").doc("s2").set({ collegeId: C, uid: "stu2", name: "OTHER", rollNumber: "24A002", mobileNo: "9876500002", department: "CSE", section: "A", year: 2, status: "REGULAR", fatherName: "OTHER DAD", bankName: "SBI" });
    await col("students").doc("s3").set({ collegeId: C, name: "NO ROLL", rollNumber: "", mobileNo: "+91 98765 00003", department: "CSE", section: "", year: 1, status: "REGULAR" }); // legacy-format mobile
    await col("students").doc("s4").set({ collegeId: C, name: "TWIN A", rollNumber: "", mobileNo: "9876500009", department: "CSE", section: "", year: 1, status: "REGULAR" });
    await col("students").doc("s5").set({ collegeId: C, name: "TWIN B", rollNumber: "", mobileNo: "9876500009", department: "CSE", section: "", year: 1, status: "REGULAR" });
    await col("students", "c2").doc("z1").set({ collegeId: "c2", name: "ELSEWHERE", rollNumber: "Z1", mobileNo: "9123400001", department: "ECE", section: "", year: 1, status: "REGULAR", fatherName: "FAR" });
    await col("users").doc("stu1").set({ uid: "stu1", collegeId: C, name: "ASHA KUMARI", role: "STUDENT", email: "24a001@students.test", isActive: true });
    await db().collection("systemUsers").doc("stu1").set({ uid: "stu1", collegeId: C, role: "STUDENT", name: "ASHA KUMARI" });
    await db().collection("studentUsernames").doc("24A001").set({ studentDocId: "s1", collegeId: C, active: true, name: "ASHA KUMARI" });
    await db().collection("studentMobileKeys").doc("9876500001").set({ studentId: "s1", collegeId: C, reservedAt: new Date() });
    await db().collection("studentMobileKeys").doc("9876500002").set({ studentId: "s2", collegeId: C, reservedAt: new Date() });
    await db().collection("studentMobileKeys").doc("9123400001").set({ studentId: "z1", collegeId: "c2", reservedAt: new Date() });
  });

  it("only College Office may preview or apply", async () => {
    who.role = "HOD";
    const body = { fields: ["fatherName"], rows: [row(2, "9876500001", { fatherName: "X" })], runId: RUN };
    expect((await call("preview", body)).status).toBe(401);
    expect((await call("apply", body)).status).toBe(401);
    expect((await stu("s1")).fatherName).toBe("RAMU");
  });

  it("the preview writes nothing at all and shows fill / same / overwrite", async () => {
    const before = await everything();
    const r = await call("preview", {
      fields: ["fatherName", "motherName", "email"],
      rows: [row(2, "9876500001", { fatherName: "RAMAIAH", motherName: "SITA", email: "asha@x.test" }), row(3, "9876500002", { motherName: "GEETA" })],
    });
    expect(r.status).toBe(200);
    const [a, b] = r.json.results;
    expect(a.outcome).toBe("WILL_UPDATE");
    expect(a.changes.map((c: Json) => `${c.key}:${c.mode}`).sort()).toEqual(["fatherName:OVERWRITE", "motherName:FILL"]);
    expect(a.sameCount).toBe(1);
    expect(b.outcome).toBe("WILL_UPDATE");
    expect(await everything()).toEqual(before);
    expect((await col("studentBulkUpdates").get()).size).toBe(0);
  });

  it("apply changes ONLY the picked fields; every other field and document is untouched; the old values are backed up", async () => {
    const before = await everything();
    const r = await call("apply", {
      runId: RUN, fileName: "f.xlsx", fields: ["fatherName", "motherName", "email"],
      rows: [row(2, "9876500001", { fatherName: "RAMAIAH", motherName: "SITA", email: "asha@x.test" }), row(3, "9876500002", { motherName: "GEETA" })],
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ appliedCount: 2, failedCount: 0 });

    const after = await everything();
    const s1b = before["c1/students/s1"] as Json, s1a = after["c1/students/s1"] as Json;
    expect({ ...s1a, updatedAt: undefined, fatherName: undefined, motherName: undefined }).toEqual({ ...s1b, updatedAt: undefined, fatherName: undefined, motherName: undefined });
    expect(s1a.fatherName).toBe("RAMAIAH");
    expect(s1a.motherName).toBe("SITA");
    expect(s1a.email).toBe("asha@x.test");
    expect(s1a.rollNumber).toBe("24A001");
    expect(s1a.mobileNo).toBe("9876500001");
    expect(s1a.handicappedType).toBe("H"); // not touched
    expect((after["c1/students/s2"] as Json).motherName).toBe("GEETA");
    expect((after["c1/students/s2"] as Json).bankName).toBe("SBI");

    // Every other document, registry, login and the other college: identical.
    for (const k of Object.keys(before)) if (k !== "c1/students/s1" && k !== "c1/students/s2") expect(after[k], k).toEqual(before[k]);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());

    // The backup holds the exact old value of every changed field, plus the new one.
    const run = (await col("studentBulkUpdates").doc(RUN).get()).data() as Json;
    expect(run).toMatchObject({ fileName: "f.xlsx", fields: ["fatherName", "motherName", "email"], fillOnly: false, performedBy: "office1", appliedCount: 2 });
    const bk = (await col("studentBulkUpdates").doc(RUN).collection("rows").doc("s1").get()).data() as Json;
    expect(bk.before).toEqual({ fatherName: "RAMU", motherName: null });
    expect(bk.after).toEqual({ fatherName: "RAMAIAH", motherName: "SITA" });
    expect(bk).toMatchObject({ mobile: "9876500001", fileRow: 2, rollNumber: "24A001" });

    const audits = (await col("auditLogs").get()).docs.map((d) => d.data() as Json);
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ action: "STUDENT_DETAILS_UPDATED", details: { via: "Bulk Update Students", runId: RUN } });
  });

  it("a re-run of the same file changes nothing and writes no second backup", async () => {
    const body = { runId: RUN, fields: ["fatherName"], rows: [row(2, "9876500001", { fatherName: "RAMAIAH" })] };
    expect((await call("apply", body)).json.appliedCount).toBe(1);
    const mid = await everything();
    const again = await call("apply", { ...body, runId: "run00000000000000000000000002" });
    expect(again.json).toMatchObject({ appliedCount: 0, failedCount: 0 });
    expect(await everything()).toEqual(mid);
    expect((await col("studentBulkUpdates").doc("run00000000000000000000000002").collection("rows").get()).size).toBe(0);
  });

  it("a blank cell never clears a stored value", async () => {
    const r = await call("apply", { runId: RUN, fields: ["fatherName", "email"], rows: [row(2, "9876500001", { fatherName: "", email: "" })] });
    expect(r.json.appliedCount).toBe(0);
    const s = await stu("s1");
    expect(s.fatherName).toBe("RAMU");
    expect(s.email).toBe("asha@x.test");
  });

  it("fill blanks only keeps existing values and still fills blanks", async () => {
    const r = await call("apply", { runId: RUN, fillOnly: true, fields: ["fatherName", "motherName"], rows: [row(2, "9876500001", { fatherName: "RAMAIAH", motherName: "SITA" })] });
    expect(r.json.appliedCount).toBe(1);
    const s = await stu("s1");
    expect(s.fatherName).toBe("RAMU");
    expect(s.motherName).toBe("SITA");
  });

  it("apply judges fresh data: a value that already became equal after the preview is not rewritten", async () => {
    const body = { fields: ["fatherName"], rows: [row(2, "9876500001", { fatherName: "RAMAIAH" })] };
    expect((await call("preview", body)).json.results[0].outcome).toBe("WILL_UPDATE");
    await col("students").doc("s1").update({ fatherName: "RAMAIAH" }); // the student edited it meanwhile
    const r = await call("apply", { ...body, runId: RUN });
    expect(r.json).toMatchObject({ appliedCount: 0, failedCount: 0 });
    expect((await col("studentBulkUpdates").doc(RUN).collection("rows").get()).size).toBe(0);
  });

  it("one bad cell skips that student only; the others in the file are applied", async () => {
    const r = await call("apply", {
      runId: RUN, fields: ["email", "fatherName"],
      rows: [row(2, "9876500001", { email: "not-an-email", fatherName: "SHOULD NOT LAND" }), row(3, "9876500002", { fatherName: "NEW DAD" })],
    });
    expect(r.json).toMatchObject({ appliedCount: 1, skippedCount: 1 });
    expect((await stu("s1")).fatherName).toBe("RAMU");
    expect((await stu("s2")).fatherName).toBe("NEW DAD");
  });

  it("never touches another college's student, shared-mobile twins, or unknown numbers", async () => {
    const before = await everything();
    const r = await call("apply", {
      runId: RUN, fields: ["fatherName"],
      rows: [row(2, "9123400001", { fatherName: "HACK" }), row(3, "9876500009", { fatherName: "HACK" }), row(4, "9000000000", { fatherName: "HACK" }), row(5, "123", { fatherName: "HACK" })],
    });
    expect(r.json).toMatchObject({ appliedCount: 0, failedCount: 0, skippedCount: 4 });
    const outcomes = Object.fromEntries(r.json.skipped.map((s: Json) => [s.rowNumber, s]));
    expect(outcomes[2].outcome).toBe("NO_MATCH");
    expect(outcomes[2].message).toContain("another college");
    expect(outcomes[3].outcome).toBe("MOBILE_SHARED");
    expect(outcomes[4].outcome).toBe("NO_MATCH");
    expect(outcomes[5].outcome).toBe("BAD_MOBILE");
    expect(await everything()).toEqual(before);
  });

  it("finds a student saved with a legacy-format mobile (+91 spaces) and leaves the mobile as it was", async () => {
    const r = await call("apply", { runId: RUN, fields: ["fatherName"], rows: [row(2, "9876500003", { fatherName: "LEGACY DAD" })] });
    expect(r.json.appliedCount).toBe(1);
    const s = await stu("s3");
    expect(s.fatherName).toBe("LEGACY DAD");
    expect(s.mobileNo).toBe("+91 98765 00003");
  });

  it("the same mobile twice in a file applies neither row", async () => {
    const r = await call("preview", { fields: ["fatherName"], rows: [row(2, "9876500001", { fatherName: "A" }), row(3, "9876500001", { fatherName: "B" })] });
    expect(r.json.results.map((x: Json) => x.outcome)).toEqual(["DUPLICATE_IN_FILE", "DUPLICATE_IN_FILE"]);
  });

  it("the same run applied in two chunks keeps the ORIGINAL old value in the backup", async () => {
    await call("apply", { runId: RUN, fields: ["fatherName"], rows: [row(2, "9876500001", { fatherName: "FIRST" })] });
    await call("apply", { runId: RUN, fields: ["fatherName"], rows: [row(2, "9876500001", { fatherName: "SECOND" })] });
    const bk = (await col("studentBulkUpdates").doc(RUN).collection("rows").doc("s1").get()).data() as Json;
    expect(bk.before).toEqual({ fatherName: "RAMU" });
    expect(bk.after).toEqual({ fatherName: "SECOND" });
    expect((await stu("s1")).fatherName).toBe("SECOND");
  });

  it("refuses fields outside the allow-list, a bad run id, and an oversized apply chunk", async () => {
    const before = await everything();
    for (const field of ["mobileNo", "rollNumber", "name", "department", "year", "status"]) {
      const r = await call("apply", { runId: RUN, fields: [field], rows: [row(2, "9876500001", { [field]: "X" })] });
      expect(r.status, field).toBe(400);
    }
    expect((await call("apply", { runId: "x", fields: ["fatherName"], rows: [row(2, "9876500001", { fatherName: "X" })] })).status).toBe(400);
    const many = Array.from({ length: 101 }, (_, i) => row(i + 2, "9876500001", { fatherName: "X" }));
    expect((await call("apply", { runId: RUN, fields: ["fatherName"], rows: many })).status).toBe(400);
    expect(await everything()).toEqual(before);
  });

  it("dependent answers are not erased: Physically Handicapped = No keeps the type and warns", async () => {
    const pv = await call("preview", { fields: ["physicallyHandicapped"], rows: [row(2, "9876500001", { physicallyHandicapped: "No" })] });
    expect(pv.json.results[0].warnings.join(" ")).toContain("Handicapped Type");
    await call("apply", { runId: RUN, fields: ["physicallyHandicapped"], rows: [row(2, "9876500001", { physicallyHandicapped: "No" })] });
    const s = await stu("s1");
    expect(s.physicallyHandicapped).toBe(false);
    expect(s.handicappedType).toBe("H");
  });
});
