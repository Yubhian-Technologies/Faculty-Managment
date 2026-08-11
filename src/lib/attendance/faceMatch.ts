"use client";

// Client-only, in-browser face verification for self-attendance check-in/out.
// Runs entirely in the faculty's browser (face-api.js on top of TensorFlow.js) —
// no image is ever uploaded anywhere; only the resulting match distance/boolean
// is sent to the server. Model weights are vendored at public/models/ (not
// bundled in the npm package) so this doesn't depend on a third-party CDN
// being up every time someone checks in.

let modelsLoadedPromise: Promise<void> | null = null;

// face-api.js's own documented threshold for "same person" on its bundled
// recognition model — below this euclidean distance counts as a match.
export const FACE_MATCH_THRESHOLD = 0.6;

export async function loadFaceModels(): Promise<void> {
  if (!modelsLoadedPromise) {
    modelsLoadedPromise = (async () => {
      const faceapi = await import("face-api.js");
      const MODEL_URL = "/models";
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
    })();
  }
  return modelsLoadedPromise;
}

// Returns null if no face (or more than one face's worth of ambiguity) was
// confidently detected in the given image/video/canvas.
export async function getFaceDescriptor(
  input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement
): Promise<Float32Array | null> {
  const faceapi = await import("face-api.js");
  const detection = await faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
  return detection?.descriptor ?? null;
}

export async function compareFaceDescriptors(a: Float32Array, b: Float32Array): Promise<number> {
  const faceapi = await import("face-api.js");
  return faceapi.euclideanDistance(a, b);
}

// Loads a (same-origin or CORS-enabled) image URL into an HTMLImageElement,
// ready for getFaceDescriptor. `crossOrigin` is required so the browser
// allows face-api.js to read pixel data via canvas without tainting it —
// Firebase Storage download-token URLs already serve permissive CORS headers.
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load reference photo"));
    img.src = url;
  });
}

export function captureVideoFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// ─── Liveness: blink + head turn ────────────────────────────────────────────
// A static printed photo or screenshot can't blink or turn on command, so
// requiring both before accepting the capture raises the bar over pure face-
// matching (which only asks "does this look like them", not "is this them,
// live, right now"). Neither stops a video replay of the person doing both —
// that needs real liveness infrastructure (a purpose-built SDK), not this.
//
// Blink alone (Eye Aspect Ratio) was tried first and proved unreliable on its
// own — real-world testing showed a genuine deliberate blink only moved EAR
// ~10-17% off baseline through face-api.js's landmark model at normal webcam
// distance, close to landmark-noise territory. Head yaw produces a much
// bigger, cleaner signal (the whole nose shifts sideways relative to the
// eyes, not just eyelid height by a few pixels), so it's the primary,
// harder-to-miss check; blink stays as a second, looser-thresholded step.

function averagePoint(points: { x: number; y: number }[]): { x: number; y: number } {
  const n = points.length || 1;
  return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
}

// Eye Aspect Ratio (Soukupová & Čech, 2016) — ratio of an eye's vertical to
// horizontal span. Roughly constant while open, collapses toward 0 when closed.
function eyeAspectRatio(eye: { x: number; y: number }[]): number {
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  // face-api.js's 6-point eye contour: [outer corner, top-outer, top-inner, inner corner, bottom-inner, bottom-outer]
  const vertical1 = dist(eye[1], eye[5]);
  const vertical2 = dist(eye[2], eye[4]);
  const horizontal = dist(eye[0], eye[3]);
  return horizontal === 0 ? 0 : (vertical1 + vertical2) / (2 * horizontal);
}

interface FaceReading {
  ear: number;
  // How far the nose sits from the midpoint between the eyes, as a fraction
  // of inter-eye distance (scale-invariant). Near 0 facing the camera dead
  // on; grows in magnitude (either sign, depending on turn direction) as the
  // head yaws left/right.
  yawOffset: number;
}

async function readFace(input: HTMLVideoElement | HTMLCanvasElement): Promise<FaceReading | null> {
  const faceapi = await import("face-api.js");
  const result = await faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks();
  if (!result) return null;

  const leftEye = result.landmarks.getLeftEye();
  const rightEye = result.landmarks.getRightEye();
  const ear = (eyeAspectRatio(leftEye) + eyeAspectRatio(rightEye)) / 2;

  const leftEyeCenter = averagePoint(leftEye);
  const rightEyeCenter = averagePoint(rightEye);
  const eyeMidX = (leftEyeCenter.x + rightEyeCenter.x) / 2;
  const interEyeDist = Math.hypot(rightEyeCenter.x - leftEyeCenter.x, rightEyeCenter.y - leftEyeCenter.y);
  const noseCenter = averagePoint(result.landmarks.getNose());
  const yawOffset = interEyeDist === 0 ? 0 : (noseCenter.x - eyeMidX) / interEyeDist;

  return { ear, yawOffset };
}

