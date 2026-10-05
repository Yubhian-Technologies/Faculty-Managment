// Sends a big import to a bulk endpoint in chunks the server accepts (it caps a request at 500
// rows), one after another, and merges the per-chunk results into one.
//
// Merging is generic so every import endpoint can share it: numeric fields are summed ("created",
// "skipped"...), arrays are concatenated, and any array item carrying a numeric `row` has it shifted
// by the chunk's offset, so a failure reported against row 3 of the second chunk shows as row 503 of
// the file. A chunk that fails (HTTP error or network) stops the run: everything before it is already
// saved, and the endpoints reject already-saved rows as duplicates, so re-importing the file is safe.

export const IMPORT_CHUNK_SIZE = 500;

export interface ChunkedImportResult<T extends Record<string, unknown>> {
  /** Merged response bodies of every chunk that succeeded. */
  merged: T;
  /** Index (0-based, in records) of the first row NOT sent successfully; null when everything went. */
  stoppedAt: number | null;
  /** Message of the failure that stopped the run. */
  error: string | null;
}

export function mergeChunkResult(into: Record<string, unknown>, chunk: Record<string, unknown>, offset: number): void {
  for (const [key, value] of Object.entries(chunk)) {
    if (typeof value === "number") {
      into[key] = ((into[key] as number | undefined) ?? 0) + value;
    } else if (Array.isArray(value)) {
      const shifted = value.map((item) =>
        item && typeof item === "object" && typeof (item as { row?: unknown }).row === "number"
          ? { ...(item as object), row: (item as { row: number }).row + offset }
          : item,
      );
      into[key] = [...((into[key] as unknown[] | undefined) ?? []), ...shifted];
    } else {
      into[key] = value;
    }
  }
}

export async function importInChunks<T extends Record<string, unknown> = Record<string, unknown>>(
  url: string,
  records: unknown[],
  opts: {
    chunkSize?: number;
    /** Extra body fields sent with every chunk (besides `records`). */
    body?: Record<string, unknown>;
    onProgress?: (done: number, total: number) => void;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<ChunkedImportResult<T>> {
  const size = opts.chunkSize ?? IMPORT_CHUNK_SIZE;
  const doFetch = opts.fetchImpl ?? fetch;
  const merged: Record<string, unknown> = {};
  let stoppedAt: number | null = null;
  let error: string | null = null;

  for (let start = 0; start < records.length; start += size) {
    opts.onProgress?.(start, records.length);
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...opts.body, records: records.slice(start, start + size) }),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        stoppedAt = start;
        error = typeof json.error === "string" ? json.error : "Import failed";
        break;
      }
      mergeChunkResult(merged, json, start);
    } catch {
      stoppedAt = start;
      error = "Network error - import failed";
      break;
    }
  }
  opts.onProgress?.(stoppedAt ?? records.length, records.length);
  return { merged: merged as T, stoppedAt, error };
}

/** CSV text of failed import rows (row number, identifier, reason) for download. */
export function failedRowsCsv(failed: { row: number; error?: string; identifier?: string; employeeId?: string; name?: string }[]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const neutral = (v: unknown) => (/^[=@]|^[+-][^\d\s.(]/.test(String(v ?? "")) ? `'${v}` : String(v ?? ""));
  return [
    ["Row", "Identifier", "Reason"].map(esc).join(","),
    ...failed.map((f) => [f.row, neutral(f.identifier ?? f.employeeId ?? f.name ?? ""), neutral(f.error ?? "")].map(esc).join(",")),
  ].join("\r\n");
}
