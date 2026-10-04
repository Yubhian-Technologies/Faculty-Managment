import { describe, expect, it, vi } from "vitest";
import { failedRowsCsv, importInChunks, mergeChunkResult } from "./chunkedImport";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("mergeChunkResult", () => {
  it("sums numbers, concatenates arrays and shifts row numbers by the chunk offset", () => {
    const into: Record<string, unknown> = {};
    mergeChunkResult(into, { created: 2, failed: [{ row: 3, error: "x" }] }, 0);
    mergeChunkResult(into, { created: 1, failed: [{ row: 2, error: "y" }], skipped: ["a"] }, 500);
    expect(into).toEqual({ created: 3, failed: [{ row: 3, error: "x" }, { row: 502, error: "y" }], skipped: ["a"] });
  });
});

describe("importInChunks", () => {
  it("sends 1,200 rows as 500+500+200 and merges the results", async () => {
    const sizes: number[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const n = (JSON.parse(String(init?.body)).records as unknown[]).length;
      sizes.push(n);
      return ok({ created: n, failed: n === 200 ? [{ row: 1, error: "bad" }] : [] });
    }) as unknown as typeof fetch;
    const progress: number[] = [];
    const out = await importInChunks("/api/x", rows(1200), { fetchImpl, onProgress: (d) => progress.push(d) });
    expect(sizes).toEqual([500, 500, 200]);
    expect(out.merged).toEqual({ created: 1200, failed: [{ row: 1001, error: "bad" }] });
    expect(out.stoppedAt).toBeNull();
    expect(progress).toEqual([0, 500, 1000, 1200]);
  });

  it("stops at the first failing chunk and reports where", async () => {
    let call = 0;
    const fetchImpl = (async () => (++call === 2 ? ok({ error: "Too many" }, 400) : ok({ created: 500 }))) as unknown as typeof fetch;
    const out = await importInChunks("/api/x", rows(1100), { fetchImpl });
    expect(out).toMatchObject({ merged: { created: 500 }, stoppedAt: 500, error: "Too many" });
  });

  it("treats a network error as a stop", async () => {
    const fetchImpl = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await importInChunks("/api/x", rows(3), { fetchImpl })).toMatchObject({ stoppedAt: 0, error: "Network error - import failed" });
  });
});

describe("failedRowsCsv", () => {
  it("lists rows and neutralises formulas", () => {
    expect(failedRowsCsv([{ row: 4, identifier: "=BAD", error: 'Name "x" missing' }])).toBe('"Row","Identifier","Reason"\r\n"4","\'=BAD","Name ""x"" missing"');
  });
});