const CALIBRATION_MS = 1200;
// Loosened from an initial 0.75 after real-world testing showed genuine
// blinks only reaching ~83-90% of baseline through this model - see git
// history for the two measured data points this was tuned against.
const BLINK_DIP_RATIO = 0.92;
const BLINK_REOPEN_RATIO = 0.95;
// First estimate, not yet real-world tuned - a deliberate head turn should
// comfortably clear this, but if it doesn't, the diagnostic readout this
// feeds (see MarkAttendanceDialog) will show exactly how far short.
const TURN_OFFSET_DELTA = 0.12;

export interface LivenessSample {
  step: "calibrating" | "blink" | "turn";
  ear: number | null;
  yawOffset: number | null;
  baselineEar?: number;
  baselineYaw?: number;
  peakYawDelta?: number;
  phase?: "waiting-closed" | "waiting-reopen";
}

interface LivenessOptions {
  timeoutMs?: number;
  shouldAbort?: () => boolean;
  onSample?: (s: LivenessSample) => void;
}

// Calibrates a personal baseline (facing the camera normally), then watches
// for one open → closed → open eye dip within `timeoutMs`. Resolves true as
// soon as a blink is confirmed, false on timeout. Samples as fast as the
// detector allows - no artificial delay - since a real blink lasts only
// ~100-400ms and throttling risks sampling right past the closed-eye frame.
export async function waitForBlink(video: HTMLVideoElement, options: LivenessOptions = {}): Promise<boolean> {
  const { timeoutMs = 8000, shouldAbort, onSample } = options;

  const calibrationDeadline = Date.now() + CALIBRATION_MS;
  const baselineSamples: number[] = [];
  while (Date.now() < calibrationDeadline) {
    if (shouldAbort?.()) return false;
    const reading = await readFace(video);
    if (reading) baselineSamples.push(reading.ear);
    onSample?.({ step: "calibrating", ear: reading?.ear ?? null, yawOffset: reading?.yawOffset ?? null });
  }
  if (baselineSamples.length === 0) return false;
  // Max, not average - eyes are presumably open through most of calibration,
  // so the peak reading is the best estimate of this face's true "open" EAR.
  const baselineEar = Math.max(...baselineSamples);
  const closedThreshold = baselineEar * BLINK_DIP_RATIO;
  const reopenThreshold = baselineEar * BLINK_REOPEN_RATIO;

  const deadline = Date.now() + timeoutMs;
  let phase: "waiting-closed" | "waiting-reopen" = "waiting-closed";
  while (Date.now() < deadline) {
    if (shouldAbort?.()) return false;
    const reading = await readFace(video);
    if (reading) {
      if (phase === "waiting-closed" && reading.ear < closedThreshold) {
        phase = "waiting-reopen";
      } else if (phase === "waiting-reopen" && reading.ear > reopenThreshold) {
        onSample?.({ step: "blink", ear: reading.ear, yawOffset: reading.yawOffset, baselineEar, phase });
        return true;
      }
    }
    onSample?.({ step: "blink", ear: reading?.ear ?? null, yawOffset: reading?.yawOffset ?? null, baselineEar, phase });
  }
  return false;
}

// Calibrates a personal "facing forward" baseline, then watches for the
// nose-vs-eyes offset to swing away from it by more than TURN_OFFSET_DELTA
// at any point within `timeoutMs` - i.e. one deliberate head turn.
export async function waitForHeadTurn(video: HTMLVideoElement, options: LivenessOptions = {}): Promise<boolean> {
  const { timeoutMs = 8000, shouldAbort, onSample } = options;

  const calibrationDeadline = Date.now() + CALIBRATION_MS;
  const baselineSamples: number[] = [];
  while (Date.now() < calibrationDeadline) {
    if (shouldAbort?.()) return false;
    const reading = await readFace(video);
    if (reading) baselineSamples.push(reading.yawOffset);
    onSample?.({ step: "calibrating", ear: reading?.ear ?? null, yawOffset: reading?.yawOffset ?? null });
  }
  if (baselineSamples.length === 0) return false;
  const baselineYaw = baselineSamples.reduce((s, v) => s + v, 0) / baselineSamples.length;

  const deadline = Date.now() + timeoutMs;
  let peakYawDelta = 0;
  while (Date.now() < deadline) {
    if (shouldAbort?.()) return false;
    const reading = await readFace(video);
    if (reading) {
      const delta = Math.abs(reading.yawOffset - baselineYaw);
      peakYawDelta = Math.max(peakYawDelta, delta);
      if (delta > TURN_OFFSET_DELTA) {
        onSample?.({ step: "turn", ear: reading.ear, yawOffset: reading.yawOffset, baselineYaw, peakYawDelta });
        return true;
      }
    }
    onSample?.({ step: "turn", ear: reading?.ear ?? null, yawOffset: reading?.yawOffset ?? null, baselineYaw, peakYawDelta });
  }
  return false;
}
