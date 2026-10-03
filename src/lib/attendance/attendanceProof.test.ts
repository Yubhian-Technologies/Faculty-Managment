import { describe, it, expect } from "vitest";
import { fakeFs } from "@/lib/testing/fakeFirestore.testutil";
import { MAX_LOCATION_ACCURACY_M, MAX_PROOF_AGE_MS, MAX_PROOF_FUTURE_MS, verifyAttendanceProof } from "@/lib/attendance/attendanceProof";
import { EMBEDDING_LENGTH, FACE_MATCH_THRESHOLD, euclideanDistance, isValidDescriptor } from "@/lib/attendance/faceThreshold";

const NOW = 1_800_000_000_000;
const base = (v: number) => Array.from({ length: EMBEDDING_LENGTH }, () => v);
/** A descriptor exactly `d` away from base(0) along the first axis. */
const away = (d: number) => { const a = base(0); a[0] = d; return a; };

function setup(seed: Record<string, Record<string, unknown>> = {}) {
  return fakeFs({
    "colleges/c1/facultyMembers/f1": { userUid: "u1", faceEmbedding: base(0) },
    ...seed,
  });
}
const good = (over: Record<string, unknown> = {}) => ({ faceDescriptor: away(0.1), capturedAt: NOW - 5_000, accuracy: 20, ...over });

describe("faceThreshold helpers", () => {
  it("validates descriptors strictly", () => {
    expect(isValidDescriptor(base(0))).toBe(true);
    expect(isValidDescriptor(base(0).slice(1))).toBe(false);
    expect(isValidDescriptor([...base(0).slice(1), NaN])).toBe(false);
    expect(isValidDescriptor([...base(0).slice(1), "1"])).toBe(false);
    expect(isValidDescriptor(null)).toBe(false);
  });
  it("euclideanDistance is the L2 norm", () => {
    expect(euclideanDistance([0, 0], [3, 4])).toBe(5);
  });
});

describe("verifyAttendanceProof (F3: the server does the face comparison)", () => {
  it("accepts a close descriptor and returns server-computed evidence", async () => {
    const { firestore } = setup();
    const res = await verifyAttendanceProof(firestore, "c1", "u1", good(), NOW);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.distance).toBeCloseTo(0.1);
      expect(res.evidence).toMatchObject({ method: "SERVER_DESCRIPTOR_MATCH", threshold: FACE_MATCH_THRESHOLD, accuracyMeters: 20, verifiedAt: NOW, capturedAt: NOW - 5_000 });
    }
  });

  it("rejects a different person's face (403) even though the client could claim faceVerified: true", async () => {
    const { firestore } = setup();
    const res = await verifyAttendanceProof(firestore, "c1", "u1", { ...good({ faceDescriptor: away(FACE_MATCH_THRESHOLD + 0.01) }), faceVerified: true } as never, NOW);
    expect(res).toMatchObject({ ok: false, status: 403 });
  });

  it("a distance exactly at the threshold is NOT a match", async () => {
    const { firestore } = setup();
    expect(await verifyAttendanceProof(firestore, "c1", "u1", good({ faceDescriptor: away(FACE_MATCH_THRESHOLD) }), NOW)).toMatchObject({ ok: false, status: 403 });
  });

  it("a bare 'faceVerified: true' with no descriptor is refused (the old trust-the-client request)", async () => {
    const { firestore } = setup();
    const res = await verifyAttendanceProof(firestore, "c1", "u1", { faceVerified: true, latitude: 1, longitude: 2 } as never, NOW);
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it.each([
    ["wrong length", { faceDescriptor: [0.1, 0.2] }],
    ["NaN inside", { faceDescriptor: [...base(0).slice(1), NaN] }],
    ["missing capturedAt", { capturedAt: undefined }],
    ["string capturedAt", { capturedAt: "now" }],
    ["NaN capturedAt", { capturedAt: NaN }],
  ])("400 for malformed proof: %s", async (_label, over) => {
    const { firestore } = setup();
    expect(await verifyAttendanceProof(firestore, "c1", "u1", good(over), NOW)).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a stale capture (replay) and a capture dated in the future, but allows the late-reason typing window", async () => {
    const { firestore } = setup();
    expect(await verifyAttendanceProof(firestore, "c1", "u1", good({ capturedAt: NOW - MAX_PROOF_AGE_MS - 1 }), NOW)).toMatchObject({ ok: false, status: 400 });
    expect(await verifyAttendanceProof(firestore, "c1", "u1", good({ capturedAt: NOW + MAX_PROOF_FUTURE_MS + 1 }), NOW)).toMatchObject({ ok: false, status: 400 });
    expect((await verifyAttendanceProof(firestore, "c1", "u1", good({ capturedAt: NOW - 3 * 60_000 }), NOW)).ok).toBe(true);
    expect((await verifyAttendanceProof(firestore, "c1", "u1", good({ capturedAt: NOW - MAX_PROOF_AGE_MS }), NOW)).ok).toBe(true);
  });

  it("rejects an imprecise or unreadable location accuracy", async () => {
    const { firestore } = setup();
    expect(await verifyAttendanceProof(firestore, "c1", "u1", good({ accuracy: MAX_LOCATION_ACCURACY_M + 1 }), NOW)).toMatchObject({ ok: false, status: 400 });
    expect(await verifyAttendanceProof(firestore, "c1", "u1", good({ accuracy: undefined }), NOW)).toMatchObject({ ok: false, status: 400 });
    expect(await verifyAttendanceProof(firestore, "c1", "u1", good({ accuracy: -5 }), NOW)).toMatchObject({ ok: false, status: 400 });
    expect((await verifyAttendanceProof(firestore, "c1", "u1", good({ accuracy: MAX_LOCATION_ACCURACY_M }), NOW)).ok).toBe(true);
  });

  it("409 when the person has not registered a face (or the stored one is malformed)", async () => {
    const none = setup({ "colleges/c1/facultyMembers/f1": { userUid: "u1" } });
    expect(await verifyAttendanceProof(none.firestore, "c1", "u1", good(), NOW)).toMatchObject({ ok: false, status: 409 });
    const bad = setup({ "colleges/c1/facultyMembers/f1": { userUid: "u1", faceEmbedding: [1, 2, 3] } });
    expect(await verifyAttendanceProof(bad.firestore, "c1", "u1", good(), NOW)).toMatchObject({ ok: false, status: 409 });
  });

  it("compares against the caller's OWN registration - never someone else's", async () => {
    const { firestore } = setup({ "colleges/c1/facultyMembers/f2": { userUid: "u2", faceEmbedding: base(5) } });
    // u1's face is base(0); u2 submitting u1's descriptor must not match u2's registration.
    expect(await verifyAttendanceProof(firestore, "c1", "u2", good(), NOW)).toMatchObject({ ok: false, status: 403 });
  });

  it("HODs/principals (no faculty record) use their user document", async () => {
    const { firestore } = fakeFs({ "colleges/c1/users/hod1": { faceEmbedding: base(0) } });
    expect((await verifyAttendanceProof(firestore, "c1", "hod1", good(), NOW)).ok).toBe(true);
  });
});
