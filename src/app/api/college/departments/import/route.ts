export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

type ImportRow = { name: string; code: string; hodEmail?: string };

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as { records: ImportRow[] };

    if (!body.records || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }
    if (body.records.length > 500) {
      return NextResponse.json({ error: "Maximum 500 records per import" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;
    const deptsColl = db.collection("colleges").doc(collegeId).collection("departments");
    const usersColl = db.collection("colleges").doc(collegeId).collection("users");

    const [existingDeptsSnap, hodUsersSnap] = await Promise.all([
      deptsColl.select("name", "code").get(),
      usersColl.where("role", "==", "HOD").get(),
    ]);

    const existingCodes = new Set(
      existingDeptsSnap.docs.map((d) => ((d.data() as { code?: string }).code ?? "").toUpperCase())
    );
    // Names are the scope model's join key (see college/departments POST), so a
    // duplicate name is as unsafe as a duplicate code - guard both, case-insensitively.
    const existingNames = new Set(
      existingDeptsSnap.docs.map((d) => ((d.data() as { name?: string }).name ?? "").trim().toLowerCase())
    );
    const hodByEmail = new Map(
      hodUsersSnap.docs.map((d) => {
        const u = d.data() as { email?: string; name?: string };
        return [(u.email ?? "").toLowerCase(), { uid: d.id, name: u.name ?? "" }];
      })
    );

    const now = new Date();
    const created: string[] = [];
    const failed: { row: number; name: string; error: string }[] = [];
    const warnings: { row: number; name: string; message: string }[] = [];

    const batch = db.batch();
    let batchCount = 0;

    for (let i = 0; i < body.records.length; i++) {
      const row = body.records[i];
      const rowNum = i + 2; // 1-indexed + header row

      const name = row.name?.trim();
      const code = row.code?.trim().toUpperCase();
      if (!name) { failed.push({ row: rowNum, name: "-", error: "Department name is required" }); continue; }
      if (!code) { failed.push({ row: rowNum, name, error: "Short code is required" }); continue; }
      if (code.length > 10) { failed.push({ row: rowNum, name, error: "Short code must be 10 characters or fewer" }); continue; }
      if (existingNames.has(name.toLowerCase())) { failed.push({ row: rowNum, name, error: `Department "${name}" already exists` }); continue; }
      if (existingCodes.has(code)) { failed.push({ row: rowNum, name, error: `Code "${code}" already exists` }); continue; }

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

      const deptRef = deptsColl.doc();
      batch.set(deptRef, {
        collegeId,
        name,
        code,
        hodUid,
        hodName,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      // Keep the HOD's own profile department in sync, same as the single-add route.
      if (hodUid) {
        batch.update(usersColl.doc(hodUid), { department: name, updatedAt: now });
      }

      existingCodes.add(code); // prevent duplicate codes within the same batch
      existingNames.add(name.toLowerCase()); // ...and duplicate names
      created.push(name);
      batchCount++;

      // Firestore batch limit is 500 writes
      if (batchCount === 499) break;
    }

    await batch.commit();

    return NextResponse.json({ created: created.length, failed, warnings }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/departments/import POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
