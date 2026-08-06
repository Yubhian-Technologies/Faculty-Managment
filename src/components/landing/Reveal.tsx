"use client";

import type { ReactNode, CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { useRevealOnScroll } from "./useRevealOnScroll";

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Stagger successive items by passing increasing delays (ms). */
  delayMs?: number;
}

/** Fades + slides a section into place the first time it scrolls into view. */
export function Reveal({ children, className, delayMs = 0 }: RevealProps) {
  const { ref, isVisible } = useRevealOnScroll<HTMLDivElement>();
  const style: CSSProperties = delayMs ? { transitionDelay: `${delayMs}ms` } : {};

  return (
    <div
      ref={ref}
      className={cn("landing-reveal", isVisible && "is-visible", className)}
      style={style}
    >
      {children}
    </div>
  );
}
