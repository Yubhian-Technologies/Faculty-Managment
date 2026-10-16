import { describe, it, expect, vi } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("@/test-support/fakeFirestore").asFirestore>,
  session: { collegeId: "c1", uid: "u1", role: "PRINCIPAL", email: "p@x.in" },
}));

vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async () => h.session,
  requireCollegeContext: async () => h.session,
}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));
vi.mock("@/lib/audit/safeAuditLog", () => ({ writeAuditLogSafe: async () => undefined }));

import { GET as getSettings, PUT } from "./route";
import { GET as getInfo } from "../../info/route";

describe("timetable signature authority round trip", () => {
  it("saved ticks come back from /api/college/info as rows", async () => {
    const f = new FakeFirestore();
    f.seed("colleges/c1", { name: "C" });
    h.db = asFirestore(f);

    const put = await PUT(new Request("http://t", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groups: [{ id: "g1", name: "Group 1", designations: [
          { label: "Timetable In-Charge", selected: true },
          { label: "HOD", selected: true },
          { label: "Dean", selected: false },
          { label: "Principal", selected: true },
        ] }],
      }),
    }));
    expect(put.status).toBe(200);

    const settings = await (await getSettings()).json();
    expect(settings.groups[0].designations).toHaveLength(4);

    const info = await (await getInfo(new Request("http://t/api/college/info"))).json();
    expect(info.timetableSignatureRows).toEqual([["Timetable In-Charge", "HOD", "Principal"]]);
  });
});
