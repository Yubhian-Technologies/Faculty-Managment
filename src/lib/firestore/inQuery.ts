import type { FieldPath, QueryDocumentSnapshot, WhereFilterOp } from "firebase-admin/firestore";

// Firestore allows at most 30 values in one `in` / `array-contains-any`. Code
// that does `.where(field, "in", values.slice(0, 30))` silently drops every
// value past the 30th - the rows for them just never appear. These helpers
// run the query once per chunk of 30 instead and merge the results.

export const IN_QUERY_LIMIT = 30;

export function chunkValues<T>(values: readonly T[], size: number = IN_QUERY_LIMIT): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

interface DocLike { id: string }
interface SnapLike<D extends DocLike> { docs: D[] }

/**
 * Runs `build(chunk).get()` for every chunk of `values` and returns the union
 * of the documents, de-duplicated by id (first occurrence wins), in chunk
 * order. An empty `values` runs nothing and returns [].
 */
export async function getInChunks<D extends DocLike>(
  values: readonly string[],
  build: (chunk: string[]) => { get(): Promise<SnapLike<D>> }
): Promise<D[]> {
  const unique = Array.from(new Set(values));
  if (unique.length === 0) return [];
  const snaps = await Promise.all(chunkValues(unique).map((chunk) => build(chunk).get()));
  return mergeDocs(snaps.map((s) => s.docs));
}

function mergeDocs<D extends DocLike>(lists: D[][]): D[] {
  const seen = new Set<string>();
  const out: D[] = [];
  for (const list of lists) {
    for (const d of list) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push(d);
    }
  }
  return out;
}

/** What route code needs from a query it keeps narrowing and finally reads. */
export interface QueryLike {
  where(field: string | FieldPath, op: WhereFilterOp, value: unknown): QueryLike;
  get(): Promise<{ docs: QueryDocumentSnapshot[]; empty: boolean }>;
}

type Narrowing = (q: QueryLike) => QueryLike;

/**
 * An `in` query over MORE than 30 values: behaves like a query (further
 * .where() filters apply to every chunk, .get() returns the merged, de-duplicated
 * documents) but is run as one real query per chunk of 30.
 */
class ChunkedInQuery implements QueryLike {
  constructor(
    private readonly base: QueryLike,
    private readonly field: string | FieldPath,
    private readonly values: string[],
    private readonly narrowings: Narrowing[] = []
  ) {}

  where(field: string | FieldPath, op: WhereFilterOp, value: unknown): QueryLike {
    return new ChunkedInQuery(this.base, this.field, this.values, [...this.narrowings, (q) => q.where(field, op, value)]);
  }

  async get() {
    const snaps = await Promise.all(
      chunkValues(this.values).map((chunk) =>
        this.narrowings.reduce<QueryLike>((q, narrow) => narrow(q), this.base.where(this.field, "in", chunk)).get()
      )
    );
    const docs = mergeDocs(snaps.map((s) => s.docs));
    return { docs, empty: docs.length === 0 };
  }
}

/**
 * `base.where(field, "in", values)` without the silent 30-value cap. With 30
 * values or fewer this IS the plain Firestore query - exactly what the code
 * it replaces built - so nothing changes for the realistic case; only a larger
 * list is split into chunks instead of being truncated.
 */
export function whereIn(base: QueryLike, field: string | FieldPath, values: readonly string[]): QueryLike {
  const unique = Array.from(new Set(values));
  if (unique.length <= IN_QUERY_LIMIT) return base.where(field, "in", unique);
  return new ChunkedInQuery(base, field, unique);
}
