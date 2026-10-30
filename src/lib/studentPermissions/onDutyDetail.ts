import type { Firestore } from "firebase-admin/firestore";
import { coversPeriod, loadOnDutyDay } from "@/lib/studentAttendance/onDuty";
import { PERMISSION_STAGE_LABELS, PERMISSION_KIND, type PermissionPayload, type PermissionStage } from "./types";
import { store } from "./wiring";

// Why is this student "On Duty" for this period? Answers from the permission
// record itself (title, who approved it), found through the on-duty day document
// attendance already reads. Read-only: nothing here writes.

export interface OnDutyDetail {
  /** What put the student on duty: an approved permission, or some other source we know nothing more about. */
  source: "PERMISSION" | "OTHER";
  title: string | null;
  category: string | null;
  fromDate: string | null;
  toDate: string | null;
  /** The approval that completed the request (null when the record is gone or has none). */
  grantedBy: { name: string; role: string } | null;
}

const PERMISSION_PREFIX = "permission:";

export async function onDutyDetailsFor(db: Firestore, collegeId: string, date: string, studentId: string, periodNumber: number | undefined): Promise<OnDutyDetail[]> {
  const sources = (await loadOnDutyDay(db, collegeId, date))?.byStudent[studentId] ?? {};
  const out: OnDutyDetail[] = [];
  for (const [sourceId, periods] of Object.entries(sources)) {
    if (!coversPeriod({ [sourceId]: periods }, periodNumber)) continue;
    const req = sourceId.startsWith(PERMISSION_PREFIX) ? await store(db).get<PermissionPayload>(collegeId, sourceId.slice(PERMISSION_PREFIX.length)) : null;
    if (!req || req.kind !== PERMISSION_KIND || req.status !== "APPROVED") { out.push({ source: "OTHER", title: null, category: null, fromDate: null, toDate: null, grantedBy: null }); continue; }
    const approval = [...req.history].reverse().find((h) => h.action === "APPROVE");
    out.push({
      source: "PERMISSION",
      title: req.payload.title,
      category: req.payload.otherCategory || req.payload.categoryLabel,
      fromDate: req.payload.fromDate,
      toDate: req.payload.toDate,
      grantedBy: approval ? { name: approval.actorName, role: approval.stage ? PERMISSION_STAGE_LABELS[approval.stage as PermissionStage] ?? approval.stage : "" } : null,
    });
  }
  return out;
}
