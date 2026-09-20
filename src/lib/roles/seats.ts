import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getAdminAuth } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";
import { ROLE_LABELS, ROLE_LEVEL } from "@/types/core";
import type { UserRole } from "@/types/core";
import type { OutgoingHolderAction, RoleSeat, RoleSeatHistoryEntry } from "@/types/roleSeats";
import {
  PRIMARY_ROLE_CHOICES, SEAT_ROLES, canHoldSeat, isSeatRole, isSingletonSeatRole, normalizeStoredRole, roleMatchesSeat, seatNeedsDepartment,
} from "@/lib/roles/seatRoles";

// Server-side seat management - see types/roleSeats.ts for the model. The one
// invariant everything here protects: a seat has at most one holder, every
// change of holder is recorded in the seat's history, and nothing the previous
// holder did is touched (department data, approvals and audit entries all hang
// off the seat / department, not the person).

export class SeatError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface SeatActor { uid: string; name: string }

export const seatsCol = (db: Firestore, collegeId: string) =>
  db.collection("colleges").doc(collegeId).collection("roleSeats");
const usersCol = (db: Firestore, collegeId: string) =>
  db.collection("colleges").doc(collegeId).collection("users");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function seatSort(a: RoleSeat, b: RoleSeat): number {
  return (ROLE_LEVEL[a.role] ?? 99) - (ROLE_LEVEL[b.role] ?? 99) || a.label.localeCompare(b.label);
}

export async function listSeats(db: Firestore, collegeId: string): Promise<RoleSeat[]> {
  const snap = await seatsCol(db, collegeId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RoleSeat).filter((s) => s.isActive !== false).sort(seatSort);
}

export async function listSeatHistory(db: Firestore, collegeId: string, seatId: string): Promise<RoleSeatHistoryEntry[]> {
  const snap = await seatsCol(db, collegeId).doc(seatId).collection("history").get();
  const ms = (v: unknown) => (v as { toMillis?(): number })?.toMillis?.() ?? 0;
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as RoleSeatHistoryEntry)
    .sort((a, b) => ms(b.from) - ms(a.from));
}

function normalizeRoleEmail(raw: string | undefined): string | undefined {
  const v = raw?.trim().toLowerCase();
  if (!v) return undefined;
  if (!EMAIL_RE.test(v)) throw new SeatError("Enter a valid role email address");
  return v;
}

export async function createSeat(
  db: Firestore,
  collegeId: string,
  input: { role: string; departmentId?: string; label?: string; roleEmail?: string },
  actor: SeatActor
): Promise<string> {
  if (!isSeatRole(input.role)) throw new SeatError("That role can't be a seat");
  const role = input.role as UserRole;
  const existing = await listSeats(db, collegeId);
  const roleEmail = normalizeRoleEmail(input.roleEmail);
  if (roleEmail && existing.some((s) => s.roleEmail === roleEmail)) {
    throw new SeatError("Another seat already uses that role email");
  }

  let label = input.label?.trim() || ROLE_LABELS[role];
  let departmentId: string | undefined;
  let departmentName: string | undefined;

  if (seatNeedsDepartment(role)) {
    if (!input.departmentId) throw new SeatError("Pick the department this HOD seat belongs to");
    const deptSnap = await db.collection("colleges").doc(collegeId).collection("departments").doc(input.departmentId).get();
    if (!deptSnap.exists) throw new SeatError("Department not found");
    departmentName = (deptSnap.data() as { name?: string }).name ?? "";
    departmentId = deptSnap.id;
    if (existing.some((s) => s.role === "HOD" && s.departmentId === departmentId)) {
      throw new SeatError(`${departmentName} already has an HOD seat`);
    }
    label = `${ROLE_LABELS.HOD} - ${departmentName}`;
  } else if (isSingletonSeatRole(role)) {
    if (existing.some((s) => s.role === role)) throw new SeatError(`There is already a ${ROLE_LABELS[role]} seat`);
  } else if (existing.some((s) => s.role === role && s.label.toLowerCase() === label.toLowerCase())) {
    throw new SeatError(`A "${label}" seat already exists - give this one a different name`);
  }

  const now = new Date();
  const ref = await seatsCol(db, collegeId).add({
    collegeId, role, label,
    ...(departmentId ? { departmentId, departmentName } : {}),
    ...(roleEmail ? { roleEmail } : {}),
    holderUid: null, holderName: "",
    isActive: true, createdAt: now, updatedAt: now,
  });
  await auditSeat(db, collegeId, "ROLE_SEAT_CREATED", actor, ref.id, { label, ...(roleEmail ? { roleEmail } : {}) });
  return ref.id;
}

