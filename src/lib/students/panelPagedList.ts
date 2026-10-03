import { FieldPath } from "firebase-admin/firestore";
import type { Section, StudentRecord } from "@/types";
import { sortStudentsForList } from "@/lib/students/listOrder";

// Paged roster for a PANEL_MEMBER (faculty in charge of one or more
// sections) - the opt-in `paged=1` shape of college/students GET. Without it
// the route still returns the whole unpaginated `{ students }` list that
// every other caller (attendance, batches page, ...) relies on.
//
// A faculty's roster is a handful of independent equality queries: each
// in-charge section is matched by (department, name, year[, courseId]), once
// on `department` and once on `secondaryDepartment` (a shared-first-year
// student - see the route's own comment). Rather than merging those streams
// (which would over-read up to streams x pageSize docs per page), they are
// drained ONE AFTER ANOTHER: a page reads from the current stream, and only
// if that stream runs dry does it carry on into the next, so a page reads
// exactly `limit` docs.
//
// Each stream is ordered by document id with a bare equality filter set, which
// Firestore serves from its automatic single-field indexes - no composite
// index to deploy. The cursor is `<sectionId>:<p|s>|<lastDocId>`; rows within
// one page are sorted by roll number (see lib/students/listOrder.ts).
//
// The page UI has numbered pages, so a page can be asked for two ways: by
// `cursor` (the page right after one already fetched - reads exactly `limit`
// docs) or by `page` number alone (a jump - per-stream count() aggregations
// locate the stream, then an offset skips into it; Firestore bills the skipped
// docs, so the client only falls back to this when it has no cursor).

interface Stream {
  key: string;
  query: FirebaseFirestore.Query;
}

export type PanelStudent = Omit<StudentRecord, "id"> & { id: string; accessLevel: "primary" | "secondary" };

export interface PanelStudentsPage {
  students: PanelStudent[];
  /** Pass back as `cursor` for the next page; null when this was the last. */
  nextCursor: string | null;
  /** Roster size - only computed on a cursor-less request, null otherwise. */
  total: number | null;
}

function buildStreams(
  studentsColl: FirebaseFirestore.CollectionReference,
  sections: Section[],
  labBatch: string
): Stream[] {
  const ordered = [...sections].sort(
    (a, b) => a.year - b.year || a.name.localeCompare(b.name) || a.department.localeCompare(b.department)
  );
  return ordered.flatMap((s) => {
    const scoped = (deptField: "department" | "secondaryDepartment") => {
      let q: FirebaseFirestore.Query = studentsColl
        .where(deptField, "==", s.department)
        .where("section", "==", s.name)
        .where("year", "==", s.year);
      if (s.courseId) q = q.where("courseId", "==", s.courseId);
      if (labBatch) q = q.where("labBatch", "==", labBatch);
      return q;
    };
    return [
      { key: `${s.id}:p`, query: scoped("department") },
      { key: `${s.id}:s`, query: scoped("secondaryDepartment") },
    ];
  });
}

export async function fetchPanelStudentsPage(
  studentsColl: FirebaseFirestore.CollectionReference,
  sections: Section[],
  opts: { sectionId: string; labBatch: string; limit: number; cursor: string; page: number }
): Promise<PanelStudentsPage> {
  const inScope = opts.sectionId ? sections.filter((s) => s.id === opts.sectionId) : sections;
  const streams = buildStreams(studentsColl, inScope, opts.labBatch);

  let startIdx = 0;
  let after: string | undefined;
  let skip = 0;
  if (opts.cursor) {
    const sep = opts.cursor.lastIndexOf("|");
    const idx = sep > 0 ? streams.findIndex((s) => s.key === opts.cursor.slice(0, sep)) : -1;
    if (idx >= 0) {
      startIdx = idx;
      after = opts.cursor.slice(sep + 1);
    }
  }

  // Count aggregations cost one read per 1000 index entries - a cheap way to
  // show the real roster size, and to locate a page, without loading it.
  let total: number | null = null;
  let counts: number[] = [];
  if (!opts.cursor) {
    counts = (await Promise.all(streams.map((s) => s.query.count().get()))).map((r) => r.data().count);
    total = counts.reduce((n, c) => n + c, 0);
    let remaining = Math.max(0, opts.page - 1) * opts.limit;
    if (remaining >= total) return { students: [], nextCursor: null, total };
    for (let i = 0; i < streams.length; i++) {
      if (remaining >= counts[i]) {
        remaining -= counts[i];
        continue;
      }
      startIdx = i;
      skip = remaining;
      break;
    }
  }

  const students: PanelStudent[] = [];
  const seen = new Set<string>();
  let nextCursor: string | null = null;

  for (let i = startIdx; i < streams.length && students.length < opts.limit; i++) {
    let q = streams[i].query.orderBy(FieldPath.documentId());
    if (i === startIdx && after) q = q.startAfter(after);
    if (i === startIdx && skip > 0) q = q.offset(skip);
    const snap = await q.limit(opts.limit - students.length).get();
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      students.push({ id: d.id, ...(d.data() as Omit<StudentRecord, "id">), accessLevel: "primary" });
    }
    // The stream came back full, so it may hold more - resume right after its
    // last doc. (A stream that came back short is drained; the loop moves on.)
    if (students.length >= opts.limit && snap.docs.length > 0) {
      nextCursor = `${streams[i].key}|${snap.docs[snap.docs.length - 1].id}`;
    }
  }

  sortStudentsForList(students);
  return { students, nextCursor, total };
}
