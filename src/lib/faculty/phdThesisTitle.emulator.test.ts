import { beforeAll, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Real-database check for "Title of the Ph.D Thesis" (academicProfile.phdDetails.thesisTitle):
// drives the REAL PATCH/GET /api/college/faculty/[id] handlers against a REAL Firestore
// (the local emulator - nothing here can reach a live project) and reads the raw
// documents back. Skipped unless the emulator is running, so plain `npm test` ignores it:
//
//   firebase emulators:exec --only firestore --project demo-thesis "npx vitest run src/lib/faculty/phdThesisTitle.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-thesis" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => { throw new Error("auth not available in this test"); } };
});
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async () => ({ uid: "principal-1", email: "p@x.test", role: "PRINCIPAL", collegeId: "c1" }),
}));

const THESIS = "Deep Learning for Medical Image Segmentation";
const THESIS_2 = "Quantum Error Correction in Noisy Devices";

describe.skipIf(!EMULATOR)("thesisTitle in a real Firestore, through the real faculty routes", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-thesis" }));
  const facRef = (id: string) => db().collection("colleges").doc("c1").collection("facultyMembers").doc(id);
  const call = async (id: string, body: unknown) => {
    const { PATCH } = await import("@/app/api/college/faculty/[id]/route");
    const res = await PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    return { status: res.status, json: await res.json() };
  };
  const read = async (id: string) => (await facRef(id).get()).data() as { academicProfile?: Record<string, Record<string, unknown> & unknown[]> } | undefined;

  beforeAll(async () => {
    // An OLD-shaped faculty: Ph.D. saved before the field existed, plus an unrelated UG that must not move.
    await facRef("old").set({
      employeeId: "EMP-OLD", legalName: "Dr Old", department: "CSE", designation: "PROFESSOR",
      academicProfile: {
        ugDetails: { course: "B.Tech/BE", branch: "CSE", institutionName: "JNTU", place: "Kakinada", percentageCgpa: "80", yearOfPassing: 2001 },
        phdDetails: { institutionName: "IIT Madras", departmentName: "Department of CSE", place: "Chennai", specialization: "ML", status: "AWARDED", yearOfAward: 2012 },
      },
    });
    await facRef("whole").set({ employeeId: "EMP-WHOLE", legalName: "Dr Whole", department: "CSE", designation: "PROFESSOR", academicProfile: {} });
  });

  it("section save (academicProfileChanges) stores thesisTitle on the Ph.D. entry, keeps the neighbours, and leaves other sections untouched", async () => {
    const before = await read("old");
    const r = await call("old", {
      academicProfileChanges: { set: { phdDetails: { ...before!.academicProfile!.phdDetails, thesisTitle: THESIS } }, remove: [] },
    });
    expect(r.status).toBe(200);
    const after = await read("old");
    expect(after!.academicProfile!.phdDetails).toEqual({
      institutionName: "IIT Madras", departmentName: "Department of CSE", thesisTitle: THESIS, place: "Chennai", specialization: "ML", status: "AWARDED", yearOfAward: 2012,
    });
    expect(after!.academicProfile!.ugDetails).toEqual(before!.academicProfile!.ugDetails);
  });

  it("the faculty GET route reads it back with the rest of the entry", async () => {
    const { GET } = await import("@/app/api/college/faculty/[id]/route");
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "old" }) });
    const { faculty } = await res.json() as { faculty: { academicProfile: { phdDetails: Record<string, unknown> } } };
    expect(faculty.academicProfile.phdDetails).toMatchObject({ thesisTitle: THESIS, departmentName: "Department of CSE", place: "Chennai", institutionName: "IIT Madras" });
  });

  it("editing it changes that value only, and clearing it stores an empty string (it can be removed again)", async () => {
    const cur = (await read("old"))!.academicProfile!.phdDetails;
    expect((await call("old", { academicProfileChanges: { set: { phdDetails: { ...cur, thesisTitle: "Edited title" } }, remove: [] } })).status).toBe(200);
    expect((await read("old"))!.academicProfile!.phdDetails.thesisTitle).toBe("Edited title");
    expect((await call("old", { academicProfileChanges: { set: { phdDetails: { ...cur, thesisTitle: "" } }, remove: [] } })).status).toBe(200);
    expect((await read("old"))!.academicProfile!.phdDetails).toMatchObject({ thesisTitle: "", place: "Chennai" });
  });

  it("whole-profile save (academicProfile) stores it on the primary AND every additional Ph.D. entry", async () => {
    const r = await call("whole", {
      academicProfile: {
        phdDetails: { institutionName: "IIT", departmentName: "CSE", thesisTitle: THESIS, place: "Chennai", yearOfAward: 2012 },
        additionalPhdDetails: [{ institutionName: "IISc", departmentName: "Physics", thesisTitle: THESIS_2, place: "Bengaluru", yearOfAward: 2018 }],
      },
    });
    expect(r.status).toBe(200);
    const stored = (await read("whole"))!.academicProfile!;
    expect(stored.phdDetails.thesisTitle).toBe(THESIS);
    expect((stored.additionalPhdDetails[0] as Record<string, unknown>).thesisTitle).toBe(THESIS_2);
  });

  it("the stored document exports the title in the right CSV slot", async () => {
    const csv = { text: "" };
    vi.doMock("@/lib/utils/csv", async (orig) => ({ ...(await orig<typeof import("@/lib/utils/csv")>()), downloadCSV: (t: string) => { csv.text = t; } }));
    vi.resetModules();
    const { exportFacultyCsv } = await import("@/lib/faculty/exportFacultyCsv");
    const stored = (await facRef("whole").get()).data()!;
    exportFacultyCsv([{ id: "whole", ...stored } as never], {}, ["phdDetailsGroup"]);
    expect(csv.text).toContain(`Name of the Department: CSE | Title of the Ph.D Thesis: ${THESIS} | Place: Chennai`);
    expect(csv.text).toContain(`Name of the Department: Physics | Title of the Ph.D Thesis: ${THESIS_2} | Place: Bengaluru`);
  });
});
