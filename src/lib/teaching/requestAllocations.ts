import type { Firestore } from "firebase-admin/firestore";
import type { FacultyAssignmentRequest, RequestAllocation } from "@/types";

// One Assignment Request can be fulfilled by several faculty (see
// FacultyAssignmentRequest.allocations). A request allocated before that was
// possible carries a single faculty in the flat fields only, so every reader goes
// through requestAllocations() instead of looking at either shape directly.

type RequestLike = Pick<
  FacultyAssignmentRequest,
  "allocations" | "allocatedFacultyId" | "allocatedFacultyName" | "allocatedBy" | "teachingAssignmentId" | "busyPeriods"
>;

export function requestAllocations(r: RequestLike): RequestAllocation[] {
  if (r.allocations && r.allocations.length > 0) return r.allocations;
  if (!r.allocatedFacultyId) return [];
  return [{
    facultyId: r.allocatedFacultyId,
    facultyName: r.allocatedFacultyName ?? "",
    teachingAssignmentId: r.teachingAssignmentId ?? "",
    busyPeriods: r.busyPeriods ?? [],
    ...(r.allocatedBy ? { allocatedBy: r.allocatedBy } : {}),
  }];
}

/** The flat/legacy + query-helper fields that must be written alongside `allocations`, so old readers and array-contains queries keep working. */
export function allocationFields(allocations: RequestAllocation[]) {
  const first = allocations[0];
  return {
    allocations,
    allocatedFacultyId: first?.facultyId ?? null,
    allocatedFacultyName: first?.facultyName ?? null,
    teachingAssignmentId: first?.teachingAssignmentId ?? null,
    busyPeriods: first?.busyPeriods ?? [],
    allocatedFacultyIds: allocations.map((a) => a.facultyId),
    teachingAssignmentIds: allocations.map((a) => a.teachingAssignmentId).filter(Boolean),
  };
}

/** "A, B and C" for messages. */
export function facultyNamesText(allocations: RequestAllocation[]): string {
  const names = allocations.map((a) => a.facultyName).filter(Boolean);
  if (names.length === 0) return "the allocated faculty";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Every teaching assignment a request produced - the ones the requester may not place until the lender closes it. */
export function requestAssignmentIds(r: RequestLike): string[] {
  return requestAllocations(r).map((a) => a.teachingAssignmentId).filter(Boolean);
}

/**
 * The lending department's name when `assignmentId` was lent in through an
 * Assignment Request that department has not yet closed ("Notify department &
 * close") AND has no period on the timetable yet, else null. The requesting side may not place such an assignment yet.
 */
export async function openLendDepartment(db: Firestore, collegeId: string, sectionId: string, assignmentId: string): Promise<string | null> {
  const snap = await db.collection("colleges").doc(collegeId).collection("facultyAssignmentRequests")
    .where("sectionId", "==", sectionId).where("status", "==", "ALLOCATED").get();
  for (const d of snap.docs) {
    const r = d.data() as FacultyAssignmentRequest;
    if (!r.busyClosed && requestAssignmentIds(r).includes(assignmentId)) {
      // Already placed on the timetable (before this rule, or by the lender): not held back.
      const placed = await db.collection("colleges").doc(collegeId).collection("timetableSlots")
        .where("assignmentId", "==", assignmentId).limit(1).get();
      if (!placed.empty) return null;
      return r.targetDepartmentName ?? "The lending department";
    }
  }
  return null;
}
