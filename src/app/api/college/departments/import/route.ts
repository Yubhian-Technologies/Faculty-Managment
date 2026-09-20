export const dynamic = "force-dynamic";

import { canonicalDepartmentCode, canonicalDepartmentName, findDepartmentConflict } from "@/lib/departments/resolve";
import { departmentKeyDocId } from "@/lib/departments/departmentKeys";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { assignSeat } from "@/lib/roles/seats";
import { resolveDepartmentCourseSelections, type DepartmentCourseSelection } from "@/lib/departments/courseSelections";

type ImportRow = { name: string; code: string; hodEmail?: string };

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as { records: ImportRow[]; courses?: DepartmentCourseSelection[] };

    if (!body.records || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }
    if (body.records.length > 500) {
      return NextResponse.json({ error: "Maximum 500 records per import" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;

    // Every imported department gets the same course(s) - a department can't
    // exist without one (see college/departments POST).
    const resolved = await resolveDepartmentCourseSelections(db, collegeId, body.courses);
    if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });
    const newCourses = resolved.courses;

    const deptsColl = db.collection("colleges").doc(collegeId).collection("departments");
    const coursesColl = db.collection("colleges").doc(collegeId).collection("courses");
    const usersColl = db.collection("colleges").doc(collegeId).collection("users");
    const seatsColl = db.collection("colleges").doc(collegeId).collection("roleSeats");

    const [existingDeptsSnap, hodUsersSnap] = await Promise.all([
      deptsColl.select("name", "code").get(),
      usersColl.get(),
    ]);

    // Name/code uniqueness uses the same normalised comparison as the manual
    // create/rename (resolve.ts) - case, spacing and NBSP insensitive, and a name
    // may not equal another department's code. `known` also grows as rows are
    // accepted so duplicates WITHIN the file are caught. The lock docs written
    // below with batch.create() make the commit itself reject a concurrent
    // duplicate (the whole batch then fails and can simply be re-imported).
    const known: { id: string; name?: string; code?: string }[] = existingDeptsSnap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as { name?: string; code?: string }),
    }));
    const keysColl = db.collection("colleges").doc(collegeId).collection("departmentKeys");
    // Anyone in the college can be named - the HOD is a seat a person holds
    // on top of their own role, not a separate kind of account. Matched on
    // either their login (college) email or personal email.
    const hodByEmail = new Map<string, { uid: string; name: string }>();
    for (const d of hodUsersSnap.docs) {
      const u = d.data() as { email?: string; collegeEmail?: string; name?: string };
      for (const e of [u.email, u.collegeEmail]) {
        if (e) hodByEmail.set(e.toLowerCase(), { uid: d.id, name: u.name ?? "" });
      }
    }
    const seatAssignments: { seatId: string; uid: string; name: string }[] = [];

    const now = new Date();
    const created: string[] = [];
    const failed: { row: number; name: string; error: string }[] = [];
    const warnings: { row: number; name: string; message: string }[] = [];

    const batch = db.batch();
    let batchWrites = 0;

    for (let i = 0; i < body.records.length; i++) {
      const row = body.records[i];
      const rowNum = i + 2; // 1-indexed + header row

      const name = canonicalDepartmentName(row.name) || undefined;
      const code = canonicalDepartmentCode(row.code) || undefined;
      if (!name) { failed.push({ row: rowNum, name: "-", error: "Department name is required" }); continue; }
      if (!code) { failed.push({ row: rowNum, name, error: "Short code is required" }); continue; }
      if (code.length > 10) { failed.push({ row: rowNum, name, error: "Short code must be 10 characters or fewer" }); continue; }
      const dup = findDepartmentConflict(known, { name, code });
      if (dup) { failed.push({ row: rowNum, name, error: dup.message }); continue; }

      let hodUid = "";
      let hodName = "";
      const hodEmail = row.hodEmail?.trim().toLowerCase();
      if (hodEmail) {
        const match = hodByEmail.get(hodEmail);
        if (match) {
          hodUid = match.uid;
          hodName = match.name;
        } else {
          warnings.push({ row: rowNum, name, message: `No HOD account found for "${row.hodEmail}" - department added without an HOD` });
        }
      }

      // Firestore batch limit is 500 writes - department + its courses (+ HOD sync).
      const rowWrites = 4 + newCourses.length; // department + seat + name/code locks (+ courses)
      if (batchWrites + rowWrites > 500) {
        failed.push({ row: rowNum, name, error: "Import batch limit reached - import the remaining rows in a second file" });
        continue;
      }

      const deptRef = deptsColl.doc();
      batch.create(keysColl.doc(departmentKeyDocId("name", name)), { departmentId: deptRef.id, field: "name", updatedAt: now });
      batch.create(keysColl.doc(departmentKeyDocId("code", code)), { departmentId: deptRef.id, field: "code", updatedAt: now });
      batch.set(deptRef, {
        collegeId,
        name,
        code,
        // Appointed through the department's HOD seat below, not written here.
        hodUid: "",
        hodName: "",
        isActive: true,
        courseScopes: Object.fromEntries(
          newCourses.map((c) => [c.catalogId, { assignedYears: c.assignedYears, secondaryDepartments: [] }])
        ),
        createdAt: now,
        updatedAt: now,
      });
      for (const c of newCourses) {
        batch.set(coursesColl.doc(), {
          collegeId,
          departmentId: deptRef.id,
          catalogId: c.catalogId,
          name: c.name,
          code: c.code,
          durationYears: c.durationYears,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Every department gets its own (empty) HOD seat; a matched HOD email is
      // appointed to it right after the batch commits.
      const seatRef = seatsColl.doc();
      batch.set(seatRef, {
        collegeId, role: "HOD", label: `Head of Department - ${name}`, departmentId: deptRef.id, departmentName: name,
        holderUid: null, holderName: "", isActive: true, createdAt: now, updatedAt: now,
      });
      if (hodUid) seatAssignments.push({ seatId: seatRef.id, uid: hodUid, name });

      known.push({ id: deptRef.id, name, code }); // catches duplicates later in the same file
      created.push(name);
      batchWrites += rowWrites;
    }

    try {
      await batch.commit();
    } catch (e) {
      // batch.create() on an existing lock doc = a concurrent create claimed the
      // same name/code between our read and this commit. Nothing was written.
      console.error("[college/departments/import] batch commit failed:", e);
      return NextResponse.json(
        { error: "A department with the same name or short code was created at the same time. Nothing was imported - please retry." },
        { status: 409 }
      );
    }

    // Appoint the HOD each row named, through the seat (which also records the
    // history and links the person's dashboard). Someone who can't hold an HOD
    // seat (e.g. supporting staff) is reported instead of silently skipped.
    const actorSnap = await usersColl.doc(session.uid).get();
    const actor = { uid: session.uid, name: (actorSnap.data() as { name?: string } | undefined)?.name ?? "Principal" };
    for (const a of seatAssignments) {
      try {
        await assignSeat(db, collegeId, a.seatId, { uid: a.uid }, actor);
      } catch (e) {
        warnings.push({ row: 0, name: a.name, message: `HOD not appointed - ${e instanceof Error ? e.message : "failed"} (appoint them in Role Assignments)` });
      }
    }

    return NextResponse.json({ created: created.length, failed, warnings }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/departments/import POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
