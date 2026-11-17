import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";
import { EMBEDDING_LENGTH } from "@/lib/attendance/faceThreshold";

// Re-registering a face, or removing the registered phone, is refused to the person themselves - the HOD resets.
const h = vi.hoisted(() => ({ db: null as unknown as FakeFirestore }));
vi.mock("@/lib/auth/verifySession", () => ({ requireCollegeMember: async () => ({ collegeId: "c1", uid: "u1", role: "PANEL_MEMBER" }) }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));
vi.mock("@/lib/attendance/registrationNotice", () => ({ noticeRegistration: async () => {} }));

import { POST as registerFace } from "./face-registration/route";
import { DELETE as removePhone } from "./passkey/route";

const C = "colleges/c1";
const face = Array.from({ length: EMBEDDING_LENGTH }, () => 0.1);
const post = (body: unknown) => registerFace(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("self check-in registration changes", () => {
  beforeEach(() => {
    h.db = new FakeFirestore({ [`${C}/facultyMembers/f1`]: { userUid: "u1" } });
  });

  it("the first face registration is self-service; a second one is refused", async () => {
    expect((await post({ embeddings: [face] })).status).toBe(200);
    const again = await post({ embeddings: [face] });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toMatch(/HOD/);
  });

  it("the registered phone can't be removed by the person", async () => {
    const res = await removePhone();
    expect(res.status).toBe(403);
  });
});
