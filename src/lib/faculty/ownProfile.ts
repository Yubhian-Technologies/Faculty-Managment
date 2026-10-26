// "One profile per person." A teaching faculty member has ONE profile: the faculty profile (/panel/profile - Employee ID,
// Full Name as per SSC, Edit Details and the tabs, all read from and saved to their faculty record). HODs, Principals and
// Vice Principals are faculty too, yet "My Profile" under their own role (/hod/profile, /principal/profile) used to open a
// second, different page built from the login account (Role, Departments ...), saving to a different document.
//
// Those role pages now hand a person who HAS a faculty record over to the faculty profile; a login without one keeps the
// role page exactly as it was. Nothing is moved, copied or deleted - this only decides which page to open.

import { migrateAcademicProfile } from "@/lib/faculty/fieldRenames";
import { FACULTY_PERSONAL_KEYS } from "@/lib/faculty/singleSource";

const ROLE_PROFILE_PATH = /^\/(hod|principal)\/profile(\/.*)?$/;

/** The faculty-profile address for a role-profile address (same tab, same edit page), or null if it is not one. */
export function ownFacultyProfilePath(pathname: string): string | null {
  const m = ROLE_PROFILE_PATH.exec(pathname);
  if (!m) return null;
  return `/panel/profile${m[2] ?? ""}`;
}

/**
 * Whether this login can use the faculty profile pages: its role is Faculty, or it holds the Faculty role as well (an HOD
 * or Principal who is also faculty - the "My Work" choice in Working as). The faculty profile saves through routes that
 * need that role, so a login without it must keep its own profile page.
 */
export function holdsFacultyRole(role: string | undefined | null, heldRoles: readonly string[] | undefined | null): boolean {
  return role === "PANEL_MEMBER" || (heldRoles ?? []).includes("PANEL_MEMBER");
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

// how many non-blank values a value holds (a row of empty strings holds none; a date counts as one)
function leaves(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "string") return v.trim() ? 1 : 0;
  if (isObj(v) && typeof (v as { toDate?: unknown }).toDate === "function") return 1;
  if (Array.isArray(v)) return v.reduce<number>((n, x) => n + leaves(x), 0);
  if (isObj(v)) return Object.values(v).reduce<number>((n, x) => n + leaves(x), 0);
  return 1;
}

const IDENTITY_KEYS = ["highestQualification", "specialization", "apaarFacultyId", "aicteFacultyId"] as const;

/**
 * The profile details the LOGIN document holds that the faculty record has nothing in. These are what the role page shows
 * and the faculty profile would not: while any exist, the person must keep their role page (nothing may drop out of sight).
 * Returns the names of those details, empty when the faculty record already covers everything the login holds.
 */
export function detailsOnlyInLogin(login: unknown, faculty: unknown): string[] {
  if (!isObj(login)) return [];
  const rec = isObj(faculty) ? faculty : {};
  const out: string[] = [];
  const loginAp = isObj(login.academicProfile) ? (migrateAcademicProfile(login.academicProfile) as Obj) : {};
  const recAp = isObj(rec.academicProfile) ? (migrateAcademicProfile(rec.academicProfile) as Obj) : {};
  for (const k of Object.keys(loginAp)) if (leaves(loginAp[k]) > 0 && leaves(recAp[k]) === 0) out.push(`academicProfile.${k}`);
  for (const k of [...FACULTY_PERSONAL_KEYS, ...IDENTITY_KEYS]) {
    if (leaves(login[k]) > 0 && leaves(rec[k]) === 0) out.push(k);
  }
  return out;
}

export interface OwnProfileLookup {
  pathname: string;
  role: string | undefined | null;
  heldRoles: readonly string[] | undefined | null;
  /** The signed-in login's own document (what the role page shows). Omitted = nothing to protect. */
  login?: unknown;
  /** GET /api/college/faculty/me, resolved to its JSON. Any failure means "stay on this page". */
  fetchMe: () => Promise<{ facultyRecord?: boolean; faculty?: unknown } | null | undefined>;
}

/**
 * Where to go instead of this role-profile page, or null to stay. Goes to the faculty profile only when the page is a role
 * profile, the login holds the Faculty role, a faculty record is actually linked to it (the same signal the faculty profile
 * itself uses), AND the login holds no detail the faculty record lacks. Every failure path returns null, so a problem never
 * strands anyone away from their profile.
 */
export async function resolveOwnProfileTarget(input: OwnProfileLookup): Promise<string | null> {
  const target = ownFacultyProfilePath(input.pathname);
  if (!target) return null;
  if (!holdsFacultyRole(input.role, input.heldRoles)) return null;
  try {
    const me = await input.fetchMe();
    if (me?.facultyRecord !== true) return null;
    // never move someone away from details that exist only on their login document
    if (detailsOnlyInLogin(input.login, me.faculty).length > 0) return null;
    return target;
  } catch {
    return null;
  }
}
