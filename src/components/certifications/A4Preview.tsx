"use client";

import { useEffect, useRef, useState } from "react";

// A certificate preview drawn at true A4 width (210 mm = 794 px) and scaled down to the box it sits in, so it
// looks exactly like the printed / PDF certificate - a narrower box never re-flows the text or pushes the college
// name past the margin.

const A4_W = 794;
const A4_H = 1123;

export function A4Preview({ html, title, className }: { html: string; title: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.7);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / A4_W));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={box} className={className}>
      <div className="overflow-hidden rounded-md border bg-white shadow-sm" style={{ height: A4_H * scale }}>
        <iframe
          title={title} srcDoc={html} sandbox=""
          style={{ width: A4_W, height: A4_H, border: 0, transform: `scale(${scale})`, transformOrigin: "top left", display: "block" }}
        />
      </div>
    </div>
  );
}
