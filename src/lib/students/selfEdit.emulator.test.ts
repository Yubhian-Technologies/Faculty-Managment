import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// A student editing THEIR OWN record, through the REAL routes on a real Firestore (the local emulator): what they can
// and cannot change, that the record / login / claims never disagree afterwards, and that the Office's own edits keep
// working alongside. Skipped unless the emulator is running:
//   firebase emulators:exec --config <cfg> --only firestore --project demo-se "npx vitest run src/lib/students/selfEdit.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const who = { uid: "stu1", role: "STUDENT" as string };

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-se" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => ({ getUser: async () => null, updateUser: async () => ({}) }) };
});
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async (...roles: string[]) => {
    if (roles.length && !roles.includes(who.role)) throw new Error("UNAUTHORIZED");
    return { uid: who.uid, email: "x@y.z", role: who.role, realRole: who.role, roles: [who.role], collegeId: "c1" };
  },
  isDepartmentOffice: () => false,
}));

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- loose JSON of a route response in a test
const C = "c1";
const photo = (uid: string, n = 1) => `https://firebasestorage.googleapis.com/v0/b/b/o/${encodeURIComponent(`profile-photos/${uid}_${n}.jpg`)}?alt=media&token=t`;

describe.skipIf(!EMULATOR)("student self-service edit (real Firestore)", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-se" }));
  const col = (n: string) => db().collection("colleges").doc(C).collection(n);
  const stu = async (id = "s1") => (await col("students").doc(id).get()).data() as Record<string, unknown>;
  const login = async (uid = "stu1") => (await col("users").doc(uid).get()).data() as Record<string, unknown>;
  const sys = async (uid = "stu1") => (await db().collection("systemUsers").doc(uid).get()).data() as Record<string, unknown> | undefined;
  const claim = async (n: string) => (await db().collection("studentMobileKeys").doc(n).get()).data() as { studentId: string } | undefined;

  const getProfile = async () => {
    const { GET } = await import("@/app/api/college/student/me/profile/route");
    const res = await GET();
    return { status: res.status, json: (await res.json()) as Json };
  };
  const patch = async (details: unknown) => {
    const { PATCH } = await import("@/app/api/college/student/me/profile/route");
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ details }) }));
    return { status: res.status, json: (await res.json()) as Json };
  };
  const patchPhoto = async (photoUrl: unknown) => {
    const { PATCH } = await import("@/app/api/college/student/me/photo/route");
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ photoUrl }) }));
    return { status: res.status, json: (await res.json()) as Json };
  };
  const officeEdit = async (id: string, body: Record<string, unknown>) => {
    const prev = { ...who };
    who.uid = "office1"; who.role = "COLLEGE_OFFICE";
    const { PATCH } = await import("@/app/api/college/students/[id]/route");
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    who.uid = prev.uid; who.role = prev.role;
    return { status: res.status, json: (await res.json()) as Json };
  };

  beforeEach(async () => {
    for (const n of ["students", "users", "auditLogs", "departments", "courses", "sections", "studentDepartmentHistory"]) for (const d of (await col(n).get()).docs) await d.ref.delete();
    for (const n of ["studentMobileKeys", "studentUsernames", "systemUsers"]) for (const d of (await db().collection(n).get()).docs) await d.ref.delete();
    who.uid = "stu1"; who.role = "STUDENT";
    vi.spyOn(console, "error").mockImplementation(() => {});
    await col("departments").doc("d1").set({ collegeId: C, name: "CSE", code: "CSE", isActive: true });
    await col("students").doc("s1").set({
      collegeId: C, uid: "stu1", name: "ASHA KUMARI", rollNumber: "24A001", rollNumberUpper: "24A001", mobileNo: "9876500001", department: "CSE", section: "", year: 2,
      status: "REGULAR", course: "Bachelor of Technology", fatherName: "RAMU", email: "asha@x.test", aadharNo: "123412341234", caste: "OC", remarks: "staff note", loginEmail: "24a001@students.test",
    });
    await col("students").doc("s2").set({ collegeId: C, uid: "stu2", name: "OTHER", rollNumber: "24A002", mobileNo: "9876500002", department: "CSE", section: "", year: 2, status: "REGULAR", fatherName: "OTHER DAD" });
    await col("students").doc("s3").set({ collegeId: C, uid: "stu3", name: "NO ROLL", rollNumber: "", mobileNo: "9876500003", department: "CSE", section: "", year: 2, status: "REGULAR" });
    await col("users").doc("stu1").set({ uid: "stu1", collegeId: C, name: "ASHA KUMARI", role: "STUDENT", email: "24a001@students.test", isActive: true });
    await db().collection("systemUsers").doc("stu1").set({ uid: "stu1", collegeId: C, role: "STUDENT", name: "ASHA KUMARI" });
    await col("users").doc("stu3").set({ uid: "stu3", collegeId: C, name: "NO ROLL", role: "STUDENT", isActive: true });
    await db().collection("studentMobileKeys").doc("9876500001").set({ studentId: "s1", collegeId: C, reservedAt: new Date() });
    await db().collection("studentMobileKeys").doc("9876500002").set({ studentId: "s2", collegeId: C, reservedAt: new Date() });
  });

  describe("reading", () => {
    it("returns the student's own record plus ONLY the editable values (no office-managed field leaks)", async () => {
      const r = await getProfile();
      expect(r.status).toBe(200);
      expect(r.json.editable.values).toMatchObject({ fatherName: "RAMU", email: "asha@x.test", mobileNo: "9876500001" });
      expect(r.json.editable.mobileEditable).toBe(true);
      for (const k of ["aadharNo", "caste", "remarks", "rollNumber", "name"]) expect(r.json.editable.values).not.toHaveProperty(k);
      expect(JSON.stringify(r.json)).not.toContain("staff note");
    });
    it("a student with no roll yet sees the mobile locked, with the reason", async () => {
      who.uid = "stu3";
      const r = await getProfile();
      expect(r.json.editable.mobileEditable).toBe(false);
      expect(r.json.editable.mobileLockedReason).toMatch(/Roll No/);
    });
  });

  describe("editing", () => {
    it("saves contact / family / address / bank details to the student's OWN record and nothing else moves", async () => {
      const before = await stu();
      const r = await patch({ email: "New@X.test", motherName: "SITA", fatherContactNo: "+91 98765 43210", temporaryAddress: "1-2-3 Main Rd", bankAccountNo: "123456789012", ifscCode: "sbin0001234", bankName: "SBI", district: "Guntur" });
      expect(r.status).toBe(200);
      expect(r.json.changed.sort()).toEqual(["bankAccountNo", "bankName", "district", "email", "fatherContactNo", "ifscCode", "motherName", "temporaryAddress"]);
      const after = await stu();
      expect(after).toMatchObject({ email: "new@x.test", motherName: "SITA", fatherContactNo: "9876543210", temporaryAddress: "1-2-3 Main Rd", ifscCode: "SBIN0001234", bankName: "SBI", district: "Guntur" });
      for (const k of ["name", "rollNumber", "rollNumberUpper", "department", "year", "status", "course", "aadharNo", "caste", "remarks", "uid", "loginEmail", "mobileNo", "fatherName"]) expect(after[k], k).toEqual(before[k]);
      expect((await stu("s2")).fatherName).toBe("OTHER DAD");
    });
    it("is refused for every office-managed field (403) and writes NOTHING, even alongside an allowed one", async () => {
      const before = await stu();
      for (const body of [{ rollNumber: "HACK1" }, { name: "NEW NAME" }, { department: "ECE" }, { year: 4 }, { aadharNo: "999999999999" }, { caste: "SC" }, { remarks: "x" }, { fatherName: "NEW", status: "GRADUATED" }]) {
        const r = await patch(body);
        expect(r.status, JSON.stringify(body)).toBe(403);
        expect(r.json.code).toBe("FIELD_NOT_EDITABLE");
      }
      expect(await stu()).toEqual(before);
      expect((await col("students").get()).size).toBe(3);
    });
    it("only ever touches the caller's own record - there is no id to pass", async () => {
      await patch({ fatherName: "CHANGED" });
      expect((await stu("s1")).fatherName).toBe("CHANGED");
      expect((await stu("s2")).fatherName).toBe("OTHER DAD");
      expect((await stu("s3")).fatherName).toBeUndefined();
    });
    it("a stale form cannot overwrite what the Office changed meanwhile (unchanged values are never sent/written)", async () => {
      // the student's page loaded earlier; the Office then fixes the father's name and the student only changes the email
      expect((await officeEdit("s1", { details: { fatherName: "RAMU RAO" } })).status).toBe(200);
      expect((await patch({ email: "later@x.test" })).status).toBe(200);
      expect(await stu()).toMatchObject({ fatherName: "RAMU RAO", email: "later@x.test" });
    });
    it("rejects bad values with 400 and changes nothing", async () => {
      const before = await stu();
      for (const body of [{ email: "nope" }, { fatherContactNo: "12345" }, { ifscCode: "X" }, { bankAccountNo: "1" }, { distanceFromResidenceKm: "-1" }]) {
        expect((await patch(body)).status, JSON.stringify(body)).toBe(400);
      }
      expect(await stu()).toEqual(before);
    });
    it("a cleared field is stored as null and 'No' clears its dependent details", async () => {
      await col("students").doc("s1").update({ physicallyHandicapped: true, handicappedType: "V", guardianName: "UNCLE" });
      expect((await patch({ guardianName: "", physicallyHandicapped: "No" })).status).toBe(200);
      expect(await stu()).toMatchObject({ guardianName: null, physicallyHandicapped: false, handicappedType: null });
    });
    it("'same as temporary' keeps the permanent address identical", async () => {
      await patch({ temporaryAddress: "Home 1", permanentAddressSameAsTemporary: "Yes" });
      expect(await stu()).toMatchObject({ temporaryAddress: "Home 1", permanentAddress: "Home 1", permanentAddressSameAsTemporary: true });
      await patch({ temporaryAddress: "Home 2" });
      expect((await stu()).permanentAddress).toBe("Home 2");
    });
    it("a no-op save writes nothing (updatedAt untouched) and logs nothing", async () => {
      const before = await stu();
      const r = await patch({ fatherName: "RAMU" });
      expect(r.status).toBe(200);
      expect(r.json.changed).toEqual([]);
      expect((await stu()).updatedAt).toEqual(before.updatedAt);
      expect((await col("auditLogs").get()).size).toBe(0);
    });
    it("records an audit entry naming the fields (never the values)", async () => {
      await patch({ fatherName: "NEW DAD" });
      const logs = (await col("auditLogs").get()).docs.map((d) => d.data());
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ action: "STUDENT_DETAILS_UPDATED", performedBy: "stu1", targetId: "s1" });
      expect((logs[0].details as { fields: string[]; self: boolean })).toMatchObject({ self: true, fields: ["fatherName"] });
      expect(JSON.stringify(logs[0])).not.toContain("NEW DAD");
    });
    it("only a STUDENT login can use it, and one with no student record gets 404", async () => {
      who.role = "COLLEGE_OFFICE";
      expect((await patch({ fatherName: "X" })).status).toBe(401);
      who.role = "STUDENT"; who.uid = "nobody";
      expect((await patch({ fatherName: "X" })).status).toBe(404);
    });
    it("a student who must still change their one-time password is refused", async () => {
      await col("students").doc("s1").update({ mustChangePassword: true });
      expect((await patch({ fatherName: "X" })).status).toBe(403);
      expect((await stu()).fatherName).toBe("RAMU");
    });
  });

  describe("Student Mobile No", () => {
    it("can be changed once a Roll No exists: stored as 10 digits, claimed, the old number freed", async () => {
      const r = await patch({ mobileNo: "+91 90000-00009" });
      expect(r.status).toBe(200);
      expect((await stu()).mobileNo).toBe("9000000009");
      expect((await claim("9000000009"))?.studentId).toBe("s1");
      // the old number is free for another student again (its claim is stale: the owner no longer holds it)
      who.uid = "stu2";
      expect((await patch({ mobileNo: "9876500001" })).status).toBe(200);
      expect((await claim("9876500001"))?.studentId).toBe("s2");
    });
    it("refuses a number another student has (409) - in this or ANOTHER college - and keeps the old one", async () => {
      expect((await patch({ mobileNo: "9876500002" })).status).toBe(409);
      expect((await stu()).mobileNo).toBe("9876500001");
      const other = await db().collection("colleges").doc("c2").collection("students").add({ collegeId: "c2", name: "FAR AWAY", rollNumber: "", mobileNo: "9111111111", department: "X", section: "", year: 1 });
      await db().collection("studentMobileKeys").doc("9111111111").set({ studentId: other.id, collegeId: "c2", reservedAt: new Date() });
      const r = await patch({ mobileNo: "9111111111" });
      expect(r.status).toBe(409);
      expect(r.json.error).toBe("Student Mobile No 9111111111 is already used by a student of another college");
      expect((await stu()).mobileNo).toBe("9876500001");
    });
    it("is locked while the student has no Roll No (403), and can never be cleared (400)", async () => {
      who.uid = "stu3";
      const locked = await patch({ mobileNo: "9000000008" });
      expect(locked.status).toBe(403);
      expect(locked.json.code).toBe("MOBILE_LOCKED");
      expect((await stu("s3")).mobileNo).toBe("9876500003");
      who.uid = "stu1";
      expect((await patch({ mobileNo: "" })).status).toBe(400);
      expect((await stu()).mobileNo).toBe("9876500001");
    });
    it("a failed claim writes nothing else from the same save", async () => {
      expect((await patch({ mobileNo: "9876500002", fatherName: "SHOULD NOT SAVE" })).status).toBe(409);
      expect((await stu()).fatherName).toBe("RAMU");
    });
  });

  describe("photo", () => {
    it("updates the student record, the login and systemUsers together", async () => {
      const r = await patchPhoto(photo("stu1"));
      expect(r.status).toBe(200);
      expect((await stu()).profilePhotoUrl).toBe(photo("stu1"));
      expect((await login()).profilePhotoUrl).toBe(photo("stu1"));
      expect((await sys())?.profilePhotoUrl).toBe(photo("stu1"));
      expect((await patchPhoto("")).status).toBe(200);
      expect((await stu()).profilePhotoUrl).toBeNull();
      expect((await login()).profilePhotoUrl).toBe("");
      expect((await sys())?.profilePhotoUrl).toBe("");
    });
    it("only accepts the student's own upload (400 foreign host, 403 someone else's path); nothing is written", async () => {
      expect((await patchPhoto("https://evil.example.com/x.jpg")).status).toBe(400);
      expect((await patchPhoto(photo("stu2"))).status).toBe(403);
      expect((await patchPhoto(undefined)).status).toBe(400);
      expect((await stu()).profilePhotoUrl).toBeUndefined();
      expect((await login()).profilePhotoUrl).toBeUndefined();
    });
    it("a photo the Office sets is mirrored to the student's login too (no stale avatar)", async () => {
      const r = await officeEdit("s1", { profilePhotoUrl: photo("s1", 2) });
      expect(r.status).toBe(200);
      expect((await stu()).profilePhotoUrl).toBe(photo("s1", 2));
      expect((await login()).profilePhotoUrl).toBe(photo("s1", 2));
      expect((await sys())?.profilePhotoUrl).toBe(photo("s1", 2));
      expect((await officeEdit("s1", { profilePhotoUrl: "" })).status).toBe(200);
      expect((await login()).profilePhotoUrl).toBe("");
    });
    it("an Office photo for a student with no login still works", async () => {
      await col("students").doc("s2").update({ uid: null });
      expect((await officeEdit("s2", { profilePhotoUrl: photo("s2") })).status).toBe(200);
      expect((await stu("s2")).profilePhotoUrl).toBe(photo("s2"));
    });
  });

  describe("everything stays consistent", () => {
    it("the Office sees the student's edit, and the Office can still correct locked data", async () => {
      await patch({ fatherName: "BY STUDENT" });
      expect((await officeEdit("s1", { details: { fatherName: "BY OFFICE", caste: "BC-A" } })).status).toBe(200);
      expect(await stu()).toMatchObject({ fatherName: "BY OFFICE", caste: "BC-A" });
      expect((await getProfile()).json.editable.values.fatherName).toBe("BY OFFICE");
    });
    it("a mobile the student changed is the one the Office's duplicate check now sees (and frees the old)", async () => {
      await patch({ mobileNo: "9000000009" });
      const r = await officeEdit("s2", { details: { mobileNo: "9000000009" } });
      expect(r.status).toBe(409);
      expect((await officeEdit("s2", { details: { mobileNo: "9876500001" } })).status).toBe(200);
    });
  });
});
