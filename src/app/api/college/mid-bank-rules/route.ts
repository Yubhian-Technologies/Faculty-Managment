export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorName, guardError, midBankRefs, rulesDocId } from "@/lib/midBank/server";
import { LIMITS } from "@/lib/midBank/constants";
import { cleanMidMap } from "@/lib/midBank/unitSplit";
import type { MidBankRules } from "@/types";
import { allowedFormats, formatName, partsFor, QUESTION_FORMATS } from "@/lib/midBank/validateQuestion";

// Mid Question Bank rules, per course (+ regulation, or "ALL"): which units
// each Mid covers, the question format and marks. Set by the Exam Cell; read
// by the bank setup. A bank takes a snapshot when it starts, so editing these
// never reshapes a bank already being written.

const READ_ROLES = ["EXAM_CELL", "HOD", "PANEL_MEMBER", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"];

export async function GET() {
  try {
    const session = await requireCollegeMember(...READ_ROLES);
    const refs = midBankRefs(getAdminDb(), session.collegeId);
    const [snap, catalog] = await Promise.all([refs.rules.get(), refs.college.collection("courseCatalog").get()]);
    // The regulations Academics set up per catalog course (Academics > Regulation) - the
    // only ones a rule may be set for; keyed like the course groups (catalog id).
    const regulationsByCourse: Record<string, string[]> = {};
    for (const d of catalog.docs) {
      const regs = (d.get("regulations") as string[] | undefined) ?? [];
      regulationsByCourse[d.id] = [...new Set(regs.map((r) => String(r).trim().toUpperCase()).filter(Boolean))].sort();
    }
    const rules = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<MidBankRules, "id">) }))
      .sort((a, b) => a.courseName.localeCompare(b.courseName) || a.regulation.localeCompare(b.regulation));
    return NextResponse.json({ rules, regulationsByCourse });
  } catch (err) {
    return guardError(err, "[college/mid-bank-rules GET]");
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const body = (await readJsonBody(request)) as Partial<MidBankRules>;
    const courseKey = String(body.courseKey ?? "").trim();
    const courseName = String(body.courseName ?? "").trim();
    const regulation = String(body.regulation ?? "").trim().toUpperCase() || "ALL";
    const marks = Number(body.marks);
    if (!courseKey || !courseName) return NextResponse.json({ error: "Pick a course" }, { status: 400 });
    // The ticked question types (an older client may still send one `format`).
    const sent = Array.isArray(body.formats) ? body.formats : body.format ? null : [];
    const formats = sent === null ? allowedFormats({ format: body.format }) : QUESTION_FORMATS.filter((f) => sent.includes(f));
    if (formats.length === 0) return NextResponse.json({ error: "Tick at least one question type" }, { status: 400 });
    if (!Number.isInteger(marks) || marks < 1 || marks > 100) return NextResponse.json({ error: "Marks per question must be a whole number from 1 to 100" }, { status: 400 });
    const tooMany = formats.find((f) => partsFor(f) > marks);
    if (tooMany) return NextResponse.json({ error: `${formatName(tooMany)} needs at least ${partsFor(tooMany)} marks (1 per part)` }, { status: 400 });

    const mids: Record<string, number[]> = {};
    for (const [mid, list] of Object.entries(body.mids ?? {})) {
      if (!/^[1-9]$/.test(mid) || !Array.isArray(list)) continue;
      const units = [...new Set(list.map(Number))];
      if (units.length === 0) continue;
      if (units.some((u) => !Number.isInteger(u) || u < 1 || u > LIMITS.units)) {
        return NextResponse.json({ error: `Mid ${mid}: units must be numbers from 1 to ${LIMITS.units}` }, { status: 400 });
      }
      mids[mid] = units;
    }
    if (Object.keys(mids).length === 0) return NextResponse.json({ error: "Set the units for at least one Mid" }, { status: 400 });

    // Splits by the subject's number of units (optional; a count left out uses the default above).
    const unitSplits: Record<string, Record<string, number[]>> = {};
    for (const [count, map] of Object.entries((body.unitSplits ?? {}) as Record<string, unknown>)) {
      const n = Number(count);
      if (!Number.isInteger(n) || n < 1 || n > LIMITS.units) continue;
      const c = cleanMidMap(map, n);
      if (c.error) return NextResponse.json({ error: `${n}-unit subjects: ${c.error}` }, { status: 400 });
      if (Object.keys(c.value).length) unitSplits[String(n)] = c.value;
    }

    const db = getAdminDb();
    // Only a regulation Academics set up for the course (Course Catalog), or ALL.
    if (regulation !== "ALL") {
      const cat = courseKey.startsWith("name:") ? null : await midBankRefs(db, session.collegeId).college.collection("courseCatalog").doc(courseKey).get();
      const regs = ((cat?.get("regulations") as string[] | undefined) ?? []).map((r) => String(r).trim().toUpperCase());
      if (!regs.includes(regulation)) return NextResponse.json({ error: `${regulation} is not a regulation of ${courseName} in Academics` }, { status: 400 });
    }
    const id = rulesDocId(courseKey, regulation);
    const data = {
      courseKey, courseName, regulation, mids, unitSplits, formats, marks,
      updatedBy: session.uid, updatedByName: await actorName(db, session.collegeId, session.uid), updatedAt: new Date(),
    };
    await midBankRefs(db, session.collegeId).rules.doc(id).set(data);
    return NextResponse.json({ rule: { id, ...data } });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-bank-rules PUT]");
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    await midBankRefs(getAdminDb(), session.collegeId).rules.doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return guardError(err, "[college/mid-bank-rules DELETE]");
  }
}
