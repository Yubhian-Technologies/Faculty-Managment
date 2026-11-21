export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { whereIn } from "@/lib/firestore/inQuery";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { actorOf } from "@/lib/audit/actorOf";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { REGISTRY_COLLECTION, claimStudentRoll, registryRef } from "@/lib/students/rollIdentity";
import { rollNumberUpperOf, studentRollKey } from "@/lib/students/loginDefaults";
import type { StudentRecord } from "@/types";

// Many Regd. No changes at once - the college renumbered a year after students joined and left (the "Sync with Final
// List" import). One-at-a-time changes can't do it: in a shifted chain (5720 -> 5719 while 5719 still belongs to the
// next student) every single change is refused as "already assigned". So:
//   { changes: [{ studentId, to }], release: [studentId], dryRun? }
//   release = students (who left) whose number is given to someone else: their roll is cleared, kept as previousRollNumber.
// 1. The FINAL state is checked first and nothing is written if it isn't clean: every new number unique, not held by
//    any student of this college outside the set, not registered to another college. Students with a login are
//    refused (their sign-in is the Regd. No - change those one by one from their details).
// 2. Every old number of the set is retired in the global registry, released students are cleared, then each new
//    number is claimed (claimStudentRoll) and written with the old one kept as previousRollNumber.
// Attendance, marks and history are keyed by the student record, so they follow the student to the new number.

const MAX = 1500;

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await readJsonBody(request)) as { changes?: unknown; release?: unknown; dryRun?: unknown };
    const changes = (Array.isArray(body.changes) ? body.changes : [])
      .map((c) => ({ studentId: String((c as { studentId?: unknown })?.studentId ?? ""), to: String((c as { to?: unknown })?.to ?? "").trim() }))
      .filter((c) => c.studentId);
    const release = Array.from(new Set((Array.isArray(body.release) ? body.release : []).map(String).filter(Boolean)));
    if (changes.length + release.length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    if (changes.length + release.length > MAX) return NextResponse.json({ error: `At most ${MAX} students at a time.` }, { status: 400 });

    const problems: string[] = [];
    const ids = Array.from(new Set([...changes.map((c) => c.studentId), ...release]));
    if (ids.length !== changes.length + release.length) problems.push("A student is listed twice.");
    const keys = new Map<string, string>();
    for (const c of changes) {
      const k = studentRollKey(c.to);
      if (!k) { problems.push(`"${c.to}" is not a valid Regd. No.`); continue; }
      if (keys.has(k)) problems.push(`Regd. No ${c.to} is given to two students.`);
      keys.set(k, c.studentId);
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const snaps = await db.getAll(...ids.map((id) => collegeRef.collection("students").doc(id)));
    const students = new Map<string, StudentRecord>();
    snaps.forEach((s, i) => {
      if (!s.exists) problems.push(`Student ${ids[i]} not found.`);
      else students.set(s.id, s.data() as StudentRecord);
    });
    for (const [id, s] of students) {
      if (s.uid || s.loginEmail) problems.push(`${s.rollNumber || s.name} has a login - change their Regd. No from their details.`);
      if (release.includes(id) && s.status !== "DISCONTINUED") problems.push(`${s.rollNumber || s.name}: only a student marked Discontinued can give up their number.`);
    }

    // Final state, college side: a new number may only be held now by a student of this set (who is moving off it).
    const inSet = new Set(ids);
    const newUppers = changes.map((c) => rollNumberUpperOf(c.to)).filter(Boolean);
    if (newUppers.length) {
      const holders = await whereIn(collegeRef.collection("students"), "rollNumberUpper", newUppers).get();
      for (const d of holders.docs) {
        if (inSet.has(d.id)) continue;
        const h = d.data() as StudentRecord;
        problems.push(`Regd. No ${h.rollNumber} belongs to ${h.name}${h.year ? ` (Year ${h.year})` : ""}, who isn't part of this change.`);
      }
      // ... and the global registry: never another college's number.
      const regs = await db.getAll(...changes.filter((c) => studentRollKey(c.to)).map((c) => registryRef(db, c.to)));
      regs.forEach((r) => {
        const cur = r.exists ? (r.data() as { collegeId?: string; active?: boolean; rollNumber?: string }) : null;
        if (cur && cur.active !== false && cur.collegeId && cur.collegeId !== session.collegeId) {
          problems.push(`Regd. No ${cur.rollNumber ?? r.id} is registered to a student of another college.`);
        }
      });
    }
    const effective = changes.filter((c) => rollNumberUpperOf(students.get(c.studentId)?.rollNumber) !== rollNumberUpperOf(c.to));
    if (problems.length || body.dryRun === true) {
      return NextResponse.json({ ok: problems.length === 0, problems, changes: effective.length, released: release.length }, { status: problems.length && body.dryRun !== true ? 400 : 200 });
    }

    const now = new Date();
    // 1. Retire every old number of the set (only entries that point at that student).
    const retire = new ChunkedBatch(db);
    const touched = [...effective.map((c) => c.studentId), ...release];
    for (const id of touched) {
      const s = students.get(id)!;
      const old = s.rollNumber ?? "";
      if (!studentRollKey(old)) continue;
      const refs = [registryRef(db, old), db.collection(REGISTRY_COLLECTION).doc(rollNumberUpperOf(old))].filter((r, i, a) => a.findIndex((x) => x.path === r.path) === i && !r.id.includes("/"));
      for (const ref of refs) {
        const snap = await ref.get();
        const cur = snap.exists ? (snap.data() as { collegeId?: string; studentDocId?: string }) : null;
        if (cur && cur.collegeId === session.collegeId && cur.studentDocId === id) retire.update(ref, { active: false, supersededAt: now });
      }
    }
    // 2. Students who left give up their number (kept on their record).
    for (const id of release) {
      const s = students.get(id)!;
      retire.update(collegeRef.collection("students").doc(id), { rollNumber: "", rollNumberUpper: "", previousRollNumber: s.rollNumber ?? "", updatedAt: now });
    }
    await retire.commit();

    // 3. Claim and write each new number.
    const failed: string[] = [];
    const write = new ChunkedBatch(db);
    for (let i = 0; i < effective.length; i += 10) {
      await Promise.all(effective.slice(i, i + 10).map(async (c) => {
        const s = students.get(c.studentId)!;
        const claim = await claimStudentRoll(db, { roll: c.to, collegeId: session.collegeId, studentDocId: c.studentId, name: s.name }, now);
        if (!claim.ok) { failed.push(`${s.name}: ${c.to} could not be claimed`); return; }
        write.update(collegeRef.collection("students").doc(c.studentId), {
          rollNumber: c.to, rollNumberUpper: rollNumberUpperOf(c.to), previousRollNumber: s.rollNumber ?? "", updatedAt: now,
        });
      }));
    }
    await write.commit();

    const actor = await actorOf(db, session.collegeId, session.uid, session.email);
    await writeAuditLog(db, session.collegeId, {
      action: "STUDENTS_RENUMBERED",
      performedBy: session.uid,
      performedByName: actor.name,
      details: {
        count: effective.length - failed.length, released: release.length, failed: failed.length,
        changes: effective.slice(0, 200).map((c) => `${students.get(c.studentId)?.rollNumber ?? ""} -> ${c.to}`),
      },
    });
    return NextResponse.json({ ok: failed.length === 0, changed: effective.length - failed.length, released: release.length, failed });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/students/renumber POST]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
