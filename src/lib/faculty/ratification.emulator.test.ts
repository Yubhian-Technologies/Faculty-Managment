import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { personalRecordFromDoc, personalPatchBody } from "./personalRecord";
import { ratificationStatusPatch, ratificationRecordsFromDoc, normalizeRatificationRecords } from "./ratificationHistory";
import { buildPersonalDetailsUpdate } from "@/lib/firestore/personalDetails";

// Firebase save + load of the Ratification flow on a REAL Firestore (the local emulator - never the live project),
// seeded with copies of every real VIT / VWU record from the read-only backup. Skipped unless the emulator runs:
//   firebase emulators:exec --only firestore --project demo-ratify "npx vitest run src/lib/faculty/ratification.emulator.test.ts"
const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const dir = join(process.cwd(), "backups");
const file = existsSync(dir) ? readdirSync(dir).filter((f) => /^faculty-records-.*\.json$/.test(f)).sort().at(-1) : undefined;

type Doc = Record<string, unknown>;
const revive = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.$date === "string") return new Date(o.$date);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, revive(x)]));
  }
  return v;
};
// Same canonical form the backup script uses, so before/after compare like the real compare does.
const plain = (v: unknown): unknown => {
  if (v === null || v === undefined) return v ?? null;
  if (v instanceof Timestamp) return { $date: v.toDate().toISOString() };
  if (v instanceof Date) return { $date: v.toISOString() };
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, plain((v as Doc)[k])]));
  return v;
};
const diffs = (a: unknown, b: unknown, path = ""): { path: string; before: unknown; after: unknown }[] => {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isO = (x: unknown): x is Doc => !!x && typeof x === "object" && !Array.isArray(x) && !("$date" in (x as object));
  if (isO(a) && isO(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => diffs(a[k], b[k], `${path}.${k}`));
  return [{ path, before: a, after: b }];
};
const blank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

describe.skipIf(!EMULATOR || !file)("Ratification save/load on real Firestore with the real VIT + VWU records", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-ratify" }));
  const backup = file ? JSON.parse(readFileSync(join(dir, file), "utf8")) as { docs: Record<string, Doc> } : { docs: {} };
  const entries = Object.entries(backup.docs).map(([path, d]) => ({ path, doc: revive(d) as Doc, history: path.includes("/facultyMembers/") }));
  const load = async (path: string) => plain((await db().doc(path).get()).data());

  // what the Edit page + PATCH route do: doc -> form -> body -> update
  const saveBack = async (path: string, history: boolean, edit?: (s: Record<string, unknown>) => void) => {
    const snap = (await db().doc(path).get()).data() as Doc;
    const state = personalRecordFromDoc(snap, { ratificationHistory: history }) as Record<string, unknown>;
    edit?.(state);
    const upd = buildPersonalDetailsUpdate(personalPatchBody(state as never, { ratificationHistory: history }) as never);
    await db().doc(path).update(upd);
  };

  it("seeds copies of all 521 records", async () => {
    for (let i = 0; i < entries.length; i += 400) {
      const batch = db().batch();
      for (const e of entries.slice(i, i + 400)) batch.set(db().doc(e.path), e.doc);
      await batch.commit();
    }
    for (const e of entries) expect(await load(e.path), e.path).toEqual(plain(e.doc));
  }, 120_000);

  it("Edit + Save with no change, then reload: no ratification data lost on any record", async () => {
    let otherNonEmptyChanges = 0;
    let dobTimeOfDayShifts = 0;
    for (const { path, doc, history } of entries) {
      const before = await load(path) as Doc;
      await saveBack(path, history);
      const after = await load(path) as Doc;

      expect(after.ratificationStatus ?? "", path).toBe(before.ratificationStatus ?? "");
      if (history) {
        const was = normalizeRatificationRecords(ratificationRecordsFromDoc(doc));
        expect(after.ratifications, path).toEqual(was); // every row, exactly
      }
      // flat pair: may only go blank when its content now lives in the rows
      for (const k of ["ratificationProceedingsNumber", "ratificationDate"]) {
        if (!blank(before[k]) && blank(after[k])) {
          expect(history, `${path} ${k} cleared outside the history path`).toBe(true);
          const moved = k === "ratificationDate" ? String((before[k] as { $date: string }).$date).slice(0, 10) : String(before[k]);
          expect(JSON.stringify(after.ratifications), path).toContain(moved);
        }
      }
      // Everything outside Ratification: a no-change save must not drop or alter a non-empty value.
      for (const d of diffs(before, after)) {
        if (d.path.startsWith(".ratification")) continue;
        if (blank(d.before)) continue; // an empty field becoming "" / [] is harmless
        // Existing behaviour, not Ratification: every Personal Details save writes new Date("YYYY-MM-DD") (00:00 UTC),
        // while some stored dates are 00:00 IST (18:30 UTC the day before). Same calendar day as the form shows it;
        // counted separately and only accepted when that calendar day is unchanged.
        if (d.path === ".dateOfBirth") {
          const ist = (x: unknown) => new Date(new Date((x as { $date: string }).$date).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
          const utcDay = (x: unknown) => (x as { $date: string }).$date.slice(0, 10);
          expect([ist(d.before), utcDay(d.before)], `${path} dateOfBirth`).toContain(utcDay(d.after));
          dobTimeOfDayShifts++;
          continue;
        }
        otherNonEmptyChanges++;
        console.warn("non-ratification field changed by a no-change save:", path, d.path, JSON.stringify(d.before)?.slice(0, 60), "->", JSON.stringify(d.after)?.slice(0, 60));
      }
    }
    console.log(`no-change save over ${entries.length} records: ratification data lost = 0; non-ratification changes = ${otherNonEmptyChanges}; dateOfBirth time-of-day shifts (same day) = ${dobTimeOfDayShifts}`);
    expect(otherNonEmptyChanges).toBe(0);
  }, 300_000);

  it("every status combination: save, reload, and the rows are still there", async () => {
    // one record per (college, stored status, number of rows) shape
    const picked = new Map<string, (typeof entries)[number]>();
    for (const e of entries.filter((x) => x.history)) {
      const key = `${e.path.split("/")[1]}|${e.doc.ratificationStatus}|${ratificationRecordsFromDoc(e.doc).length}`;
      if (!picked.has(key)) picked.set(key, e);
    }
    expect(picked.size).toBeGreaterThanOrEqual(6);
    const combos: ["status" | "result", string][] = [
      ["status", "Not Yet Attended"],
      ["status", "Attended"],
      ["result", "Not Ratified"],
      ["result", "Ratified"],
    ];
    for (const { path } of picked.values()) {
      const rows = (await load(path) as Doc).ratifications;
      for (const [level, pick] of combos) {
        await saveBack(path, true, (s) => Object.assign(s, ratificationStatusPatch(s.ratificationStatus as string, pick, level, true)));
        const after = await load(path) as Doc;
        // picking Attended while already Ratified keeps Ratified; the status step is stored as Attended otherwise
        expect(["Not Yet Attended", "Attended", "Not Ratified", "Ratified"], `${path} ${pick}`).toContain(after.ratificationStatus);
        if (level === "result" || pick === "Not Yet Attended") expect(after.ratificationStatus, `${path} ${pick}`).toBe(pick);
        expect(after.ratifications, `${path} ${pick}`).toEqual(rows ?? []);
      }
    }
  }, 120_000);

  it("add a record, edit a record, reload", async () => {
    const e = entries.find((x) => x.history && x.doc.ratificationStatus === "Ratified" && ratificationRecordsFromDoc(x.doc).length === 1)!;
    const original = ratificationRecordsFromDoc(e.doc)[0];
    const added = { designation: "Principal", proceedingsNumber: "TEST-2", date: "2026-10-18" };
    // Add More -> a second record
    await saveBack(e.path, true, (s) => { s.ratifications = [...(s.ratifications as unknown[]), added]; });
    let after = (await load(e.path) as Doc).ratifications as Doc[];
    expect(after).toEqual([original, added]);
    // edit the first record's number
    await saveBack(e.path, true, (s) => { (s.ratifications as Doc[])[0] = { ...(s.ratifications as Doc[])[0], proceedingsNumber: "EDITED" }; });
    after = (await load(e.path) as Doc).ratifications as Doc[];
    expect(after[0]).toEqual({ ...original, proceedingsNumber: "EDITED" });
    expect(after[1]).toEqual(added);
  }, 60_000);

  it("Ratified picked on a record, the default blank row left untouched, stores no empty row", async () => {
    const e = entries.find((x) => x.history && x.doc.ratificationStatus === "Not Ratified" && ratificationRecordsFromDoc(x.doc).length === 0)!;
    await saveBack(e.path, true, (s) => Object.assign(s, ratificationStatusPatch("Attended", "Ratified", "result", true)));
    const after = await load(e.path) as Doc;
    expect(after.ratificationStatus).toBe("Ratified");
    expect(after.ratifications).toEqual([]);
  }, 30_000);
});
