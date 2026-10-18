import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { personalRecordFromDoc, personalPatchBody } from "./personalRecord";
import {
  ratificationRecordsFromDoc, normalizeRatificationRecords, ratificationStatusPatch, ratificationStatusStep, ratificationResultStep,
  RATIFICATION_STATUS_STORED,
} from "./ratificationHistory";
import { buildPersonalDetailsUpdate } from "@/lib/firestore/personalDetails";

// Replays EVERY real VIT / VWU record from the read-only backup (scripts/backup-faculty-records.mjs) through the
// exact path an Edit save takes - doc -> form state -> PATCH body -> buildPersonalDetailsUpdate - and proves the
// ratification information on file survives untouched. Skipped when no backup file is present.
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
const str = (v: unknown) => (typeof v === "string" ? v : "");

describe.skipIf(!file)("real VIT + VWU records through the Ratification edit/save path", () => {
  const backup = file ? JSON.parse(readFileSync(join(dir, file), "utf8")) as { docs: Record<string, Doc> } : { docs: {} };
  const entries = Object.entries(backup.docs).map(([path, d]) => ({ path, doc: revive(d) as Doc, history: path.includes("/facultyMembers/") }));
  const save = (doc: Doc, history: boolean, edit?: (s: Record<string, unknown>) => void) => {
    const state = personalRecordFromDoc(doc, { ratificationHistory: history }) as Record<string, unknown>;
    edit?.(state);
    return buildPersonalDetailsUpdate(personalPatchBody(state as never, { ratificationHistory: history }) as never);
  };

  it("has the whole backup (VIT + VWU, faculty and logins)", () => {
    expect(entries.length).toBe(521);
  });

  it("only the two statuses the app ever wrote exist on file (so nothing needs a migration)", () => {
    const seen = new Set(entries.map((e) => str(e.doc.ratificationStatus)));
    expect([...seen].sort()).toEqual(["", "Not Ratified", "Ratified"]);
  });

  it("Edit-and-save with no change keeps every stored status exactly, for all records", () => {
    for (const { path, doc, history } of entries) {
      const stored = str(doc.ratificationStatus);
      if (!stored) continue; // a login with no status stays blank
      expect(save(doc, history).ratificationStatus, path).toBe(stored);
    }
  });

  it("Edit-and-save with no change keeps every ratification row exactly (designation text, number, date)", () => {
    let rows = 0;
    for (const { path, doc, history } of entries.filter((e) => e.history)) {
      const out = save(doc, history).ratifications as { designation: string; proceedingsNumber: string; date: string }[];
      const before = ratificationRecordsFromDoc(doc);
      expect(out, path).toEqual(normalizeRatificationRecords(before));
      // nothing non-blank was dropped
      for (const r of before.filter((r) => r.designation || r.proceedingsNumber || r.date)) expect(out, path).toContainEqual(r);
      rows += out.length;
    }
    expect(rows).toBeGreaterThan(0);
  });

  it("the old flat Proceedings Number/Date (staff / login records) is kept when Ratified", () => {
    for (const { path, doc } of entries.filter((e) => !e.history && e.doc.ratificationStatus === "Ratified")) {
      const out = save(doc, false);
      expect(str(out.ratificationProceedingsNumber), path).toBe(str(doc.ratificationProceedingsNumber));
    }
  });

  it("every stored status maps to a defined step pair - older ones are shown as they are, never changed", () => {
    for (const { doc } of entries) {
      const s = str(doc.ratificationStatus);
      if (s === "Ratified") expect([ratificationStatusStep(s), ratificationResultStep(s)]).toEqual(["Attended", "Ratified"]);
      if (s === "Not Ratified") expect([ratificationStatusStep(s), ratificationResultStep(s)]).toEqual(["Not Ratified", ""]);
    }
  });

  it("every dropdown pick, on every real faculty record: rows are kept, only the status changes", () => {
    const picks: ["status" | "result", string, string][] = [
      ["status", "Not Yet Attended", "Not Yet Attended"],
      ["status", "Attended", "Attended"],            // from a not-yet-Attended start; from Ratified it keeps Ratified (checked below)
      ["result", "Not Yet Ratified", "Not Yet Ratified"],
      ["result", "Ratified", "Ratified"],
    ];
    for (const { path, doc, history } of entries.filter((e) => e.history)) {
      const baseline = save(doc, history).ratifications;
      for (const [level, pick, expected] of picks) {
        const out = save(doc, history, (s) => Object.assign(s, ratificationStatusPatch(s.ratificationStatus as string, pick, level, history)));
        expect(out.ratifications, `${path} ${pick}`).toEqual(baseline); // rows never deleted by a pick
        // "Attended" picked while already Ratified keeps Ratified (result not lost)
        const wasRatified = doc.ratificationStatus === "Ratified";
        expect(out.ratificationStatus, `${path} ${pick}`).toBe(level === "status" && pick === "Attended" && wasRatified ? "Ratified" : expected);
      }
    }
  });

  it("every stored value the new flow can write is one of the four known ones", () => {
    expect([...RATIFICATION_STATUS_STORED]).toEqual(["Not Yet Attended", "Attended", "Not Yet Ratified", "Ratified"]);
  });
});
