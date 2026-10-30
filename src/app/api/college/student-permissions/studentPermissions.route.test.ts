import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// HTTP behaviour of the student-permission routes: who gets in, which service call a request becomes, and what an error looks
// like. The service itself (rules, engine) has its own tests, so it is mocked here - this pins the routes' wiring.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeFirestore,
  session: { uid: "u1", role: "STUDENT", roles: ["STUDENT"], collegeId: "c1", email: "u1@x.com" } as Record<string, unknown>,
  deny: false,
}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async (...roles: string[]) => {
    if (h.deny || !roles.includes(h.session.role as string)) throw new Error("UNAUTHORIZED");
    return h.session;
  },
}));
vi.mock("@/lib/studentPermissions/service", async (orig) => ({
  ...(await orig<typeof import("@/lib/studentPermissions/service")>()),
  createStudentRequest: vi.fn(async () => ({ id: "r1" })),
  createFacultyRequests: vi.fn(async () => [{ id: "r2" }]),
  listMine: vi.fn(async () => [{ id: "mine" }]),
  listInbox: vi.fn(async () => [{ id: "inbox" }]),
  listForOversight: vi.fn(async () => [{ id: "all" }]),
  decide: vi.fn(async () => ({ id: "r1", status: "APPROVED" })),
  cancelRequest: vi.fn(async () => ({ id: "r1", status: "CANCELLED" })),
  revokeRequest: vi.fn(async () => ({ id: "r1", status: "REVOKED" })),
  retryEffects: vi.fn(async () => ({ id: "r1" })),
}));

import * as service from "@/lib/studentPermissions/service";
import { ApprovalError } from "@/lib/approvals";
import { GET, POST } from "./route";
import { PATCH } from "./[id]/route";

