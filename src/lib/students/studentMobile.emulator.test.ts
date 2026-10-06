import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Student Mobile No REQUIRED and unique across ALL colleges, Roll No optional (but unique when given), through the REAL
// routes on a real Firestore (the local emulator): the bulk import, adding one student, and editing one. Skipped unless
// the emulator is running:
//   firebase emulators:exec --config <cfg> --only firestore --project demo-sm "npx vitest run src/lib/students/studentMobile.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const who = { uid: "office1", role: "COLLEGE_OFFICE" as string };

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-sm" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => ({ getUser: async () => null, updateUser: async () => ({}), createUser: async () => { throw new Error("no login expected"); } }) };
});
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async (...roles: string[]) => {
    if (roles.length && !roles.includes(who.role)) throw new Error("UNAUTHORIZED");
    return { uid: who.uid, email: "o@x.test", role: who.role, realRole: who.role, roles: [who.role], collegeId: "c1" };
  },
  isDepartmentOffice: () => false,
}));

const C = "c1";
const OTHER = "c2";
const COURSE = "Bachelor of Technology";

describe.skipIf(!EMULATOR)("Student Mobile No required + globally unique, Roll No optional (real Firestore)", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-sm" }));
  const col = (n: string, college = C) => db().collection("colleges").doc(college).collection(n);
  const students = async () => (await col("students").get()).docs.map((d) => ({ id: d.id, ...d.data() })) as (Record<string, unknown> & { id: string })[];
  const byName = async (name: string) => (await students()).find((s) => s.name === name);
  const claims = async () => (await db().collection("studentMobileKeys").get()).docs.map((d) => ({ id: d.id, ...d.data() })) as { id: string; studentId: string; collegeId: string }[];

  async function importRows(records: Record<string, unknown>[]) {
    const { POST } = await import("@/app/api/college/students/import-excel/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ records }) }));
    return { status: res.status, json: (await res.json()) as { created: number; failed: { row: number; rollNumber: string; error: string }[]; loginFailed?: { error: string }[]; loginsCreated?: number } };
  }
  const unassigned = (over: Record<string, unknown>) => ({ department: "CSE", course: COURSE, year: 2, ...over });
  async function addOne(body: Record<string, unknown>) {
    const { POST } = await import("@/app/api/college/students/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ department: "CSE", course: COURSE, year: 2, ...body }) }));
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }
  async function edit(id: string, details: Record<string, unknown>) {
    const { PATCH } = await import("@/app/api/college/students/[id]/route");
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ details }) }), { params: Promise.resolve({ id }) });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }
  /** A student of ANOTHER college, holding `mobile` the way a student written by the new code does (student + claim). */
  async function seedOtherCollegeStudent(name: string, mobile: string, withClaim = true) {
    const ref = await col("students", OTHER).add({ collegeId: OTHER, name, rollNumber: "", mobileNo: mobile, department: "ECE", section: "", year: 2, status: "REGULAR" });
    if (withClaim) await db().collection("studentMobileKeys").doc(mobile).set({ studentId: ref.id, collegeId: OTHER, reservedAt: new Date() });
    return ref.id;
  }

  beforeEach(async () => {
    for (const n of ["students", "departments", "courses", "sections", "auditLogs", "studentDepartmentHistory"]) {
      for (const d of (await col(n).get()).docs) await d.ref.delete();
    }
    for (const d of (await col("students", OTHER).get()).docs) await d.ref.delete();
    for (const d of (await db().collection("studentMobileKeys").get()).docs) await d.ref.delete();
    for (const d of (await db().collection("studentUsernames").get()).docs) await d.ref.delete();
    who.uid = "office1"; who.role = "COLLEGE_OFFICE";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dept = await col("departments").add({ collegeId: C, name: "CSE", code: "CSE", isActive: true, assignedYears: [1, 2, 3, 4] });
    const course = await col("courses").add({ collegeId: C, name: COURSE, code: "BTECH", departmentId: dept.id, durationYears: 4 });
    await col("sections").doc("secA").set({ collegeId: C, name: "A", year: 2, department: "CSE", courseId: course.id, courseName: COURSE, isActive: true });
  });

  describe("bulk import", () => {
    it("imports students with NO roll number (stored as '', no roll claim, no roll key)", async () => {
      const r = await importRows([unassigned({ name: "ASHA", mobileNo: "9876500001" }), unassigned({ name: "BHAVYA", mobileNo: "9876500002" })]);
      expect(r.status).toBe(201);
      expect(r.json.created).toBe(2);
      expect(r.json.failed).toEqual([]);
      const asha = await byName("ASHA");
      expect(asha).toMatchObject({ rollNumber: "", mobileNo: "9876500001", department: "CSE", section: "" });
      expect(asha?.rollNumberUpper).toBeUndefined();
      expect((await db().collection("studentUsernames").get()).size).toBe(0);
    });

    it("a placed row (named section) needs no roll either", async () => {
      const r = await importRows([{ name: "CHARAN", section: "A", department: "CSE", course: COURSE, year: 2, mobileNo: "9876500003" }]);
      expect(r.json.created).toBe(1);
      expect(await byName("CHARAN")).toMatchObject({ rollNumber: "", section: "A", mobileNo: "9876500003" });
    });

    it("REJECTS a row with no Student Mobile No (blank, spaces or missing) - nothing is saved for it", async () => {
      const r = await importRows([unassigned({ name: "NOMOB1" }), unassigned({ name: "NOMOB2", mobileNo: "" }), unassigned({ name: "NOMOB3", mobileNo: "   " }), unassigned({ name: "OKAY", mobileNo: "9876500040" })]);
      expect(r.json.created).toBe(1);
      expect(r.json.failed.map((f) => f.row)).toEqual([2, 3, 4]);
      expect(r.json.failed.every((f) => f.error === "Student Mobile No is required")).toBe(true);
      expect((await students()).map((s) => s.name)).toEqual(["OKAY"]);
    });

    it("stores the 10-digit form however the number was typed, and claims it globally", async () => {
      await importRows([unassigned({ name: "DEEPA", mobileNo: "+91 98765-00004" })]);
      const deepa = await byName("DEEPA");
      expect(deepa?.mobileNo).toBe("9876500004");
      expect((await claims()).map((c) => c.id)).toEqual(["9876500004"]);
      expect((await claims())[0]).toMatchObject({ studentId: deepa?.id, collegeId: C });
    });

    it("rejects a row whose Student Mobile No is already used by an earlier row of the same file", async () => {
      const r = await importRows([unassigned({ name: "EKTA", mobileNo: "9876500005" }), unassigned({ name: "FARHA", mobileNo: "98765 00005" })]);
      expect(r.json.created).toBe(1);
      expect(r.json.failed).toHaveLength(1);
      expect(r.json.failed[0]).toMatchObject({ row: 3 });
      expect(r.json.failed[0].error).toMatch(/already used by another student \(EKTA\)/);
      expect(await byName("FARHA")).toBeUndefined();
    });

    it("rejects a mobile number already held by a saved student of this college (typed another way)", async () => {
      await col("students").add({ collegeId: C, name: "GOWRI", rollNumber: "R1", rollNumberUpper: "R1", mobileNo: "9876500006", department: "CSE", section: "", year: 2, status: "REGULAR" });
      const r = await importRows([unassigned({ name: "HARI", mobileNo: "+919876500006" })]);
      expect(r.json.created).toBe(0);
      expect(r.json.failed[0].error).toMatch(/9876500006 is already used by another student \(GOWRI, Roll No R1\)/);
    });

    it("rejects a mobile number held by a student of ANOTHER college - without naming them - and saves nothing", async () => {
      await seedOtherCollegeStudent("SECRET STUDENT", "9876500050");
      const r = await importRows([unassigned({ name: "ISHA", mobileNo: "+91 98765 00050" }), unassigned({ name: "JAGAN", mobileNo: "9876500051" })]);
      expect(r.json.created).toBe(1);
      expect(r.json.failed).toHaveLength(1);
      expect(r.json.failed[0].error).toBe("Student Mobile No 9876500050 is already used by a student of another college");
      expect(JSON.stringify(r.json)).not.toContain("SECRET");
      expect(await byName("ISHA")).toBeUndefined();
      expect((await claims()).find((c) => c.id === "9876500050")?.collegeId).toBe(OTHER); // their claim is untouched
    });

    it("rejects a malformed number", async () => {
      const r = await importRows([unassigned({ name: "INDU", mobileNo: "12345" }), unassigned({ name: "JYOTHI", mobileNo: "Optional; phone/text" }), unassigned({ name: "KAVYA", mobileNo: "9876500041" })]);
      expect(r.json.created).toBe(1);
      expect(r.json.failed.map((f) => f.row)).toEqual([2, 3]);
      expect(r.json.failed[0].error).toMatch(/10 digits/);
      expect(await byName("KAVYA")).toBeDefined();
    });

    it("importing the same file twice never creates a second copy of a student", async () => {
      const file = [unassigned({ name: "LAKSHMI", mobileNo: "9876500007" }), unassigned({ name: "MEGHA", mobileNo: "9876500008" })];
      expect((await importRows(file)).json.created).toBe(2);
      const again = await importRows(file);
      expect(again.json.created).toBe(0);
      expect(again.json.failed).toHaveLength(2);
      expect((await students()).length).toBe(2);
    });

    it("roll numbers keep working: a row with a roll is imported, a repeated roll is still refused (and its mobile given back)", async () => {
      const r = await importRows([unassigned({ name: "NIKHIL", rollNumber: "24A001", mobileNo: "9876500009" }), unassigned({ name: "OMKAR", rollNumber: "24a001", mobileNo: "9876500010" })]);
      expect(r.json.created).toBe(1);
      expect(r.json.failed[0].error).toMatch(/24a001/i);
      expect(await byName("NIKHIL")).toMatchObject({ rollNumber: "24A001", rollNumberUpper: "24A001" });
      expect(await byName("OMKAR")).toBeUndefined();
      expect((await claims()).map((c) => c.id)).toEqual(["9876500009"]);
    });

    it("a row with a login password but no roll is saved; only its login is reported as not created", async () => {
      const r = await importRows([unassigned({ name: "PRIYA", mobileNo: "9876500011", loginPassword: "Passw0rd!x" })]);
      expect(r.json.created).toBe(1);
      expect(r.json.loginsCreated).toBe(0);
      expect(r.json.loginFailed?.[0].error).toMatch(/Roll Number/i);
      expect(await byName("PRIYA")).toBeDefined();
    });

    it("a number whose student was removed (stale claim) can be used again; so can one whose owner changed number", async () => {
      await importRows([unassigned({ name: "QUEEN", mobileNo: "9876500012" }), unassigned({ name: "RANI", mobileNo: "9876500013" })]);
      const queen = await byName("QUEEN"); const rani = await byName("RANI");
      const old = new Date(Date.now() - 10 * 60 * 1000);
      await col("students").doc(queen!.id).delete();
      await db().collection("studentMobileKeys").doc("9876500012").update({ reservedAt: old });
      await col("students").doc(rani!.id).update({ mobileNo: "9876599999" });
      const r = await importRows([unassigned({ name: "SITA", mobileNo: "9876500012" }), unassigned({ name: "TARA", mobileNo: "9876500013" })]);
      expect(r.json.created).toBe(2);
      expect((await claims()).find((c) => c.id === "9876500012")?.studentId).toBe((await byName("SITA"))?.id);
    });

    it("a number whose student in ANOTHER college was removed can be used here", async () => {
      const id = await seedOtherCollegeStudent("GONE", "9876500052");
      await col("students", OTHER).doc(id).delete();
      await db().collection("studentMobileKeys").doc("9876500052").update({ reservedAt: new Date(Date.now() - 10 * 60 * 1000) });
      expect((await importRows([unassigned({ name: "KIRAN", mobileNo: "9876500052" })])).json.created).toBe(1);
    });

    it("two imports at the same moment cannot both take one number", async () => {
      const [a, b] = await Promise.all([
        importRows([unassigned({ name: "UMA", mobileNo: "9876500014" })]),
        importRows([unassigned({ name: "VANI", mobileNo: "9876500014" })]),
      ]);
      expect(a.json.created + b.json.created).toBe(1);
      expect((await students()).filter((s) => s.mobileNo === "9876500014")).toHaveLength(1);
    });
  });

  describe("adding one student", () => {
    it("works without a roll number and claims the mobile", async () => {
      const r = await addOne({ name: "WAHEEDA", mobileNo: "9876500020" });
      expect(r.status).toBe(201);
      expect(await byName("WAHEEDA")).toMatchObject({ rollNumber: "", mobileNo: "9876500020" });
      expect((await claims()).map((c) => c.id)).toEqual(["9876500020"]);
    });
    it("REQUIRES a Student Mobile No (missing, empty or spaces -> 400, nothing saved)", async () => {
      for (const mobileNo of [undefined, "", "   "]) {
        const r = await addOne({ name: "NOMOBILE", mobileNo });
        expect(r.status).toBe(400);
        expect(r.json.error).toBe("Student Mobile No is required");
      }
      expect(await students()).toHaveLength(0);
      expect(await claims()).toHaveLength(0);
    });
    it("refuses a mobile number another student has (409) and a malformed one (400); nothing is saved", async () => {
      await addOne({ name: "XENA", mobileNo: "9876500021" });
      const dup = await addOne({ name: "YASH", mobileNo: "98765 00021" });
      expect(dup.status).toBe(409);
      expect(String(dup.json.error)).toMatch(/already used by another student \(XENA\)/);
      const bad = await addOne({ name: "ZARA", mobileNo: "123" });
      expect(bad.status).toBe(400);
      expect((await students()).map((s) => s.name)).toEqual(["XENA"]);
    });
    it("refuses a number a student of ANOTHER college has (409), without naming them", async () => {
      await seedOtherCollegeStudent("SECRET TWO", "9876500053");
      const r = await addOne({ name: "LEENA", mobileNo: "+919876500053" });
      expect(r.status).toBe(409);
      expect(r.json.error).toBe("Student Mobile No 9876500053 is already used by a student of another college");
      expect(await students()).toHaveLength(0);
    });
    it("a roll that is already taken is still refused, and the mobile taken for it is given back", async () => {
      await addOne({ name: "AMAN", rollNumber: "24A777", mobileNo: "9876500022" });
      const clash = await addOne({ name: "BINDU", rollNumber: "24a777", mobileNo: "9876500023" });
      expect(clash.status).toBe(409);
      expect((await students()).map((s) => s.name)).toEqual(["AMAN"]);
      expect((await claims()).map((c) => c.id)).toEqual(["9876500022"]);
    });
  });

  describe("editing a student (the later update)", () => {
    it("the Office can add the roll number to a student who has none; the mobile stays", async () => {
      await addOne({ name: "CHITRA", mobileNo: "9876500030" });
      const s = await byName("CHITRA");
      const r = await edit(s!.id, { rollNumber: "24A900" });
      expect(r.status).toBe(200);
      expect(await byName("CHITRA")).toMatchObject({ rollNumber: "24A900", rollNumberUpper: "24A900", mobileNo: "9876500030" });
    });
    it("changing the mobile to a free number works, is stored as 10 digits, and frees the old one", async () => {
      await addOne({ name: "DINESH", mobileNo: "9876500031" });
      const s = await byName("DINESH");
      expect((await edit(s!.id, { mobileNo: "+91 98765 00032" })).status).toBe(200);
      expect((await byName("DINESH"))?.mobileNo).toBe("9876500032");
      expect((await addOne({ name: "ESHA", mobileNo: "9876500031" })).status).toBe(201);
    });
    it("changing it to another student's number is refused (409) and nothing changes", async () => {
      await addOne({ name: "FAROOQ", mobileNo: "9876500033" });
      await addOne({ name: "GAYATRI", mobileNo: "9876500034" });
      const g = await byName("GAYATRI");
      const r = await edit(g!.id, { mobileNo: "9876500033" });
      expect(r.status).toBe(409);
      expect((await byName("GAYATRI"))?.mobileNo).toBe("9876500034");
    });
    it("changing it to a number a student of ANOTHER college has is refused (409)", async () => {
      await seedOtherCollegeStudent("SECRET THREE", "9876500054");
      await addOne({ name: "MALA", mobileNo: "9876500055" });
      const r = await edit((await byName("MALA"))!.id, { mobileNo: "9876500054" });
      expect(r.status).toBe(409);
      expect(r.json.error).toBe("Student Mobile No 9876500054 is already used by a student of another college");
      expect((await byName("MALA"))?.mobileNo).toBe("9876500055");
    });
    it("a malformed new number is refused (400)", async () => {
      await addOne({ name: "HEMA", mobileNo: "9876500035" });
      expect((await edit((await byName("HEMA"))!.id, { mobileNo: "999" })).status).toBe(400);
    });
    it("the mobile can NEVER be cleared (400) - it stays exactly as it was", async () => {
      await addOne({ name: "INDRA", mobileNo: "9876500036" });
      const s = await byName("INDRA");
      const r = await edit(s!.id, { mobileNo: null, fatherName: "Somebody" });
      expect(r.status).toBe(400);
      expect(String(r.json.error)).toMatch(/can't be removed/);
      expect(await byName("INDRA")).toMatchObject({ mobileNo: "9876500036" });
      expect((await byName("INDRA"))?.fatherName).toBeUndefined(); // the whole edit was refused
      expect((await addOne({ name: "JAYA", mobileNo: "9876500036" })).status).toBe(409); // and it is still taken
    });
    it("re-saving the unchanged number never trips - even for old data that already shares one", async () => {
      await col("students").add({ collegeId: C, name: "OLD ONE", rollNumber: "", mobileNo: "9000000001", department: "CSE", section: "", year: 2, status: "REGULAR" });
      await col("students").add({ collegeId: C, name: "OLD TWO", rollNumber: "", mobileNo: "9000000001", department: "CSE", section: "", year: 2, status: "REGULAR" });
      const two = await byName("OLD TWO");
      const r = await edit(two!.id, { mobileNo: "9000000001", fatherName: "Somebody" });
      expect(r.status).toBe(200);
      expect(await byName("OLD TWO")).toMatchObject({ fatherName: "Somebody", mobileNo: "9000000001" });
    });
    it("a legacy student saved with NO mobile can still be edited (and can be given one later)", async () => {
      const ref = await col("students").add({ collegeId: C, name: "LEGACY", rollNumber: "", department: "CSE", section: "", year: 2, status: "REGULAR" });
      expect((await edit(ref.id, { mobileNo: null, fatherName: "Somebody" })).status).toBe(200); // the form re-sends the blank
      expect((await byName("LEGACY"))?.fatherName).toBe("Somebody");
      expect((await edit(ref.id, { mobileNo: "9876500060" })).status).toBe(200);
      expect(await byName("LEGACY")).toMatchObject({ mobileNo: "9876500060" });
      expect((await claims()).map((c) => c.id)).toEqual(["9876500060"]);
    });
  });
});
