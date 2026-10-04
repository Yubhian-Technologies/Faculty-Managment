// Face-match constants and maths shared by the browser (faceMatch.ts, face-api.js)
// and the server (attendanceProof.ts). Pure - no browser or node APIs - so both
// sides use the same threshold and the same distance.

// face-api.js's faceRecognitionNet always produces a 128-dimensional descriptor.
export const EMBEDDING_LENGTH = 128;

// face-api.js's own documented threshold for "same person" on its bundled
// recognition model - below this euclidean distance counts as a match.
export const FACE_MATCH_THRESHOLD = 0.6;

export function isValidDescriptor(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === EMBEDDING_LENGTH && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

export function euclideanDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}
