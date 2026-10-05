import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Route-inventory safety net for the read-only (RESIGNED/RETIRED) faculty rule.
//
//  (a) EVERY mutating handler (POST/PATCH/PUT/DELETE) under src/app/api must go through a role guard
//      (requireRole / requireCollegeMember / ... or one of the wrappers that call them), OR be in the
//      reviewed exemption list below. A NEW route that forgets its guard fails this test - which is
//      exactly the route that would silently let a read-only person write.
//  (b) With the read-only switch ON, a RESIGNED/RETIRED login is denied every one of those handlers
//      through the REAL guard code (liveRoles + pickEffectiveRole), while an ACTIVE login is not -
//      so the denial is proven to come from the rule, not from the route's own role list.

const API_DIR = path.join(process.cwd(), "src/app/api");
const SRC_DIR = path.join(process.cwd(), "src");

// ── fake Firestore + request context for the real guard ───────────────────────
const state = vi.hoisted(() => ({ status: "RESIGNED" as string, method: "POST", path: "/api/x" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: (n: string) => (n.toLowerCase() === "x-fms-method" ? state.method : n.toLowerCase() === "x-fms-path" ? state.path : null) }),
}));
vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => ({
    collection: () => ({
      doc: () => ({
        collection: (sub: string) => ({
          doc: () => ({ get: async () => ({ exists: true, data: () => ({ role: "PANEL_MEMBER", seatRoles: ["HOD", "VICE_PRINCIPAL", "ACADEMICS"], isActive: true }) }) }),
          where: () => ({ limit: () => ({ get: async () => (sub === "facultyMembers" ? { empty: false, docs: [{ data: () => ({ status: state.status }) }] } : { empty: true, docs: [] }) }) }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/leave/roleDelegation", () => ({ activeDelegatedRoles: async () => ({ roles: [] }) }));

import { resolveHeldRoles, forgetHeldRoles } from "@/lib/auth/liveRoles";
import { isAllowedReadOnlyRequest } from "@/lib/auth/readOnlyAccess";
import { pickEffectiveRole } from "@/lib/roles/seatRoles";

// ── the reviewed exemptions: mutating handlers that are deliberately NOT behind a college role guard ──
// Public/candidate pages, cron and auth entry points, location-scoped and platform-admin APIs (their
// callers are not college faculty), and the two bearer-token routes. Adding to this list is a review decision.
const EXEMPT = new Set([
  "POST admin/colleges", "PATCH admin/colleges",
  "POST auth/resolve-student-login", "POST auth/session", "DELETE auth/session",
  "POST cron/attendance-not-posted", "POST cron/od-proof-reminders",
  "POST email/send", "POST pdf/generate",
  "POST location/candidates", "PATCH location/candidates/[id]",
  "POST location/departments", "PATCH location/departments/[id]", "DELETE location/departments/[id]",
  "POST location/interviews", "PATCH location/interviews/[id]",
  "POST location/offers", "PATCH location/offers/[id]",
  "POST location/users",
  "POST location/vacancy-requests", "PATCH location/vacancy-requests/[id]",
  "PATCH public/candidate-form/[collegeId]/[candidateId]", "POST public/careers/[collegeId]",
  "POST public/offer-acceptance/[collegeId]/[offerId]", "POST public/student-feedback",
]);

// Calls that ARE a role guard (the require* family, plus the wrappers that call it).
const GUARD_CALLS = /\b(requireSuperAdmin|requireManagement|requireRole|requireCollegeContext|requireCollegeMember|requireLocationMember|requireSeatManager|authenticate|hodContext)\s*\(/;

interface Handler { rel: string; method: string; guarded: boolean; roles: string[]; url: string }

function walk(dir: string, out: string[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "route.ts") out.push(p);
  }
}

// Role constants (`const FOO_ROLES = [...]`, `...OTHER_ROLES` spreads) resolved across src, so the roles a
// handler accepts can be known even when it passes `...FOO_ROLES` to the guard.
function buildConstMap(): Map<string, { roles: string[]; spreads: string[] }> {
  const files: string[] = [];
  (function w(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!["node_modules", ".next"].includes(e.name)) w(p); }
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p);
    }
  })(SRC_DIR);
  const map = new Map<string, { roles: string[]; spreads: string[] }>();
  const arr = /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*(\[[^\]]*\])/g;
  const alias = /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*([A-Z][A-Z0-9_]*)\s*;/g;
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    let m: RegExpExecArray | null;
    while ((m = arr.exec(s))) if (!map.has(m[1])) map.set(m[1], { roles: (m[2].match(/"([A-Z_]+)"/g) ?? []).map((x) => x.replace(/"/g, "")), spreads: (m[2].match(/\.\.\.([A-Z0-9_]+)/g) ?? []).map((x) => x.slice(3)) });
    while ((m = alias.exec(s))) if (!map.has(m[1])) map.set(m[1], { roles: [], spreads: [m[2]] });
  }
  return map;
}
const resolveConst = (map: ReturnType<typeof buildConstMap>, n: string, seen = new Set<string>()): string[] => {
  if (seen.has(n)) return [];
  seen.add(n);
  const c = map.get(n);
  return c ? [...c.roles, ...c.spreads.flatMap((x) => resolveConst(map, x, seen))] : [];
};

const handlers: Handler[] = [];

beforeAll(() => {
  const consts = buildConstMap();
  const files: string[] = [];
  walk(API_DIR, files);
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const rel = path.relative(API_DIR, f).split(path.sep).join("/").replace(/\/route\.ts$/, "");
    // Same-file helpers that themselves call a role guard (e.g. `async function context() { ... await
    // requireCollegeMember("HOD") ... }`): calling one of them counts as being guarded.
    const localGuards: string[] = [];
    const defRe = /(?:async\s+function|function)\s+([A-Za-z_]\w*)\s*\([^)]*\)[^{]*\{/g;
    const defs: { name: string; idx: number }[] = [];
    let dm: RegExpExecArray | null;
    while ((dm = defRe.exec(src))) if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(dm[1])) defs.push({ name: dm[1], idx: dm.index });
    defs.forEach((d, i) => {
      let text = src.slice(d.idx, i + 1 < defs.length ? defs[i + 1].idx : src.length);
      const cut = text.search(/\nexport\s+async\s+function/);
      if (cut >= 0) text = text.slice(0, cut);
      if (GUARD_CALLS.test(text)) localGuards.push(d.name);
    });
    const localGuardCall = localGuards.length ? new RegExp(`\\b(${localGuards.join("|")})\\s*\\(`) : null;
    const re = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
    const hs: { method: string; idx: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) hs.push({ method: m[1], idx: m.index });
    hs.forEach((h, i) => {
      const body = src.slice(h.idx, i + 1 < hs.length ? hs[i + 1].idx : src.length);
      const roles = new Set<string>();
      for (const g of ["requireRole", "requireCollegeContext", "requireCollegeMember", "requireLocationMember"]) {
        const gr = new RegExp(`${g}\\s*\\(([^)]*)\\)`, "g");
        let gm: RegExpExecArray | null;
        while ((gm = gr.exec(body))) {
          (gm[1].match(/"([A-Z_]+)"/g) ?? []).forEach((x) => roles.add(x.replace(/"/g, "")));
          (gm[1].match(/\.\.\.([A-Z0-9_]+)/g) ?? []).forEach((x) => resolveConst(consts, x.slice(3)).forEach((r) => roles.add(r)));
        }
      }
      handlers.push({ rel, method: h.method, guarded: GUARD_CALLS.test(body) || !!localGuardCall?.test(body), roles: [...roles], url: `/api/${rel.replace(/\[[^\]]+\]/g, "x1")}` });
    });
  }
});

const mutating = () => handlers.filter((h) => h.method !== "GET");

describe("(a) every mutating route is behind a role guard or reviewed", () => {
  it("finds the routes (sanity: the scan is not empty)", () => {
    expect(mutating().length).toBeGreaterThan(250);
  });

  it("no mutating handler is unguarded unless it is in the reviewed exemption list", () => {
    const unguarded = mutating().filter((h) => !h.guarded).map((h) => `${h.method} ${h.rel}`);
    const unexpected = unguarded.filter((k) => !EXEMPT.has(k));
    expect(unexpected, `New mutating route(s) with NO role guard. Add requireRole/requireCollegeMember (or a reviewed exemption): ${unexpected.join(", ")}`).toEqual([]);
  });

  it("the exemption list holds no stale entries (each still exists and is still unguarded)", () => {
    const unguarded = new Set(mutating().filter((h) => !h.guarded).map((h) => `${h.method} ${h.rel}`));
    const stale = [...EXEMPT].filter((k) => !unguarded.has(k));
    expect(stale, `Remove from EXEMPT (route gone or now guarded): ${stale.join(", ")}`).toEqual([]);
  });
});

describe("(b) read-only faculty are denied every guarded mutating handler (real guard code)", () => {
  const session = { uid: "u1", role: "PANEL_MEMBER", roles: ["VICE_PRINCIPAL", "HOD", "ACADEMICS", "PANEL_MEMBER"], collegeId: "c1" };
  const decide = async (h: Handler, status: string) => {
    state.status = status; state.method = h.method; state.path = h.url;
    forgetHeldRoles("c1", "u1");
    const held = await resolveHeldRoles(session);
    return pickEffectiveRole(held, h.roles);
  };

  beforeAll(() => { process.env.READ_ONLY_FACULTY_COLLEGES = "c1"; vi.spyOn(console, "error").mockImplementation(() => {}); });

  it("a RESIGNED and a RETIRED login get NO role for any guarded mutating route", async () => {
    const guarded = mutating().filter((h) => h.guarded && h.roles.length > 0);
    expect(guarded.length).toBeGreaterThan(200);
    const leaks: string[] = [];
    for (const status of ["RESIGNED", "RETIRED"]) {
      for (const h of guarded) {
        // The path must never be on the read-only allow-list either (belt and braces for the method rule).
        if (isAllowedReadOnlyRequest(h.method, h.url)) leaks.push(`allow-listed ${h.method} ${h.url}`);
        if ((await decide(h, status)) !== null) leaks.push(`${status} ${h.method} ${h.url}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("control: the SAME login while ACTIVE is accepted by the routes that list its roles (the denial is the rule's doing)", async () => {
    const accepting = mutating().filter((h) => h.guarded && h.roles.some((r) => ["PANEL_MEMBER", "HOD", "VICE_PRINCIPAL", "ACADEMICS"].includes(r)));
    expect(accepting.length).toBeGreaterThan(100);
    const refused: string[] = [];
    for (const h of accepting) if ((await decide(h, "ACTIVE")) === null) refused.push(`${h.method} ${h.url}`);
    expect(refused).toEqual([]);
  });

  it("every allow-listed read is a GET (no mutating handler can ever be reached through the allow-list)", () => {
    const mutatingUrls = new Set(mutating().map((h) => `${h.method} ${h.url}`));
    for (const m of ["POST", "PATCH", "PUT", "DELETE"]) for (const h of mutating()) expect(mutatingUrls.has(`${m} ${h.url}`) ? isAllowedReadOnlyRequest(m, h.url) : false).toBe(false);
  });
});
