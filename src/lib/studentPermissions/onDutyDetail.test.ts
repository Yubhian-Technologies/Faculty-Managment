import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ day: null as null | { byStudent: Record<string, Record<string, "ALL" | number[]>> }, requests: {} as Record<string, unknown> }));
vi.mock("@/lib/studentAttendance/onDuty", async (orig) => ({ ...(await orig<typeof import("@/lib/studentAttendance/onDuty")>()), loadOnDutyDay: async () => h.day }));
vi.mock("./wiring", () => ({ store: () => ({ get: async (_c: string, id: string) => h.requests[id] ?? null }) }));

import { onDutyDetailsFor } from "./onDutyDetail";

const approved = (over: object = {}) => ({
  kind: "STUDENT_PERMISSION", status: "APPROVED",
  payload: { title: "Smart India Hackathon", categoryLabel: "Hackathons", fromDate: "2026-10-10", toDate: "2026-10-12" },
  history: [
    { action: "APPROVE", actorName: "Dr. Rao", stage: "HOD", at: "x", actorUid: "h" },
    { action: "APPROVE", actorName: "Prof. Devi", stage: "PRINCIPAL", at: "y", actorUid: "p" },
  ], ...over,
});

describe("onDutyDetailsFor", () => {
  beforeEach(() => { h.day = { byStudent: { s1: { "permission:r1": [2, 3], "permission:gone": "ALL", "event:e1": "ALL" } } }; h.requests = { r1: approved() }; });

  it("returns the permission title and the final approver for a covered period", async () => {
    const d = await onDutyDetailsFor({} as never, "c", "2026-10-10", "s1", 2);
    const perm = d.find((x) => x.source === "PERMISSION")!;
    expect(perm).toMatchObject({ title: "Smart India Hackathon", grantedBy: { name: "Prof. Devi", role: "Principal" } });
  });
  it("skips a permission that does not cover the period", async () => {
    expect((await onDutyDetailsFor({} as never, "c", "2026-10-10", "s1", 5)).filter((x) => x.title)).toHaveLength(0);
  });
  it("falls back to a generic entry when the record is missing or not approved, and for non-permission sources", async () => {
    h.requests.r1 = approved({ status: "REVOKED" });
    const d = await onDutyDetailsFor({} as never, "c", "2026-10-10", "s1", 2);
    expect(d.every((x) => x.source === "OTHER" && x.title === null && x.grantedBy === null)).toBe(true);
  });
  it("returns nothing for a student or day with no on-duty coverage", async () => {
    expect(await onDutyDetailsFor({} as never, "c", "2026-10-10", "nobody", 2)).toEqual([]);
    h.day = null;
    expect(await onDutyDetailsFor({} as never, "c", "2026-10-10", "s1", 2)).toEqual([]);
  });
});
