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

const snap = (...ids: string[]) => ({ docs: ids.map((id) => ({ id, data: () => ({ toUid: "u1", read: false }) })) });

beforeEach(() => {
  h.listeners.length = 0;
  h.fetchCalls = 0;
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe("subscribeToNotifications", () => {
  it("pushes new notifications to subscribers as the listener delivers them", () => {
    const seen: string[][] = [];
    const off = subscribeToNotifications("c1", "u1", (items) => seen.push(items.map((n) => n.id)));
    h.listeners[0].next(snap("a"));
    h.listeners[0].next(snap("b", "a"));
    expect(seen).toEqual([["a"], ["b", "a"]]);
    off();
  });

  it("shares one listener between components and stops it when the last one leaves", () => {
    const a = vi.fn(), b = vi.fn();
    const offA = subscribeToNotifications("c1", "u1", a);
    h.listeners[0].next(snap("x"));
    const offB = subscribeToNotifications("c1", "u1", b);
    expect(h.listeners).toHaveLength(1);
    expect(b).toHaveBeenCalledTimes(1); // late subscriber gets the latest list at once
    offA();
    expect(h.listeners[0].unsub).not.toHaveBeenCalled();
    offB();
    expect(h.listeners[0].unsub).toHaveBeenCalledTimes(1);
  });

  it("falls back to polling the API when the listener errors", async () => {
    const seen: string[][] = [];
    const off = subscribeToNotifications("c2", "u1", (items) => seen.push(items.map((n) => n.id)));
    h.listeners[0].error(new Error("permission-denied"));
    await vi.waitFor(() => expect(seen).toEqual([["polled"]]));
    expect(h.fetchCalls).toBe(1);
    expect(h.listeners[0].unsub).toHaveBeenCalled();
    off();
  });
});
