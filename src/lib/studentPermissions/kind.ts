import type { Transaction } from "firebase-admin/firestore";
import type { ApprovalKind } from "@/lib/approvals";
import { canHodEditDepartment, getHodDepartmentScope } from "@/lib/departments/scope";
import { getFacultyIdCandidates } from "@/lib/faculty/resolveFacultyMemberId";
import {
  addOnDutyInTx, applyOnDutyToExistingSessions, releaseOnDutyFromSessions, removeOnDutyInTx,
} from "@/lib/studentAttendance/onDuty";
import { canDecideStage } from "./decisionRules";
import { PERMISSION_KIND, type PermissionContext, type PermissionPayload } from "./types";

// The student-permission kind for the approvals engine: its stages, who may
// decide them, and what approval DOES. The only thing approval does is tell the
// attendance module (through its neutral on-duty API) that these students are
// away for these periods - nothing here knows how attendance marks are stored.

const sourceOf = (id: string) => `permission:${id}`;

/** Students grouped by (section, year), the unit the attendance sessions are found by. */
function sessionTargets(payload: PermissionPayload) {
  const groups = new Map<string, { section: string; year: number; studentIds: string[] }>();
  for (const s of payload.students) {
    const key = `${s.section}|${s.year}`;
    const g = groups.get(key) ?? { section: s.section, year: s.year, studentIds: [] };
    g.studentIds.push(s.id);
    groups.set(key, g);
  }
  return Array.from(groups.values());
}

export const studentPermissionKind: ApprovalKind<PermissionPayload, PermissionContext, Transaction> = {
  kind: PERMISSION_KIND,

  stageScope: (stage, req) => (stage === "HOD" ? req.scope : stage === "CLASS_INCHARGE" ? req.payload.inchargeUid ?? "none" : "*"),

  async canDecide(ctx, req, stage, actor) {
    let headsRequestDepartment = false;
    if (stage === "HOD" && ctx.actorRoles.includes("HOD")) {
      // activeOnly:false - this is an authorisation question about a SPECIFIC
      // department, not "which department am I working in right now".
      const scope = await getHodDepartmentScope(ctx.db, ctx.collegeId, actor.uid, { activeOnly: false });
      headsRequestDepartment = canHodEditDepartment(scope, req.scope);
    }
    let isRecordedIncharge = false;
    if (stage === "CLASS_INCHARGE" && req.payload.inchargeUid) {
      isRecordedIncharge = (await getFacultyIdCandidates(ctx.db, ctx.collegeId, actor.uid)).includes(req.payload.inchargeUid);
    }
    return canDecideStage({
      stage, actorUid: actor.uid, requesterUid: req.requesterUid, actorRoles: ctx.actorRoles,
      headsRequestDepartment, isRecordedIncharge,
    });
  },

  // A class with no incharge assigned would strand the request at that stage.
  isStageActionable: async (_ctx, req, stage) => (stage === "CLASS_INCHARGE" ? !!req.payload.inchargeUid : true),

  // Committed atomically with the decision: the day documents attendance reads. If
  // this succeeds, any period opened from now on is pre-marked, even if the heavier
  // retro-apply below hits trouble.
  applyInTransaction(tx, ctx, req, change) {
    const cover = {
      sourceId: sourceOf(req.id), dates: req.payload.coverageDates, studentIds: req.payload.students.map((s) => s.id),
    };
    if (change === "APPROVED") addOnDutyInTx(tx, ctx.db, ctx.collegeId, { ...cover, periods: req.payload.periods });
    else removeOnDutyInTx(tx, ctx.db, ctx.collegeId, cover);
  },

  // Sessions that already exist (created, or even submitted, before approval).
  async afterApproved(ctx, req) {
    await applyOnDutyToExistingSessions(ctx.db, ctx.collegeId, { dates: req.payload.coverageDates, periods: req.payload.periods, students: sessionTargets(req.payload) });
  },
  async afterRevoked(ctx, req) {
    await releaseOnDutyFromSessions(ctx.db, ctx.collegeId, { dates: req.payload.coverageDates, students: sessionTargets(req.payload) });
  },
};
