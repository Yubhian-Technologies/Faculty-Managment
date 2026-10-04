import type { StageId } from "@/lib/approvals";

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
}

export function canDecideStage(f: DecisionFacts): boolean {
  // Nobody decides their own request, whatever else they hold.
  if (f.actorUid === f.requesterUid) return false;
  switch (f.stage) {
    case "CLASS_INCHARGE": return f.isRecordedIncharge;
    case "HOD": return f.actorRoles.includes("HOD") && f.headsRequestDepartment;
    case "VICE_PRINCIPAL": return f.actorRoles.includes("VICE_PRINCIPAL");
    case "PRINCIPAL": return f.actorRoles.includes("PRINCIPAL");
    default: return false;
  }
}
