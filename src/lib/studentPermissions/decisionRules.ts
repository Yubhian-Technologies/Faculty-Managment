import type { StageId } from "@/lib/approvals";
import { oversees } from "./roles";

// Who may decide a permission request at a stage - as a pure function of facts
// the caller gathered, so the rule itself is unit-tested without a database.

export interface DecisionFacts {
  stage: StageId;
  actorUid: string;
  requesterUid: string;
  /** Every role the acting login holds (primary + seats). */
  actorRoles: readonly string[];
  /** For the HOD stage: the actor heads (or manages) the request's department. */
  headsRequestDepartment: boolean;
  /** For the class-incharge stage: the actor is the incharge recorded on the request. */
  isRecordedIncharge: boolean;
  /** For the delegated-faculty stage: the actor is the designated faculty member or department HOD. */
  isDelegatedFaculty?: boolean;
}

export function canDecideStage(f: DecisionFacts): boolean {
  // Nobody decides their own request, whatever else they hold.
  if (f.actorUid === f.requesterUid) return false;
  // The Principal and Vice Principal oversee every request: they may decide it at whatever stage it is waiting,
  // whatever the configured route says (see service.decide - their approval completes the request).
  const overseer = oversees(f.actorRoles);
  switch (f.stage) {
    case "CLASS_INCHARGE": return overseer || f.isRecordedIncharge;
    case "DELEGATED_FACULTY": return overseer || !!f.isDelegatedFaculty || (f.actorRoles.includes("HOD") && f.headsRequestDepartment);
    case "HOD": return overseer || (f.actorRoles.includes("HOD") && f.headsRequestDepartment);
    case "VICE_PRINCIPAL": return overseer;
    case "PRINCIPAL": return overseer;
    default: return false;
  }
}
