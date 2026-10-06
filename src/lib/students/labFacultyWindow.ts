import type { Firestore } from "firebase-admin/firestore";
import type { LabFacultyWindow, SectionLabFacultyWindows } from "@/types";

// Per section and lab: which dates each of its faculty teaches it (see
// SectionLabFacultyWindows). Nothing set = everyone teaches it throughout.

export const LAB_FACULTY_WINDOWS = "sectionLabFacultyWindows";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const labWindowId = (sectionId: string, subjectId: string) => `${sectionId}_${subjectId}`;

/** settingId (`${sectionId}_${subjectId}`) -> facultyId -> that faculty's dates. */
export type LabWindows = Map<string, Record<string, LabFacultyWindow>>;

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Validates faculty -> window: real dates, from <= to, and no two faculty overlapping
 * (they take the lab in turn). An empty/absent window means "throughout" and is dropped.
 */
export function normalizeWindows(
  input: Record<string, { from?: string | null; to?: string | null } | null | undefined>,
): { ok: true; windows: Record<string, LabFacultyWindow> } | { ok: false; error: string } {
  const windows: Record<string, LabFacultyWindow> = {};
  for (const [facultyId, w] of Object.entries(input ?? {})) {
    const from = (w?.from ?? "").trim();
    const to = (w?.to ?? "").trim();
    if (!from && !to) continue;
    if (!from || !to) return { ok: false, error: "Give both a From and a To date, or leave both empty" };
    if (!isRealDate(from) || !isRealDate(to)) return { ok: false, error: "Dates must be real dates" };
    if (from > to) return { ok: false, error: `From date ${from} is after To date ${to}` };
    windows[facultyId] = { from, to };
  }
  const entries = Object.entries(windows).sort((a, b) => a[1].from.localeCompare(b[1].from));
  for (let i = 1; i < entries.length; i++) {
    if (entries[i][1].from <= entries[i - 1][1].to) {
      return { ok: false, error: "Two faculty of one lab cannot have overlapping dates" };
    }
  }
  return { ok: true, windows };
}

export async function loadLabWindows(
  db: Firestore,
  collegeId: string,
  pairs: { sectionId?: string; subjectId?: string }[],
): Promise<LabWindows> {
  const ids = Array.from(new Set(
    pairs.filter((p) => p.sectionId && p.subjectId).map((p) => labWindowId(p.sectionId as string, p.subjectId as string)),
  ));
  const out: LabWindows = new Map();
  if (ids.length === 0) return out;
  const col = db.collection("colleges").doc(collegeId).collection(LAB_FACULTY_WINDOWS);
  const snaps = await db.getAll(...ids.map((id) => col.doc(id)));
  for (const s of snaps) {
    if (!s.exists) continue;
    const w = (s.data() as SectionLabFacultyWindows).windowByFaculty ?? {};
    if (Object.keys(w).length > 0) out.set(s.id, w);
  }
  return out;
}

/** True unless this faculty has dates for the lab and `date` ("YYYY-MM-DD") falls outside them. */
export function facultyActiveOn(
  windows: LabWindows,
  sectionId: string | undefined,
  subjectId: string | undefined,
  facultyId: string | undefined,
  date: string,
): boolean {
  if (!sectionId || !subjectId || !facultyId) return true;
  const w = windows.get(labWindowId(sectionId, subjectId))?.[facultyId];
  if (!w) return true;
  return date >= w.from && date <= w.to;
}

/** True unless this faculty has dates for the lab and NONE of the given dates fall inside them. */
export function facultyActiveOnAny(
  windows: LabWindows,
  sectionId: string | undefined,
  subjectId: string | undefined,
  facultyId: string | undefined,
  dates: readonly string[],
): boolean {
  return dates.some((d) => facultyActiveOn(windows, sectionId, subjectId, facultyId, d));
}
