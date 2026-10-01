import "dotenv/config";
import { describe, expect, it } from "vitest";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadStrengthPayload } from "./load";
import { buildReport, describeFilters, totalFor } from "./query";
import { effectiveBranchName } from "./aggregate";

// READ-ONLY end-to-end check against a real Firestore project. Skipped unless
// RUN_LIVE_STRENGTH=1 (it needs the FIREBASE_ADMIN_* env and touches live data,
// so it must never run in CI by default):
//
//   RUN_LIVE_STRENGTH=1 npx vitest run src/lib/students/strength/strength.live.test.ts
//
// For every college that has students it runs the real loader, then verifies
// the engine's numbers against numbers Firestore itself computes with COUNT()
// aggregation, and against a second, independent full read of the documents.
const live = process.env.RUN_LIVE_STRENGTH === "1";

describe.skipIf(!live)("student strength against live Firestore (read-only)", () => {
  it("matches Firestore COUNT() aggregations and an independent full read, for every college", async () => {
    const db = getAdminDb();
    const colleges = await db.collection("colleges").get();
    let verified = 0;

    for (const college of colleges.docs) {
      const coll = college.ref.collection("students");
      const dbTotal = (await coll.count().get()).data().count;
      if (dbTotal === 0) continue;

      const payload = await loadStrengthPayload(db, college.id);
      const { cells, meta } = payload;
      const name = (college.data() as { name?: string }).name;

      // 1. every record scanned, every record in exactly one cell
      expect(payload.integrity).toEqual({ databaseCount: dbTotal, scannedRecords: dbTotal });
      expect(cells.reduce((n, c) => n + c.count, 0)).toBe(dbTotal);

      // 2. per-status, per-year totals vs Firestore's own COUNT()
      for (const st of ["REGULAR", "DETAINED", "GRADUATED"]) {
        const expected = (await coll.where("status", "==", st).count().get()).data().count;
        expect(totalFor(cells, { status: st }), `${name}: status ${st}`).toBe(expected);
      }
      for (const year of [1, 2, 3, 4, 5, 6]) {
        const expected = (await coll.where("year", "==", year).where("status", "in", ["REGULAR", "DETAINED"]).count().get()).data().count;
        expect(totalFor(cells, { status: "ENROLLED", year }), `${name}: year ${year}`).toBe(expected);
      }
      for (const p of meta.programs.filter((x) => x.key)) {
        const raw = (await coll.select("course").get()).docs.filter((d) => String(d.get("course") ?? "").trim().toLowerCase() === p.key).length;
        expect(totalFor(cells, { status: "ALL", program: p.key }), `${name}: program ${p.label}`).toBe(raw);
      }

      // 3. independent re-implementation of "which branch" from a full read
      const full = await coll.get();
      const perBranch = new Map<string, number>();
      for (const d of full.docs) {
        const b = effectiveBranchName({ department: d.get("department"), secondaryDepartment: d.get("secondaryDepartment") }).toLowerCase();
        perBranch.set(b, (perBranch.get(b) ?? 0) + 1);
      }
      for (const [b, n] of perBranch) expect(totalFor(cells, { status: "ALL", branch: b }), `${name}: branch ${b}`).toBe(n);

      // 4. the generated report reconciles
      const report = buildReport(cells, meta, { status: "ENROLLED" });
      expect(report.total).toBe(totalFor(cells, { status: "ENROLLED" }));
      expect(report.matrices.reduce((n, m) => n + m.total, 0)).toBe(report.total);
      expect(report.sections.reduce((n, s) => n + s.count, 0)).toBe(report.total);

      console.log(
        `[live] ${name}: ${dbTotal} students, ${cells.length} cells, enrolled=${report.total}, ` +
          `${describeFilters({ status: "ENROLLED" }, meta)}; dup rolls=${payload.health.duplicateRolls.length}; ` +
          `without section=${payload.health.enrolledWithoutSection}`
      );
      for (const m of report.matrices) {
        console.log(`  ${m.label} (years ${m.years.join(",")}): total ${m.total}`);
        for (const r of m.rows) console.log(`    ${(r.code || r.label).padEnd(40)} ${m.years.map((y) => String(r.byYear[y]).padStart(4)).join("")}  = ${r.total}`);
      }
      verified += 1;
    }
    expect(verified).toBeGreaterThan(0);
  }, 120_000);
});
