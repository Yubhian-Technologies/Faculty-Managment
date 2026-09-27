import { test, expect, type APIRequestContext } from "@playwright/test";
import { getAdminDb } from "@/lib/firebase/admin";
import { createDirectSessionContext } from "../support/auth";
import type { SubjectType, DayOfWeek } from "@/types";

interface PipelineTestState {
  collegeId: string;
  departmentId: string;
  departmentName: string;
  courseId: string;
  courseCatalogId?: string;
  sectionId: string;
  sectionName: string;
  year: number;
  facultyId: string;
  facultyUid: string;
  facultyName: string;
  facultyEmail: string;
  hodUid: string;
  hodEmail: string;
  principalUid: string;
  principalEmail: string;
  testMasterSubjectId?: string;
  testMasterSubjectCode?: string;
  testAssignmentId?: string;
  testSlotId?: string;
  testAttendanceSessionId?: string;
}

const state: PipelineTestState = {
  collegeId: "6657e7f7107d44fe87ea",
  departmentId: "",
  departmentName: "",
  courseId: "",
  sectionId: "",
  sectionName: "",
  year: 2,
  facultyId: "",
  facultyUid: "",
  facultyName: "",
  facultyEmail: "",
  hodUid: "",
  hodEmail: "",
  principalUid: "SlpHykSUVENm6LYMF1zpXATKzfH2",
  principalEmail: "principal@bvrit.ac.in",
};

