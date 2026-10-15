"use client";

import { useEffect, useState } from "react";

// Client helpers shared by the pages of the Student Mentoring Record.

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Could not load this");
  return data;
}

export async function sendJson<T>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Could not save");
  return data;
}

/**
 * Loads `url` and keeps the last answer while the next one loads (switching a semester must not blank the page).
 * `reload` fetches the same url again; `setData` lets the caller apply a save's answer without a round trip.
 */
export function useLoaded<T>(url: string | null) {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    getJson<T>(url)
      .then((data) => { if (!cancelled) setState({ key: `${url}#${nonce}`, data, error: null }); })
      .catch((e: Error) => { if (!cancelled) setState((s) => ({ key: `${url}#${nonce}`, data: s.data, error: e.message })); });
    return () => { cancelled = true; };
  }, [url, nonce]);
  const loading = !!url && state.key !== `${url}#${nonce}`;
  return {
    data: state.data,
    error: loading ? null : state.error,
    loading,
    reload: () => setNonce((n) => n + 1),
    setData: (data: T) => setState((s) => ({ ...s, data })),
  };
}

export const percentText = (p: number | null | undefined) => (p == null ? "—" : `${p % 1 === 0 ? p : p.toFixed(1)}%`);
export const SHORT_FALLBACK = "—";
