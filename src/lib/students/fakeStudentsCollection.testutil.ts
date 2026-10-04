// A tiny in-memory stand-in for a Firestore students collection, for the unit
// tests of the paged / count reads. It supports exactly what those reads use -
// chained `where(field, "==" | "in", value)`, `.get()`, `.count().get()` and
// `firestore.getAll(...doc refs)` - and, like Firestore, treats a document that
// lacks a field as not matching a filter on it. `stats` records how many
// documents each kind of read touched, so a test can assert that a filter was
// really pushed down to the query (fewer documents read) rather than applied
// after everything was downloaded.

export interface FakeStudent {
  id: string;
  data: Record<string, unknown>;
}

type Filter = [field: string, op: "==" | "in", value: unknown];

export interface FakeStats {
  /** Documents returned by `.get()` and `getAll`. */
  docsRead: number;
  /** `.count().get()` calls (each is billed as an aggregation, not per document). */
  countCalls: number;
}

export function fakeStudentsCollection(students: FakeStudent[]) {
  const stats: FakeStats = { docsRead: 0, countCalls: 0 };

  const snapshot = (s: FakeStudent) => ({ id: s.id, exists: true, data: () => ({ ...s.data }) });

  function query(filters: Filter[]) {
    const matching = () =>
      students.filter((s) =>
        filters.every(([field, op, value]) =>
          op === "==" ? s.data[field] === value : (value as unknown[]).includes(s.data[field])
        )
      );
    return {
      where(field: string, op: "==" | "in", value: unknown) {
        return query([...filters, [field, op, value]]);
      },
      async get() {
        const found = matching();
        stats.docsRead += found.length;
        return { docs: found.map(snapshot), size: found.length, empty: found.length === 0 };
      },
      count() {
        return {
          async get() {
            stats.countCalls += 1;
            return { data: () => ({ count: matching().length }) };
          },
        };
      },
    };
  }

  const collection = {
    ...query([]),
    doc(id: string) {
      return { id };
    },
    firestore: {
      async getAll(...refs: { id: string }[]) {
        return refs.map((ref) => {
          const found = students.find((s) => s.id === ref.id);
          if (found) stats.docsRead += 1;
          return found ? snapshot(found) : { id: ref.id, exists: false, data: () => undefined };
        });
      },
    },
  };

  return { collection: collection as unknown as FirebaseFirestore.CollectionReference, stats };
}
