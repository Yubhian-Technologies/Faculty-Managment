export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { toMenteeSummary } from "@/lib/mentoring/summary";
import { compareStudentsForList } from "@/lib/students/listOrder";
import type { StudentRecord } from "@/types";

const PAGE = 50;
const BATCH = 100;
const MAX_BATCHES = 5;
const FIELDS = ["name", "rollNumber", "department", "section", "year", "status", "mentorUid", "mentorName", "profilePhotoUrl"] as const;

// Principal / Vice-Principal: find students of their OWN college (the college comes from the
// session) to open their mentoring record. Never a whole-college read:
//   - department and / or one mentor (`mentorUid`) [+ year] [+ section]: an equality query on those fields only,
//     read BATCH at a time in document-id order (no composite index), PAGE results per call;
//     `mentor=with|none` and `q` (name or Regd. No, 3+ letters) narrow the batch as it is read;
//     `cursor` (the last student id seen) fetches the next page.
//   - Regd. No only (no department): an indexed prefix lookup on rollNumberUpper, one page, no cursor.
// Summary fields only (`select`) - the record itself is read through mentoring/college-students/[id].
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL");
    const p = new URL(request.url).searchParams;
    const department = (p.get("department") ?? "").trim();
    const year = /^\d{1,2}$/.test(p.get("year") ?? "") ? Number(p.get("year")) : null;
    const section = (p.get("section") ?? "").trim();
    const mentorUid = (p.get("mentorUid") ?? "").trim();
    const mentor = p.get("mentor") === "with" || p.get("mentor") === "none" ? p.get("mentor") : null;
    const q = (p.get("q") ?? "").trim().toUpperCase();
    const cursor = (p.get("cursor") ?? "").trim();

    const db = getAdminDb();
    const students = db.collection("colleges").doc(session.collegeId).collection("students");
    const out = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) =>
      docs.map((d) => ({ ...(d.data() as StudentRecord), id: d.id })).filter((s) => s.status !== "GRADUATED");

    if (!department && !mentorUid) {
      if (q.length < 3) return NextResponse.json({ students: [], needFilter: true });
      const snap = await students.where("rollNumberUpper", ">=", q).where("rollNumberUpper", "<", `${q}`).select(...FIELDS).limit(PAGE).get();
      const hits = out(snap.docs).filter((s) => !mentor || (mentor === "with") === !!s.mentorUid).sort(compareStudentsForList);
      return NextResponse.json({ students: hits.map(toMenteeSummary), nextCursor: null });
    }

    // A department and / or one mentor's mentees: equality filters only (no scan, no composite index).
    let base: FirebaseFirestore.Query = students;
    if (department) base = base.where("department", "==", department);
    if (mentorUid) base = base.where("mentorUid", "==", mentorUid);
    if (year != null) base = base.where("year", "==", year);
    if (section) base = base.where("section", "==", section);

    const matches: (StudentRecord & { id: string })[] = [];
    let last = cursor;
    let exhausted = false;
    for (let i = 0; i < MAX_BATCHES && matches.length < PAGE && !exhausted; i++) {
      let query = base.orderBy("__name__").select(...FIELDS).limit(BATCH);
      if (last) query = query.startAfter(last);
      const snap = await query.get();
      if (snap.size < BATCH) exhausted = true;
      if (snap.empty) break;
      last = snap.docs[snap.docs.length - 1].id;
      for (const s of out(snap.docs)) {
        if (mentor && (mentor === "with") !== !!s.mentorUid) continue;
        if (q && !((s.rollNumber ?? "").toUpperCase().includes(q) || (s.name ?? "").toUpperCase().includes(q))) continue;
        matches.push(s);
      }
    }
    // The page's own order is the roster order; pages follow each other by document id.
    matches.sort(compareStudentsForList);
    return NextResponse.json({ students: matches.map(toMenteeSummary), nextCursor: exhausted ? null : last });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/college-students GET]");
  }
}
