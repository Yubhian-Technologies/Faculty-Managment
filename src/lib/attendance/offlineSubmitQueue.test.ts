import { beforeEach, describe, expect, it, vi } from "vitest";

// vitest.config.mts runs these under environment: "node" (no jsdom), so
// localStorage isn't a global here the way it would be in a browser - a
// minimal in-memory polyfill is enough to exercise the module's own
// read/write/dedup logic without pulling in a full DOM environment.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}

const baseItem = {
  sessionId: "assign1_2026-09-25_1",
  assignmentId: "assign1",
  date: "2026-09-25",
  periodNumber: 1,
  subjectName: "Physics",
  sectionName: "A",
  entries: [{ studentId: "s1", status: "PRESENT" as const }],
  classNotes: "Covered chapter 3",
};

describe("offlineSubmitQueue", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
  });

  it("starts empty", async () => {
    const { getQueue } = await import("./offlineSubmitQueue");
    expect(getQueue()).toEqual([]);
  });

  it("enqueues a submission and it shows up in the queue", async () => {
    const { enqueueSubmission, getQueue } = await import("./offlineSubmitQueue");
    enqueueSubmission(baseItem);
    const queue = getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].sessionId).toBe(baseItem.sessionId);
    expect(queue[0].classNotes).toBe("Covered chapter 3");
  });

  it("replaces the prior queued attempt for the same session instead of stacking a duplicate", async () => {
    const { enqueueSubmission, getQueue } = await import("./offlineSubmitQueue");
    enqueueSubmission(baseItem);
    enqueueSubmission({ ...baseItem, classNotes: "Edited before reconnecting" });
    const queue = getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].classNotes).toBe("Edited before reconnecting");
  });

  it("keeps queued submissions for different sessions independent", async () => {
    const { enqueueSubmission, getQueue } = await import("./offlineSubmitQueue");
    enqueueSubmission(baseItem);
    enqueueSubmission({ ...baseItem, sessionId: "assign1_2026-09-25_2", periodNumber: 2 });
    expect(getQueue()).toHaveLength(2);
  });
});
