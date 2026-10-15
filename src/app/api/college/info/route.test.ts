import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("@/test-support/fakeFirestore").asFirestore>,
  session: { collegeId: "c1", uid: "u1", role: "PRINCIPAL" },
}));

vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeContext: async () => h.session,
}));
vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => h.db,
}));
vi.mock("@/lib/audit/safeAuditLog", () => ({
  writeAuditLogSafe: async () => undefined,
}));

import { GET, PATCH } from "./route";

function seed(collegeData: Record<string, unknown> = {}) {
  const f = new FakeFirestore();
  f.seed("colleges/c1", {
    name: "Vishnu Institute of Technology",
    code: "PA",
    affiliation: "JNTUK",
    ...collegeData,
  });
  return asFirestore(f);
}

describe("GET /api/college/info", () => {
  it("defaults to /vishnulogo.png when college has no logoUrl", async () => {
    h.db = seed({ logoUrl: "" });
    const res = await GET(new Request("http://test/api/college/info"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logoUrl).toBe("/vishnulogo.png");
    expect(body.hasCustomLogo).toBe(false);
  });

  it("returns custom logo when college has a custom logoUrl", async () => {
    h.db = seed({ logoUrl: "https://example.com/custom-logo.png" });
    const res = await GET(new Request("http://test/api/college/info"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logoUrl).toBe("https://example.com/custom-logo.png");
    expect(body.hasCustomLogo).toBe(true);
  });
});

describe("PATCH /api/college/info", () => {
  it("updates the college logoUrl", async () => {
    h.db = seed({ logoUrl: "" });
    const res = await PATCH(
      new Request("http://test/api/college/info", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: "https://example.com/new-logo.png" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logoUrl).toBe("https://example.com/new-logo.png");
    expect(body.hasCustomLogo).toBe(true);
  });

  it("resets to default /vishnulogo.png when empty string is provided", async () => {
    h.db = seed({ logoUrl: "https://example.com/existing.png" });
    const res = await PATCH(
      new Request("http://test/api/college/info", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: "" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logoUrl).toBe("/vishnulogo.png");
    expect(body.hasCustomLogo).toBe(false);
  });
});
