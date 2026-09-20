import { beforeAll, describe, expect, it } from "vitest";
import { readSession, signSession } from "./sessionToken";

beforeAll(() => { process.env.SESSION_SECRET = "test-secret"; });

describe("session token", () => {
  it("round-trips a payload, including non-ASCII", async () => {
    const token = await signSession({ uid: "u1", role: "PRINCIPAL", name: "Ñandú" });
    expect(await readSession(token)).toEqual({ uid: "u1", role: "PRINCIPAL", name: "Ñandú" });
  });
  it("rejects an edited payload", async () => {
    const token = await signSession({ uid: "u1", role: "PANEL_MEMBER" });
    const [v, , sig] = token.split(".");
    const forged = `${v}.${btoa(JSON.stringify({ uid: "u1", role: "SUPER_ADMIN" }))}.${sig}`;
    expect(await readSession(forged)).toBeNull();
  });
  it("rejects the old unsigned format and junk", async () => {
    expect(await readSession(`header.${btoa('{"role":"SUPER_ADMIN"}')}.signature`)).toBeNull();
    expect(await readSession("nonsense")).toBeNull();
    expect(await readSession(undefined)).toBeNull();
  });
});