export async function updateSeat(
  db: Firestore,
  collegeId: string,
  seatId: string,
  input: { roleEmail?: string | null; label?: string },
  actor: SeatActor
): Promise<void> {
  const ref = seatsCol(db, collegeId).doc(seatId);
  const snap = await ref.get();
  if (!snap.exists) throw new SeatError("Seat not found", 404);
  const seat = snap.data() as RoleSeat;
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (input.roleEmail !== undefined) {
    const roleEmail = input.roleEmail === null ? undefined : normalizeRoleEmail(input.roleEmail);
    if (roleEmail) {
      const others = await listSeats(db, collegeId);
      if (others.some((s) => s.id !== seatId && s.roleEmail === roleEmail)) {
        throw new SeatError("Another seat already uses that role email");
      }
      updates.roleEmail = roleEmail;
    } else {
      updates.roleEmail = FieldValue.delete();
    }
  }
  // A department's HOD seat is always named after the department.
  if (input.label !== undefined && !seatNeedsDepartment(seat.role) && input.label.trim()) {
    updates.label = input.label.trim();
  }
  await ref.update(updates);
  await auditSeat(db, collegeId, "ROLE_SEAT_UPDATED", actor, seatId, { label: seat.label, changed: Object.keys(updates).filter((k) => k !== "updatedAt") });
}

// Recomputes everything a person's own record needs from the seats they hold
// right now: the list of seat ids/roles that guards and lookups read, and - for
// HOD seats - the `departments` list the existing HOD scoping
// (lib/departments/scope.ts) is built on. Safe to call any time; it's derived
// purely from the seats collection.
export async function syncHolderAccess(db: Firestore, collegeId: string, uid: string): Promise<void> {
  const userRef = usersCol(db, collegeId).doc(uid);
  const [seatsSnap, userSnap] = await Promise.all([
    seatsCol(db, collegeId).where("holderUid", "==", uid).get(),
    userRef.get(),
  ]);
  if (!userSnap.exists) return;
  const user = userSnap.data() as { role?: string; department?: string };
  const seats = seatsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as RoleSeat).filter((s) => s.isActive !== false);

  const hodNames = Array.from(new Set(seats.filter((s) => s.role === "HOD" && s.departmentName).map((s) => s.departmentName as string)));
  const updates: Record<string, unknown> = {
    seatIds: seats.map((s) => s.id),
    seatRoles: Array.from(new Set(seats.map((s) => s.role))),
    updatedAt: new Date(),
  };
  if (hodNames.length > 0) {
    updates.departments = hodNames;
    // Legacy fields expect the HOD's own department here; never overwrite a
    // department a faculty member already belongs to.
    if (!user.department) updates.department = hodNames[0];
  } else if (normalizeStoredRole(user.role ?? "") !== "HOD") {
    updates.departments = FieldValue.delete();
  }
  await userRef.update(updates);
}

async function retireAccount(db: Firestore, collegeId: string, uid: string, action: OutgoingHolderAction): Promise<void> {
  const now = new Date();
  const userRef = usersCol(db, collegeId).doc(uid);
  if (action.action === "DEACTIVATE") {
    await userRef.update({ isActive: false, updatedAt: now });
  } else {
    await userRef.update({ role: action.role, updatedAt: now });
    await db.collection("systemUsers").doc(uid).set({ role: action.role }, { merge: true });
  }
  // Best-effort: the Firestore change above is what the app enforces (live
  // role lookup); this additionally stops the old login/token from being used.
  try {
    const auth = await getAdminAuth();
    if (action.action === "DEACTIVATE") await auth.updateUser(uid, { disabled: true });
    else await auth.setCustomUserClaims(uid, { role: action.role, collegeId });
    await auth.revokeRefreshTokens(uid);
  } catch { /* non-fatal */ }
}

