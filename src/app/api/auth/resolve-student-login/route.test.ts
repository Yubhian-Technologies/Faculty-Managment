import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";
import { resetRateLimits } from "@/lib/security/rateLimit";

const h = vi.hoisted(() => ({ db: null as unknown as FakeFirestore }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));

import { POST } from "./route";

let ipCounter = 0;
const post = (body: unknown, ip?: string, raw = false) =>
  POST(
    new Request("http://localhost/api/auth/resolve-student-login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip ?? `10.0.0.${++ipCounter}` },
      body: raw ? (body as string) : JSON.stringify(body),
    })
  );

beforeEach(() => {
  resetRateLimits();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.db = new FakeFirestore({
    "studentUsernames/R1": { rollKey: "r1", loginEmail: "r1@students.internal", active: true },
    "studentUsernames/R2": { rollKey: "r2", loginEmail: "r2@students.internal", active: true },
    "studentUsernames/24-PA1A0501": { loginEmail: "24-pa1a0501@students.internal" },
  });
});

describe("POST /api/auth/resolve-student-login (S2/S3)", () => {
  it("returns the login email for a known roll, in any case or formatting", async () => {
    for (const typed of ["R2", "r2", " r-2 "]) {
      const res = await post({ rollNumber: typed });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ loginEmail: "r2@students.internal", loginEmails: ["r2@students.internal"] });
    }
  });

  it("finds a legacy punctuated account too", async () => {
    const body = await (await post({ rollNumber: "24-pa1a0501" })).json();
    expect(body.loginEmails).toEqual(["24-pa1a0501@students.internal"]);
  });

  it("answers an UNKNOWN roll the same way (200 + placeholder email) so rolls cannot be enumerated", async () => {
    const known = await post({ rollNumber: "R2" });
    const unknown = await post({ rollNumber: "ZZZ999" });
    expect(unknown.status).toBe(known.status);
    const body = await unknown.json();
    expect(Object.keys(body).sort()).toEqual(["loginEmail", "loginEmails"]);
    expect(body.loginEmail).toBe("zzz999@students.internal");
  });

  it("malformed JSON, missing roll, non-string roll and absurd lengths are 400, never 500", async () => {
    expect((await post("{not json", undefined, true)).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ rollNumber: "   " })).status).toBe(400);
    expect((await post({ rollNumber: 12345 })).status).toBe(400);
    expect((await post({ rollNumber: { $ne: 1 } })).status).toBe(400);
    expect((await post({ rollNumber: "A".repeat(500) })).status).toBe(400);
    expect((await post(null as never)).status).toBe(400);
  });

  it("rate limits one address (429 with Retry-After) without affecting another address", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 35; i++) statuses.push((await post({ rollNumber: `U${i}` }, "9.9.9.9")).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(30).every((s) => s === 429)).toBe(true);
    const limited = await post({ rollNumber: "U99" }, "9.9.9.9");
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await post({ rollNumber: "U1" }, "8.8.8.8")).status).toBe(200);
  });

  it("rate limits probing of ONE roll from many addresses", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) statuses.push((await post({ rollNumber: "R2" })).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(4);
  });

  it("a Firestore failure is a generic 500 that leaks nothing", async () => {
    h.db.collection = (() => { throw new Error("secret internal detail"); }) as never;
    const res = await post({ rollNumber: "R2" });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/secret/);
  });
});
