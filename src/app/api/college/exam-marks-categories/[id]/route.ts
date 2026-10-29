export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorName, guardError } from "@/lib/midBank/server";
import { checkMarksBreakdown } from "@/lib/exams/marksBreakdown";
import { subjectTypeToExamType } from "@/lib/exams/internalExamMarks";
import { MARKS_CATEGORY_ROLES, marksEnteredFor } from "@/lib/exams/marksCategoriesServer";
import type { ExamMarksCategory, Subject } from "@/types";

// One marks category.
//   PATCH { name?, internalMaxMarks?, externalMaxMarks?, components? } - rename / change the breakdown
//         (refused while any of its subjects has marks entered)
//   PATCH { add: subjectIds[] } or { addCodes: string[], catalogId } - put subjects in (each one: same exam
//         type, not in another category, no marks entered yet); skipped ones come back with the reason
//   PATCH { remove: subjectIds[] } - take subjects out (not one with marks entered)
//   DELETE - only while none of its subjects has marks entered

type Params = { params: Promise<{ id: string }> };
const fmt = (m: Map<string, string[]>, id: string) => (m.get(id) ?? []).slice(0, 2).join(", ");

export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MARKS_CATEGORY_ROLES);
    const { id } = await params;
    const body = (await readJsonBody(request)) as {
      name?: string; internalMaxMarks?: unknown; externalMaxMarks?: unknown; components?: unknown;
      add?: unknown; addCodes?: unknown; catalogId?: string; remove?: unknown;
    };
    const db = getAdminDb();
    const college = db.collection("colleges").doc(session.collegeId);
    const ref = college.collection("examMarksCategories").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Category not found" }, { status: 404 });
    const cat = { ...(snap.data() as ExamMarksCategory), id };
    const update: Record<string, unknown> = { updatedBy: session.uid, updatedByName: await actorName(db, session.collegeId, session.uid), updatedAt: new Date() };
    const skipped: { subject: string; reason: string }[] = [];

    if (typeof body.name === "string") {
      const name = body.name.replace(/\s+/g, " ").trim().slice(0, 80);
      if (!name) return NextResponse.json({ error: "Give the category a name" }, { status: 400 });
      update.name = name;
    }
    if (body.components !== undefined) {
      const checked = checkMarksBreakdown(body);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      const entered = await marksEnteredFor(db, session.collegeId, cat.subjectIds);
      if (entered.size) {
        const who = cat.subjects.filter((s) => entered.has(s.id)).map((s) => `${s.code} - ${fmt(entered, s.id)}`).slice(0, 3);
        return NextResponse.json({ error: `Marks are already entered for ${who.join("; ")}${entered.size > 3 ? " ..." : ""} - the breakdown can't change now` }, { status: 409 });
      }
      Object.assign(update, { internalMaxMarks: checked.internalMaxMarks, externalMaxMarks: checked.externalMaxMarks, components: checked.components });
    }

    let subjects = [...cat.subjects];
    const removeIds = (Array.isArray(body.remove) ? body.remove : []).map(String);
    if (removeIds.length) {
      const entered = await marksEnteredFor(db, session.collegeId, removeIds);
      for (const sid of removeIds) {
        const s = subjects.find((x) => x.id === sid);
        if (!s) continue;
        if (entered.has(sid)) { skipped.push({ subject: s.code, reason: `marks entered (${fmt(entered, sid)})` }); continue; }
        subjects = subjects.filter((x) => x.id !== sid);
      }
    }

    // Subjects to add: by id, or by code within one catalog course (a code may match several regulations - all are added).
    let addDocs: (Subject & { id: string })[] = [];
    const addIds = [...new Set((Array.isArray(body.add) ? body.add : []).map(String))];
    if (addIds.length) {
      const snaps = await db.getAll(...addIds.map((x) => college.collection("subjects").doc(x)));
      addDocs = snaps.filter((x) => x.exists).map((x) => ({ ...(x.data() as Subject), id: x.id }));
    }
    const codes = [...new Set((Array.isArray(body.addCodes) ? body.addCodes : []).map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
    if (codes.length) {
      if (!body.catalogId) return NextResponse.json({ error: "Pick the course the codes belong to" }, { status: 400 });
      const all = (await college.collection("subjects").where("catalogId", "==", body.catalogId).get()).docs.map((x) => ({ ...(x.data() as Subject), id: x.id }));
      for (const code of codes) {
        const hits = all.filter((s) => String(s.code).trim().toUpperCase() === code);
        if (hits.length === 0) skipped.push({ subject: code, reason: "no subject with this code in the course" });
        addDocs.push(...hits);
      }
    }
    if (addDocs.length) {
      const others = (await college.collection("examMarksCategories").get()).docs.filter((d) => d.id !== id).map((d) => ({ ...(d.data() as ExamMarksCategory), id: d.id }));
      const entered = await marksEnteredFor(db, session.collegeId, addDocs.map((s) => s.id));
      for (const s of addDocs) {
        if (subjects.some((x) => x.id === s.id)) continue;
        if (subjectTypeToExamType(s.type) !== cat.examType) { skipped.push({ subject: s.code, reason: `is a ${subjectTypeToExamType(s.type) === "LAB" ? "lab" : "theory"} subject` }); continue; }
        const other = others.find((o) => o.examType === cat.examType && o.subjectIds.includes(s.id));
        if (other) { skipped.push({ subject: s.code, reason: `already in "${other.name}"` }); continue; }
        if (entered.has(s.id)) { skipped.push({ subject: s.code, reason: `marks entered (${fmt(entered, s.id)})` }); continue; }
        subjects.push({ id: s.id, code: s.code, name: s.name, regulation: s.regulation ?? "" });
      }
    }
    if (removeIds.length || addDocs.length) {
      subjects.sort((a, b) => a.code.localeCompare(b.code) || a.regulation.localeCompare(b.regulation));
      Object.assign(update, { subjects, subjectIds: subjects.map((s) => s.id) });
    }

    await ref.update(update);
    return NextResponse.json({ category: { ...cat, ...update }, skipped });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/exam-marks-categories/[id] PATCH]");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MARKS_CATEGORY_ROLES);
    const { id } = await params;
    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("examMarksCategories").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ ok: true });
    const entered = await marksEnteredFor(db, session.collegeId, (snap.data() as ExamMarksCategory).subjectIds);
    if (entered.size) return NextResponse.json({ error: "Marks are already entered for some of its subjects - it can't be deleted now" }, { status: 409 });
    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return guardError(err, "[college/exam-marks-categories/[id] DELETE]");
  }
}
