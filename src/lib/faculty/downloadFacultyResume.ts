import { downloadResumePdf } from "@/lib/pdf/downloadResume";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import type { ResumeSectionKey } from "@/lib/pdf/resumeSections";

/**
 * Builds and downloads one faculty member's resume PDF from a Faculty Register
 * row - the single implementation behind the Download button on the HOD and
 * Principal faculty lists, so the two can never produce different resumes.
 *
 * Two lookups enrich the row before it is rendered, and both are best-effort:
 * the live teaching-load table (teaching assignments) and the R&D-verified
 * publications. If either request fails the resume still generates, just
 * without that section's live data. Throws only when the PDF itself cannot be
 * produced (e.g. the browser's Firebase session needs a refresh).
 */
export async function downloadFacultyResume(
  row: Record<string, unknown>,
  opts: { collegeName: string; sections: ResumeSectionKey[] }
): Promise<void> {
  let teachingAssignments: unknown[] = [];
  try {
    const res = await fetch(`/api/college/teaching-assignments?facultyId=${encodeURIComponent(row.id as string)}`);
    const data = (await res.json()) as { assignments?: unknown[] };
    teachingAssignments = data.assignments ?? [];
  } catch { /* non-critical - resume still generates without the live teaching-load table */ }

  let researchPublications: unknown[] = [];
  const researchUid = (row.userUid as string | undefined) ?? (row.uid as string | undefined);
  if (researchUid) {
    try {
      const res = await fetch(`/api/college/publications?uid=${encodeURIComponent(researchUid)}`);
      const data = (await res.json()) as { publications?: unknown[] };
      researchPublications = data.publications ?? [];
    } catch { /* non-critical - resume falls back to self-reported publications, if any */ }
  }

  await downloadResumePdf(
    { ...row, teachingAssignments, researchPublications, collegeName: opts.collegeName, sections: opts.sections },
    (row.employeeId as string) || facultyDisplayName(row as Parameters<typeof facultyDisplayName>[0])
  );
}
