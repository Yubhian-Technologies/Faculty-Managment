"use client";

import { useEffect, useRef, useState } from "react";

/** Fires once when the element first scrolls into view, then disconnects —
 *  drives the .landing-reveal / .is-visible pair in globals.css. */
export function useRevealOnScroll<T extends HTMLElement>(options?: IntersectionObserverInit) {
  const ref = useRef<T | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px", ...options }
    );
    observer.observe(node);
    return () => observer.disconnect();
    // Intentionally mount-only: `options` is a caller-supplied literal that would
    // otherwise be a new object every render, tearing the observer down constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ref, isVisible };
}
