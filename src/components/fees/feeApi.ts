"use client";

// Accounts > Fees: calls carry the college picked (?collegeId) - see lib/fees/http.ts.

export const withCollege = (path: string, collegeId: string) => `${path}${path.includes("?") ? "&" : "?"}collegeId=${encodeURIComponent(collegeId)}`;

export async function feeGet<T>(path: string, collegeId: string): Promise<T> {
  const res = await fetch(withCollege(path, collegeId));
  const d = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(d.error ?? "Unable to load. Try again.");
  return d;
}

export async function feeSend<T>(path: string, collegeId: string, method: "POST" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(withCollege(path, collegeId), { method, headers: { "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const d = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(d.error ?? "Unable to complete the request. Try again.");
  return d;
}

export const rupee = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
export const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

export interface FeeOptions { courses: { key: string; name: string }[]; batchesByCourse: Record<string, string[]>; admissionTypes: string[]; academicYear: string; today: string }

/** The academic years offered: the current one, the next, and the three before. */
export function yearChoices(current: string): string[] {
  const start = Number(current.slice(0, 4));
  return [1, 0, -1, -2, -3].map((d) => `${start + d}-${String((start + d + 1) % 100).padStart(2, "0")}`);
}
