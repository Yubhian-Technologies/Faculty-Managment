import { beforeAll, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Real-database check for the Academic Details additions (collegeType / universityType / universityTypeOther /
// additionalInformation on a degree entry): drives the REAL PATCH/GET /api/college/faculty/[id] handlers against a REAL
// Firestore (the local emulator - nothing here can reach a live project). Skipped unless the emulator is running:
//
//   firebase emulators:exec --only firestore --project demo-insttype "npx vitest run src/lib/faculty/institutionType.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-insttype" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => { throw new Error("auth not available in this test"); } };
});
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async () => ({ uid: "principal-1", email: "p@x.test", role: "PRINCIPAL", collegeId: "c1" }),
}));

type Profile = Record<string, Record<string, unknown> & Record<string, unknown>[]>;

describe.skipIf(!EMULATOR)("institution type + additional information in a real Firestore, through the real faculty routes", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-insttype" }));
  const facRef = (id: string) => db().collection("colleges").doc("c1").collection("facultyMembers").doc(id);
  const call = async (id: string, body: unknown) => {
    const { PATCH } = await import("@/app/api/college/faculty/[id]/route");
    const res = await PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    return { status: res.status, json: await res.json() };
  };
  const raw = async (id: string) => (await facRef(id).get()).data() as { academicProfile?: Profile } & Record<string, unknown>;

  // Shapes copied from live VIT/VWU records (names and ids changed): UG/PG with the old institutionType, Ph.D. without any.
  const OLD_PROFILE = {
    ugDetails: { domain: "ENGINEERING", course: "B.Tech/BE", degreeType: "B.Tech", branch: "CSE", institutionType: "INSTITUTE", institutionName: "SCRK", affiliatedUniversity: "JNTUK", place: "Chilakaluripet", percentageCgpa: "80", yearOfPassing: 2010, hallTicketNumber: "H1", certificateUrl: "" },
    pgDetails: { domain: "ENGINEERING", course: "M.Tech/ME", degreeType: "M.Tech", branch: "EEE", institutionType: "UNIVERSITY", institutionName: "NIT Warangal", place: "Warangal", percentageCgpa: "8.1", yearOfPassing: 2015, hallTicketNumber: "H2" },
    phdDetails: { institutionName: "IIT Madras", departmentName: "Department of CSE", place: "Chennai", specialization: "ML", status: "AWARDED", yearOfAward: 2012 },
    postdoctoralFellowshipDetails: { institutionName: "IISc", departmentName: "Physics", status: "PURSUING" },
    additionalPgDetails: [{ course: "MBA", branch: "HR", institutionType: "INSTITUTE", institutionName: "XYZ", percentageCgpa: "70" }],
  };

  beforeAll(async () => {
    await facRef("old").set({ employeeId: "EMP-OLD", legalName: "Dr Old", department: "CSE", designation: "PROFESSOR", academicProfile: OLD_PROFILE });
    await facRef("other").set({ employeeId: "EMP-OTHER", legalName: "Dr Other", department: "CSE", designation: "PROFESSOR", academicProfile: { ugDetails: { course: "BBA", institutionName: "Z" } } });
  });

  it("an old record loads through the GET route exactly as stored", async () => {
    const { GET } = await import("@/app/api/college/faculty/[id]/route");
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "old" }) });
    const { faculty } = await res.json() as { faculty: { academicProfile: Profile } };
    expect(faculty.academicProfile.ugDetails).toMatchObject(OLD_PROFILE.ugDetails);
    expect(faculty.academicProfile.phdDetails).toMatchObject(OLD_PROFILE.phdDetails);
    expect(faculty.academicProfile.ugDetails).not.toHaveProperty("collegeType");
  });

  it("adding the new fields to UG saves them next to the old values and leaves every other section byte-identical", async () => {
    const before = await raw("old");
    const ug = { ...OLD_PROFILE.ugDetails, collegeType: "AUTONOMOUS", additionalInformation: "Lateral entry" };
    expect((await call("old", { academicProfileChanges: { set: { ugDetails: ug }, remove: [] } })).status).toBe(200);
    const after = await raw("old");
    expect(after.academicProfile!.ugDetails).toEqual(ug);
    for (const k of ["pgDetails", "phdDetails", "postdoctoralFellowshipDetails", "additionalPgDetails"]) {
      expect(after.academicProfile![k]).toEqual(before.academicProfile![k]);
    }
    // Every save through this route re-derives updatedAt and totalYearsOfExperience (existing behaviour, not this feature);
    // all other top-level fields must be unchanged.
    const strip = (d: Record<string, unknown>) => Object.fromEntries(Object.entries(d).filter(([k]) => !["academicProfile", "updatedAt", "totalYearsOfExperience"].includes(k)));
    expect(strip(after)).toEqual(strip(before));
  });

  it("University Type (including typed Others), Ph.D. and Postdoc entries, and an additional PG entry all save", async () => {
    const cur = (await raw("old")).academicProfile!;
    const set = {
      pgDetails: { ...cur.pgDetails, universityType: "OTHERS", universityTypeOther: "Central University", additionalInformation: "Gold medal" },
      phdDetails: { ...cur.phdDetails, institutionType: "UNIVERSITY", universityType: "IIT", additionalInformation: "Part-time" },
      postdoctoralFellowshipDetails: { ...cur.postdoctoralFellowshipDetails, institutionType: "INSTITUTE", collegeType: "NON_AUTONOMOUS" },
      additionalPgDetails: [{ ...(cur.additionalPgDetails as Record<string, unknown>[])[0], collegeType: "AUTONOMOUS" }],
    };
    expect((await call("old", { academicProfileChanges: { set, remove: [] } })).status).toBe(200);
    const after = (await raw("old")).academicProfile!;
    expect(after.pgDetails).toMatchObject({ universityType: "OTHERS", universityTypeOther: "Central University", additionalInformation: "Gold medal", institutionName: "NIT Warangal", hallTicketNumber: "H2" });
    expect(after.phdDetails).toMatchObject({ institutionType: "UNIVERSITY", universityType: "IIT", additionalInformation: "Part-time", institutionName: "IIT Madras", yearOfAward: 2012 });
    expect(after.postdoctoralFellowshipDetails).toMatchObject({ institutionType: "INSTITUTE", collegeType: "NON_AUTONOMOUS", institutionName: "IISc" });
    expect((after.additionalPgDetails as Record<string, unknown>[])[0]).toMatchObject({ collegeType: "AUTONOMOUS", institutionName: "XYZ", percentageCgpa: "70" });
  });

  it("editing and clearing the optional fields works, and an optional field left blank still saves", async () => {
    const cur = (await raw("old")).academicProfile!;
    expect((await call("old", { academicProfileChanges: { set: { ugDetails: { ...cur.ugDetails, additionalInformation: "Edited" } }, remove: [] } })).status).toBe(200);
    expect((await raw("old")).academicProfile!.ugDetails.additionalInformation).toBe("Edited");
    expect((await call("old", { academicProfileChanges: { set: { ugDetails: { ...cur.ugDetails, additionalInformation: "" } }, remove: [] } })).status).toBe(200);
    expect((await raw("old")).academicProfile!.ugDetails).toMatchObject({ additionalInformation: "", collegeType: "AUTONOMOUS", institutionName: "SCRK" });
  });

  it("switching the type back and forth (which only changes the label) never alters the saved institution name", async () => {
    const cur = (await raw("old")).academicProfile!;
    const names = (p: Profile) => ["ugDetails", "pgDetails", "phdDetails", "postdoctoralFellowshipDetails"].map((k) => p[k].institutionName);
    const before = names(cur);
    const flip = (d: Record<string, unknown>, t: string) => ({ ...d, institutionType: t });
    expect((await call("old", { academicProfileChanges: { set: { ugDetails: flip(cur.ugDetails, "UNIVERSITY"), pgDetails: flip(cur.pgDetails, "INSTITUTE"), phdDetails: flip(cur.phdDetails, "UNIVERSITY"), postdoctoralFellowshipDetails: flip(cur.postdoctoralFellowshipDetails, "UNIVERSITY") }, remove: [] } })).status).toBe(200);
    expect(names((await raw("old")).academicProfile!)).toEqual(before);
    expect((await raw("old")).academicProfile!.ugDetails).toMatchObject({ institutionType: "UNIVERSITY", affiliatedUniversity: "JNTUK" });
  });

  it("whole-profile save (older client) also keeps the new keys", async () => {
    const r = await call("other", { academicProfile: { ugDetails: { course: "BBA", institutionName: "Z", institutionType: "UNIVERSITY", universityType: "STATE", additionalInformation: "x" } } });
    expect(r.status).toBe(200);
    expect((await raw("other")).academicProfile!.ugDetails).toMatchObject({ universityType: "STATE", additionalInformation: "x", institutionName: "Z" });
  });
});
