import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, fetchJson, resetApiFetchState } from "./apiFetch";

const assign = vi.fn();
const reply = (status: number, body?: unknown) =>
  vi.fn(async () => new Response(body === undefined ? "" : JSON.stringify(body), { status }));

beforeEach(() => {
  resetApiFetchState();
  assign.mockReset();
  vi.stubGlobal("window", { location: { pathname: "/hod/students", search: "?x=1", assign } });
});
afterEach(() => vi.unstubAllGlobals());

describe("apiFetch", () => {
  it("redirects to login once on 401, remembering where the person was", async () => {
    vi.stubGlobal("fetch", reply(401, { error: "Unauthorized" }));
    await apiFetch("/api/a");
    await apiFetch("/api/b");
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/login?redirect=%2Fhod%2Fstudents%3Fx%3D1");
  });
  it("does not redirect for other statuses", async () => {
    vi.stubGlobal("fetch", reply(500, { error: "x" }));
    await apiFetch("/api/a");
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("fetchJson", () => {
  it("returns the parsed body on success", async () => {
    vi.stubGlobal("fetch", reply(200, { students: [1] }));
    expect(await fetchJson("/api/a")).toEqual({ students: [1] });
  });
  it("throws ApiError with the server message on failure", async () => {
    vi.stubGlobal("fetch", reply(409, { error: "Already exists" }));
    await expect(fetchJson("/api/a")).rejects.toMatchObject({ status: 409, message: "Already exists" });
  });
  it("still throws a readable error when the body is empty", async () => {
    vi.stubGlobal("fetch", reply(502));
    const err = (await fetchJson("/api/a").catch((e) => e)) as Error;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Request failed (502)");
  });
});
