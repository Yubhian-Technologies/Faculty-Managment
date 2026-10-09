"use client";

import { useEffect } from "react";

/**
 * Keeps the address bar in step with a list's own state (no navigation, no
 * reload), so a refresh or the browser's Back button restores the same view.
 * Does nothing once the user has left `listPath`.
 */
export function useListUrlSync(listUrl: string, listPath: string): void {
  useEffect(() => {
    if (typeof window === "undefined" || window.location.pathname !== listPath) return;
    const current = window.location.pathname + window.location.search;
    if (current !== listUrl) window.history.replaceState(window.history.state, "", listUrl);
  }, [listUrl, listPath]);
}
