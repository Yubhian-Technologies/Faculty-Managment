import { FACE_MATCH_THRESHOLD, euclideanDistance, isValidDescriptor } from "@/lib/attendance/faceThreshold";
import { loadRegisteredEmbedding } from "@/lib/attendance/faceRegistry";

// What the server can and cannot establish about a self check-in / check-out.
//
// BEFORE: the browser compared the faces and the server believed whatever
// `faceVerified: true` and latitude/longitude it was sent - so anyone holding a
// session could POST "verified, standing on campus" from anywhere.
//
// NOW the server does the comparison itself: the browser posts the face
// DESCRIPTOR it captured, and it is measured here against the descriptor the
// person registered; the verdict and the distance come from this function, never
// from the client. The capture must be fresh (not a replay of an old request) and
// the location fix must be reasonably precise.
//
// STILL NOT PROVEN, and not provable from a server alone:
//  - the descriptor really came from a live camera: a script that has someone's
//    registered descriptor (it is readable by its owner) could replay it - there is
//    no server-side liveness check, only the browser's blink / head-turn prompts;
//  - the coordinates are real: they are client-reported, and a browser or device
//    can fake a position (the accuracy figure is client-reported too).
// Defence against those needs something the client cannot forge (device/app
// attestation, a campus network check, on-site kiosks). Every accepted check-in
// stores the evidence below so a disputed one can be reviewed.

// Long enough for a late check-in to type its reason between the capture and the
// submit; short enough that an old captured request is useless.
export const MAX_PROOF_AGE_MS = 10 * 60 * 1000;
export const MAX_PROOF_FUTURE_MS = 30 * 1000;
export const MAX_LOCATION_ACCURACY_M = 150;

export interface AttendanceProofBody {
  faceDescriptor?: unknown;
  capturedAt?: unknown;
  accuracy?: unknown;
}

export interface AttendanceProofEvidence {
  method: "SERVER_DESCRIPTOR_MATCH";
  distance: number;
  threshold: number;
  accuracyMeters: number;
  capturedAt: number;
  verifiedAt: number;
}

export type AttendanceProofResult =
  | { ok: true; distance: number; evidence: AttendanceProofEvidence }
  | { ok: false; status: number; error: string };

export async function verifyAttendanceProof(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string,
  body: AttendanceProofBody,
  now: number = Date.now()
): Promise<AttendanceProofResult> {
  if (!isValidDescriptor(body.faceDescriptor)) {
    return { ok: false, status: 400, error: "Face verification data is missing - please refresh the page and try again" };
  }
  const capturedAt = typeof body.capturedAt === "number" && Number.isFinite(body.capturedAt) ? body.capturedAt : null;
  if (capturedAt === null) {
    return { ok: false, status: 400, error: "Face verification data is missing - please refresh the page and try again" };
  }
  if (now - capturedAt > MAX_PROOF_AGE_MS || capturedAt - now > MAX_PROOF_FUTURE_MS) {
    return { ok: false, status: 400, error: "That face capture has expired - please capture again" };
  }
  const accuracy = typeof body.accuracy === "number" && Number.isFinite(body.accuracy) && body.accuracy >= 0 ? body.accuracy : null;
  if (accuracy === null) {
    return { ok: false, status: 400, error: "Your location accuracy could not be read - please try again" };
  }
  if (accuracy > MAX_LOCATION_ACCURACY_M) {
    return {
      ok: false,
      status: 400,
      error: `Your location is too imprecise (±${Math.round(accuracy)} m) - move to an open area, turn on precise location and try again`,
    };
  }

  const registered = await loadRegisteredEmbedding(db, collegeId, uid);
  if (!registered) {
    return { ok: false, status: 409, error: "You haven't registered your face yet - register it first" };
  }
  const distance = euclideanDistance(body.faceDescriptor, registered);
  if (!(distance < FACE_MATCH_THRESHOLD)) {
    return { ok: false, status: 403, error: "Face didn't match your registered face. Try again with better lighting, facing the camera directly." };
  }
  return {
    ok: true,
    distance,
    evidence: { method: "SERVER_DESCRIPTOR_MATCH", distance, threshold: FACE_MATCH_THRESHOLD, accuracyMeters: accuracy, capturedAt, verifiedAt: now },
  };
}
