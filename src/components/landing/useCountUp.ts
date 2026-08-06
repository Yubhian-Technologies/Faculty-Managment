"use client";

import { useEffect, useRef, useState } from "react";

/** Animates from 0 to `target` once `start` becomes true. Runs exactly once —
 *  intended to be paired with useRevealOnScroll's isVisible flag. */
export function useCountUp(target: number, start: boolean, durationMs = 1600): number {
  const [value, setValue] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!start || startedRef.current) return;
    startedRef.current = true;

    const startTime = performance.now();
    let frame: number;

    function tick(now: number) {
      const progress = Math.min((now - startTime) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [start, target, durationMs]);

  return value;
}
