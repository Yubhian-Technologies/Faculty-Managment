import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { assignSeat, seatsCol, SeatError, type SeatActor } from "@/lib/roles/seats";
import { roleMatchesSeat } from "@/lib/roles/seatRoles";
import { notifyRole } from "@/lib/notify";
import { forgetHeldRoles } from "@/lib/auth/liveRoles";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import type { RoleSeat } from "@/types/roleSeats";

export interface VacateSeatsResult {
  /** Seat labels that were vacated. */
  vacated: string[];
  /** Seats deliberately left alone, with the reason (a human must decide). */
  skipped: { seat: string; reason: string }[];
  /** Seats where vacating failed unexpectedly - retry by saving the status again. */
  failed: { seat: string; error: string }[];
}

/**
 * When a faculty member becomes RESIGNED/RETIRED they keep a read-only login but
 * must hold NO seat (HOD, Vice Principal, Academics, ...). This vacates every
 * active seat they hold through the existing seat flow (assignSeat with no
 * holder), so the seat's history is closed, departments.hodUid/hodName are
 * cleared, the holder's seatIds/seatRoles/departments are re-synced, and the
 * ROLE_SEAT_VACATED audit entry + notification are written exactly as for any
 * other vacate.
 *
 * Deliberately NOT done here:
 *  - nothing is ever restored: moving the status back to ACTIVE does not give a
 *    seat back - an admin assigns it again through Role Assignments;
 *  - an OLD ROLE-ACCOUNT (the login's stored role IS the seat's role, e.g. a
 *    legacy HOD login) is skipped and flagged. assignSeat would force a choice
 *    between deactivating the account (disables the Firebase Auth user) and
 *    rewriting its stored role - both are off the table for a read-only exit;
 *  - the Library seat can't be vacated (assignSeat refuses) - reported as skipped.
 * One seat failing never stops the others; nothing here throws. It is idempotent: a person
 * who holds no active seat changes nothing, so the caller re-runs it on every save of an
 * exited faculty member - that is the retry for a failed or skipped vacate.
 */
export async function vacateSeatsOnExit(
  db: Firestore,
  collegeId: string,
  uid: string,
  person: { name: string; status: string },
  actor: SeatActor
): Promise<VacateSeatsResult> {
  const result: VacateSeatsResult = { vacated: [], skipped: [], failed: [] };

  let seats: RoleSeat[] = [];
  let storedRole = "";
  let hasDepartmentOfficePost = false;
  try {
    const [seatsSnap, userSnap] = await Promise.all([
      seatsCol(db, collegeId).where("holderUid", "==", uid).get(),
      db.collection("colleges").doc(collegeId).collection("users").doc(uid).get(),
    ]);
    seats = seatsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as RoleSeat).filter((s) => s.isActive !== false);
    const userData = userSnap.data() as { role?: string; seatRoles?: string[] } | undefined;
    storedRole = userData?.role ?? "";
    hasDepartmentOfficePost = (userData?.seatRoles ?? []).includes("DEPARTMENT_OFFICE");
  } catch (err) {
    result.failed.push({ seat: "(lookup)", error: err instanceof Error ? err.message : String(err) });
    return result;
  }

  for (const seat of seats) {
    if (roleMatchesSeat(storedRole, seat.role)) {
      result.skipped.push({ seat: seat.label, reason: "This login is an old role-account for the seat; an admin must decide what happens to the account" });
      continue;
    }
    try {
      await assignSeat(db, collegeId, seat.id, { uid: null }, actor);
      result.vacated.push(seat.label);
    } catch (err) {
      if (err instanceof SeatError) result.skipped.push({ seat: seat.label, reason: err.message });
      else result.failed.push({ seat: seat.label, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // The Department Office head post is a seat too, but it is NOT in the roleSeats collection: it is
  // granted by putting DEPARTMENT_OFFICE in the person's own users.seatRoles (api/college/department-office).
  // Take that hat away the same way that route's own "stand down" does - arrayRemove, nothing else on the
  // account is touched. A standalone old DEPARTMENT_OFFICE login (its stored role IS the post) is skipped and
  // flagged instead: removing the post from it would mean deactivating the account.
  if (hasDepartmentOfficePost) {
    if (storedRole === "DEPARTMENT_OFFICE") {
      result.skipped.push({ seat: "Department Office head", reason: "This login is an old role-account for the post; an admin must decide what happens to the account" });
    } else {
      try {
        await db.collection("colleges").doc(collegeId).collection("users").doc(uid)
          .update({ seatRoles: FieldValue.arrayRemove("DEPARTMENT_OFFICE"), updatedAt: new Date() });
        forgetHeldRoles(collegeId, uid);
        await writeAuditLogSafe(db, collegeId, { action: "DEPARTMENT_OFFICE_REMOVED", performedBy: actor.uid, performedByName: actor.name, targetId: uid, details: { name: person.name, reason: person.status } });
        result.vacated.push("Department Office head");
      } catch (err) {
        result.failed.push({ seat: "Department Office head", error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  if (result.vacated.length > 0) {
    const title = `${person.name} is ${person.status.toLowerCase()} - seat${result.vacated.length === 1 ? "" : "s"} vacated`;
    const message = `${result.vacated.join(", ")} ${result.vacated.length === 1 ? "is" : "are"} now vacant. Assign a new holder in Role Assignments. ${person.name} keeps read-only access to their own records.`;
    for (const role of ["PRINCIPAL", "VICE_PRINCIPAL"]) {
      try { await notifyRole(db, collegeId, role, "ROLE_SEAT_REMOVED", title, message); } catch { /* best-effort */ }
    }
  }

  return result;
}
