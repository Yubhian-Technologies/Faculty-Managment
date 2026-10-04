import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";
import { EMBEDDING_LENGTH } from "@/lib/attendance/faceThreshold";

// F3: check-in / check-out compare the face on the SERVER; the client's own
// "faceVerified" flag and distance are ignored. In-memory fakes only.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeFirestore,
  session: null as null | { collegeId: string; uid: string; role: string },
}));
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async (...roles: string[]) => {
    if (!h.session || (roles.length && !roles.includes(h.session.role))) throw new Error("UNAUTHORIZED");
    return h.session;
  },
}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));
// Everything about "is today a working day / late" is out of scope here and is made neutral.
vi.mock("@/lib/attendance/workingDays", () => ({ isWorkingDayForRole: async () => true }));
vi.mock("@/lib/leave/holidaysCount", () => ({ getHolidayNameForDate: async () => null }));
vi.mock("@/lib/leave/leaveStatusToday", () => ({ isOnApprovedLeaveToday: async () => false }));
vi.mock("@/lib/attendance/checkInPermission", () => ({ resolveCheckInPermission: async () => undefined }));
vi.mock("@/lib/attendance/lateStatus", () => ({ isLateCheckIn: () => false }));
vi.mock("@/lib/leave/lateAttendancePenalty", () => ({ recordLateCheckIn: async () => {} }));

import { POST as checkIn } from "./check-in/route";
import { POST as checkOut } from "./check-out/route";

const C = "colleges/c1";
// Wednesday 2026-10-07, 12:00 IST.
const NOW = new Date("2026-10-07T06:30:00Z").getTime();
const DAY = "2026-10-07";
const base = (v: number) => Array.from({ length: EMBEDDING_LENGTH }, () => v);
const away = (d: number) => { const a = base(0); a[0] = d; return a; };
const CAMPUS = { shape: "circle", latitude: 17.0, longitude: 82.0, radiusMeters: 300 };
const post = (handler: (r: Request) => Promise<Response>, body: Record<string, unknown>) =>
  handler(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const good = (over: Record<string, unknown> = {}) => ({
  latitude: 17.0001, longitude: 82.0001, accuracy: 15, faceDescriptor: away(0.2), capturedAt: NOW - 3_000, ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.session = { collegeId: "c1", uid: "u1", role: "PANEL_MEMBER" };
  h.db = new FakeFirestore({
    [C]: { campusLocation: CAMPUS },
    [`${C}/users/u1`]: { name: "Dr Rao", department: "CSE" },
    [`${C}/facultyMembers/f1`]: { userUid: "u1", faceEmbedding: base(0) },
  });
});
afterEach(() => vi.useRealTimers());

describe("POST /attendance/check-in (F3)", () => {
  it("records the check-in with SERVER-computed distance and evidence", async () => {
    const res = await post(checkIn, good());
    expect(res.status).toBe(200);
    const rec = h.db.get(`${C}/attendanceRecords/u1_${DAY}`)!;
    expect(rec).toMatchObject({ status: "PRESENT", checkInVerified: true, source: "BIOMETRIC" });
    expect(rec.checkInFaceMatchDistance as number).toBeCloseTo(0.2);
    expect(rec.checkInProof).toMatchObject({ method: "SERVER_DESCRIPTOR_MATCH", accuracyMeters: 15 });
  });

  it("ignores a client-supplied 'faceVerified: true' and distance - a wrong face is 403 and writes nothing", async () => {
    const res = await post(checkIn, good({ faceDescriptor: away(0.9), faceVerified: true, faceMatchDistance: 0.01 }));
    expect(res.status).toBe(403);
    expect(h.db.get(`${C}/attendanceRecords/u1_${DAY}`)).toBeUndefined();
  });

  it("the old request shape (verified flag + coordinates, no descriptor) is refused with 400", async () => {
    const res = await post(checkIn, { latitude: 17.0001, longitude: 82.0001, faceVerified: true, faceMatchDistance: 0.1 });
    expect(res.status).toBe(400);
    expect(h.db.get(`${C}/attendanceRecords/u1_${DAY}`)).toBeUndefined();
  });

  it("refuses a stale capture, an imprecise fix, and a person with no registered face", async () => {
    expect((await post(checkIn, good({ capturedAt: NOW - 11 * 60_000 }))).status).toBe(400);
    expect((await post(checkIn, good({ accuracy: 900 }))).status).toBe(400);
    h.db.docs.set(`${C}/facultyMembers/f1`, { userUid: "u1" });
    expect((await post(checkIn, good())).status).toBe(409);
    expect(h.db.get(`${C}/attendanceRecords/u1_${DAY}`)).toBeUndefined();
  });

  it("still enforces the campus geofence after the face check", async () => {
    const res = await post(checkIn, good({ latitude: 17.5, longitude: 82.5 }));
    expect(res.status).toBe(403);
    expect(h.db.get(`${C}/attendanceRecords/u1_${DAY}`)).toBeUndefined();
  });

  it("a second check-in the same day is 409 and keeps the first record", async () => {
    await post(checkIn, good());
    const first = h.db.get(`${C}/attendanceRecords/u1_${DAY}`)!.checkIn;
    vi.setSystemTime(NOW + 3_600_000);
    expect((await post(checkIn, good({ capturedAt: NOW + 3_600_000 - 1000 }))).status).toBe(409);
    expect(h.db.get(`${C}/attendanceRecords/u1_${DAY}`)!.checkIn).toBe(first);
  });

  it("missing location is 400; unauthenticated is 401", async () => {
    expect((await post(checkIn, { faceDescriptor: away(0.1), capturedAt: NOW, accuracy: 10 })).status).toBe(400);
    h.session = null;
    expect((await post(checkIn, good())).status).toBe(401);
  });
});

describe("POST /attendance/check-out (F3)", () => {
  beforeEach(async () => {
    expect((await post(checkIn, good())).status).toBe(200);
    vi.setSystemTime(NOW + 4 * 3_600_000);
  });
  const out = (over: Record<string, unknown> = {}) => good({ capturedAt: NOW + 4 * 3_600_000 - 2000, ...over });

  it("records the check-out with server-computed evidence", async () => {
    const res = await post(checkOut, out());
    expect(res.status).toBe(200);
    const rec = h.db.get(`${C}/attendanceRecords/u1_${DAY}`)!;
    expect(rec).toMatchObject({ checkOutVerified: true });
    expect(rec.checkOutFaceMatchDistance as number).toBeCloseTo(0.2);
    expect(rec.checkOutProof).toMatchObject({ method: "SERVER_DESCRIPTOR_MATCH" });
  });

  it("a wrong face or a missing descriptor cannot check someone out", async () => {
    expect((await post(checkOut, out({ faceDescriptor: away(1.5), faceVerified: true }))).status).toBe(403);
    expect((await post(checkOut, { latitude: 17.0001, longitude: 82.0001, faceVerified: true })).status).toBe(400);
    expect(h.db.get(`${C}/attendanceRecords/u1_${DAY}`)!.checkOut).toBeUndefined();
  });

  it("cannot check out twice, or without having checked in", async () => {
    expect((await post(checkOut, out())).status).toBe(200);
    expect((await post(checkOut, out())).status).toBe(409);
    h.session = { collegeId: "c1", uid: "u2", role: "PANEL_MEMBER" };
    h.db.docs.set(`${C}/facultyMembers/f2`, { userUid: "u2", faceEmbedding: base(0) });
    expect((await post(checkOut, out())).status).toBe(409);
  });
});
