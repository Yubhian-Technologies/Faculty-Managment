import type { StudentRecord } from "@/types";
import { fetchSectionStudents, type SectionIdentity } from "@/lib/students/sectionRoster";

// A TTL cache in front of fetchSectionStudents, scoped to the one call site
// that re-reads the exact same roster over and over in a single day:
// opening attendance for a period (student-attendance/route.ts POST). A
// 60-student section has ~7 periods/day, each paying ~60 reads for a roster
// that hasn't changed since the first one - this cuts that to one real read
// per section per TTL window.
//
// TTL must span the WHOLE teaching day from the first fetch, not just the
// gap between two periods: this entry's `at` is only set on a miss (not
// refreshed on a hit - see below), so a TTL shorter than "first period to
// last period" would expire partway through the day and start missing
// again for the later periods, even though the roster never changed. 10
// hours covers a ~7.5h teaching day (09:00-16:30) with margin for a longer
// one, while staying well under the ~16h overnight gap to the next day's
// first period - so no explicit date-awareness is needed to avoid leaking
// into tomorrow.
const TTL_MS = 10 * 60 * 60_000;

// Same tradeoff as lib/auth/liveRoles.ts's role cache, documented there and
// accepted here too: this is an in-process Map, so it only helps when a
// request lands on a warm serverless instance that already holds the entry
// - not a platform-wide guarantee on Vercel. It also means a student
// added/dropped mid-day can take up to TTL_MS (10h, i.e. effectively "for
// the rest of today") to show up on THIS path specifically; every other
// fetchSectionStudents caller (reports, office correction, promote) is
// untouched and always reads live.

interface CacheEntry { at: number; students: (StudentRecord & { id: string })[] }
const cache = new Map<string, CacheEntry>();

function keyFor(collegeId: string, identity: SectionIdentity): string {
  return `${collegeId}/${identity.department}/${identity.sectionName}/${identity.year ?? ""}/${identity.courseId ?? ""}/${identity.labBatch ?? ""}`;
}

export async function fetchSectionStudentsCached(
  collegeRef: FirebaseFirestore.DocumentReference,
  identity: SectionIdentity,
): Promise<(StudentRecord & { id: string })[]> {
  const key = keyFor(collegeRef.id, identity);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.students;

  const students = await fetchSectionStudents(collegeRef, identity);
  cache.set(key, { at: Date.now(), students });
  return students;
}
