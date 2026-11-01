import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listeners: [] as { next: (snap: unknown) => void; error: (e: unknown) => void; unsub: ReturnType<typeof vi.fn> }[],
  fetchCalls: 0,
}));

vi.mock("firebase/firestore", () => ({
  collection: () => ({}), where: () => ({}), orderBy: () => ({}), limit: () => ({}), query: () => ({}),
  onSnapshot: (_q: unknown, next: (s: unknown) => void, error: (e: unknown) => void) => {
    const unsub = vi.fn();
    h.listeners.push({ next, error, unsub });
    return unsub;
  },
}));
vi.mock("@/lib/firebase/client", () => ({ db: {} }));
vi.mock("@/lib/api/collegeFetch", () => ({
  collegeFetch: async () => {
    h.fetchCalls++;
    return { ok: true, json: async () => ({ notifications: [{ id: "polled", toUid: "u1", read: false }] }) };
  },
}));

import { subscribeToNotifications } from "./liveFeed";


beforeEach(() => {
  h.listeners.length = 0;
  h.fetchCalls = 0;
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

// Notifications are PAUSED for cost (liveFeed.ts, commit 11e373e0): no Firestore listener and no polling -
// subscribers get an empty list once. The listener / shared-subscription / polling-fallback tests that went
// with the live feed are in commit b8796199 - bring them back with it when notifications are switched on.
describe("subscribeToNotifications (paused)", () => {
  it("gives the subscriber an empty list at once and starts nothing - no listener, no polling", async () => {
    const seen: string[][] = [];
    const off = subscribeToNotifications("c1", "u1", (items) => seen.push(items.map((n) => n.id)));
    expect(seen).toEqual([[]]);
    await new Promise((r) => setTimeout(r, 10));
    expect(h.listeners).toHaveLength(0);
    expect(h.fetchCalls).toBe(0);
    expect(() => { off(); off(); }).not.toThrow();
  });

  it("every subscriber is answered on its own", () => {
    const a = vi.fn(), b = vi.fn();
    subscribeToNotifications("c1", "u1", a)();
    subscribeToNotifications("c2", "u2", b)();
    expect(a).toHaveBeenCalledWith([]);
    expect(b).toHaveBeenCalledWith([]);
    expect(h.listeners).toHaveLength(0);
  });
});
