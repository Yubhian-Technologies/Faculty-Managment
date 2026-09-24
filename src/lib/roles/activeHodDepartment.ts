// A head of several departments works in ONE of them at a time, picked in the
// "Working as" switcher ("HOD - CSE"). The pick travels to the server in this
// cookie; the server only ever uses it to NARROW the departments the person
// already heads, never to widen them, so it is safe for the browser to set.
export const ACTIVE_HOD_DEPT_COOKIE = "fms_hod_dept";
export const HOD_CONTEXT_PREFIX = "HOD:";

export function hodContextKey(department: string): string {
  return `${HOD_CONTEXT_PREFIX}${department}`;
}

export function departmentOfContext(key: string | null | undefined): string | null {
  return key && key.startsWith(HOD_CONTEXT_PREFIX) ? key.slice(HOD_CONTEXT_PREFIX.length) : null;
}

export function encodeActiveHodDepartment(uid: string, department: string): string {
  return encodeURIComponent(`${uid}|${department}`);
}

export function decodeActiveHodDepartment(raw: string | undefined, uid: string): string | null {
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

// Server only. Narrows `ownDepartmentNames` to the department picked in the
// switcher when that pick is one of them and was made by this same login.
export async function narrowToActiveHodDepartment(uid: string, ownDepartmentNames: string[]): Promise<string[]> {
  if (ownDepartmentNames.length < 2) return ownDepartmentNames;
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const picked = decodeActiveHodDepartment(jar.get(ACTIVE_HOD_DEPT_COOKIE)?.value, uid);
    return picked && ownDepartmentNames.includes(picked) ? [picked] : ownDepartmentNames;
  } catch {
    return ownDepartmentNames;
  }
}
