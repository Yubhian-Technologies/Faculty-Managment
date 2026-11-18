import { FACE_MATCH_THRESHOLD, bestDistance, isValidDescriptor } from "@/lib/attendance/faceThreshold";
import { loadFaceRegistration } from "@/lib/attendance/faceRegistry";
import { isNewRegistration } from "@/lib/attendance/checkInHow";
import { allowsFace, allowsPasskey, PasskeyError, selfCheckInMethod, verifyAttendancePasskey } from "@/lib/attendance/passkeys";
import { COMPUTER_COPY_MESSAGE, deviceKindOf, passkeyRouteOf, type DeviceKind, type PasskeyRoute } from "@/lib/attendance/passkeyDevice";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

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
  /** A passkey signature (WebAuthn assertion) made for this check-in / check-out - see lib/attendance/passkeys.ts. */
  passkey?: unknown;
  /** `navigator.maxTouchPoints` of the page - tells an iPhone / iPad asking for the desktop site from a Mac (passkeyDevice.ts). */
  touchPoints?: unknown;
}

export type AttendanceProofEvidence =
  | {
      method: "SERVER_DESCRIPTOR_MATCH";
      distance: number;
      threshold: number;
      accuracyMeters: number;
      capturedAt: number;
      verifiedAt: number;
      /** The face was registered in the last few days (checkInHow.ts) - shown as "New device" to the HOD. */
      newRegistration?: boolean;
    }
  | {
      // The registered phone's own fingerprint / face unlock, verified as a WebAuthn signature on the server.
      method: "PASSKEY";
      credentialId: string;
      deviceLabel: string;
      /** ON_PHONE, or NEARBY_PHONE = signed by the phone through a computer's QR code. Missing on older records. */
      route?: PasskeyRoute;
      /** The device the request came from, as the browser reported it. */
      deviceKind?: DeviceKind;
      /** The passkey is a synced copy (iCloud Keychain / Google Password Manager). */
      synced?: boolean;
      accuracyMeters: number;
      verifiedAt: number;
      newRegistration?: boolean;
    };

export type AttendanceProofResult =
  | { ok: true; distance?: number; evidence: AttendanceProofEvidence }
  | { ok: false; status: number; error: string };

/**
 * `request` is needed for a passkey (the site the key belongs to). Which proofs are accepted follows the
 * college's Self Check-In Method (settings/selfCheckIn: FACE - the default -, PASSKEY or EITHER).
 */
export async function verifyAttendanceProof(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string,
  body: AttendanceProofBody,
  now: number = Date.now(),
  request?: Request,
): Promise<AttendanceProofResult> {
  const accuracy = typeof body.accuracy === "number" && Number.isFinite(body.accuracy) && body.accuracy >= 0 ? body.accuracy : null;
  const locationProblem = (): AttendanceProofResult | null => {
    if (accuracy === null) return { ok: false, status: 400, error: "Your location accuracy could not be read - try again" };
    if (accuracy > MAX_LOCATION_ACCURACY_M) {
      return {
        ok: false,
        status: 400,
        error: `Your location is too imprecise (±${Math.round(accuracy)} m) - move to an open area, turn on precise location and try again`,
      };
    }
    return null;
  };
  const method = await selfCheckInMethod(db, collegeId);

  if (body.passkey !== undefined) {
    if (!allowsPasskey(method)) return { ok: false, status: 400, error: "Phone fingerprint / face unlock check-in is not turned on for your college - use the face scan." };
    if (!request) return { ok: false, status: 400, error: "Unable to verify the phone - try again." };
    const loc = locationProblem();
    if (loc) return loc;
    // Only the registered phone itself may sign - not a laptop's synced copy of its passkey.
    const deviceKind = deviceKindOf(request.headers, body.touchPoints);
    const route = passkeyRouteOf((body.passkey as { authenticatorAttachment?: unknown } | null)?.authenticatorAttachment, deviceKind);
    if (!route) return { ok: false, status: 403, error: COMPUTER_COPY_MESSAGE };
    try {
      const used = await verifyAttendancePasskey(db, collegeId, uid, body.passkey as AuthenticationResponseJSON, request);
      return {
        ok: true,
        evidence: {
          method: "PASSKEY", credentialId: used.credentialId, deviceLabel: used.label, route, deviceKind, synced: used.synced,
          accuracyMeters: accuracy!, verifiedAt: now,
          ...(isNewRegistration(used.registeredAt, now) ? { newRegistration: true } : {}),
        },
      };
    } catch (err) {
      if (err instanceof PasskeyError) return { ok: false, status: err.status, error: err.message };
      throw err;
    }
  }

  if (!allowsFace(method)) {
    return { ok: false, status: 400, error: "Your college uses phone fingerprint / face unlock for check-in - register this phone on My Attendance." };
  }
  if (!isValidDescriptor(body.faceDescriptor)) {
    return { ok: false, status: 400, error: "Face verification data is missing - refresh the page and try again" };
  }
  const capturedAt = typeof body.capturedAt === "number" && Number.isFinite(body.capturedAt) ? body.capturedAt : null;
  if (capturedAt === null) {
    return { ok: false, status: 400, error: "Face verification data is missing - refresh the page and try again" };
  }
  if (now - capturedAt > MAX_PROOF_AGE_MS || capturedAt - now > MAX_PROOF_FUTURE_MS) {
    return { ok: false, status: 400, error: "That face capture has expired - capture again" };
  }
  const loc = locationProblem();
  if (loc) return loc;

  const { samples: registered, registeredAt } = await loadFaceRegistration(db, collegeId, uid);
  if (!registered.length) {
    return { ok: false, status: 409, error: "You haven't registered your face yet - register it first" };
  }
  // The closest of the registered samples decides.
  const distance = bestDistance(body.faceDescriptor, registered);
  if (!(distance < FACE_MATCH_THRESHOLD)) {
    return { ok: false, status: 403, error: "Face didn't match your registered face. Try again with better lighting, facing the camera directly." };
  }
  return {
    ok: true,
    distance,
    evidence: {
      method: "SERVER_DESCRIPTOR_MATCH", distance, threshold: FACE_MATCH_THRESHOLD, accuracyMeters: accuracy!, capturedAt, verifiedAt: now,
      ...(isNewRegistration(registeredAt, now) ? { newRegistration: true } : {}),
    },
  };
}
