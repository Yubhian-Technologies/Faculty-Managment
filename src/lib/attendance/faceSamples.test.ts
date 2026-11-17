import { describe, expect, it } from "vitest";
import { bestDistance, EMBEDDING_LENGTH } from "./faceThreshold";
import { registeredSamplesOf } from "./faceRegistry";

const vec = (x: number) => Array.from({ length: EMBEDDING_LENGTH }, () => x);

describe("registered face samples", () => {
  it("matches the closest sample", () => {
    const probe = vec(0.1);
    expect(bestDistance(probe, [vec(0.5), vec(0.1)])).toBe(0);
    expect(bestDistance(probe, [])).toBe(Number.POSITIVE_INFINITY);
  });

  it("reads the samples, else the single older embedding, ignoring bad entries", () => {
    expect(registeredSamplesOf({ faceEmbeddingSamples: [{ v: vec(1) }, { v: [1, 2] }, { v: vec(2) }] })).toEqual([vec(1), vec(2)]);
    expect(registeredSamplesOf({ faceEmbedding: vec(3) })).toEqual([vec(3)]);
    expect(registeredSamplesOf({ faceEmbedding: [1] })).toEqual([]);
    expect(registeredSamplesOf(undefined)).toEqual([]);
  });
});
