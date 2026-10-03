import { describe, it, expect } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { computeStudentAttendanceHistory, studentDepartmentsForHistory } from "./history";

// A tiny in-memory Firestore: just the calls history.ts makes (collection/doc
// chaining, where with ==, in, >=, <=, get, getAll).
type Doc = Record<string, unknown>;
type Store = Record<string, Record<string, Doc>>; // collection path -> id -> data

function fakeDb(store: Store): Firestore {
  const query = (path: string, filters: [string, string, unknown][] = []) => ({
    where: (field: string, op: string, value: unknown) => query(path, [...filters, [field, op, value]]),
    get: async () => {
      const docs = Object.entries(store[path] ?? {})
        .filter(([, data]) =>
          filters.every(([field, op, value]) => {
            const v = data[field] as string;
            if (op === "==") return v === value;
            if (op === "in") return (value as unknown[]).includes(v);
            if (op === ">=") return v >= (value as string);
            if (op === "<=") return v <= (value as string);
            throw new Error(`unsupported op ${op}`);
          })
        )
        .map(([id, data]) => ({ id, data: () => data }));
      return { docs, empty: docs.length === 0 };
    },
  });
  const collection = (path: string) => ({
    ...query(path),
    doc: (id: string) => ({
      __path: path,
      id,
      collection: (sub: string) => collection(`${path}/${id}/${sub}`),
    }),
  });
  return {
    collection: (name: string) => ({
      doc: (id: string) => ({ collection: (sub: string) => collection(`${name}/${id}/${sub}`) }),
    }),
    getAll: async (...refs: { __path: string; id: string }[]) =>
      refs.map((r) => {
        const data = store[r.__path]?.[r.id];
        return { id: r.id, exists: !!data, data: () => data };
      }),
  } as unknown as Firestore;
}

const C = "colleges/c1";
const S = "stu1";

function session(over: Partial<Doc> & { entries: { studentId: string; status: string | null }[] }): Doc {
  return {
    department: "CSE",
    status: "SUBMITTED",
    date: "2026-10-05",
    subjectId: "sub-ds",
    subjectName: "Data Structures",
    subjectCode: "R2321055",
    ...over,
  };
}

const present = [{ studentId: S, status: "PRESENT" }];
const absent = [{ studentId: S, status: "ABSENT" }];

describe("computeStudentAttendanceHistory", () => {
  it("counts held/attended per subject and ignores DRAFT sessions", async () => {
    const db = fakeDb({
      [`${C}/studentAttendance`]: {
        a: session({ entries: present }),
        b: session({ date: "2026-10-06", entries: absent }),
        c: session({ date: "2026-10-07", status: "DRAFT", entries: present }),
      },
    });
    const r = await computeStudentAttendanceHistory(db, "c1", S, ["CSE"]);
    expect(r.subjects).toHaveLength(1);
    expect(r.subjects[0]).toMatchObject({ subjectId: "sub-ds", held: 2, attend: 1, percent: 50 });
    expect(r.total).toEqual({ held: 2, attend: 1, percent: 50 });
  });

  it("a session whose roster doesn't include the student is not held for them (other lab batch)", async () => {
    const db = fakeDb({
      [`${C}/studentAttendance`]: {
        a: session({ entries: present }),
        b: session({ date: "2026-10-06", labBatch: "B2", entries: [{ studentId: "someone-else", status: "PRESENT" }] }),
      },
    });
    const r = await computeStudentAttendanceHistory(db, "c1", S, ["CSE"]);
    expect(r.total).toEqual({ held: 1, attend: 1, percent: 100 });
  });

  it("an unmarked (null) entry is held but not attended", async () => {
    const db = fakeDb({ [`${C}/studentAttendance`]: { a: session({ entries: [{ studentId: S, status: null }] }) } });
    expect((await computeStudentAttendanceHistory(db, "c1", S, ["CSE"])).total).toEqual({ held: 1, attend: 0, percent: 0 });
  });

  it("date range is inclusive at both ends", async () => {
    const db = fakeDb({
      [`${C}/studentAttendance`]: {
        a: session({ date: "2026-10-01", entries: present }),
        b: session({ date: "2026-10-15", entries: present }),
        c: session({ date: "2026-10-31", entries: present }),
        d: session({ date: "2026-11-01", entries: present }),
        e: session({ date: "2026-09-30", entries: present }),
      },
    });
    const r = await computeStudentAttendanceHistory(db, "c1", S, ["CSE"], { from: "2026-10-01", to: "2026-10-31" });
    expect(r.total.held).toBe(3);
  });

  it("a promoted student keeps the sessions filed under their earlier departments", async () => {
    const db = fakeDb({
      [`${C}/students/${S}/departmentHistory`]: {
        h1: { department: "Basic Science", year: 1 },
        h2: { department: "CSE", year: 2 },
      },
      [`${C}/studentAttendance`]: {
        a: session({ department: "Basic Science", date: "2025-09-10", entries: present }),
        b: session({ department: "CSE", date: "2026-10-05", entries: absent }),
        other: session({ department: "ECE", date: "2026-10-05", entries: present }),
      },
    });
    // Only the current department -> the Year-1 session is lost (the old bug).
    expect((await computeStudentAttendanceHistory(db, "c1", S, "CSE")).total.held).toBe(1);

    const depts = await studentDepartmentsForHistory(db, "c1", { id: S, department: "CSE" });
    expect(depts.sort()).toEqual(["Basic Science", "CSE"]);
    const r = await computeStudentAttendanceHistory(db, "c1", S, depts);
    expect(r.total).toEqual({ held: 2, attend: 1, percent: 50 });
  });

  it("includes the shared-first-year secondaryDepartment", async () => {
    const depts = await studentDepartmentsForHistory(fakeDb({}), "c1", { id: S, department: "Basic Science", secondaryDepartment: "CSE" });
    expect(depts.sort()).toEqual(["Basic Science", "CSE"]);
  });

  it("returns Subject.shortCode when set and omits it otherwise", async () => {
    const db = fakeDb({
      [`${C}/subjects`]: { "sub-ds": { shortCode: "DS" } },
      [`${C}/studentAttendance`]: {
        a: session({ entries: present }),
        b: session({ subjectId: "sub-os", subjectName: "Operating Systems", subjectCode: "R2321060", entries: present }),
      },
    });
    const r = await computeStudentAttendanceHistory(db, "c1", S, ["CSE"]);
    expect(r.subjects.find((s) => s.subjectId === "sub-ds")?.shortCode).toBe("DS");
    expect(r.subjects.find((s) => s.subjectId === "sub-os")?.shortCode).toBeUndefined();
  });

  it("no sessions -> empty result", async () => {
    const r = await computeStudentAttendanceHistory(fakeDb({}), "c1", S, ["CSE"]);
    expect(r).toEqual({ subjects: [], total: { held: 0, attend: 0, percent: 0 } });
  });
});
