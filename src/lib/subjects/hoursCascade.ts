import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { cachedCollectionDocs } from "@/lib/firestore/sharedReads";
import { getInChunks } from "@/lib/firestore/inQuery";
import { planHoursSync } from "./hoursSync";
import { teachingAssignmentUsesInstance } from "./services/SubjectInstanceService";
import type { Course, Department, TeachingAssignment } from "@/types";

// A teaching assignment copies its semester instance's hoursPerWeek (it caps the
// timetable periods the assignment may hold). When an instance's hours change -
// from an edit of the master subject or of one department's instance - the
// copies must follow, except where that would leave a timetable over its cap
// (hoursSync.ts). One implementation, used by both edits.

export interface HoursTarget {
  /** The instance whose hours are changing. */
  departmentId: string;
  semester: number;
  year?: number;
  /** The instance's new hoursPerWeek (L + T + P). */
  hoursPerWeek: number;
  /** Whether this edit actually changes them (see planHoursSync). */
  hoursChanged: boolean;
}

export interface HoursCascadePlan {
  /** Set when an edit must be refused; nothing should be written. */
  error?: string;
  /** Teaching assignments to bring in step, with the hours to write. */
  sync: { ref: DocumentReference; hoursPerWeek: number }[];
}

export async function planTeachingHoursSync(
  db: Firestore,
  collegeId: string,
  subjectId: string,
  targets: HoursTarget[],
): Promise<HoursCascadePlan> {
  if (targets.length === 0) return { sync: [] };
  const collegeRef = db.collection("colleges").doc(collegeId);
  const [taSnap, deptDocs, courseDocs] = await Promise.all([
    collegeRef.collection("teachingAssignments").where("subjectId", "==", subjectId).get(),
    cachedCollectionDocs(db, collegeId, "departments"),
    cachedCollectionDocs(db, collegeId, "courses"),
  ]);
  if (taSnap.empty) return { sync: [] };
  const departments = deptDocs.map((d) => ({ id: d.id, ...d.data() })) as (Department & { id: string })[];
  const coursesById = new Map(courseDocs.map((d) => [d.id, d.data() as Pick<Course, "departmentId" | "catalogId">]));

  const staleByTarget = targets.map((t) =>
    taSnap.docs.filter((d) => {
      const ta = d.data() as TeachingAssignment;
      return ta.hoursPerWeek !== t.hoursPerWeek
        && teachingAssignmentUsesInstance(ta, { departmentId: t.departmentId, semester: t.semester, year: t.year }, departments, coursesById);
    }),
  );
  const staleIds = Array.from(new Set(staleByTarget.flat().map((d) => d.id)));
  if (staleIds.length === 0) return { sync: [] };

  const slotDocs = await getInChunks(staleIds, (chunk) => collegeRef.collection("timetableSlots").where("assignmentId", "in", chunk));
  const placed = new Map<string, number>();
  for (const s of slotDocs) {
    const id = (s.data() as { assignmentId: string }).assignmentId;
    placed.set(id, (placed.get(id) ?? 0) + 1);
  }

  const sync = new Map<string, { ref: DocumentReference; hoursPerWeek: number }>();
  for (let i = 0; i < targets.length; i++) {
    const stale = staleByTarget[i];
    if (stale.length === 0) continue;
    const plan = planHoursSync(stale.map((d) => ({ id: d.id, placedPeriods: placed.get(d.id) ?? 0 })), targets[i].hoursPerWeek, targets[i].hoursChanged);
    if (plan.blockedIds.length > 0) {
      const blocked = new Set(plan.blockedIds);
      const who = stale.filter((d) => blocked.has(d.id)).slice(0, 3)
        .map((d) => { const t = d.data() as TeachingAssignment; return `${t.facultyName} (${t.sectionName ?? "-"}, ${placed.get(d.id)} periods)`; }).join("; ");
      return { error: `Can't lower hours below the periods already placed on the timetable: ${who}. Remove those periods first.`, sync: [] };
    }
    const ok = new Set(plan.syncIds);
    for (const d of stale) if (ok.has(d.id)) sync.set(d.id, { ref: d.ref, hoursPerWeek: targets[i].hoursPerWeek });
  }
  return { sync: Array.from(sync.values()) };
}