const as = (role: string, roles = [role]) => { h.session = { uid: "u1", role, roles, collegeId: "c1", email: "u1@x.com" }; };
const post = (body: unknown) => new Request("http://x/api/college/student-permissions", { method: "POST", body: JSON.stringify(body) });
const get = (qs = "") => new Request(`http://x/api/college/student-permissions${qs}`);
const patch = (body: unknown) => new Request("http://x/api/college/student-permissions/r1", { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) });
const ctx = { params: Promise.resolve({ id: "r1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.deny = false;
  h.db = new FakeFirestore({ "colleges/c1/users/u1": { name: "Test User" } });
  as("STUDENT");
});

describe("POST /api/college/student-permissions", () => {
  it("a student raises a request for themselves", async () => {
    const res = await POST(post({ title: "x" }));
    expect(res.status).toBe(201);
    expect(service.createStudentRequest).toHaveBeenCalledOnce();
    expect(service.createFacultyRequests).not.toHaveBeenCalled();
    expect((vi.mocked(service.createStudentRequest).mock.calls[0][1] as { uid: string }).uid).toBe("u1");
  });
  it("faculty raise requests for the students they pick", async () => {
    as("PANEL_MEMBER");
    const res = await POST(post({ studentIds: ["s1"] }));
    expect(res.status).toBe(201);
    expect(service.createFacultyRequests).toHaveBeenCalledOnce();
    expect(service.createStudentRequest).not.toHaveBeenCalled();
  });
  it("the Principal can raise a request for students", async () => {
    as("PRINCIPAL");
    const res = await POST(post({ studentIds: ["s1"] }));
    expect(res.status).toBe(201);
    expect(service.createFacultyRequests).toHaveBeenCalledOnce();
  });
  it("no session is a 401, and a role outside the module never reaches the service", async () => {
    h.deny = true;
    expect((await POST(post({}))).status).toBe(401);
    h.deny = false;
    as("COLLEGE_OFFICE");
    expect((await POST(post({}))).status).toBe(401);
    expect(service.createStudentRequest).not.toHaveBeenCalled();
  });
  it("a service refusal comes back with its own status and message, never a stack trace", async () => {
    vi.mocked(service.createStudentRequest).mockRejectedValueOnce(new ApprovalError("INVALID", "A request can cover at most 15 days", 400));
    const res = await POST(post({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "A request can cover at most 15 days", code: "INVALID" });
  });
  it("an unexpected error is a plain 500 that leaks nothing", async () => {
    vi.mocked(service.createStudentRequest).mockRejectedValueOnce(new Error("firestore exploded: secret detail"));
    const res = await POST(post({}));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal error" });
  });
});

describe("GET /api/college/student-permissions", () => {
  it("'mine' is open to a student", async () => {
    const res = await GET(get("?view=mine"));
    expect(res.status).toBe(200);
    expect(service.listMine).toHaveBeenCalledOnce();
  });
  it("a student-only login gets an empty inbox without any lookup", async () => {
    const res = await GET(get("?view=inbox"));
    expect(await res.json()).toEqual({ requests: [] });
    expect(service.listInbox).not.toHaveBeenCalled();
  });
  it("a student cannot read the oversight view", async () => {
    const res = await GET(get("?view=oversight"));
    expect(res.status).toBe(403);
    expect(service.listForOversight).not.toHaveBeenCalled();
  });
  it("an HOD, Vice Principal and Principal can read the oversight view", async () => {
    for (const role of ["HOD", "VICE_PRINCIPAL", "PRINCIPAL"]) {
      as(role);
      expect((await GET(get("?view=oversight"))).status).toBe(200);
    }
    expect(service.listForOversight).toHaveBeenCalledTimes(3);
  });
  it("an unknown view is a 400", async () => {
    expect((await GET(get("?view=everything"))).status).toBe(400);
  });
});

describe("PATCH /api/college/student-permissions/[id]", () => {
  it("APPROVE and REJECT go to decide with the remark, trimmed to 500 characters", async () => {
    as("HOD");
    expect((await PATCH(patch({ action: "APPROVE", remark: "ok" }), ctx)).status).toBe(200);
    expect(service.decide).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ uid: "u1" }), "r1", "APPROVE", "ok");
    await PATCH(patch({ action: "REJECT", remark: "x".repeat(900) }), ctx);
    expect(vi.mocked(service.decide).mock.calls[1][4]).toHaveLength(500);
    expect(vi.mocked(service.decide).mock.calls[1][3]).toBe("REJECT");
  });
  it("CANCEL, REVOKE and RETRY reach their own service calls", async () => {
    await PATCH(patch({ action: "CANCEL" }), ctx);
    await PATCH(patch({ action: "REVOKE", remark: "wrong dates" }), ctx);
    await PATCH(patch({ action: "RETRY" }), ctx);
    expect(service.cancelRequest).toHaveBeenCalledOnce();
    expect(service.revokeRequest).toHaveBeenCalledWith(expect.anything(), expect.anything(), "r1", "wrong dates");
    expect(service.retryEffects).toHaveBeenCalledOnce();
  });
  it("an unknown action, a missing action and a malformed body are 400s that change nothing", async () => {
    expect((await PATCH(patch({ action: "DELETE" }), ctx)).status).toBe(400);
    expect((await PATCH(patch({}), ctx)).status).toBe(400);
    expect((await PATCH(patch("{not json"), ctx)).status).toBe(400);
    expect(service.decide).not.toHaveBeenCalled();
  });
  it("no session is a 401", async () => {
    h.deny = true;
    expect((await PATCH(patch({ action: "APPROVE" }), ctx)).status).toBe(401);
    expect(service.decide).not.toHaveBeenCalled();
  });
  it("a refusal from the engine (not your stage) is passed through as a 403", async () => {
    vi.mocked(service.decide).mockRejectedValueOnce(new ApprovalError("FORBIDDEN", "You can't decide this request", 403));
    const res = await PATCH(patch({ action: "APPROVE" }), ctx);
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe("You can't decide this request");
  });
});
