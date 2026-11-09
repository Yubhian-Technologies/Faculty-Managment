import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// The Mid Question Bank through its REAL routes on a real Firestore (the local
// emulator): a deadline opens the module, the subject's syllabus is frozen (units /
// COs / mapping) and a faculty member starts a bank for their section + a colleague's, sections can't be
// claimed twice, the colleague reads only, the deadline locks writes and an
// extension reopens them, and the question rules (rev, unit order, checks,
// duplicates, completed units, per-question format).
// Skipped unless the emulator is running:
//   firebase emulators:exec --only firestore --project demo-mb "npx vitest run src/lib/midBank/midBank.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const who = { uid: "u-fac", role: "PANEL_MEMBER" as string };

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-mb" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => ({}), getAdminStorage: () => ({}) };
});
vi.mock("@/lib/departments/scope", async (orig) => ({
  ...(await orig() as object),
  getHodDepartmentScope: async () => ({ departmentName: "Information Technology", departmentId: "it", ownDepartmentNames: ["Information Technology"], ownDepartmentIds: ["it"],
    childDepartmentNames: [], childDepartmentIds: [], managedDepartmentNames: [], managedDepartmentIds: [], parentDepartmentIds: [] }),
}));
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async (...roles: string[]) => {
    if (roles.length && !roles.includes(who.role)) throw new Error("UNAUTHORIZED");
    return { uid: who.uid, email: "f@x.test", role: who.role, realRole: who.role, roles: [who.role], collegeId: "c1" };
  },
}));

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- loose JSON of a route response in a test
const C = "c1";
const D = "d1";
const BRANCH = "Information Technology";
const BANK = `${D}__sub1__information-technology__fm1`;
const FUTURE = "2099-12-31";

