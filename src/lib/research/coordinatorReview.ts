import type { Firestore } from "firebase-admin/firestore";
import { notify, notifyRole } from "@/lib/notify";
import type { PublicationStatus } from "@/types";
import type { RoleSeat } from "@/types/roleSeats";

// Research & Innovation review chain:
//
//   faculty submits -> department's R&D Coordinator (COORDINATOR_REVIEW)
//                   -> R&D (PENDING) -> APPROVED
//
// The coordinator can edit the record, forward it to R&D, send it back to the
// submitter for changes (SENT_BACK) or reject it. A department with no
// coordinator seat filled - or a coordinator submitting their own record -
// skips the coordinator step so nothing gets stuck.

export interface ReviewableModule {
  /** Firestore collection under colleges/{collegeId}. */
  collection: string;
  label: string;
  /** Route segment, matches RESEARCH_MODULES / the faculty module page. */
  slug: string;
}

export const REVIEWABLE_MODULES: Record<string, ReviewableModule> = {
  "publications": { collection: "publications", label: "Publication", slug: "publications" },
  "consultancy-projects": { collection: "consultancyProjects", label: "Consultancy Project", slug: "consultancy-projects" },
  "seed-funding": { collection: "seedFundingProjects", label: "Seed Funding", slug: "seed-funding" },
  "sponsored-projects": { collection: "sponsoredProjects", label: "Sponsored Project", slug: "sponsored-projects" },
  "discovery-innovation": { collection: "discoveryInnovations", label: "Discovery & Innovation (IPR)", slug: "discovery-innovation" },
  "phd-supervision": { collection: "phdSupervisions", label: "Ph.D. Supervision", slug: "phd-supervision" },
  "research-services": { collection: "researchServices", label: "Research Service", slug: "research-services" },
  "hackathons": { collection: "hackathons", label: "Hackathon / Competition", slug: "hackathons" },
  "innovations": { collection: "innovations", label: "Innovation", slug: "innovations" },
};

// Records still with the coordinator, or returned to the submitter, are not
// R&D's to see yet - they only enter R&D's queue once forwarded.
export function isVisibleToRnD(status: string | undefined): boolean {
  return status !== "COORDINATOR_REVIEW" && status !== "SENT_BACK";
}

// A submitter may fix and resubmit a record that was rejected or sent back.
export function isResubmittable(status: string | undefined): boolean {
  return status === "REJECTED" || status === "SENT_BACK";
}

const sameDept = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

async function coordinatorSeats(db: Firestore, collegeId: string): Promise<RoleSeat[]> {
  const snap = await db.collection("colleges").doc(collegeId).collection("roleSeats")
    .where("role", "==", "RND_COORDINATOR").get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as RoleSeat)
    .filter((s) => s.isActive !== false);
}

/** Department names this person coordinates R&D for (empty if none). */
export async function getCoordinatorDepartments(db: Firestore, collegeId: string, uid: string): Promise<string[]> {
  const seats = await coordinatorSeats(db, collegeId);
  return seats
    .filter((s) => s.holderUid === uid && s.departmentName)
    .map((s) => s.departmentName as string);
}

export async function findDepartmentCoordinator(
  db: Firestore, collegeId: string, department: string
): Promise<{ uid: string; name: string } | null> {
  const seats = await coordinatorSeats(db, collegeId);
  const seat = seats.find((s) => s.holderUid && sameDept(s.departmentName, department));
  return seat?.holderUid ? { uid: seat.holderUid, name: seat.holderName ?? "" } : null;
}

async function resolveSubmitterDepartment(db: Firestore, collegeId: string, uid: string): Promise<string | undefined> {
  const college = db.collection("colleges").doc(collegeId);
  const facultySnap = await college.collection("facultyMembers").where("userUid", "==", uid).limit(1).get();
  const fromFaculty = (facultySnap.docs[0]?.data() as { department?: string } | undefined)?.department;
  if (fromFaculty) return fromFaculty;
  const userSnap = await college.collection("users").doc(uid).get();
  return (userSnap.data() as { department?: string } | undefined)?.department || undefined;
}

export interface SubmissionRoute {
  status: PublicationStatus;
  /** Department whose coordinator reviews this - stored so they can be scoped to it. */
  reviewDepartment?: string;
  coordinatorUid?: string;
}

/** Where a fresh (or resubmitted) record goes first. R&D's own entries are already official. */
export async function resolveSubmissionRoute(
  db: Firestore, collegeId: string, submitterUid: string, isRnD: boolean
): Promise<SubmissionRoute> {
  if (isRnD) return { status: "APPROVED" };
  const department = await resolveSubmitterDepartment(db, collegeId, submitterUid);
  if (!department) return { status: "PENDING" };
  const coordinator = await findDepartmentCoordinator(db, collegeId, department);
  if (!coordinator || coordinator.uid === submitterUid) return { status: "PENDING", reviewDepartment: department };
  return { status: "COORDINATOR_REVIEW", reviewDepartment: department, coordinatorUid: coordinator.uid };
}

/** Fields to spread into a document write so it carries its routing. */
export function routeFields(route: SubmissionRoute): Record<string, unknown> {
  return {
    ...(route.reviewDepartment ? { reviewDepartment: route.reviewDepartment } : {}),
    ...(route.coordinatorUid ? { coordinatorUid: route.coordinatorUid } : {}),
  };
}

/** Tells whoever reviews next - the coordinator, or R&D when there is none. */
export async function notifyReviewer(
  db: Firestore, collegeId: string, route: SubmissionRoute,
  n: { type: string; title: string; message: string; rndLink: string }
): Promise<void> {
  if (route.status === "COORDINATOR_REVIEW" && route.coordinatorUid) {
    await notify(db, collegeId, route.coordinatorUid, n.type, n.title, n.message, "/rnd-coordinator");
  } else if (route.status === "PENDING") {
    await notifyRole(db, collegeId, "R_AND_D", n.type, n.title, n.message, n.rndLink);
  }
}
