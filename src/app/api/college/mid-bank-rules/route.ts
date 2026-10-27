export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorName, guardError, midBankRefs, rulesDocId } from "@/lib/midBank/server";
import { LIMITS } from "@/lib/midBank/constants";
import type { MidBankFormat, MidBankRules } from "@/types";

// Mid Question Bank rules, per course (+ regulation, or "ALL"): which units
// each Mid covers, the question format and marks. Set by the Exam Cell; read
// by the bank setup. A bank takes a snapshot when it starts, so editing these
// never reshapes a bank already being written.

const READ_ROLES = ["EXAM_CELL", "HOD", "PANEL_MEMBER", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"];

export async function GET() {
  try {
    const session = await requireCollegeMember(...READ_ROLES);
    const snap = await midBankRefs(getAdminDb(), session.collegeId).rules.get();
    const rules = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<MidBankRules, "id">) }))
      .sort((a, b) => a.courseName.localeCompare(b.courseName) || a.regulation.localeCompare(b.regulation));
    return NextResponse.json({ rules });
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
    const format = body.format as MidBankFormat;
    const marks = Number(body.marks);
    if (!courseKey || !courseName) return NextResponse.json({ error: "Pick a course" }, { status: 400 });
    if (format !== "SINGLE" && format !== "PARTS_AB") return NextResponse.json({ error: "Pick the question format" }, { status: 400 });
    if (!Number.isInteger(marks) || marks < 1 || marks > 100) return NextResponse.json({ error: "Marks per question must be a whole number from 1 to 100" }, { status: 400 });
    if (format === "PARTS_AB" && marks % 2 !== 0) return NextResponse.json({ error: "Parts (a) and (b) split the marks evenly - use an even number" }, { status: 400 });

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

    const db = getAdminDb();
    const id = rulesDocId(courseKey, regulation);
    const data = {
      courseKey, courseName, regulation, mids, format, marks,
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
