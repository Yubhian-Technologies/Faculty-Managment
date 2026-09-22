export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify, notifyRole } from "@/lib/notify";
import { REVIEWABLE_MODULES, getCoordinatorDepartments } from "@/lib/research/coordinatorReview";

// The R&D Coordinator's review queue, for every Research & Innovation module at
// once. Scoped by the coordinator's own department seat(s): a record is only
// ever reachable here if its `reviewDepartment` is one they coordinate.

// Server-owned fields a coordinator can never write, however they're named in
// an edit payload.
const PROTECTED = new Set([
  "id", "uid", "collegeId", "status", "createdAt", "updatedAt", "addedBy", "addedByName",
  "ownerName", "ownerRole", "ownerDesignation", "reviewDepartment", "coordinatorUid",
  "reviewedBy", "reviewedByName", "reviewedAt", "rejectionReason", "changeLog",
  "coordinatorReviewedBy", "coordinatorReviewedByName", "coordinatorReviewedAt",
  "coordinatorNote", "sentBackReason", "coordinatorEdits", "internalAuthorUids",
]);

type Scalar = string | number | boolean | null;
const isScalar = (v: unknown): v is Scalar =>
  v === null || ["string", "number", "boolean"].includes(typeof v);

function readPath(obj: Record<string, unknown>, path: string): { found: boolean; value?: unknown } {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur) || !(part in (cur as object))) return { found: false };
    cur = (cur as Record<string, unknown>)[part];
  }
  return { found: true, value: cur };
}

async function nameOf(db: FirebaseFirestore.Firestore, collegeId: string, uid: string): Promise<string> {
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    return (snap.data() as { name?: string } | undefined)?.name ?? "R&D Coordinator";
  } catch {
    return "R&D Coordinator";
  }
}