// Puts `input.uid` in the seat (or empties it when null), closing the previous
// holder's history entry and opening a new one. The seat's own data is never
// touched, so whoever sits in it next inherits everything.
export async function assignSeat(
  db: Firestore,
  collegeId: string,
  seatId: string,
  input: { uid: string | null; outgoing?: OutgoingHolderAction; note?: string },
  actor: SeatActor
): Promise<void> {
  const seatRef = seatsCol(db, collegeId).doc(seatId);
  const seatSnap = await seatRef.get();
  if (!seatSnap.exists) throw new SeatError("Seat not found", 404);
  const seat = { id: seatSnap.id, ...seatSnap.data() } as RoleSeat;
  if (seat.isActive === false) throw new SeatError("This seat is no longer active");

  const outgoingUid = seat.holderUid;
  if (input.uid && input.uid === outgoingUid) throw new SeatError("That person already holds this seat");
  if (!input.uid && !outgoingUid) throw new SeatError("This seat is already empty");

  let newHolder: { uid: string; name: string } | null = null;
  if (input.uid) {
    const snap = await usersCol(db, collegeId).doc(input.uid).get();
    const u = snap.data() as { name?: string; role?: string; isActive?: boolean } | undefined;
    if (!snap.exists || !u) throw new SeatError("That person was not found in this college", 404);
    if (u.isActive === false) throw new SeatError("That person's account is inactive");
    if (["STUDENT", "CLASS_LEADER"].includes(normalizeStoredRole(u.role ?? ""))) {
      throw new SeatError("Students can't hold a seat");
    }
    if (!canHoldSeat(u.role ?? "", seat.role)) {
      throw new SeatError(`${ROLE_LABELS[seat.role]} seats can only be held by teaching faculty`);
    }
    newHolder = { uid: input.uid, name: u.name ?? "Unknown" };
  }

  // The outgoing holder's account might BE the role (an old role-based login
  // whose own role is this seat's role). Once nobody uses it as that any more
  // it has to become something else - or be retired - so we need to be told
  // which. A holder who simply carries this seat on top of their own primary
  // role needs nothing: their faculty/staff account is untouched.
  let outgoingAction: OutgoingHolderAction | null = null;
  if (outgoingUid) {
    const outSnap = await usersCol(db, collegeId).doc(outgoingUid).get();
    const out = outSnap.data() as { role?: string } | undefined;
    if (outSnap.exists && roleMatchesSeat(out?.role ?? "", seat.role)) {
      const stillHolds = await seatsCol(db, collegeId).where("holderUid", "==", outgoingUid).get();
      const holdsAnotherOfSameRole = stillHolds.docs.some((d) => d.id !== seatId && (d.data() as RoleSeat).role === seat.role);
      if (!holdsAnotherOfSameRole) {
        if (!input.outgoing) throw new SeatError("OUTGOING_ACTION_REQUIRED");
        if (input.outgoing.action === "SET_PRIMARY" && !PRIMARY_ROLE_CHOICES.includes(input.outgoing.role)) {
          throw new SeatError("Pick faculty, supporting staff or office as their role from now on");
        }
        outgoingAction = input.outgoing;
      }
    }
  }

  const now = new Date();
  const histCol = seatRef.collection("history");
  const newHistRef = newHolder ? histCol.doc() : null;
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(seatRef);
    if ((fresh.data() as RoleSeat | undefined)?.holderUid !== outgoingUid) {
      throw new SeatError("This seat was changed by someone else - reload and try again", 409);
    }
    if (seat.openHistoryId) tx.update(histCol.doc(seat.openHistoryId), { to: now });
    if (newHolder && newHistRef) {
      tx.set(newHistRef, {
        seatId, seatLabel: seat.label, role: seat.role, uid: newHolder.uid, name: newHolder.name,
        from: now, to: null, assignedBy: actor.uid, assignedByName: actor.name,
        ...(input.note ? { note: input.note } : {}),
      });
      tx.update(seatRef, {
        holderUid: newHolder.uid, holderName: newHolder.name, holderSince: now, openHistoryId: newHistRef.id, updatedAt: now,
      });
    } else {
      tx.update(seatRef, {
        holderUid: null, holderName: "", holderSince: FieldValue.delete(), openHistoryId: FieldValue.delete(), updatedAt: now,
      });
    }
  });

  // HOD seat: keep the department's own pointer (used by budget, recruitment,
  // indents and every "notify the HOD" path) on whoever now sits in it.
  if (seat.role === "HOD" && seat.departmentId) {
    await db.collection("colleges").doc(collegeId).collection("departments").doc(seat.departmentId)
      .update({ hodUid: newHolder?.uid ?? "", hodName: newHolder?.name ?? "", updatedAt: now }).catch(() => {});
  }

  if (outgoingUid && outgoingAction) await retireAccount(db, collegeId, outgoingUid, outgoingAction);
  if (outgoingUid) await syncHolderAccess(db, collegeId, outgoingUid);
  if (newHolder) await syncHolderAccess(db, collegeId, newHolder.uid);

  await auditSeat(db, collegeId, newHolder ? "ROLE_SEAT_ASSIGNED" : "ROLE_SEAT_VACATED", actor, seatId, {
    seat: seat.label,
    ...(newHolder ? { to: newHolder.name } : {}),
    ...(seat.holderName ? { from: seat.holderName } : {}),
    ...(outgoingAction ? { outgoingAccount: outgoingAction.action } : {}),
  });
  if (newHolder) {
    await notify(
      db, collegeId, newHolder.uid, "ROLE_SEAT_ASSIGNED", `You are now ${seat.label}`,
      `${actor.name} has appointed you as ${seat.label}. Refresh the page (or sign in again) to see its modules in your dashboard.`
    );
  }
  if (outgoingUid) {
    await notify(
      db, collegeId, outgoingUid, "ROLE_SEAT_REMOVED", `You are no longer ${seat.label}`,
      `${actor.name} has ${newHolder ? `handed ${seat.label} to ${newHolder.name}` : `vacated ${seat.label}`}. Its modules have been removed from your dashboard; your own profile and history are unchanged.`
    );
  }
}

