import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";

// The section-edit page asks "which subjects are assigned to THIS section". For a managed branch's
// shared first year (BS-ENGLISH running CE's year 1) the subjects are filed under the managing
// department, so asking by the branch's own department found nothing.

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("@/test-support/fakeFirestore").asFirestore>,
  session: { collegeId: "c1", uid: "u1", role: "PRINCIPAL" } as { collegeId: string; uid: string; role: string },
  hodScope: { ownDepartmentNames: ["BS-ENGLISH"], childDepartmentNames: [] as string[], managedDepartmentNames: ["CE"] } as unknown,
}));
vi.mock("@/lib/auth/verifySession", () => ({ requireCollegeMember: async () => h.session }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));
vi.mock("@/lib/departments/scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/departments/scope")>()),
  getHodDepartmentScope: async () => h.hodScope,
}));

import { GET } from "./route";

const C = "colleges/c1";
function seed() {
  const f = new FakeFirestore();
  f.seed(`${C}/departments/bs`, { name: "BASIC SCIENCE", hasSubDepartments: true, assignedYears: [1] });
  f.seed(`${C}/departments/bse`, { name: "BS-ENGLISH", parentDepartmentId: "bs", managedDepartments: ["CE"] });
  f.seed(`${C}/departments/ce`, { name: "CE", assignedYears: [2, 3, 4] });
  f.seed(`${C}/departments/mech`, { name: "MECH", assignedYears: [1, 2, 3, 4] });
  f.seed(`${C}/courses/c-bs`, { departmentId: "bs", catalogId: "btech", name: "B.Tech" });
  f.seed(`${C}/courses/c-ce`, { departmentId: "ce", catalogId: "btech", name: "B.Tech" });
  f.seed(`${C}/courses/c-mech`, { departmentId: "mech", catalogId: "btech", name: "B.Tech" });
  f.seed(`${C}/sections/sec1`, { name: "BSE-CE-A", department: "CE", courseId: "c-ce", year: 1 });
  f.seed(`${C}/sections/sec3`, { name: "CE-A", department: "CE", courseId: "c-ce", year: 3 });
  // The shared year's timing lives on the manager's programme; semester 1 is running, 2 is far off.
  f.seed(`${C}/courseYearTimings/c-bs_year1`, {
    courseId: "c-bs", year: 1,
    semesters: [
      { semester: 1, startDate: new Date("2000-01-01"), endDate: new Date("2999-12-31") },
      { semester: 2, startDate: new Date("3000-01-01"), endDate: new Date("3000-12-31") },
    ],
  });
  const a = (id: string, o: Record<string, unknown>) => f.seed(`${C}/subjectSemesterAssignments/${id}`, { year: 1, semester: 1, courseId: "c-bs", departmentId: "bse", ...o });
  a("a1", { subjectId: "eng1" });
  a("a2", { subjectId: "eng2", semester: 2 });
  a("a3", { subjectId: "ce-y3", courseId: "c-ce", departmentId: "ce", year: 3 });
  a("a4", { subjectId: "mech1", courseId: "c-mech", departmentId: "mech" });
  a("a5", { subjectId: "phy1" });
  return asFirestore(f);
}
const get = (qs: string) => GET(new Request(`http://app.test/api/college/subject-semester-assignments${qs}`));
const subjectsOf = async (res: Response) => ((await res.json()).assignments as { subjectId: string }[]).map((x) => x.subjectId).sort();

beforeEach(() => {
  h.db = seed();
  h.session = { collegeId: "c1", uid: "u1", role: "PRINCIPAL" };
  h.hodScope = { ownDepartmentNames: ["BS-ENGLISH"], childDepartmentNames: [], managedDepartmentNames: ["CE"] };
});

describe("GET ?forSectionId - a managed branch's shared year", () => {
  it("finds the subjects assigned to the managing department, for the semester that is running", async () => {
    const res = await get("?forSectionId=sec1&currentSemesterOnly=1");
    expect(res.status).toBe(200);
    expect(await subjectsOf(res)).toEqual(["eng1", "phy1"]); // semester 1 only; eng2 is semester 2
  });

  it("reports the current semester it resolved", async () => {
    expect((await (await get("?forSectionId=sec1&currentSemesterOnly=1")).json()).semester).toBe(1);
  });

  it("without currentSemesterOnly it returns every semester of the year", async () => {
    expect(await subjectsOf(await get("?forSectionId=sec1"))).toEqual(["eng1", "eng2", "phy1"]);
  });

  it("never mixes in another department's or another year's assignments", async () => {
    const ids = await subjectsOf(await get("?forSectionId=sec1"));
    expect(ids).not.toContain("mech1");
    expect(ids).not.toContain("ce-y3");
  });

  it("the branch's own later year does not borrow the manager's subjects", async () => {
    expect(await subjectsOf(await get("?forSectionId=sec3"))).toEqual(["ce-y3"]);
  });

  it("404 for an unknown section", async () => {
    expect((await get("?forSectionId=nope")).status).toBe(404);
  });
});

describe("GET ?forSectionId - who may ask", () => {
  it("the managing HOD can read it", async () => {
    h.session = { collegeId: "c1", uid: "u2", role: "HOD" };
    expect((await get("?forSectionId=sec1&currentSemesterOnly=1")).status).toBe(200);
  });

  it("an HOD of an unrelated department is refused", async () => {
    h.session = { collegeId: "c1", uid: "u3", role: "HOD" };
    h.hodScope = { ownDepartmentNames: ["MECH"], childDepartmentNames: [], managedDepartmentNames: [] };
    expect((await get("?forSectionId=sec1")).status).toBe(403);
  });
});

describe("existing call shapes are unchanged", () => {
  it("still needs courseId or subjectId (or forSectionId)", async () => {
    expect((await get("")).status).toBe(400);
  });

  it("courseId + departmentId + year still returns that department's rows for every semester", async () => {
    expect(await subjectsOf(await get("?courseId=c-bs&departmentId=bse&year=1"))).toEqual(["eng1", "eng2", "phy1"]);
  });

  it("the old lookup by the branch's own department still finds nothing - the gap forSectionId closes", async () => {
    expect(await subjectsOf(await get("?courseId=c-ce&departmentId=ce&year=1"))).toEqual([]);
  });
});
