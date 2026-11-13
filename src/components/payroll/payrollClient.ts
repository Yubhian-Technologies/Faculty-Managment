// Small browser helpers shared by the payroll screens.

export const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm";

/** "?collegeId=..." for Accounts (who pick a college); empty for the College Office (their own). */
export const collegeQs = (collegeId?: string, extra: Record<string, string> = {}) => {
  const p = new URLSearchParams({ ...(collegeId ? { collegeId } : {}), ...extra });
  const s = p.toString();
  return s ? `?${s}` : "";
};

export async function payrollFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error ?? "Unable to complete the request. Try again."), { data, status: res.status });
  return data;
}

export const rupees = (n: number) => n.toLocaleString("en-IN");

/** "2026-11" -> "Nov 2026". */
export const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
};

export const thisMonth = () => {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 7);
};