export async function deactivateSeat(db: Firestore, collegeId: string, seatId: string, actor: SeatActor): Promise<void> {
  const ref = seatsCol(db, collegeId).doc(seatId);
  const snap = await ref.get();
  if (!snap.exists) throw new SeatError("Seat not found", 404);
  const seat = snap.data() as RoleSeat;
  if (seat.holderUid) throw new SeatError("Empty the seat before removing it");
  await ref.update({ isActive: false, updatedAt: new Date() });
  await auditSeat(db, collegeId, "ROLE_SEAT_REMOVED", actor, seatId, { seat: seat.label });
}

// Existing HOD / Principal / VP / Dean / ... logins are role-based accounts:
// the account itself IS the role. This turns each into a seat held by that
// account (its login email becomes the seat's role email), so from then on a
// real person can be appointed and the old account retired - without touching
// anything the account did. Idempotent: an account that already holds (or was
// converted into) a seat is skipped.
export async function convertLegacyAccounts(
  db: Firestore,
  collegeId: string,
  actor: SeatActor
): Promise<{ created: number; skipped: string[] }> {
  const [usersSnap, seats, deptsSnap] = await Promise.all([
    usersCol(db, collegeId).where("role", "in", SEAT_ROLES).get(),
    listSeats(db, collegeId),
    db.collection("colleges").doc(collegeId).collection("departments").get(),
  ]);
  const deptByName = new Map(deptsSnap.docs.map((d) => [((d.data() as { name?: string }).name ?? "").trim(), d.id]));
  const skipped: string[] = [];
  let created = 0;
  const now = new Date();
  const touched = new Set<string>();

  for (const doc of usersSnap.docs) {
    const u = doc.data() as { name?: string; email?: string; role?: string; department?: string; departments?: string[]; isActive?: boolean };
    // College Admin is its own seat role - compared raw, not normalized to Principal.
    const role = (u.role === "COLLEGE_ADMIN" ? "COLLEGE_ADMIN" : normalizeStoredRole(u.role ?? "")) as UserRole;
    if (u.isActive === false || !isSeatRole(role)) continue;
    const name = u.name ?? "Unknown";

    type Wanted = { label: string; departmentId?: string; departmentName?: string };
    let wanted: Wanted[] = [];
    if (role === "HOD") {
      const names = (u.departments?.length ? u.departments : [u.department ?? ""]).map((n) => n.trim()).filter(Boolean);
      wanted = names.flatMap((n) => {
        const departmentId = deptByName.get(n);
        return departmentId ? [{ label: `${ROLE_LABELS.HOD} - ${n}`, departmentId, departmentName: n }] : [];
      });
      if (wanted.length === 0) { skipped.push(`${name} (${ROLE_LABELS.HOD}) - department not found`); continue; }
    } else {
      const sameRole = seats.filter((s) => s.role === role);
      wanted = [{ label: isSingletonSeatRole(role) ? ROLE_LABELS[role] : `${ROLE_LABELS[role]} ${sameRole.length + 1}` }];
    }

    for (const w of wanted) {
      const already = seats.find((s) =>
        s.holderUid === doc.id && s.role === role && (w.departmentId ? s.departmentId === w.departmentId : true)
      );
      if (already) continue;
      const clash = w.departmentId
        ? seats.find((s) => s.role === "HOD" && s.departmentId === w.departmentId)
        : isSingletonSeatRole(role) ? seats.find((s) => s.role === role) : undefined;
      if (clash) { skipped.push(`${name} (${w.label}) - seat already exists`); continue; }

      const seatRef = seatsCol(db, collegeId).doc();
      const histRef = seatRef.collection("history").doc();
      const seat = {
        collegeId, role, label: w.label,
        ...(w.departmentId ? { departmentId: w.departmentId, departmentName: w.departmentName } : {}),
        ...(u.email ? { roleEmail: u.email.toLowerCase() } : {}),
        holderUid: doc.id, holderName: name, holderSince: now, openHistoryId: histRef.id, legacyUid: doc.id,
        isActive: true, createdAt: now, updatedAt: now,
      };
      const batch = db.batch();
      batch.set(seatRef, seat);
      batch.set(histRef, {
        seatId: seatRef.id, seatLabel: w.label, role, uid: doc.id, name, from: now, to: null,
        assignedBy: actor.uid, assignedByName: actor.name, note: "Converted from the existing role account",
      });
      await batch.commit();
      seats.push({ id: seatRef.id, ...seat } as unknown as RoleSeat);
      touched.add(doc.id);
      created++;
    }
  }

  for (const uid of touched) await syncHolderAccess(db, collegeId, uid);
  if (created > 0) await auditSeat(db, collegeId, "ROLE_SEATS_CONVERTED", actor, undefined, { created });
  return { created, skipped };
}

