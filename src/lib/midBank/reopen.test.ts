import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";

// The Exam Cell sends an APPROVED paper set back for changes (a suggestion marked "needs changes") through the real
// suggestions route on an in-memory Firestore: only the Exam Cell, only while approved, never once printed; the owner
// may then edit past the deadline; a plain comment changes nothing.

const fake = new FakeFirestore();
const who = { uid: "u-exam", role: "EXAM_CELL" };
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => asFirestore(fake) }));
vi.mock("@/lib/notify", () => ({ notify: async () => undefined, notifyRole: async () => undefined, getDepartmentHeadUids: async () => [] }));
vi.mock("@/lib/audit/safeAuditLog", () => ({ writeAuditLogSafe: async () => undefined }));
vi.mock("@/lib/departments/scope", async (orig) => ({ ...(await orig() as object), getHodDepartmentScope: async () => ({ departmentName: "IT", ownDepartmentNames: ["IT"], ownDepartmentIds: ["it"], childDepartmentNames: [], childDepartmentIds: [], managedDepartmentNames: [], managedDepartmentIds: [], parentDepartmentIds: [] }) }));
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async (...roles: string[]) => {
    if (roles.length && !roles.includes(who.role)) throw new Error("UNAUTHORIZED");
    return { uid: who.uid, email: "x@x", role: who.role, realRole: who.role, roles: [who.role], collegeId: "c1" };
  },
}));

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- loose JSON of a route response in a test
const BANK = "d1__sub1__it__fm1";
const suggest = async (body: unknown) => {
  const { POST } = await import("@/app/api/college/mid-question-banks/[id]/suggestions/route");
  const r = await POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: BANK }) });
  return { status: r.status, json: (await r.json()) as Json };
};
const access = async (uid: string, role: string) => {
  const { bankAccess } = await import("@/lib/midBank/server");
  return bankAccess(asFirestore(fake) as never, { uid, role, collegeId: "c1" } as never, BANK);
};
const bank = () => fake.read(`colleges/c1/midQuestionBanks/${BANK}`) as Json;

beforeEach(() => {
  fake.seed("colleges/c1/facultyMembers/fm1", { userUid: "u-fac", name: "Dr A" });
  fake.seed("colleges/c1/facultyMembers/fm2", { userUid: "u-col", name: "Dr B" });
  fake.seed("colleges/c1/subjects/sub1", { name: "Maths", code: "MA1" });
  fake.seed("colleges/c1/midBankDeadlines/d1", { deadline: "2020-01-01", midNumber: 1 });   // passed
  fake.seed(`colleges/c1/midQuestionBanks/${BANK}`, {
    kind: "PAPERS", deadlineId: "d1", subjectId: "sub1", subjectName: "Maths", subjectCode: "MA1", branch: "IT", midNumber: 1,
    ownerFacultyId: "fm1", ownerUid: "u-fac", ownerName: "Dr A", viewerFacultyIds: ["fm2"], sections: [], status: "COMPLETE",
    approval: "APPROVED", approvalHistory: [{ at: "2026-11-10T00:00:00.000Z", byUid: "u-hod", byName: "HOD", action: "APPROVED" }],
  });
  Object.assign(who, { uid: "u-exam", role: "EXAM_CELL" });
});

describe("Exam Cell reopens an approved paper for changes", () => {
  it("locked when approved; the Exam Cell's 'needs changes' reopens it - editable past the deadline, HOD approves again", async () => {
    expect((await access("u-fac", "PANEL_MEMBER"))!.canWrite).toBe(false);
    const sent = await suggest({ text: "Q3 repeats Mid 1", reopen: true });
    expect(sent.status).toBe(201);
    expect(bank()).toMatchObject({ approval: "RETURNED", reopened: { text: "Q3 repeats Mid 1", byUid: "u-exam" } });
    expect(bank().approvalHistory.at(-1)).toMatchObject({ action: "REOPENED", remarks: "Q3 repeats Mid 1" });
    expect((await access("u-fac", "PANEL_MEMBER"))!.canWrite).toBe(true);   // the deadline has passed - still editable
    expect((await access("u-col", "PANEL_MEMBER"))!.canWrite).toBe(false);  // only the owner
    expect((await suggest({ text: "again", reopen: true })).status).toBe(409);   // not approved any more
  });
  it("a plain comment doesn't reopen; only the Exam Cell reopens; never a printed paper", async () => {
    expect((await suggest({ text: "Looks fine" })).status).toBe(201);
    expect(bank().approval).toBe("APPROVED");
    Object.assign(who, { uid: "u-col", role: "PANEL_MEMBER" });
    expect((await suggest({ text: "x", reopen: true })).status).toBe(403);
    Object.assign(who, { uid: "u-exam", role: "EXAM_CELL" });
    fake.seed("colleges/c1/midPaperChoices/ch1", { bankId: BANK, final: { setNo: 1 } });
    const printed = await suggest({ text: "x", reopen: true });
    expect(printed.status).toBe(409);
    expect(printed.json.error).toMatch(/already printed/);
    expect(bank().approval).toBe("APPROVED");
  });
});
