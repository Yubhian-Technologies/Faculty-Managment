import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fail: true, role: "HOD" as string }));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => ({
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => {
              if (h.fail) throw new Error("firestore unavailable");
              return { exists: true, data: () => ({ role: h.role, seatRoles: [], isActive: true }) };
            },
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/leave/roleDelegation", () => ({ activeDelegatedRoles: async () => ({ roles: [] }) }));

import { resolveHeldRoles, forgetHeldRoles } from "./liveRoles";

const session = { uid: "u1", role: "HOD", roles: ["HOD"], collegeId: "c1" };

describe("resolveHeldRoles when the live lookup fails", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    forgetHeldRoles("c1", "u1");
  });

  it("holds no roles (fails closed) rather than trusting the cookie snapshot", async () => {
    h.fail = true;
    expect(await resolveHeldRoles(session)).toEqual([]);
  });

  it("keeps serving a recent cached answer through a short outage", async () => {
    h.fail = false;
    expect(await resolveHeldRoles(session)).toEqual(["HOD"]);
    h.fail = true;
    // within the 20s cache window the hit is returned without any lookup at all
    expect(await resolveHeldRoles(session)).toEqual(["HOD"]);
  });
});
