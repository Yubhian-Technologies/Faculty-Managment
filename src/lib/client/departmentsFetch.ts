import { useAuthStore } from "@/store/authStore";

// One shared GET of /api/college/departments for the browser. A page often asks for the department list
// from several places at once (the page, the sidebar, a panel or two), and each call costs three Firestore
// queries on the server. Calls made within a few seconds of each other now share one request; each caller
// gets its own copy of the response, so it can read the body exactly as it did with fetch().
// Any change to departments or HOD seats calls invalidateDepartments(), so the next read is fresh.

const URL = "/api/college/departments";
const TTL_MS = 10_000;

let cached: { at: number; uid: string; res: Promise<Response> } | null = null;

export function fetchDepartments(): Promise<Response> {
  const uid = useAuthStore.getState().user?.uid ?? "";
  const now = Date.now();
  if (!cached || cached.uid !== uid || now - cached.at > TTL_MS) {
    const entry = { at: now, uid, res: fetch(URL) };
    cached = entry;
    // A failed request is never reused.
    entry.res.then(
      (r) => { if (!r.ok && cached === entry) cached = null; },
      () => { if (cached === entry) cached = null; },
    );
  }
  return cached.res.then((r) => r.clone());
}

export function invalidateDepartments() {
  cached = null;
}
