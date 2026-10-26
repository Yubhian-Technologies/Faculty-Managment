import { downloadResumePdf, fetchResumeHtml } from "@/lib/pdf/downloadResume";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import type { ResumeSectionKey } from "@/lib/pdf/resumeSections";

/**
 * Builds and downloads one faculty member's resume PDF from their register row.
 * Shared by the HOD Faculty Register and the Principal's department faculty
 * list so both produce the identical document.
 *
 * Two enrichments are fetched alongside the row itself; both are non-critical
 * (the resume still generates without them), so a failed lookup is swallowed.
 */
type ResumeRow = Record<string, unknown> & { id?: string; legalName?: string };

async function buildResumeRecord(row: ResumeRow, collegeName: string, sections: ResumeSectionKey[]) {
  let teachingAssignments: unknown[] = [];
  try {
    // Without the record's id the API would answer with the VIEWER's own load.
    if (row.id) {
      const res = await fetch(`/api/college/teaching-assignments?facultyId=${encodeURIComponent(row.id)}`);
      teachingAssignments = ((await res.json()) as { assignments?: unknown[] }).assignments ?? [];
    }
  } catch { /* resume still generates without the live teaching-load table */ }

  let researchPublications: unknown[] = [];
  const researchUid = (row.userUid as string | undefined) ?? (row.uid as string | undefined);
  if (researchUid) {
    try {
      const res = await fetch(`/api/college/publications?uid=${encodeURIComponent(researchUid)}`);
      researchPublications = ((await res.json()) as { publications?: unknown[] }).publications ?? [];
    } catch { /* resume falls back to self-reported publications, if any */ }
  }

  const currentAcademicYear = await fetchCurrentAcademicYear();

  return { ...row, teachingAssignments, researchPublications, collegeName, currentAcademicYear, sections };
}

export async function downloadFacultyResume(row: ResumeRow, collegeName: string, sections: ResumeSectionKey[]): Promise<void> {
  await downloadResumePdf(
    await buildResumeRecord(row, collegeName, sections),
    (row.employeeId as string) || facultyDisplayName(row)
  );
}

/** The same resume as `downloadFacultyResume` builds, as HTML for an on-screen preview. */
export async function previewFacultyResumeHtml(row: ResumeRow, collegeName: string, sections: ResumeSectionKey[]): Promise<string> {
  return fetchResumeHtml(await buildResumeRecord(row, collegeName, sections));
}

/** The college's current academic year ("2026-27"), printed against a current
 *  teaching assignment that stores none of its own. Empty when it can't be
 *  read - the resume then works it out from today's date. */
export async function fetchCurrentAcademicYear(): Promise<string> {
  try {
    const res = await fetch("/api/college/academic-year/current");
    return ((await res.json()) as { label?: string }).label ?? "";
  } catch {
    return "";
  }
}
