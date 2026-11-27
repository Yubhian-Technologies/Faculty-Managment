export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { paymentErrorResponse } from "@/lib/payments/server";
import { requireFeesManager } from "@/lib/fees/http";
import { FeeError, feeRefs, loadHeads } from "@/lib/fees/server";
import { CATEGORY_LABEL } from "@/lib/fees/rules";
import { ACADEMIC_YEAR_RE, cleanStructure } from "@/lib/fees/rules";
import type { FeeStructure } from "@/types/fees";

// Accounts > Fees > Fee Structures (?collegeId): the year's fee for academic year + course + batch + category
// (A - also used for Spot students - or B), by fee head (Category A: which heads FR covers), split into instalments
// with due dates. Publishing needs every head to have its bank account.
// GET ?academicYear=   the structures of that year
// POST { id?, rev?, ...fields, publish?: boolean, reason? }   add / edit (a published one needs a reason; accounts
//      already raised keep their fee until fees are raised again)
// DELETE ?id=           a draft only

export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireFeesManager(db, request);
    const year = new URL(request.url).searchParams.get("academicYear") ?? "";
    if (!ACADEMIC_YEAR_RE.test(year)) throw new FeeError("Select the academic year.");
    const snap = await feeRefs(db, session.collegeId).structures.where("academicYear", "==", year).get();
    const structures = snap.docs.map((d) => ({ ...(d.data() as FeeStructure), id: d.id }))
      .sort((a, b) => a.courseName.localeCompare(b.courseName) || b.batch.localeCompare(a.batch) || a.category.localeCompare(b.category));
    return NextResponse.json({ structures });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/structures GET]");
  }
}

export async function POST(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireFeesManager(db, request);
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const heads = await loadHeads(db, session.collegeId);
    const cleaned = cleanStructure(body as never, new Map(heads.map((h) => [h.id, h.name])));
    if ("error" in cleaned) throw new FeeError(cleaned.error);
    const v = cleaned.value;
    const refs = feeRefs(db, session.collegeId);
    const id = typeof body.id === "string" && body.id ? body.id : null;
    const reason = String(body.reason ?? "").trim().slice(0, 300);
    const publish = body.publish === true;
    // One structure per academic year + course + batch + category.
    const same = await refs.structures.where("academicYear", "==", v.academicYear).where("courseKey", "==", v.courseKey).where("batch", "==", v.batch).get();
    if (same.docs.some((d) => d.id !== id && (d.data() as FeeStructure).category === v.category)) {
      throw new FeeError(`A ${CATEGORY_LABEL[v.category]} fee structure for ${v.courseName} ${v.batch} already exists for ${v.academicYear}. Edit that one.`, 409);
    }
    const noBank = v.heads.filter((h) => !heads.find((x) => x.id === h.headId)?.bankAccountId);
    if (publish && noBank.length) throw new FeeError(`Set the bank account of ${noBank.map((h) => h.name).join(", ")} first (Setup).`);
    const at = new Date().toISOString();
    const saved = await db.runTransaction(async (tx) => {
      const ref = id ? refs.structures.doc(id) : refs.structures.doc();
      const cur = id ? ((await tx.get(ref)).data() as FeeStructure | undefined) : undefined;
      if (id && !cur) throw new FeeError("Fee structure not found. It may have been deleted.", 404);
      if (cur && Number(body.rev) !== cur.rev) throw new FeeError("This structure changed since you opened it. Reload and try again.", 409);
      if (cur?.status === "PUBLISHED" && !reason) throw new FeeError("Enter the reason for changing a published fee structure.");
      const status = cur?.status === "PUBLISHED" || publish ? "PUBLISHED" : "DRAFT";
      const action = !cur ? "CREATED" : cur.status === "DRAFT" && status === "PUBLISHED" ? "PUBLISHED" : "UPDATED";
      const next: FeeStructure = {
        ...(cur ?? {}), ...v, id: ref.id, status, rev: (cur?.rev ?? 0) + 1, createdAt: cur?.createdAt ?? at, updatedAt: at, updatedByName: session.byName,
        ...(status === "PUBLISHED" && !cur?.publishedAt ? { publishedAt: at } : {}),
        history: [...(cur?.history ?? []), { at, byName: session.byName, action, ...(reason ? { reason } : {}) }].slice(-30),
      };
      tx.set(ref, next);
      return next;
    });
    await writeAuditLogSafe(db, session.collegeId, {
      action: `FEE_STRUCTURE_${saved.history?.slice(-1)[0]?.action ?? "UPDATED"}`, performedBy: session.uid, performedByName: session.byName, targetId: saved.id,
      details: { academicYear: saved.academicYear, course: saved.courseName, batch: saved.batch, category: saved.category, total: saved.total, ...(reason ? { reason } : {}) },
    });
    return NextResponse.json({ structure: saved });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/structures POST]");
  }
}

export async function DELETE(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireFeesManager(db, request);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    const ref = feeRefs(db, session.collegeId).structures.doc(id || "-");
    const cur = (await ref.get()).data() as FeeStructure | undefined;
    if (!cur) throw new FeeError("Fee structure not found. It may have been deleted.", 404);
    if (cur.status !== "DRAFT") throw new FeeError("A published fee structure can't be deleted.", 409);
    await ref.delete();
    await writeAuditLogSafe(db, session.collegeId, { action: "FEE_STRUCTURE_DELETED", performedBy: session.uid, performedByName: session.byName, targetId: id, details: { academicYear: cur.academicYear, course: cur.courseName, batch: cur.batch } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/structures DELETE]");
  }
}
