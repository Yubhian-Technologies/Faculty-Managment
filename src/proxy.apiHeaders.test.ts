import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

// proxy.ts stamps the HTTP method + path on every /api request so the role guard
// (lib/auth/liveRoles.ts) can give RESIGNED/RETIRED faculty read-only access. The
// values must always be the proxy's own, never the client's.
const stamped = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

describe("proxy stamps the request for the guard", () => {
  it("stamps the real method and path on API requests", async () => {
    const res = await proxy(new NextRequest("http://localhost/api/college/students?x=1", { method: "POST" }));
    expect(stamped(res, "x-fms-method")).toBe("POST");
    expect(stamped(res, "x-fms-path")).toBe("/api/college/students");   // pathname only, no query
  });

  it("OVERWRITES client-supplied values (a client cannot pretend a write is a read)", async () => {
    const res = await proxy(new NextRequest("http://localhost/api/college/students", {
      method: "PATCH",
      headers: { "x-fms-method": "GET", "x-fms-path": "/api/college/faculty/me" },
    }));
    expect(stamped(res, "x-fms-method")).toBe("PATCH");
    expect(stamped(res, "x-fms-path")).toBe("/api/college/students");
  });

  it("covers the public/auth API paths too (they simply pass through otherwise)", async () => {
    const res = await proxy(new NextRequest("http://localhost/api/auth/session", { method: "POST" }));
    expect(stamped(res, "x-fms-method")).toBe("POST");
    expect(res.status).toBe(200);
  });

  it("does not change page handling: a page request with no session still redirects to /login", async () => {
    const res = await proxy(new NextRequest("http://localhost/panel", { method: "GET" }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("public pages are still let through untouched", async () => {
    const res = await proxy(new NextRequest("http://localhost/login", { method: "GET" }));
    expect(res.headers.get("location")).toBeNull();
    expect(stamped(res, "x-fms-method")).toBeNull();
  });
});
