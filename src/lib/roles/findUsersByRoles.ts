import type { Firestore } from "firebase-admin/firestore";
import { normalizeStoredRole, orderHeldRoles } from "@/lib/roles/seatRoles";

// "Who is the HOD / Principal / Vice Principal ...?" - answered from BOTH places
// a role can live: a user's own primary role, and the seats they hold (see
// types/roleSeats.ts). A plain `where("role", "in", ...)` scan only sees the
// first, so it would miss a faculty member who is the current Principal and
// their notifications / approvals / letters would silently go nowhere. Every
// lookup of a SEAT role (Principal, Vice Principal, HOD, Academics, IQAC, T&P, R&D,
// Placement, Exam Cell, Library) goes through here; roles that are never seats
// (College Office, Accounts, Finance, ...) keep their own simple queries.
//
// Deactivated accounts are left out - a retired role login or a departed
// employee should not receive anything.

export interface RoleMatch {
  doc: FirebaseFirestore.QueryDocumentSnapshot;
  /** The role this user was found under: the seat/primary role that matched. */
  matchedRole: string;
}

export async function findUsersWithMatchedRole(
  db: Firestore,
  collegeId: string,
  roles: string[],
  // `exact` skips the COLLEGE_ADMIN / DEPARTMENT_OFFICE synonyms, for the few
  // places that mean the actual Principal or HOD and not their look-alikes.
  opts: { exact?: boolean } = {}
): Promise<RoleMatch[]> {
  const expanded = Array.from(new Set(roles.flatMap((r) =>
    opts.exact ? [r] : r === "PRINCIPAL" ? ["PRINCIPAL", "COLLEGE_ADMIN"] : r === "HOD" ? ["HOD", "DEPARTMENT_OFFICE"] : [r]
  )));
  // A College Admin seat has the Principal's authority (it normalizes to
  // PRINCIPAL everywhere), so asking for the Principal also finds its holders.
  const seatRoleQuery = !opts.exact && roles.includes("PRINCIPAL") ? Array.from(new Set([...roles, "COLLEGE_ADMIN"])) : roles;
  const users = db.collection("colleges").doc(collegeId).collection("users");
  const [byPrimary, bySeat] = await Promise.all([
    users.where("role", "in", expanded.slice(0, 30)).get(),
    users.where("seatRoles", "array-contains-any", seatRoleQuery.slice(0, 30)).get(),
  ]);

  const seen = new Set<string>();
  const out: RoleMatch[] = [];
  for (const doc of [...byPrimary.docs, ...bySeat.docs]) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    const u = doc.data() as { role?: string; seatRoles?: string[]; isActive?: boolean };
    if (u.isActive === false) continue;
    const held = orderHeldRoles(u.role ?? "", u.seatRoles ?? []);
    const matchedRole = roles.find((r) => held.includes(r)) ?? normalizeStoredRole(u.role ?? "");
    out.push({ doc, matchedRole });
  }
  return out;
}

export async function findUsersByRoles(
  db: Firestore,
  collegeId: string,
  roles: string[],
  opts: { exact?: boolean } = {}
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  return (await findUsersWithMatchedRole(db, collegeId, roles, opts)).map((m) => m.doc);
}

// Same lookup, shaped like a Firestore QuerySnapshot (`.docs`, `.empty`) so a
// call site that used to end in `.where("role", "in", [...]).get()` only
// changes its query line.
export async function findUsersSnapshot(
  db: Firestore,
  collegeId: string,
  roles: string[],
  opts: { exact?: boolean } = {}
): Promise<{ docs: FirebaseFirestore.QueryDocumentSnapshot[]; empty: boolean }> {
  const docs = await findUsersByRoles(db, collegeId, roles, opts);
  return { docs, empty: docs.length === 0 };
}
