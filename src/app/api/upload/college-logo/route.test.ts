import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("@/test-support/fakeFirestore").asFirestore>,
  session: { collegeId: "c1", uid: "u1", role: "PRINCIPAL" },
  savedFiles: [] as { path: string; buffer: Buffer; contentType: string }[],
}));

vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeContext: async () => h.session,
}));
vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => h.db,
  getAdminStorage: () => ({
    bucket: () => ({
      name: "test-bucket",
      file: (path: string) => ({
        save: async (buffer: Buffer, opts: { metadata: { contentType: string } }) => {
          h.savedFiles.push({ path, buffer, contentType: opts.metadata.contentType });
        },
      }),
    }),
  }),
}));
vi.mock("@/lib/audit/safeAuditLog", () => ({
  writeAuditLogSafe: async () => undefined,
}));

import { POST } from "./route";

function seed() {
  const f = new FakeFirestore();
  f.seed("colleges/c1", { name: "Test College", logoUrl: "" });
  return asFirestore(f);
}

describe("POST /api/upload/college-logo", () => {
  beforeEach(() => {
    h.db = seed();
    h.savedFiles = [];
  });

  it("returns 400 when no file is provided", async () => {
    const formData = new FormData();
    const res = await POST(new Request("http://test/api/upload/college-logo", {
      method: "POST",
      body: formData,
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("No image file provided");
  });

  it("returns 400 for unsupported file types", async () => {
    const formData = new FormData();
    const blob = new Blob(["not an image"], { type: "text/plain" });
    formData.append("file", blob, "test.txt");

    const res = await POST(new Request("http://test/api/upload/college-logo", {
      method: "POST",
      body: formData,
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Only PNG, JPEG, WEBP, or SVG");
  });

  it("successfully uploads image, saves to storage, and updates college document", async () => {
    const formData = new FormData();
    const imageBlob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    formData.append("file", imageBlob, "logo.png");

    const res = await POST(new Request("http://test/api/upload/college-logo", {
      method: "POST",
      body: formData,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.url).toContain("https://firebasestorage.googleapis.com");
    expect(body.hasCustomLogo).toBe(true);

    expect(h.savedFiles).toHaveLength(1);
    expect(h.savedFiles[0].contentType).toBe("image/png");
    expect(h.savedFiles[0].path).toMatch(/^colleges\/c1\/logo_\d+\.png$/);
  });
});
