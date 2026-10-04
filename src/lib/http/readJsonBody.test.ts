import { describe, expect, it } from "vitest";
import { badBodyResponse, BadJsonBodyError, readJsonBody } from "./readJsonBody";

const req = (body: string) => new Request("http://x/api", { method: "POST", body });

describe("readJsonBody", () => {
  it("returns the parsed body", async () => {
    expect(await readJsonBody(req('{"a":1}'))).toEqual({ a: 1 });
  });

  it("throws the tagged error on malformed or empty JSON", async () => {
    await expect(readJsonBody(req("{oops"))).rejects.toBeInstanceOf(BadJsonBodyError);
    await expect(readJsonBody(req(""))).rejects.toBeInstanceOf(BadJsonBodyError);
  });
});

describe("badBodyResponse", () => {
  it("maps only the tagged error to a 400", async () => {
    const res = badBodyResponse(new BadJsonBodyError())!;
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Request body must be valid JSON" });
    expect(badBodyResponse(new Error("boom"))).toBeNull();
    expect(badBodyResponse(new SyntaxError("x"))).toBeNull();
  });
});
