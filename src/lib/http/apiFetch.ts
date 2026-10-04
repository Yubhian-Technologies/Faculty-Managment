// One place for calling this app's own API from pages.
//
//  - A 401 means the session ended: send the person to /login once (with a way back),
//    instead of every page showing an empty table or a vague "failed" toast.
//  - fetchJson throws ApiError with the server's message on any non-2xx, so pages can show an
//    error state ("Couldn't load students - Retry") rather than rendering an empty list.
//
// Client-side only (uses window); pages that already handle responses themselves can keep
// calling fetch - adopt this where a page is touched.

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

let redirecting = false;

function onUnauthorized(): void {
  if (typeof window === "undefined" || redirecting) return;
  const { pathname, search } = window.location;
  if (pathname.startsWith("/login")) return;
  redirecting = true;
  window.location.assign(`/login?redirect=${encodeURIComponent(pathname + search)}`);
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, { credentials: "same-origin", ...init });
  if (res.status === 401) onUnauthorized();
  return res;
}

export async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(input, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // empty or non-JSON body
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error;
    throw new ApiError(res.status, msg || (res.status === 401 ? "Your session has ended - please sign in again" : `Request failed (${res.status})`));
  }
  return body as T;
}

export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Test hook. */
export function resetApiFetchState(): void {
  redirecting = false;
}
