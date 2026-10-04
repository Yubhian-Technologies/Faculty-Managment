import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";
import { resetRateLimits } from "@/lib/security/rateLimit";

const h = vi.hoisted(() => ({ db: null as unknown as FakeFirestore }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));

import { GET, POST } from "./route";

const params = (id = "c1") => ({ params: Promise.resolve({ collegeId: id }) });
const RESUME = "https://firebasestorage.googleapis.com/v0/b/x/o/colleges%2Fc1%2Fresumes%2F1_cv.pdf?alt=media";
const apply = (over: Record<string, unknown> = {}) =>
  POST(new Request("http://x/api/public/careers/c1", { method: "POST", body: JSON.stringify({ name: "Asha Rao", email: "asha@example.com", phone: "9876543210", vacancyRequestId: "v1", resumeUrl: RESUME, ...over }) }), params());

beforeEach(() => {
  resetRateLimits();
  h.db = new FakeFirestore({
    "colleges/c1": { name: "VIT" },
    "colleges/c1/vacancyRequests/v1": { status: "APPROVED", position: "Lecturer", department: "CSE", requiredCount: 2, requestedByUid: "secret" },
    "colleges/c1/vacancyRequests/v2": { status: "PENDING", position: "Clerk", department: "ADMIN" },
  });
});

describe("GET /public/careers", () => {
  it("lists only approved openings with the fields the page shows", async () => {
    const res = await GET(new Request("http://x"), params());
    expect(await res.json()).toEqual({ college: { id: "c1", name: "VIT" }, openings: [{ id: "v1", position: "Lecturer", department: "CSE", requiredCount: 2 }] });
  });
  it("404s for an unknown college", async () => {
    expect((await GET(new Request("http://x"), params("nope"))).status).toBe(404);
  });
});

describe("POST /public/careers", () => {
  const docs = (prefix: string) => [...h.db.docs.keys()].filter((k) => k.startsWith(prefix));

  it("creates the candidate and the application together", async () => {
    expect((await apply()).status).toBe(201);
    expect(docs("colleges/c1/candidates/")).toHaveLength(1);
    const [appKey] = docs("colleges/c1/candidateApplications/");
    expect(h.db.get(appKey)).toMatchObject({ vacancyRequestId: "v1", position: "Lecturer", department: "CSE", currentStage: "DEMO", status: "PENDING" });
  });
  it("refuses a position that is not approved/open", async () => {
    expect((await apply({ vacancyRequestId: "v2" })).status).toBe(409);
    expect(docs("colleges/c1/candidates/")).toHaveLength(0);
  });
  it("refuses a resume link outside this college's folder, and bad input", async () => {
    expect((await apply({ resumeUrl: "https://evil.example/cv.pdf" })).status).toBe(400);
    expect((await apply({ email: "nope" })).status).toBe(400);
    expect((await POST(new Request("http://x", { method: "POST", body: "{oops" }), params())).status).toBe(400);
  });
});
