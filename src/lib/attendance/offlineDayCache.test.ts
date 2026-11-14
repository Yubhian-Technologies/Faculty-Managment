import { beforeEach, describe, expect, it, vi } from "vitest";

// The saved day for Mark Attendance with no internet: today's copy when there is one, else the latest copy of the
// same weekday (re-keyed to today, the old day's attendance dropped); another login's copy is never used.

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
  };
}

const period = (date: string, over: Record<string, unknown> = {}) => ({
  assignmentId: "a1", periodNumber: 2, sessionId: `a1_${date}_2`, session: { status: "SUBMITTED" }, sessionStatus: "SUBMITTED",
  roster: [{ studentId: "s1", rollNumber: "1", name: "A", status: null }], ...over,
});

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
});

describe("offlineDayCache", () => {
  it("returns today's saved classes as they were saved", async () => {
    const { saveDay, loadDay } = await import("./offlineDayCache");
    saveDay("u1", "2026-11-16", [period("2026-11-16")]);
    const day = loadDay<ReturnType<typeof period>>("u1", "2026-11-16");
    expect(day?.fromDate).toBeUndefined();
    expect(day?.periods[0].sessionStatus).toBe("SUBMITTED");
  });

  it("falls back to the latest same-weekday copy, re-keyed to today with the old attendance dropped", async () => {
    const { saveDay, loadDay } = await import("./offlineDayCache");
    saveDay("u1", "2026-11-02", [period("2026-11-02", { periodNumber: 1, sessionId: "a1_2026-11-02_1" })]); // Monday
    saveDay("u1", "2026-11-09", [period("2026-11-09")]); // Monday
    saveDay("u1", "2026-11-10", [period("2026-11-10", { assignmentId: "tue" })]); // Tuesday
    const day = loadDay<ReturnType<typeof period>>("u1", "2026-11-16"); // Monday, never saved
    expect(day?.fromDate).toBe("2026-11-09");
    expect(day?.date).toBe("2026-11-16");
    expect(day?.periods[0]).toMatchObject({ assignmentId: "a1", sessionId: "a1_2026-11-16_2", session: null, sessionStatus: null });
    expect(day?.periods[0].roster).toHaveLength(1);
  });

  it("has nothing for a weekday never saved, or for another login", async () => {
    const { saveDay, loadDay } = await import("./offlineDayCache");
    saveDay("u1", "2026-11-10", [period("2026-11-10")]); // Tuesday
    expect(loadDay("u1", "2026-11-16")).toBeNull();
    expect(loadDay("someone-else", "2026-11-10")).toBeNull();
  });

  it("keeps only the latest few days", async () => {
    const { saveDay, loadDay } = await import("./offlineDayCache");
    for (let d = 1; d <= 12; d++) saveDay("u1", `2026-11-${String(d).padStart(2, "0")}`, [period("x")]);
    expect(loadDay("u1", "2026-11-01")).toBeNull();
    expect(loadDay("u1", "2026-11-12")).not.toBeNull();
  });
});
