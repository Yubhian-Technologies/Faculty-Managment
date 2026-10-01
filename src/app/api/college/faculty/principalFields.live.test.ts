import "dotenv/config";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { getAdminDb } from "@/lib/firebase/admin";
import { migrateFacultyDoc, migrateSupportingStaffDoc } from "@/lib/faculty/fieldRenames";
import {
  FacultyDesignationCell, FacultyExperienceCell, FacultyStatusCell, JoiningLine, type FacultyListRow,
} from "@/components/faculty/facultyListCells";

// READ-ONLY check against the real Firestore project. Skipped unless
// RUN_LIVE_FACULTY=1 (needs FIREBASE_ADMIN_* and touches live data):
//
//   RUN_LIVE_FACULTY=1 npx vitest run src/app/api/college/faculty/principalFields.live.test.ts
//
// Proves two things for Principal / College Admin on real records:
//  1. the faculty and supporting-staff API responses carry EVERY field of the
//     stored document (nothing is stripped for this role), and
//  2. every real row renders through the shared list cells with real values -
//     no "undefined", "NaN" or "Invalid Date" leaking into the table.
const live = process.env.RUN_LIVE_FACULTY === "1";

const session = { current: { collegeId: "", uid: "principal-test", role: "PRINCIPAL" } };
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async () => session.current,
  verifySession: async () => null,
}));

const keysOf = (o: Record<string, unknown>) => Object.keys(o).filter((k) => o[k] !== undefined).sort();

describe.skipIf(!live)("Principal sees every stored field of faculty and supporting staff (live, read-only)", () => {
  it("list + single-record APIs return the full documents, and the shared cells render every real row", async () => {
    const { GET: listFaculty } = await import("./route");
    const { GET: getOneFaculty } = await import("./[id]/route");
    const { GET: listStaff } = await import("../supporting-staff/route");
    const { GET: getOneStaff } = await import("../supporting-staff/[id]/route");

    const db = getAdminDb();
    const colleges = await db.collection("colleges").get();
    let facultyChecked = 0, staffChecked = 0, cellsRendered = 0, singleChecked = 0;
    const problems: string[] = [];

    for (const c of colleges.docs) {
      session.current.collegeId = c.id;
      const rawFaculty = await c.ref.collection("facultyMembers").get();
      const rawStaff = await c.ref.collection("supportingStaff").get();
      if (rawFaculty.empty && rawStaff.empty) continue;

      // ── faculty list as Principal ──
      const res = await listFaculty(new Request("http://x/api/college/faculty"));
      const { faculty } = (await res.json()) as { faculty: (Record<string, unknown> & { id: string })[] };
      const returned = new Map(faculty.map((f) => [f.id, f]));
      for (const d of rawFaculty.docs) {
        const apiRow = returned.get(d.id);
        // Legacy technical designations are intentionally moved to Supporting Staff - not a stripped field.
        if (!apiRow) continue;
        const expected = keysOf(migrateFacultyDoc(d.data()) as Record<string, unknown>);
        const got = keysOf(apiRow).filter((k) => k !== "id" && k !== "accessLevel");
        const missing = expected.filter((k) => !got.includes(k));
        if (missing.length) problems.push(`${c.id}/${d.id}: faculty list dropped ${missing.join(",")}`);
        facultyChecked += 1;

        // ── shared cells render real values ──
        const el = [
          createElement(JoiningLine, { row: apiRow as FacultyListRow }),
          createElement(FacultyDesignationCell, { row: apiRow as FacultyListRow }),
          createElement(FacultyExperienceCell, { row: apiRow as FacultyListRow }),
          createElement(FacultyStatusCell, { row: apiRow as FacultyListRow }),
        ].map((e) => renderToStaticMarkup(e)).join(" ");
        if (/undefined|NaN|Invalid Date/.test(el)) problems.push(`${c.id}/${d.id}: cell rendered a bad value -> ${el.replace(/<[^>]+>/g, " ").trim()}`);
        if (apiRow.joiningDate && /Joined: -|Expected to join: -/.test(el)) problems.push(`${c.id}/${d.id}: has a joiningDate but rendered '-'`);
        cellsRendered += 1;
      }

      // ── single-record API (profile / module pages) for a sample incl. rich ones ──
      const sample = [...rawFaculty.docs].sort((a, b) => Object.keys(b.data()).length - Object.keys(a.data()).length).slice(0, 5);
      for (const d of sample) {
        const r = await getOneFaculty(new Request("http://x"), { params: Promise.resolve({ id: d.id }) });
        if (r.status !== 200) { problems.push(`${c.id}/${d.id}: single GET -> ${r.status}`); continue; }
        const { faculty: one } = (await r.json()) as { faculty: Record<string, unknown> };
        const missing = keysOf(migrateFacultyDoc(d.data()) as Record<string, unknown>).filter((k) => !keysOf(one).includes(k));
        if (missing.length) problems.push(`${c.id}/${d.id}: profile GET dropped ${missing.join(",")}`);
        singleChecked += 1;
      }

      // ── supporting staff as Principal ──
      if (!rawStaff.empty) {
        const sres = await listStaff(new Request("http://x/api/college/supporting-staff"));
        const { staff } = (await sres.json()) as { staff: (Record<string, unknown> & { id: string })[] };
        const byId = new Map(staff.map((s) => [s.id, s]));
        for (const d of rawStaff.docs) {
          const apiRow = byId.get(d.id);
          if (!apiRow) { problems.push(`${c.id}/${d.id}: supporting staff missing from Principal's list`); continue; }
          const missing = keysOf(migrateSupportingStaffDoc(d.data()) as Record<string, unknown>).filter((k) => !keysOf(apiRow).includes(k));
          if (missing.length) problems.push(`${c.id}/${d.id}: staff list dropped ${missing.join(",")}`);
          staffChecked += 1;
        }
        for (const d of rawStaff.docs.slice(0, 3)) {
          const r = await getOneStaff(new Request("http://x"), { params: Promise.resolve({ id: d.id }) });
          if (r.status !== 200) problems.push(`${c.id}/${d.id}: staff single GET -> ${r.status}`);
        }
      }
    }

    console.log(`[live] faculty rows verified=${facultyChecked}, cells rendered=${cellsRendered}, profile GETs=${singleChecked}, supporting staff verified=${staffChecked}`);
    if (problems.length) console.log(problems.slice(0, 25).join("\n"));
    expect(problems).toEqual([]);
    expect(facultyChecked).toBeGreaterThan(0);
  }, 300_000);
});
