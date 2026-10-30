import { describe, expect, it, vi } from "vitest";

// Settings > Website Display Name end to end on an in-memory Firestore: save a tick, read it back, and the names a
// ticked place swaps in (Display Name + honorific) - only for people who filled in BOTH parts.

const store = new Map<string, Record<string, unknown>>();
const fakeDb = {
  collection(path: string) {
    const col = (p: string) => ({
      doc: (id: string) => ({
        collection: (sub: string) => col(`${p}/${id}/${sub}`),
        get: async () => ({ data: () => store.get(`${p}/${id}`), exists: store.has(`${p}/${id}`) }),
        set: async (v: Record<string, unknown>) => { store.set(`${p}/${id}`, v); },
      }),
      add: async (v: Record<string, unknown>) => { store.set(`${p}/${store.size}-${Math.random()}`, v); return { id: "x" }; },
      where: () => ({
        select: () => ({ get: async () => ({ docs: [...store.entries()].filter(([k]) => k.startsWith(`${p}/`)).map(([k, v]) => ({ id: k.slice(p.length + 1), data: () => v })) }) }),
        get: async () => ({
          docs: [...store.entries()].filter(([k]) => k.startsWith(`${p}/`)).map(([k, v]) => ({ id: k.slice(p.length + 1), data: () => v })),
        }),
      }),
    });
    return col(path);
  },
};
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => fakeDb }));
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async () => ({ uid: "admin", email: "a@b.c", role: "PRINCIPAL", collegeId: "c1" }),
  requireCollegeContext: async () => ({ uid: "u1", role: "PANEL_MEMBER", collegeId: "c1" }),
}));
vi.mock("@/lib/http/readJsonBody", () => ({ readJsonBody: async (r: Request) => r.json(), badBodyResponse: () => null }));

describe("display name settings round trip", () => {
  it("keeps a saved tick and swaps in Display Name + honorific only for people who filled both parts", async () => {
    const route = await import("./route");
    const names = await import("../../faculty-display-names/route");
    store.set("colleges/c1/facultyMembers/f1", { displaySurname: "MS", displayName: "SRI LAKSHMI", honorific: "Mrs.", userUid: "u1" });
    store.set("colleges/c1/facultyMembers/f2", { displaySurname: "AB" });

    expect(await (await names.GET(new Request("http://x"))).json()).toEqual({ names: {} }); // nothing ticked

    const put = await route.PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ surfaces: { dashboardName: true } }) }));
    expect(put.status).toBe(200);
    const got = await (await route.GET()).json();
    expect(got.surfaces.dashboardName).toBe(true);
    expect(got.surfaces.publicProfile).toBe(false);
    expect(got.filled).toBe(1); // f2 has only the surname

    expect(await (await names.GET(new Request("http://x"))).json()).toEqual({ names: { f1: "Mrs.MS.SRI LAKSHMI", u1: "Mrs.MS.SRI LAKSHMI" } });
  });
});