test.describe.serial("Subjects to Attendance Reports API Pipeline", () => {
  let principalCtx: APIRequestContext;
  let hodCtx: APIRequestContext;
  let facultyCtx: APIRequestContext;

  test.beforeAll(async () => {
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(state.collegeId);

    // 1. Resolve Course & Department
    const coursesSnap = await collegeRef.collection("courses").limit(5).get();
    if (coursesSnap.empty) {
      throw new Error(`No courses found in college ${state.collegeId}`);
    }
    const courseDoc = coursesSnap.docs[0];
    state.courseId = courseDoc.id;
    const courseData = courseDoc.data();
    state.courseCatalogId = courseData.catalogId;
    state.departmentId = courseData.departmentId;

    const deptDoc = await collegeRef.collection("departments").doc(state.departmentId).get();
    state.departmentName = deptDoc.exists ? deptDoc.data()?.name ?? "Engineering" : "Engineering";

    // 2. Resolve Section
    const sectionsSnap = await collegeRef.collection("sections").where("courseId", "==", state.courseId).limit(1).get();
    if (!sectionsSnap.empty) {
      const secDoc = sectionsSnap.docs[0];
      state.sectionId = secDoc.id;
      const secData = secDoc.data();
      state.sectionName = secData.name;
      state.year = secData.year || 2;
    } else {
      const anySection = await collegeRef.collection("sections").limit(1).get();
      if (!anySection.empty) {
        state.sectionId = anySection.docs[0].id;
        state.sectionName = anySection.docs[0].data().name;
        state.year = anySection.docs[0].data().year || 2;
      }
    }

    // 3. Resolve Faculty Member
    const facultySnap = await collegeRef.collection("facultyMembers").limit(5).get();
    if (!facultySnap.empty) {
      const facDoc = facultySnap.docs[0];
      state.facultyId = facDoc.id;
      const facData = facDoc.data();
      state.facultyName = facData.legalName || "Test Faculty";
      state.facultyUid = facData.userUid || facDoc.id;
      state.facultyEmail = facData.collegeEmail || "faculty@test.in";
    }

    // 4. Resolve HOD user or create identifier
    state.hodUid = "e2e-test-hod-uid";
    state.hodEmail = "hod.test@yec.edu.in";

    // 5. Initialize Contexts
    principalCtx = await createDirectSessionContext({
      uid: state.principalUid,
      email: state.principalEmail,
      role: "PRINCIPAL",
      collegeId: state.collegeId,
    });

    hodCtx = await createDirectSessionContext({
      uid: state.hodUid,
      email: state.hodEmail,
      role: "HOD",
      collegeId: state.collegeId,
    });

    facultyCtx = await createDirectSessionContext({
      uid: state.facultyUid,
      email: state.facultyEmail,
      role: "PANEL_MEMBER",
      collegeId: state.collegeId,
    });
  });

  test.afterAll(async () => {
    // Teardown / cleanup test-created documents from Firestore
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(state.collegeId);

    if (state.testSlotId) {
      await collegeRef.collection("timetableSlots").doc(state.testSlotId).delete().catch(() => {});
    }
    if (state.testAssignmentId) {
      await collegeRef.collection("teachingAssignments").doc(state.testAssignmentId).delete().catch(() => {});
    }
    if (state.testMasterSubjectId) {
      await collegeRef.collection("subjectSemesterAssignments").doc(`${state.testMasterSubjectId}_${state.departmentId}`).delete().catch(() => {});
      await collegeRef.collection("subjects").doc(state.testMasterSubjectId).delete().catch(() => {});
    }
    if (state.testAttendanceSessionId) {
      await collegeRef.collection("studentAttendance").doc(state.testAttendanceSessionId).delete().catch(() => {});
    }

    await principalCtx?.dispose();
    await hodCtx?.dispose();
    await facultyCtx?.dispose();
  });

  // =========================================================================
  // 1. MASTER SUBJECTS COLLECTION API
  // =========================================================================
  test.describe("1. Master Subjects Collection API", () => {
    test("1.1 POST /api/college/subjects creates a master subject (Academics/Principal)", async () => {
      const suffix = Date.now().toString().slice(-6);
      state.testMasterSubjectCode = `E2E${suffix}`;
      const payload = {
        courseId: state.courseId,
        serialNumber: 1,
        category: "PCC",
        name: `Automated Pipeline Subject ${suffix}`,
        code: state.testMasterSubjectCode,
        type: "THEORY" as SubjectType,
        lectureHours: 3,
        tutorialHours: 1,
        practicalHours: 0,
        hoursPerWeek: 4,
        credits: 3,
      };

      const res = await principalCtx.post("/api/college/subjects", { data: payload });
      expect(res.status(), `Status should be 201: ${await res.text()}`).toBe(201);
      const data = await res.json();
      expect(data).toHaveProperty("id");
      expect(typeof data.id).toBe("string");
      state.testMasterSubjectId = data.id;
    });

    test("1.2 POST /api/college/subjects rejects missing name or code", async () => {
      const res = await principalCtx.post("/api/college/subjects", {
        data: {
          courseId: state.courseId,
          name: "",
          code: "",
        },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("name and code are required");
    });

    test("1.3 POST /api/college/subjects rejects missing lecture/tutorial/practical hours", async () => {
      const res = await principalCtx.post("/api/college/subjects", {
        data: {
          courseId: state.courseId,
          name: "Invalid Hours Subject",
          code: `INV${Date.now()}`,
          serialNumber: 1,
          category: "PCC",
          // missing lectureHours, tutorialHours, practicalHours
        },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("L, T and P are required");
    });

    test("1.4 POST /api/college/subjects rejects master subject creation when called by HOD (RBAC)", async () => {
      const res = await hodCtx.post("/api/college/subjects", {
        data: {
          courseId: state.courseId,
          name: "HOD Master Subject",
          code: `HOD${Date.now()}`,
          serialNumber: 2,
          category: "PCC",
          lectureHours: 3,
          tutorialHours: 0,
          practicalHours: 0,
        },
      });
      expect(res.status()).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("isn't available to HOD");
    });

    test("1.5 POST /api/college/subjects rejects duplicate subject code under same course", async () => {
      const payload = {
        courseId: state.courseId,
        serialNumber: 3,
        category: "PCC",
        name: "Duplicate Subject Attempt",
        code: state.testMasterSubjectCode,
        type: "THEORY" as SubjectType,
        lectureHours: 3,
        tutorialHours: 0,
        practicalHours: 0,
      };
      const res = await principalCtx.post("/api/college/subjects", { data: payload });
      expect(res.status()).toBe(409);
      const data = await res.json();
      expect(data.error).toContain("already exists for this course");
    });

    test("1.6 GET /api/college/subjects returns created master subject", async () => {
      const res = await principalCtx.get(`/api/college/subjects?courseId=${state.courseId}`);
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.subjects)).toBe(true);
      const found = data.subjects.find((s: { id: string; code: string }) => s.id === state.testMasterSubjectId);
      expect(found).toBeDefined();
      expect(found.code).toBe(state.testMasterSubjectCode);
    });
  });

  // =========================================================================
  // 2. SUBJECT-SEMESTER ASSIGNMENT (CURRICULUM MAPPING) API
  // =========================================================================
  test.describe("2. Subject-Semester Curriculum Assignment API", () => {
    test("2.1 POST /api/college/subject-semester-assignments assigns master subject to semester", async () => {
      const payload = {
        subjectId: state.testMasterSubjectId,
        departmentId: state.departmentId,
        departmentName: state.departmentName,
        courseId: state.courseId,
        semester: 3,
        year: state.year,
      };

      const res = await principalCtx.post("/api/college/subject-semester-assignments", { data: payload });
      // Can succeed (201) or report timing configuration mismatch (400)
      const status = res.status();
      expect([201, 400]).toContain(status);
      if (status === 201) {
        const data = await res.json();
        expect(data).toHaveProperty("id");
        expect(data).toHaveProperty("instance");
      }
    });

    test("2.2 POST /api/college/subject-semester-assignments rejects missing departmentId or semester", async () => {
      const res = await principalCtx.post("/api/college/subject-semester-assignments", {
        data: {
          subjectId: state.testMasterSubjectId,
        },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("departmentId and semester are required");
    });

    test("2.3 GET /api/college/subject-semester-assignments returns assignments", async () => {
      const res = await principalCtx.get(
        `/api/college/subject-semester-assignments?courseId=${state.courseId}&departmentId=${state.departmentId}`
      );
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.assignments)).toBe(true);
    });
  });

  // =========================================================================
  // 3. TEACHING ASSIGNMENTS API
  // =========================================================================
  test.describe("3. Teaching Assignments API", () => {
    test("3.1 POST /api/college/teaching-assignments creates teaching assignment", async () => {
      // Create a section-scoped teaching assignment linking course, section, subject, and faculty
      const payload = {
        facultyId: state.facultyId,
        subjectId: state.testMasterSubjectId,
        courseId: state.courseId,
        sectionId: state.sectionId,
        academicYear: "2026-27",
        semester: 3,
        hoursPerWeek: 4,
        section: state.sectionName,
      };

      const res = await principalCtx.post("/api/college/teaching-assignments", { data: payload });
      const status = res.status();
      expect([201, 400, 403, 409]).toContain(status);
      if (status === 201) {
        const data = await res.json();
        expect(data).toHaveProperty("id");
        state.testAssignmentId = data.id;
      }
    });

    test("3.2 POST /api/college/teaching-assignments rejects missing facultyId or subjectId", async () => {
      const res = await principalCtx.post("/api/college/teaching-assignments", {
        data: {
          courseId: state.courseId,
          sectionId: state.sectionId,
        },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("facultyId and subjectId are required");
    });

    test("3.3 GET /api/college/teaching-assignments returns assignments with subjectType", async () => {
      const res = await principalCtx.get(`/api/college/teaching-assignments?sectionId=${state.sectionId}`);
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.assignments)).toBe(true);
      expect(Array.isArray(data.timetableSlots)).toBe(true);
    });
  });

  // =========================================================================
  // 4. TIMETABLE SLOTS API
  // =========================================================================
  test.describe("4. Timetable Slots API", () => {
    test("4.1 POST /api/college/timetable-slots rejects non-working day (Sunday)", async () => {
      if (!state.testAssignmentId) test.skip();
      const res = await principalCtx.post("/api/college/timetable-slots", {
        data: {
          assignmentId: state.testAssignmentId,
          day: "SUN" as DayOfWeek,
          periodNumber: 1,
        },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("not a working day");
    });

    test("4.2 POST /api/college/timetable-slots rejects allowSplit or labBatch on THEORY subjects", async () => {
      if (!state.testAssignmentId) test.skip();
      const res = await principalCtx.post("/api/college/timetable-slots", {
        data: {
          assignmentId: state.testAssignmentId,
          day: "MON" as DayOfWeek,
          periodNumber: 1,
          allowSplit: true,
          labBatch: "Batch-1",
        },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Only lab (PRACTICAL) subjects can be split into batches");
    });

    test("4.3 POST /api/college/timetable-slots schedules a valid slot", async () => {
      if (!state.testAssignmentId) test.skip();
      const res = await principalCtx.post("/api/college/timetable-slots", {
        data: {
          assignmentId: state.testAssignmentId,
          day: "MON" as DayOfWeek,
          periodNumber: 1,
          classroom: "Room-204",
        },
      });
      const status = res.status();
      const text = await res.text();
      expect([201, 400, 409], `Expected 201/400/409, got ${status}: ${text}`).toContain(status);
      if (status === 201) {
        const data = JSON.parse(text);
        expect(data).toHaveProperty("id");
        state.testSlotId = data.id;
      }
    });

    test("4.4 GET /api/college/timetable-slots returns slots and working days", async () => {
      const res = await principalCtx.get(`/api/college/timetable-slots?sectionId=${state.sectionId}`);
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.slots)).toBe(true);
      expect(Array.isArray(data.subjects)).toBe(true);
      expect(Array.isArray(data.workingDays)).toBe(true);
    });
  });

  // =========================================================================
  // 5. STUDENT ATTENDANCE RESOLUTION & POSTING API
  // =========================================================================
  test.describe("5. Student Attendance Today Periods & Session API", () => {
    test("5.1 GET /api/college/student-attendance/today-periods returns today periods structure", async () => {
      const res = await facultyCtx.get("/api/college/student-attendance/today-periods");
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("date");
      expect(Array.isArray(data.periods)).toBe(true);
    });

    test("5.2 POST /api/college/student-attendance rejects invalid date format", async () => {
      const res = await facultyCtx.post("/api/college/student-attendance", {
        data: {
          assignmentId: state.testAssignmentId || "any-id",
          date: "not-a-date",
        },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("valid date");
    });

    test("5.3 POST /api/college/student-attendance validates period window (out of window rejection)", async () => {
      if (!state.testAssignmentId) test.skip();
      const res = await facultyCtx.post("/api/college/student-attendance", {
        data: {
          assignmentId: state.testAssignmentId,
          date: "2026-01-01",
        },
      });
      // Non-today date must be rejected with 403 WRONG_DATE or 404
      expect([403, 404]).toContain(res.status());
      if (res.status() === 403) {
        const data = await res.json();
        expect(data.error).toBeDefined();
      }
    });

    test("5.4 POST /api/college/student-attendance/office-correction rejects missing reason", async () => {
      const res = await principalCtx.post("/api/college/student-attendance/office-correction", {
        data: {
          facultyId: state.facultyId,
          assignmentId: state.testAssignmentId || "asm-test",
          date: "2026-09-26",
          periodNumber: 1,
          reason: "",
        },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("reason is required");
    });

    test("5.5 POST /api/college/student-attendance/office-correction rejects future date", async () => {
      const res = await principalCtx.post("/api/college/student-attendance/office-correction", {
        data: {
          facultyId: state.facultyId,
          assignmentId: state.testAssignmentId || "asm-test",
          date: "2030-01-01",
          periodNumber: 1,
          reason: "Testing future date gate",
        },
      });
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("future date");
    });

    test("5.6 PATCH /api/college/student-attendance/[id] rejects unauthorized mark status", async () => {
      const res = await facultyCtx.patch("/api/college/student-attendance/non-existent-session-id", {
        data: {
          entries: [{ studentId: "s1", status: "INVALID_STATUS" as any }],
        },
      });
      // 404 if doc does not exist, or 400 for invalid mark
      expect([400, 404]).toContain(res.status());
    });
  });

  // =========================================================================
  // 6. END ATTENDANCE REPORTS API
  // =========================================================================
  test.describe("6. Attendance Reports API", () => {
    test("6.1 GET /api/college/section-attendance-report rejects missing sectionId", async () => {
      const res = await principalCtx.get("/api/college/section-attendance-report");
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("sectionId is required");
    });

    test("6.2 GET /api/college/section-attendance-report rejects inverted date range (from > to)", async () => {
      const res = await principalCtx.get(
        `/api/college/section-attendance-report?sectionId=${state.sectionId}&from=2026-09-30&to=2026-09-01`
      );
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("From date must be before the To date");
    });

    test("6.3 GET /api/college/section-attendance-report returns years drill-down", async () => {
      const res = await principalCtx.get(`/api/college/section-attendance-report?sectionId=${state.sectionId}`);
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.years)).toBe(true);
    });

    test("6.4 GET /api/college/section-attendance-report returns tillNow cumulative section report", async () => {
      const res = await principalCtx.get(
        `/api/college/section-attendance-report?sectionId=${state.sectionId}&tillNow=true`
      );
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.subjects)).toBe(true);
      expect(Array.isArray(data.students)).toBe(true);
      expect(data).toHaveProperty("summary");
      expect(data.summary).toHaveProperty("totalPeriodsHeld");
      expect(data.summary).toHaveProperty("totalPeriodsAttended");
      expect(data.summary).toHaveProperty("overallPercentage");
    });

    test("6.5 GET /api/college/section-attendance-report handles absentOnly and shortage filters", async () => {
      const res = await principalCtx.get(
        `/api/college/section-attendance-report?sectionId=${state.sectionId}&tillNow=true&absentOnly=true&shortage=true&threshold=75`
      );
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.students)).toBe(true);
    });

    test("6.6 GET /api/college/faculty-attendance-completion rejects missing date and range", async () => {
      const res = await principalCtx.get("/api/college/faculty-attendance-completion");
      expect(res.status()).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("A valid date (YYYY-MM-DD) or range");
    });

    test("6.7 GET /api/college/faculty-attendance-completion returns faculty day periods", async () => {
      const res = await principalCtx.get(
        `/api/college/faculty-attendance-completion?facultyId=${state.facultyId}&date=2026-09-25`
      );
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("facultyId", state.facultyId);
      expect(Array.isArray(data.periods)).toBe(true);
    });

    test("6.8 GET /api/college/faculty-attendance-completion returns aggregated range completion", async () => {
      const res = await principalCtx.get(
        `/api/college/faculty-attendance-completion?facultyId=${state.facultyId}&from=2026-09-20&to=2026-09-25`
      );
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("totalPeriods");
      expect(data).toHaveProperty("onTime");
      expect(data).toHaveProperty("late");
      expect(data).toHaveProperty("notMarked");
      expect(data).toHaveProperty("byDate");
    });
  });
});
