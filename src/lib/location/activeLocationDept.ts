// Tracks the active department for a LOCATION_DEPT_HEAD who heads multiple departments.
// The selected department travels via cookie; the server verifies the user actually heads that department.
export const ACTIVE_LOCATION_DEPT_COOKIE = "fms_location_dept";
export const LOCATION_DEPT_CONTEXT_PREFIX = "LOC_DEPT:";

export function locationDeptContextKey(deptId: string): string {
  return `${LOCATION_DEPT_CONTEXT_PREFIX}${deptId}`;
}

export function deptIdOfLocationContext(key: string | null | undefined): string | null {
  return key && key.startsWith(LOCATION_DEPT_CONTEXT_PREFIX)
    ? key.slice(LOCATION_DEPT_CONTEXT_PREFIX.length)
    : null;
}

export function encodeActiveLocationDept(uid: string, deptId: string): string {
  return encodeURIComponent(`${uid}|${deptId}`);
}

export function decodeActiveLocationDept(raw: string | undefined, uid: string): string | null {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    const i = decoded.indexOf("|");
    if (i < 0 || decoded.slice(0, i) !== uid) return null;
    return decoded.slice(i + 1) || null;
  } catch {
    return null;
  }
}

/**
 * Server only. Resolves the active department ID among allowed departments.
 */
export async function narrowToActiveLocationDept(
  uid: string,
  allowedDeptIds: string[]
): Promise<string> {
  if (allowedDeptIds.length <= 1) return allowedDeptIds[0] ?? "";
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const picked = decodeActiveLocationDept(jar.get(ACTIVE_LOCATION_DEPT_COOKIE)?.value, uid);
    return picked && allowedDeptIds.includes(picked) ? picked : allowedDeptIds[0] ?? "";
  } catch {
    return allowedDeptIds[0] ?? "";
  }
}
