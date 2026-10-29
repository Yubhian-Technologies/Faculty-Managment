// The order an HOD arranged their department's faculty list in.
//
// Stored as ONE document per department: colleges/{c}/facultyOrders/{departmentId} = { order: facultyId[], ... }.
// Nothing is kept in step when people join, leave or move: ids that no longer belong are ignored on read, and a member the
// order doesn't name sits after the named ones in the default order (see compareOrderRank in listOrder.ts).
// A department with no document has no custom order - every list falls back to the default.

import type { Firestore } from "firebase-admin/firestore";

export const FACULTY_ORDER_COLLECTION = "facultyOrders";
export const MAX_FACULTY_ORDER = 500;

export function facultyOrderRef(db: Firestore, collegeId: string, departmentId: string) {
  return db.collection("colleges").doc(collegeId).collection(FACULTY_ORDER_COLLECTION).doc(departmentId);
}

/**
 * The ids to keep, in the order given: strings only, each once, only ones in `validIds`.
 * Null when the input is not an array or is over the cap (the caller answers 400).
 */
export function cleanFacultyOrder(input: unknown, validIds: ReadonlySet<string>): string[] | null {
  if (!Array.isArray(input) || input.length > MAX_FACULTY_ORDER * 2) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of input) {
    if (typeof v !== "string" || !validIds.has(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.length <= MAX_FACULTY_ORDER ? out : null;
}

type Row = { id: string; department?: unknown; departmentId?: unknown; orderRank?: number };

/**
 * Stamps `orderRank` on rows whose department has an arranged order: the position in that order, and the list length
 * for a member the order doesn't name (so they tie, and the default order sorts them). Departments with no order get
 * nothing. Reads: one batched read of the order documents, plus one name lookup only for a department no row has an id for.
 * Display-only and additive; a failure leaves the rows untouched (the caller's default order stands).
 */
export async function stampFacultyOrderRanks(db: Firestore, collegeId: string, rows: Row[]): Promise<void> {
  try {
    const idByName = new Map<string, string>();
    const unresolved = new Set<string>();
    for (const r of rows) {
      const name = typeof r.department === "string" ? r.department.trim() : "";
      if (!name || idByName.has(name)) continue;
      if (typeof r.departmentId === "string" && r.departmentId) idByName.set(name, r.departmentId);
      else unresolved.add(name);
    }
    for (const n of idByName.keys()) unresolved.delete(n);
    if (unresolved.size > 0) {
      const snap = await db.collection("colleges").doc(collegeId).collection("departments")
        .where("name", "in", Array.from(unresolved).slice(0, 30)).select("name").get();
      for (const d of snap.docs) idByName.set((d.data() as { name: string }).name, d.id);
    }
    if (idByName.size === 0) return;

    const entries = Array.from(idByName);
    const snaps = await db.getAll(...entries.map(([, id]) => facultyOrderRef(db, collegeId, id)));
    const orderByName = new Map<string, string[]>();
    snaps.forEach((s, i) => {
      const order = (s.data() as { order?: unknown } | undefined)?.order;
      if (Array.isArray(order)) orderByName.set(entries[i][0], order.filter((v): v is string => typeof v === "string"));
    });
    if (orderByName.size === 0) return;

    const position = new Map<string, Map<string, number>>();
    for (const [name, order] of orderByName) position.set(name, new Map(order.map((id, i) => [id, i])));
    for (const r of rows) {
      const name = typeof r.department === "string" ? r.department.trim() : "";
      const pos = position.get(name);
      if (pos) r.orderRank = pos.get(r.id) ?? orderByName.get(name)!.length;
    }
  } catch (err) {
    console.error("[facultyOrder] stamp", err);
  }
}
