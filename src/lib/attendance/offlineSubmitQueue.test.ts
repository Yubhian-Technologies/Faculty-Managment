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

  describe("trySyncQueue", () => {
    const respond = (status: number) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status < 400, status, json: async () => ({ error: "x" }) })));

    it.each([500, 503, 429, 408, 401])("keeps the marks queued on a transient %i", async (status) => {
      const { enqueueSubmission, getQueue, trySyncQueue } = await import("./offlineSubmitQueue");
      enqueueSubmission(baseItem);
      respond(status);
      const out = await trySyncQueue();
      expect(out).toEqual([{ sessionId: baseItem.sessionId, result: "retry", status }]);
      expect(getQueue()).toHaveLength(1);
    });

    it("stops the sweep at the first transient failure and leaves the rest queued", async () => {
      const { enqueueSubmission, getQueue, trySyncQueue } = await import("./offlineSubmitQueue");
      enqueueSubmission(baseItem);
      enqueueSubmission({ ...baseItem, sessionId: "assign1_2026-09-25_2", periodNumber: 2 });
      respond(503);
      await trySyncQueue();
      expect(getQueue()).toHaveLength(2);
    });

    it("removes the item on success", async () => {
      const { enqueueSubmission, getQueue, trySyncQueue } = await import("./offlineSubmitQueue");
      enqueueSubmission(baseItem);
      respond(200);
      expect((await trySyncQueue())[0].result).toBe("synced");
      expect(getQueue()).toHaveLength(0);
    });

    it("removes a 409 (updated / submitted elsewhere meanwhile)", async () => {
      const { enqueueSubmission, getQueue, trySyncQueue } = await import("./offlineSubmitQueue");
      enqueueSubmission(baseItem);
      respond(409);
      expect((await trySyncQueue())[0].result).toBe("conflict");
      expect(getQueue()).toHaveLength(0);
    });

    it.each([403, 400])("keeps a refused %i on the device with its reason - never silently dropped", async (status) => {
      const { enqueueSubmission, getQueue, trySyncQueue } = await import("./offlineSubmitQueue");
      enqueueSubmission(baseItem);
      respond(status);
      const first = (await trySyncQueue())[0];
      expect(first.result).toBe("rejected");
      expect(getQueue()).toHaveLength(1);
      expect(getQueue()[0].lastError).toBeTruthy();
      // The same refusal again is not announced twice.
      respond(status);
      expect((await trySyncQueue())[0]).toMatchObject({ result: "rejected", repeat: true });
    });
  });

  it("a period opened with no internet is created on the server first, then submitted - both marked offline", async () => {
    const { enqueueSubmission, getQueue, trySyncQueue } = await import("./offlineSubmitQueue");
    enqueueSubmission({ ...baseItem, isNew: true, markedAt: "2026-09-25T04:10:00.000Z" });
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return url.endsWith("/student-attendance")
        ? { ok: true, status: 201, json: async () => ({ session: { id: baseItem.sessionId } }) }
        : { ok: true, status: 200, json: async () => ({}) };
    }));
    expect((await trySyncQueue())[0].result).toBe("synced");
    expect(calls.map((c) => c.url)).toEqual(["/api/college/student-attendance", `/api/college/student-attendance/${baseItem.sessionId}`]);
    expect(calls[0].body.offline).toEqual({ markedAt: "2026-09-25T04:10:00.000Z" });
    expect(calls[1].body).toMatchObject({ submit: true, offline: { markedAt: "2026-09-25T04:10:00.000Z" } });
    expect(getQueue()).toHaveLength(0);
  });

  it("keeps queued submissions for different sessions independent", async () => {
    const { enqueueSubmission, getQueue } = await import("./offlineSubmitQueue");
    enqueueSubmission(baseItem);
    enqueueSubmission({ ...baseItem, sessionId: "assign1_2026-09-25_2", periodNumber: 2 });
    expect(getQueue()).toHaveLength(2);
  });
});