describe.skipIf(!EMULATOR)("Mid Question Bank (real Firestore)", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-mb" }));
  const col = (n: string) => db().collection("colleges").doc(C).collection(n);
  const res = async (r: Response) => ({ status: r.status, json: (await r.json()) as Json });

  // Units / COs / mapping now come from the subject's FROZEN syllabus (HOD prepares, Academics freezes).
  const syllabusRoute = async () => import("@/app/api/college/subjects/[id]/syllabus-outcomes/route");
  const putSyllabus = async (body: unknown) => { const { PUT } = await syllabusRoute(); return res((await PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "sub1" }) })) as Response); };
  const syllabusStep = async (action: string, baseVersion: number, remarks = "") => { const { POST } = await syllabusRoute(); return res((await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ action, baseVersion, remarks }) }), { params: Promise.resolve({ id: "sub1" }) })) as Response); };
  /** Freeze the subject's syllabus straight in the database (what HOD + Academics produce). */
  const putOutcomes = async (body: { units: { title: string }[]; cos: { statement: string }[]; mapping: Record<string, string[]> }) => {
    await col("subjectSyllabus").doc("sub1").set({
      subjectId: "sub1", subjectName: "Discrete Maths", subjectCode: "DM101", courseName: "B.Tech", regulation: "R23",
      units: body.units.map((u, i) => ({ no: i + 1, title: u.title })), cos: body.cos.map((c, i) => ({ id: `CO${i + 1}`, statement: c.statement, unit: 1 })),
      mapping: body.mapping, status: "FROZEN", version: 3, frozenAt: "2026-11-01T00:00:00.000Z", frozenByName: "Dean", updatedAt: "2026-11-01T00:00:00.000Z", updatedByUid: "u-ac", updatedByName: "Dean", history: [],
    });
    return { status: 200, json: {} };
  };
  const startBank = async (sectionIds: string[]) => {
    const { POST } = await import("@/app/api/college/mid-question-banks/route");
    return res(await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ deadlineId: D, subjectId: "sub1", branch: BRANCH, sectionIds }) })));
  };
  const getBank = async (id = BANK) => {
    const { GET } = await import("@/app/api/college/mid-question-banks/[id]/route");
    return res(await GET(new Request("http://x"), { params: Promise.resolve({ id }) }));
  };
  const save = async (qid: string, action: "draft" | "complete", parts: unknown[], baseRev = 0, format?: string) => {
    const { PATCH } = await import("@/app/api/college/mid-question-banks/[id]/questions/[qid]/route");
    return res(await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ action, parts, baseRev, format }) }), { params: Promise.resolve({ id: BANK, qid }) }));
  };
  const moveDeadline = async (deadline: string) => {
    const { PATCH } = await import("@/app/api/college/mid-bank-deadlines/[id]/route");
    return res(await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ deadline }) }), { params: Promise.resolve({ id: D }) }));
  };
  const part = (text: string, bloom: string, cos = ["CO1"]) => ({ text, cos, bloom });
  const outcomes = {
    deadlineId: D, subjectId: "sub1", branch: BRANCH, baseVersion: 0,
    units: [{ title: "Sets" }, { title: "Relations" }, { title: "Graphs" }],
    cos: [{ statement: "Explain sets" }, { statement: "Apply relations" }],
    mapping: { CO1: ["PO1"], CO2: ["PO2", "PSO1"] },
  };
  const asFaculty = (uid: string) => { who.uid = uid; who.role = "PANEL_MEMBER"; };

  beforeEach(async () => {
    for (const n of ["midBankDeadlines", "midQuestionBanks", "midBankSectionClaims", "subjectOutcomes", "subjectSyllabus", "departments", "auditLogs", "midBankRules", "subjects", "facultyMembers",
      "users", "courses", "sections", "subjectSemesterAssignments", "teachingAssignments", "examMidSchedules", "notifications", "examSettings"]) {
      for (const d of (await col(n).get()).docs) {
        for (const sub of await d.ref.listCollections()) for (const x of (await sub.get()).docs) await x.ref.delete();
        await d.ref.delete();
      }
    }
    asFaculty("u-fac");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await col("users").doc("u-fac").set({ name: "Dr A" });
    await col("facultyMembers").doc("fm1").set({ userUid: "u-fac", name: "Dr A" });
    await col("facultyMembers").doc("fm2").set({ userUid: "u-other", name: "Dr B" });
    await col("courses").doc("crs").set({ name: "B.Tech", catalogId: "btech", durationYears: 4, departmentId: "it" });
    await col("subjects").doc("sub1").set({ name: "Discrete Maths", code: "DM101", catalogId: "btech", courseName: "B.Tech", regulation: "R23", ownerDepartments: [{ id: "it", name: BRANCH }], ownerDepartmentIds: ["it"] });
    await col("departments").doc("it").set({ name: BRANCH });
    await col("sections").doc("sA").set({ name: "A", courseId: "crs", year: 2, department: BRANCH, batch: "2025-2029" });
    await col("sections").doc("sB").set({ name: "B", courseId: "crs", year: 2, department: BRANCH, batch: "2025-2029" });
    await col("subjectSemesterAssignments").doc("i1").set({ courseId: "crs", semester: 3, year: 2, subjectId: "sub1", subjectName: "Discrete Maths", subjectCode: "DM101", departmentId: "it" });
    await col("teachingAssignments").doc("t1").set({ sectionId: "sA", subjectId: "sub1", subjectName: "Discrete Maths", subjectCode: "DM101", facultyId: "fm1", facultyName: "Dr A", year: 2 });
    await col("teachingAssignments").doc("t2").set({ sectionId: "sB", subjectId: "sub1", subjectName: "Discrete Maths", subjectCode: "DM101", facultyId: "fm2", facultyName: "Dr B", year: 2 });
    await col("midBankRules").doc("btech__ALL").set({ courseKey: "btech", courseName: "B.Tech", regulation: "ALL", mids: { "1": [1, 2] }, formats: ["SINGLE", "PARTS_AB", "PARTS_ABC"], marks: 10 });
    await col("midBankDeadlines").doc(D).set({ courseKey: "btech", courseName: "B.Tech", courseIds: ["crs"], year: 2, semester: 3, midNumber: 1, deadline: FUTURE, extensions: [] });
  });

  it("starts only after the branch setup; covers a colleague's section, who then reads it but can't claim it", async () => {
    const early = await startBank(["sA", "sB"]); // the syllabus isn't frozen yet
    expect(early.status).toBe(400);
    expect(early.json.issues[0].code).toBe("NO_SYLLABUS");
    expect((await putOutcomes(outcomes)).status).toBe(200);
    const started = await startBank(["sA", "sB"]);
    expect(started.status).toBe(201);
    expect(started.json.bank).toMatchObject({ units: [1, 2], formats: ["SINGLE", "PARTS_AB", "PARTS_ABC"], viewerFacultyIds: ["fm1", "fm2"] });
    expect((await col("notifications").where("toUid", "==", "u-other").get()).size).toBe(1);

    asFaculty("u-other");
    expect((await startBank(["sB"])).json.error).toBe("Section B is already in Dr A's question bank");
    expect((await getBank()).json.access).toMatchObject({ isOwner: false, isIncluded: true, canWrite: false });
    expect((await save("1_1", "draft", [part("x", "")])).status).toBe(403);
  });

  it("syllabus: the HOD prepares and submits, Academics freezes; then only Academics edits, and each change is recorded", async () => {
    const form = { units: [{ title: "Sets" }, { title: "Relations" }], cos: [{ statement: "Explain sets", unit: 1 }, { statement: "Apply relations", unit: 2 }], mapping: { CO1: ["PO1"], CO2: ["PO2"] } };
    who.uid = "u-hod"; who.role = "HOD";
    expect((await putSyllabus({ ...form, cos: [{ statement: "Explain sets" }], baseVersion: 0 })).json.error).toBe("CO1: pick its unit");
    const draft = await putSyllabus({ ...form, baseVersion: 0 });
    expect(draft.json.syllabus).toMatchObject({ status: "DRAFT", version: 1 });
    expect((await putSyllabus({ ...form, baseVersion: 0 })).status).toBe(409); // stale version
    expect((await syllabusStep("SUBMIT", 1)).json.syllabus.status).toBe("SUBMITTED");
    expect((await putSyllabus({ ...form, baseVersion: 2 })).status).toBe(409); // with Academics: the HOD can't change it
    expect((await syllabusStep("FREEZE", 2)).status).toBe(403); // only Academics freezes

    who.uid = "u-ac"; who.role = "ACADEMICS";
    expect((await syllabusStep("RETURN", 2)).status).toBe(400); // remarks needed
    expect((await syllabusStep("FREEZE", 2)).json.syllabus).toMatchObject({ status: "FROZEN", version: 3 });
    const edited = await putSyllabus({ ...form, units: [{ title: "Sets and logic" }, { title: "Relations" }], baseVersion: 3 });
    expect(edited.json.syllabus.status).toBe("FROZEN");
    expect(edited.json.syllabus.history.at(-1)).toMatchObject({ action: "EDITED_AFTER_FREEZE", role: "ACADEMICS", changes: [{ field: "Unit 1 title", before: "Sets", after: "Sets and logic" }] });

    who.uid = "u-hod"; who.role = "HOD";
    expect((await putSyllabus({ ...form, baseVersion: 4 })).json.error).toContain("only Academics");
    // Faculty start on it.
    asFaculty("u-fac");
    const started = await startBank(["sA"]);
    expect(started.status).toBe(201);
    expect(started.json.bank.outcomesId).toBe("syllabus__sub1");
  });

  it("a practical (non-theory) subject has no question bank", async () => {
    await col("subjects").doc("sub1").update({ type: "PRACTICAL" });
    await putOutcomes(outcomes);
    expect((await startBank(["sA"])).status).not.toBe(201);
  });

  it("refuses a bank without one of my own sections", async () => {
    await putOutcomes(outcomes);
    expect((await startBank(["sB"])).json.error).toBe("Include at least one section you teach");
  });

  describe("writing questions", () => {
    beforeEach(async () => {
      await putOutcomes(outcomes);
      await startBank(["sA"]);
    });

    it("drafts save with a rev; a save on a stale rev is refused, not overwritten", async () => {
      expect((await save("1_1", "draft", [part("Define a set", "")])).json.question).toMatchObject({ state: "DRAFT", rev: 1 });
      expect((await save("1_1", "draft", [part("Something else", "")], 0)).status).toBe(409);
    });

    it("the deadline locks the bank; an Exam Cell extension reopens it", async () => {
      await col("midBankDeadlines").doc(D).update({ deadline: "2020-01-01" });
      const locked = await save("1_1", "draft", [part("Define a set", "")]);
      expect(locked.status).toBe(403);
      expect(locked.json.error).toContain("deadline has passed");
      who.uid = "u-exam"; who.role = "EXAM_CELL";
      expect((await moveDeadline(FUTURE)).status).toBe(200);
      asFaculty("u-fac");
      expect((await save("1_1", "draft", [part("Define a set", "")])).status).toBe(200);
    });

    it("a later unit stays locked; a complete question needs a CO and a level, and can't repeat another", async () => {
      expect((await save("2_1", "draft", [part("x", "")])).status).toBe(403);
      const bad = await save("1_1", "complete", [{ text: "Define a set", cos: [], bloom: "" }]);
      expect(Object.keys(bad.json.errors)).toEqual(["parts.0.cos", "parts.0.bloom"]);
      expect((await save("1_1", "complete", [part("Define a set", "L2")])).status).toBe(200);
      expect((await save("1_2", "complete", [part("define a SET.", "L3")])).json.errors["parts.0.text"]).toBe("Question is the same as Unit 1 Q1");
    });

    it("parts carry the faculty's split, which must add up", async () => {
      const off = await save("1_2", "complete", [{ ...part("State Ohm's law", "L2"), marks: 6 }, { ...part("Find the current", "L3"), marks: 3 }], 0, "PARTS_AB");
      expect(off.json.errors.marks).toBe("Parts (a) and (b) must add up to 10 marks (now 9)");
      const ok = await save("1_2", "complete", [{ ...part("State Ohm's law", "L2"), marks: 6 }, { ...part("Find the current", "L3"), marks: 4 }], 0, "PARTS_AB");
      expect(ok.json.question).toMatchObject({ format: "PARTS_AB", parts: [{ marks: 6 }, { marks: 4 }] });
    });

    it("a unit completes at 10 with L2/L3/L4 x3, opens the next, and can't be broken afterwards", async () => {
      const blooms = ["L2", "L2", "L2", "L2", "L3", "L3", "L3", "L4", "L4", "L4"];
      for (let s = 1; s <= 10; s++) expect((await save(`1_${s}`, "complete", [part(`Question number ${s} about sets topic ${s * 7}`, blooms[s - 1])])).status).toBe(200);
      expect((await col("midQuestionBanks").doc(BANK).get()).data()!.unitStatus["1"]).toMatchObject({ complete: true, bloom: { L2: 4, L3: 3, L4: 3 } });
      expect((await save("2_1", "draft", [part("Relations question", "")])).status).toBe(200);
      const breaking = await save("1_10", "complete", [part("Question number 10 about sets topic 70", "L2")], 1);
      expect(breaking.status).toBe(409);
      expect(breaking.json.error).toContain("L4 would drop to 2");
    });

    it("once questions use the frozen syllabus, Academics can't remove a unit / CO they use", async () => {
      await save("1_1", "draft", [part("Define a set", "", ["CO2"])]);
      who.uid = "u-ac"; who.role = "ACADEMICS";
      const cut = await putSyllabus({ units: [{ title: "Sets" }, { title: "Relations" }, { title: "Graphs" }], cos: [{ statement: "Explain sets", unit: 1 }], mapping: { CO1: ["PO1"] }, baseVersion: 3 });
      expect(cut.status).toBe(409);
      expect(cut.json.error).toBe("CO2 is used by questions and can't be removed");
    });
  });
});
