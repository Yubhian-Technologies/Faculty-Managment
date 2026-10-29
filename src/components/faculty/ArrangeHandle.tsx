"use client";

import { GripVertical } from "lucide-react";

// The scrollable ancestor to nudge while dragging near its edge (the page itself when none).
function scrollParent(el: HTMLElement | null): HTMLElement | Window {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if ((y === "auto" || y === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return window;
}

/**
 * The pointer on a faculty row: press it and drag to another row (mouse, touch, pen), release to drop.
 * The row is found under the pointer through the `data-arrange-id` carried by every handle in the table, so rows
 * without a handle (another department's) are not drop targets. The table colours the rows through the data-* flags.
 */
export function ArrangeHandle({ id, name, dragging, over, onStart, onOver, onDrop, onCancel }: {
  id: string;
  name: string;
  dragging: boolean;
  over: boolean;
  onStart: (id: string) => void;
  onOver: (id: string | null) => void;
  onDrop: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="button"
      aria-label={`Drag ${name} to a new position`}
      data-arrange-id={id}
      data-dragging={dragging}
      data-over={over}
      className="inline-flex touch-none select-none cursor-grab rounded p-1.5 text-muted-foreground hover:bg-muted active:cursor-grabbing"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onStart(id);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("tr")?.querySelector<HTMLElement>("[data-arrange-id]");
        onOver(target?.dataset.arrangeId ?? null);
        const edge = 60;
        const dy = e.clientY < edge ? -16 : e.clientY > window.innerHeight - edge ? 16 : 0;
        if (dy) {
          const sp = scrollParent(e.currentTarget);
          if (sp instanceof Window) sp.scrollBy(0, dy); else sp.scrollBy({ top: dy });
        }
      }}
      onPointerUp={onDrop}
      onPointerCancel={onCancel}
    >
      <GripVertical className="h-5 w-5" aria-hidden />
    </div>
  );
}
