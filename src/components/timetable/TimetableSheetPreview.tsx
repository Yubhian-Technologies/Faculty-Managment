"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// A4 portrait is 210mm wide; at 96dpi that is 794px.
const SHEET_WIDTH_PX = 794;
const MAX_SCALE = 2.2;

// The faculty timetable exactly as it downloads: the PDF's own HTML, shown on the page. It is the same
// document `buildFacultyTimetablePdfHtml` renders to PDF / print, so the screen can never drift from the file.
// Nothing in it runs (no scripts); same-origin is allowed only so the frame can be sized to its content.
// The sheet is scaled to the width available (down on small screens, up on wide ones, so the page's white space
// is used instead of leaving a narrow strip), and cut to its content's height - no blank A4 page below it.
export function TimetableSheetPreview({ html, title }: { html: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const [contentHeight, setContentHeight] = useState(400);

  const measure = useCallback(() => {
    if (box.current) setScale(Math.min(MAX_SCALE, box.current.clientWidth / SHEET_WIDTH_PX));
    const doc = frame.current?.contentDocument;
    // The body's own height: the document's is never shorter than the frame, which would keep the blank A4 page.
    if (doc?.body) setContentHeight(Math.ceil(doc.body.getBoundingClientRect().height));
  }, []);

  useEffect(() => {
    measure();
    if (!box.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div ref={box} className="w-full overflow-hidden rounded-lg border bg-muted/30">
      <div className="mx-auto" style={{ width: SHEET_WIDTH_PX * scale, height: contentHeight * scale }}>
        <iframe
          ref={frame}
          title={title}
          srcDoc={html}
          sandbox="allow-same-origin"
          onLoad={measure}
          className="block max-w-none border-0 bg-white"
          style={{ width: SHEET_WIDTH_PX, height: contentHeight, transform: `scale(${scale})`, transformOrigin: "top left" }}
        />
      </div>
    </div>
  );
}
