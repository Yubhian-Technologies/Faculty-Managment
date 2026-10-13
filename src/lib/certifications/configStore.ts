import type { Firestore } from "firebase-admin/firestore";
import type { RecipientResolver } from "@/types";
import { findUsersByRoles } from "@/lib/roles/findUsersByRoles";
import { canHodEditDepartment, getHodDepartmentScope } from "@/lib/departments/scope";

export interface RecipientContext {
  studentDepartment: string;
}

// The one function every step/branch/issuer "who can act" question goes
// through - the abstraction that keeps transitions.ts/service.ts ignorant of
// WHERE a resolver's answer comes from (a code constant today; a Firestore
// config doc in a later phase would change only this function).
export async function resolveRecipientUids(
  db: Firestore,
  collegeId: string,
  resolver: RecipientResolver,
  context: RecipientContext
): Promise<string[]> {
  if (resolver.kind === "ROLE") {
    const docs = await findUsersByRoles(db, collegeId, [resolver.role]);
    return docs.map((d) => d.id);
  }
  // STUDENT_DEPARTMENT_HOD: the HOD of THIS request's own student department -
  // never every HOD in the college. Resolved via the same department-scoping
  // helper leave/budget/studentPermissions already use, by checking every HOD
  // login's scope rather than trusting a single stored hodUid pointer (an HOD
  // can head more than one department, and a sub-HOD's scope differs from a
  // parent HOD's - see scope.ts's own doc-comments).
  //
  // Discovery goes through findUsersByRoles (not a raw role==="HOD" query) so
  // a faculty login holding the HOD SEAT (role e.g. "PANEL_MEMBER" with
  // seatRoles including "HOD") is found too - a raw primary-role query missed
  // every seat-held HOD, which was silently dropping every certificate
  // request off that department's HOD inbox.
  const hodDocs = await findUsersByRoles(db, collegeId, ["HOD"]);
  const uids: string[] = [];
  for (const doc of hodDocs) {
    const scope = await getHodDepartmentScope(db, collegeId, doc.id, { activeOnly: false });
    if (canHodEditDepartment(scope, context.studentDepartment)) uids.push(doc.id);
  }
  return uids;
}