function unauthorized(err: unknown) {
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET() {
  try {
    const session = await requireCollegeMember("RND_COORDINATOR");
    const db = getAdminDb();
    const departments = await getCoordinatorDepartments(db, session.collegeId, session.uid);
    if (departments.length === 0) return NextResponse.json({ departments, items: [] });

    const college = db.collection("colleges").doc(session.collegeId);
    const results = await Promise.all(
      Object.entries(REVIEWABLE_MODULES).map(async ([module, cfg]) => {
        // Firestore `in` takes at most 30 values - a coordinator holds a handful of seats at most.
        const snap = await college.collection(cfg.collection).where("reviewDepartment", "in", departments.slice(0, 30)).get();
        return snap.docs.map((d) => ({ module, moduleLabel: cfg.label, id: d.id, record: { id: d.id, ...d.data() } as Record<string, unknown> }));
      })
    );
    const ms = (v: unknown) => (v as { toMillis?(): number })?.toMillis?.() ?? (v instanceof Date ? v.getTime() : 0);
    const items = results.flat().sort((a, b) => ms(b.record.createdAt) - ms(a.record.createdAt));
    return NextResponse.json({ departments, items });
  } catch (err) {
    const res = unauthorized(err);
    if (res) return res;
    console.error("[college/research-review GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface ReviewBody {
  module?: string;
  id?: string;
  action?: "FORWARD" | "SEND_BACK" | "REJECT" | "EDIT";
  reason?: string;
  // Field path -> new value. Dotted paths reach into nested objects (e.g. details.title).
  edits?: Record<string, unknown>;
}

export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember("RND_COORDINATOR");
    const body = (await request.json()) as ReviewBody;
    const cfg = body.module ? REVIEWABLE_MODULES[body.module] : undefined;
    if (!cfg || !body.id || !body.action) {
      return NextResponse.json({ error: "module, id and action are required" }, { status: 400 });
    }
    const reason = body.reason?.trim() ?? "";
    if ((body.action === "SEND_BACK" || body.action === "REJECT") && !reason) {
      return NextResponse.json({ error: "A reason is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const departments = await getCoordinatorDepartments(db, session.collegeId, session.uid);
    const ref = db.collection("colleges").doc(session.collegeId).collection(cfg.collection).doc(body.id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Record not found" }, { status: 404 });
    const rec = snap.data() as Record<string, unknown> & { uid?: string; title?: string; reviewDepartment?: string; status?: string };

    const inScope = !!rec.reviewDepartment && departments.some((d) => d.trim().toLowerCase() === rec.reviewDepartment!.trim().toLowerCase());
    if (!inScope) return NextResponse.json({ error: "This record isn't from a department you coordinate" }, { status: 403 });
    if (rec.status !== "COORDINATOR_REVIEW") {
      return NextResponse.json({ error: "This record is no longer awaiting coordinator review" }, { status: 409 });
    }

    const now = new Date();
    const coordinatorName = await nameOf(db, session.collegeId, session.uid);
    const updates: Record<string, unknown> = { updatedAt: now };

    // Edits are applied first so a "forward" carries the corrected values.
    const editedFields: string[] = [];
    for (const [path, value] of Object.entries(body.edits ?? {})) {
      if (PROTECTED.has(path.split(".")[0])) continue;
      const current = readPath(rec, path);
      // Only existing scalar fields, and only to a value of the same kind: this
      // is a correction tool, not a way to reshape a record.
      if (!current.found || !isScalar(current.value) || !isScalar(value)) continue;
      if (current.value !== null && value !== null && typeof current.value !== typeof value) continue;
      if (current.value === value) continue;
      updates[path] = value;
      editedFields.push(path);
    }
    if (editedFields.length > 0) {
      updates.coordinatorEdits = FieldValue.arrayUnion({
        at: now, by: session.uid, byName: coordinatorName, fields: editedFields,
      });
    }

    const title = rec.title ?? cfg.label;
    if (body.action === "FORWARD") {
      Object.assign(updates, {
        status: "PENDING",
        coordinatorReviewedBy: session.uid, coordinatorReviewedByName: coordinatorName, coordinatorReviewedAt: now,
        ...(reason ? { coordinatorNote: reason } : {}),
      });
    } else if (body.action === "SEND_BACK") {
      Object.assign(updates, {
        status: "SENT_BACK", sentBackReason: reason,
        coordinatorReviewedBy: session.uid, coordinatorReviewedByName: coordinatorName, coordinatorReviewedAt: now,
      });
    } else if (body.action === "REJECT") {
      Object.assign(updates, {
        status: "REJECTED", rejectionReason: reason,
        reviewedBy: session.uid, reviewedByName: coordinatorName, reviewedAt: now,
        coordinatorReviewedBy: session.uid, coordinatorReviewedByName: coordinatorName, coordinatorReviewedAt: now,
      });
    } else if (body.action !== "EDIT") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    if (body.action === "EDIT" && editedFields.length === 0) {
      return NextResponse.json({ error: "No changes to save" }, { status: 400 });
    }

    await ref.update(updates);

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "RD_COORDINATOR_REVIEWED",
      performedBy: session.uid,
      performedByName: coordinatorName,
      targetId: body.id,
      details: { module: body.module, title, action: body.action, ...(editedFields.length ? { edited: editedFields } : {}) },
      timestamp: now,
    });

    if (body.action === "FORWARD") {
      await notifyRole(
        db, session.collegeId, "R_AND_D",
        "RESEARCH_PENDING_VERIFICATION",
        `${cfg.label} verified by ${rec.reviewDepartment} coordinator`,
        `"${title}" was checked by ${coordinatorName} and is ready for your approval`,
        `/r-and-d/${cfg.slug}`
      );
      if (rec.uid) {
        await notify(db, session.collegeId, rec.uid, "RESEARCH_COORDINATOR_REVIEWED", `${cfg.label} sent to R&D`,
          `"${title}" was verified by your R&D Coordinator and forwarded to R&D for final approval`);
      }
    } else if (body.action === "SEND_BACK" && rec.uid) {
      await notify(db, session.collegeId, rec.uid, "RESEARCH_COORDINATOR_REVIEWED", `${cfg.label} sent back for changes`,
        `"${title}" was sent back by ${coordinatorName}: ${reason}. Edit it and it will go for review again.`);
    } else if (body.action === "REJECT" && rec.uid) {
      await notify(db, session.collegeId, rec.uid, "RESEARCH_COORDINATOR_REVIEWED", `${cfg.label} rejected`,
        `"${title}" was rejected by ${coordinatorName}: ${reason}`);
    }

    return NextResponse.json({ ok: true, edited: editedFields });
  } catch (err) {
    const res = unauthorized(err);
    if (res) return res;
    console.error("[college/research-review PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
