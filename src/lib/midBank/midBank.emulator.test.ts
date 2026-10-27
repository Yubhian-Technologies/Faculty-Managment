import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// The Mid Question Bank through its REAL routes on a real Firestore (the local
// emulator): starting a bank, the rev check, unit order, completion checks,
// duplicates, completed-unit protection, and that only the holder writes.
// Skipped unless the emulator is running:
//   firebase emulators:exec --only firestore --project demo-mb "npx vitest run src/lib/midBank/midBank.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const who = { uid: "u-fac", role: "PANEL_MEMBER" as string };

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-mb" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => ({}), getAdminStorage: () => ({}) };
});
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async (...roles: string[]) => {
    if (roles.length && !roles.includes(who.role)) throw new Error("UNAUTHORIZED");
    return { uid: who.uid, email: "f@x.test", role: who.role, realRole: who.role, roles: [who.role], collegeId: "c1" };
  },
}));

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- loose JSON of a route response in a test
const C = "c1";
const A = "sub1_mid1";

describe.skipIf(!EMULATOR)("Mid Question Bank (real Firestore)", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-mb" }));
  const col = (n: string) => db().collection("colleges").doc(C).collection(n);

  const start = async () => {
    const { POST } = await import("@/app/api/college/mid-question-banks/[id]/start/route");
    const res = await POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: A }) });
    return { status: res.status, json: (await res.json()) as Json };
  };
  const save = async (qid: string, action: "draft" | "complete", parts: unknown[], baseRev = 0) => {
    const { PATCH } = await import("@/app/api/college/mid-question-banks/[id]/questions/[qid]/route");
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ action, parts, baseRev }) }), { params: Promise.resolve({ id: A, qid }) });
    return { status: res.status, json: (await res.json()) as Json };
  };
  const putOutcomes = async (body: unknown) => {
    const { PUT } = await import("@/app/api/college/subject-outcomes/[subjectId]/route");
    const res = await PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ subjectId: "sub1" }) });
    return { status: res.status, json: (await res.json()) as Json };
  };
  const part = (text: string, bloom: string, cos = ["CO1"]) => ({ text, cos, bloom });
  const outcomes = {
    units: [{ title: "Sets" }, { title: "Relations" }, { title: "Graphs" }],
    cos: [{ statement: "Explain sets" }, { statement: "Apply relations" }],
    psos: [],
    mapping: { CO1: { PO1: 3 }, CO2: { PO2: 2 } },
  };

  beforeEach(async () => {
    for (const n of ["midPaperAssignments", "midQuestionBanks", "subjectOutcomes", "midBankRules", "subjects", "facultyMembers", "users", "courses"]) {
      for (const d of (await col(n).get()).docs) {
        for (const sub of await d.ref.listCollections()) for (const x of (await sub.get()).docs) await x.ref.delete();
        await d.ref.delete();
      }
    }
    who.uid = "u-fac"; who.role = "PANEL_MEMBER";
    vi.spyOn(console, "error").mockImplementation(() => {});
    await col("facultyMembers").doc("fm1").set({ userUid: "u-fac", name: "Dr A" });
    await col("facultyMembers").doc("fm2").set({ userUid: "u-other", name: "Dr B" });
    await col("subjects").doc("sub1").set({ name: "Discrete Maths", code: "DM101", catalogId: "btech", courseName: "B.Tech", regulation: "R23", department: "CSE", year: 2, semester: 3 });
    await col("midPaperAssignments").doc(A).set({ subjectId: "sub1", subjectName: "Discrete Maths", subjectCode: "DM101", midNumber: 1, facultyId: "fm1", facultyName: "Dr A", department: "CSE", year: 2 });
  });

  it("can't start without Exam Cell rules and a setup; then starts once, with a snapshot of the rules", async () => {
    expect((await start()).status).toBe(400);
    await col("midBankRules").doc("btech__ALL").set({ courseKey: "btech", courseName: "B.Tech", regulation: "ALL", mids: { "1": [1, 2] }, format: "SINGLE", marks: 10 });
    expect((await putOutcomes({ ...outcomes, baseVersion: 0 })).status).toBe(200);
    const r = await start();
    expect(r.status).toBe(201);
    expect(r.json.bank).toMatchObject({ units: [1, 2], format: "SINGLE", marks: 10, totalCount: 20, status: "IN_PROGRESS" });
    await col("midBankRules").doc("btech__ALL").update({ marks: 20 });
    expect((await start()).json.bank.marks).toBe(10); // started bank keeps its copy
  });

  describe("writing questions", () => {
    beforeEach(async () => {
      await col("midBankRules").doc("btech__ALL").set({ courseKey: "btech", courseName: "B.Tech", regulation: "ALL", mids: { "1": [1, 2] }, format: "SINGLE", marks: 10 });
      await putOutcomes({ ...outcomes, baseVersion: 0 });
      await start();
    });

    it("drafts save with a rev; a save on a stale rev is refused, not overwritten", async () => {
      const a = await save("1_1", "draft", [part("Define a set", "")]);
      expect(a.status).toBe(200);
      expect(a.json.question).toMatchObject({ state: "DRAFT", rev: 1 });
      const stale = await save("1_1", "draft", [part("Something else", "")], 0);
      expect(stale.status).toBe(409);
      expect((await col("midQuestionBanks").doc(A).collection("questions").doc("1_1").get()).data()?.parts[0].text).toBe("Define a set");
    });

    it("only the holder writes; a later unit stays locked", async () => {
      who.uid = "u-other";
      expect((await save("1_1", "draft", [part("x", "")])).status).toBe(403);
      who.uid = "u-fac";
      expect((await save("2_1", "draft", [part("x", "")])).status).toBe(403);
    });

    it("a complete question needs a CO and a Bloom level, and can't repeat another", async () => {
      const bad = await save("1_1", "complete", [{ text: "Define a set", cos: [], bloom: "" }]);
      expect(bad.status).toBe(400);
      expect(Object.keys(bad.json.errors)).toEqual(["parts.0.cos", "parts.0.bloom"]);
      expect((await save("1_1", "complete", [part("Define a set", "L2")])).status).toBe(200);
      const dup = await save("1_2", "complete", [part("define a SET.", "L3")]);
      expect(dup.status).toBe(400);
      expect(dup.json.errors["parts.0.text"]).toBe("Question is the same as Unit 1 Q1");
    });

    it("a unit completes at 10 with L2/L3/L4 x3, opens the next, and can't be broken afterwards", async () => {
      const blooms = ["L2", "L2", "L2", "L2", "L3", "L3", "L3", "L4", "L4", "L4"];
      for (let s = 1; s <= 10; s++) expect((await save(`1_${s}`, "complete", [part(`Question number ${s} about sets topic ${s * 7}`, blooms[s - 1])])).status).toBe(200);
      const bank = (await col("midQuestionBanks").doc(A).get()).data()!;
      expect(bank.unitStatus["1"]).toMatchObject({ complete: true, completeCount: 10, bloom: { L2: 4, L3: 3, L4: 3 } });
      expect((await save("2_1", "draft", [part("Relations question", "")])).status).toBe(200); // unit 2 now open
      const breaking = await save("1_10", "complete", [part("Question number 10 about sets topic 70", "L2")], 1);
      expect(breaking.status).toBe(409);
      expect(breaking.json.error).toContain("L4 would drop to 2");
    });

    it("once questions use the setup, the faculty can't change it (the HOD can)", async () => {
      await save("1_1", "draft", [part("Define a set", "", ["CO2"])]);
      expect((await putOutcomes({ ...outcomes, baseVersion: 1 })).status).toBe(403);
    });
  });
});
