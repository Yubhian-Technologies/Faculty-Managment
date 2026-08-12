import type { Firestore } from "firebase-admin/firestore";

// Deliberately its own collection, not a field on the leaveRequests doc - see
// OtherLeaveCategory in src/types/leave.ts for why: nothing outside the
// Principal-only surfaces that explicitly query this collection ever sees a
// category, by construction (there's no field to forget to strip out of some
// other response). Doc id == the leave request's own id (1:1).
export const OTHER_CATEGORIES_COL = (collegeId: string, db: Firestore) =>
  db.collection("colleges").doc(collegeId).collection("otherLeaveCategories");
