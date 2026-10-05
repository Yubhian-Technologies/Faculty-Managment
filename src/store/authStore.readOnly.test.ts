import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "@/store/authStore";
import type { FMSUser } from "@/types";

// The read-only flag (RESIGNED/RETIRED faculty) used to be dropped whenever a caller replaced the stored
// user with a copy that had never heard of it - the login page, a refreshed profile, a photo update.

const base = (extra: Partial<FMSUser> = {}): FMSUser => ({
  uid: "u1", collegeId: "c1", name: "Dr X", email: "x@y.z", role: "PANEL_MEMBER", isActive: true, createdAt: {} as never, ...extra,
});

beforeEach(() => { useAuthStore.setState({ user: null, selectedCollegeId: null }); });

describe("authStore.setUser keeps read-only access", () => {
  it("a later copy of the SAME person that does not mention it keeps the flag and the trimmed roles", () => {
    const { setUser } = useAuthStore.getState();
    setUser(base({ readOnlyAccess: true, roles: ["PANEL_MEMBER"] }));
    setUser(base({ name: "Dr X Updated", roles: ["PANEL_MEMBER", "HOD"] }));   // e.g. a fresh Firestore profile / photo update
    expect(useAuthStore.getState().user).toMatchObject({ name: "Dr X Updated", readOnlyAccess: true, roles: ["PANEL_MEMBER"] });
  });

  it("an explicit `false` from the server clears it (reinstated) and `true` sets it", () => {
    const { setUser } = useAuthStore.getState();
    setUser(base({ readOnlyAccess: true, roles: ["PANEL_MEMBER"] }));
    setUser(base({ readOnlyAccess: false, roles: ["PANEL_MEMBER", "HOD"] }));
    expect(useAuthStore.getState().user?.readOnlyAccess).toBe(false);
    expect(useAuthStore.getState().user?.roles).toEqual(["PANEL_MEMBER", "HOD"]);
    setUser(base({ readOnlyAccess: true, roles: ["PANEL_MEMBER"] }));
    expect(useAuthStore.getState().user?.readOnlyAccess).toBe(true);
  });

  it("never leaks to a DIFFERENT person signing in on the same browser", () => {
    const { setUser } = useAuthStore.getState();
    setUser(base({ readOnlyAccess: true, roles: ["PANEL_MEMBER"] }));
    setUser(base({ uid: "u2", roles: ["PANEL_MEMBER", "HOD"] }));
    expect(useAuthStore.getState().user?.readOnlyAccess).toBeUndefined();
    expect(useAuthStore.getState().user?.roles).toEqual(["PANEL_MEMBER", "HOD"]);
  });

  it("an ACTIVE faculty member's store is unchanged by all this (no flag appears)", () => {
    const { setUser } = useAuthStore.getState();
    setUser(base({ roles: ["PANEL_MEMBER", "HOD"] }));
    setUser(base({ name: "Renamed" }));
    expect(useAuthStore.getState().user).toMatchObject({ name: "Renamed" });
    expect(useAuthStore.getState().user?.readOnlyAccess).toBeUndefined();
  });

  it("logout clears it", () => {
    useAuthStore.getState().setUser(base({ readOnlyAccess: true }));
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().user).toBeNull();
  });
});