async function auditSeat(
  db: Firestore, collegeId: string, action: string, actor: SeatActor, targetId: string | undefined, details: Record<string, unknown>
): Promise<void> {
  await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
    collegeId, action, performedBy: actor.uid, performedByName: actor.name,
    ...(targetId ? { targetId } : {}), details, timestamp: new Date(),
  }).catch(() => {});
}

// ─── Department <-> HOD seat ───────────────────────────────────────────────
// Every department has exactly one HOD seat, created together with the
// department (empty until someone is appointed in Role Assignments). The
// department's own hodUid/hodName pointer is derived from it, never edited.

export async function ensureHodSeatForDepartment(
  db: Firestore,
  collegeId: string,
  dept: { id: string; name: string },
  actor?: SeatActor
): Promise<void> {
  const existing = await seatsCol(db, collegeId).where("role", "==", "HOD").where("departmentId", "==", dept.id).limit(1).get();
  if (!existing.empty) return;
  const now = new Date();
  const label = `${ROLE_LABELS.HOD} - ${dept.name}`;
  const ref = await seatsCol(db, collegeId).add({
    collegeId, role: "HOD", label, departmentId: dept.id, departmentName: dept.name,
    holderUid: null, holderName: "", isActive: true, createdAt: now, updatedAt: now,
  });
  if (actor) await auditSeat(db, collegeId, "ROLE_SEAT_CREATED", actor, ref.id, { label });
}

// A renamed department renames its seat, and the holder's own `departments`
// list (which the HOD scoping reads) follows.
export async function renameDepartmentSeat(db: Firestore, collegeId: string, deptId: string, newName: string): Promise<void> {
  const snap = await seatsCol(db, collegeId).where("role", "==", "HOD").where("departmentId", "==", deptId).get();
  for (const d of snap.docs) {
    await d.ref.update({ departmentName: newName, label: `${ROLE_LABELS.HOD} - ${newName}`, updatedAt: new Date() });
    const holder = (d.data() as RoleSeat).holderUid;
    if (holder) await syncHolderAccess(db, collegeId, holder);
  }
}

// A deleted department takes its seat with it: the holder is released (their
// own account and the seat's history are kept) and the seat retired.
export async function retireDepartmentSeat(db: Firestore, collegeId: string, deptId: string): Promise<void> {
  const snap = await seatsCol(db, collegeId).where("role", "==", "HOD").where("departmentId", "==", deptId).get();
  const now = new Date();
  for (const d of snap.docs) {
    const seat = d.data() as RoleSeat;
    if (seat.openHistoryId) await d.ref.collection("history").doc(seat.openHistoryId).update({ to: now }).catch(() => {});
    await d.ref.update({
      isActive: false, holderUid: null, holderName: "", holderSince: FieldValue.delete(), openHistoryId: FieldValue.delete(), updatedAt: now,
    });
    if (seat.holderUid) await syncHolderAccess(db, collegeId, seat.holderUid);
  }
}

// Department id -> who currently sits in its HOD seat, for every department
// that has one. Authoritative for the department's hodUid/hodName.
export async function hodSeatHoldersByDepartment(
  db: Firestore,
  collegeId: string
): Promise<Map<string, { uid: string; name: string }>> {
  const snap = await seatsCol(db, collegeId).where("role", "==", "HOD").get();
  const out = new Map<string, { uid: string; name: string }>();
  for (const d of snap.docs) {
    const s = d.data() as RoleSeat;
    if (s.isActive === false || !s.departmentId) continue;
    out.set(s.departmentId, { uid: s.holderUid ?? "", name: s.holderName ?? "" });
  }
  return out;
}
