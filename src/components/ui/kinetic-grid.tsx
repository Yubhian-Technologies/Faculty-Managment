"use client";

import { useEffect, useRef, useCallback, ReactNode } from "react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Point {
  x: number;
  y: number;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  born: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CELL_SIZE = 55; // Desktop-ish size. Will dictate cols/rows
const INFLUENCE_RADIUS = 260;
const MAX_WARP = 24;
const DOT_SPACING = 28;
const LERP_SPEED = 0.08;

const NODE_BASE_RADIUS = 1.8;
const NODE_ACTIVE_RADIUS = 3.2;

const OFFSCREEN: Point = { x: -9999, y: -9999 };

// ─── Themes ───────────────────────────────────────────────────────────────────

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface GridTheme {
  bg: string;
  /** Resting grid line / node colours, away from the cursor. */
  lineBase: Rgba;
  nodeBase: Rgba;
  /** Fully-warped colours directly under the cursor. */
  lineActive: Rgba;
  nodeActive: Rgba;
  /** "r,g,b" triplets for the node glow gradient and ripple rings. */
  glow: string;
  ripple: string;
  /** Static background dot texture. */
  dots: string;
}

const THEMES: Record<"default" | "monochrome" | "light", GridTheme> = {
  default: {
    bg: "#161618",
    lineBase: { r: 255, g: 255, b: 255, a: 0.13 },
    nodeBase: { r: 255, g: 255, b: 255, a: 0.2 },
    lineActive: { r: 74, g: 158, b: 255, a: 0.9 },
    nodeActive: { r: 74, g: 158, b: 255, a: 1.0 },
    glow: "74,158,255",
    ripple: "100,180,255",
    dots: "rgba(255,255,255,0.05)",
  },
  monochrome: {
    bg: "#000000",
    lineBase: { r: 255, g: 255, b: 255, a: 0.13 },
    nodeBase: { r: 255, g: 255, b: 255, a: 0.2 },
    lineActive: { r: 255, g: 255, b: 255, a: 0.9 },
    nodeActive: { r: 255, g: 255, b: 255, a: 1.0 },
    glow: "255,255,255",
    ripple: "255,255,255",
    dots: "rgba(255,255,255,0.05)",
  },
  // Light surface: inverts the resting colours so the grid reads as a faint blue
  // mesh on white, darkening toward the brand blue as the cursor approaches.
  light: {
    bg: "#ffffff",
    lineBase: { r: 74, g: 158, b: 255, a: 0.16 },
    nodeBase: { r: 74, g: 158, b: 255, a: 0.28 },
    lineActive: { r: 37, g: 99, b: 235, a: 0.75 },
    nodeActive: { r: 37, g: 99, b: 235, a: 1.0 },
    glow: "74,158,255",
    ripple: "74,158,255",
    dots: "rgba(37,99,235,0.07)",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lerpN(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpColor(
  base: { r: number; g: number; b: number; a: number },
  active: { r: number; g: number; b: number; a: number },
  t: number,
): string {
  const r = Math.round(lerpN(base.r, active.r, t));
  const g = Math.round(lerpN(base.g, active.g, t));
  const b = Math.round(lerpN(base.b, active.b, t));
  const a = lerpN(base.a, active.a, t);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Interactive canvas grid that warps toward the pointer and ripples on click.
 *
 * Scoped to its own container rather than the viewport: the canvas is absolutely
 * positioned and sized from the wrapper element, and pointer events are bound to
 * the wrapper. That lets it sit behind a single section (e.g. the landing hero)
 * without painting over the rest of the page as the user scrolls.
 */
export default function KineticGrid({
  children,
  className,
  globalColor = "default",
}: {
  children?: ReactNode;
  className?: string;
  globalColor?: "default" | "monochrome" | "light";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const mouseRef = useRef<Point>({ ...OFFSCREEN });
  const targetMouseRef = useRef<Point>({ ...OFFSCREEN });
  const ripplesRef = useRef<Ripple[]>([]);
  const rafRef = useRef<number>(0);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  // ── Warp ────────────────────────────────────────────────────────────────────

  const getWarpedPoint = useCallback(
    (
      gx: number,
      gy: number,
      col: number,
      row: number,
      mouse: Point,
      ripples: Ripple[],
      cols: number,
      rows: number,
    ): { pt: Point; proximity: number } => {
      // Edge pin — smoothly locks boundary rows/cols in place
      const edgeMargin = 1.5;
      const colPin = Math.min(
        col / edgeMargin,
        (cols - 1 - col) / edgeMargin,
        1,
      );
      const rowPin = Math.min(
        row / edgeMargin,
        (rows - 1 - row) / edgeMargin,
        1,
      );
      const pinFactor = colPin * colPin * rowPin * rowPin;

      const dx = gx - mouse.x;
      const dy = gy - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const proximity = Math.max(0, 1 - dist / INFLUENCE_RADIUS) * pinFactor;

      // Ripple displacement
      let rx = 0,
        ry = 0;
      for (const r of ripples) {
        const rdx = gx - r.x;
        const rdy = gy - r.y;
        const rdist = Math.sqrt(rdx * rdx + rdy * rdy);
        const waveWidth = 55;
        const diff = rdist - r.radius;
        if (Math.abs(diff) < waveWidth) {
          const strength =
            (1 - Math.abs(diff) / waveWidth) * r.opacity * 18 * pinFactor;
          const angle = Math.atan2(rdy, rdx);
          const sign = diff < 0 ? -1 : 1;
          rx += Math.cos(angle) * strength * sign * -1;
          ry += Math.sin(angle) * strength * sign * -1;
        }
      }

      // Cursor warp with bell falloff
      if (dist < INFLUENCE_RADIUS && dist > 0 && pinFactor > 0) {
        const t = dist / INFLUENCE_RADIUS;
        const eased = t < 0.01 ? 0 : (1 - t) * (1 - t) * Math.min(1, dist / 60);
        const warpAmt = eased * MAX_WARP * pinFactor;
        const angle = Math.atan2(dy, dx);
        return {
          pt: {
            x: gx - Math.cos(angle) * warpAmt + rx,
            y: gy - Math.sin(angle) * warpAmt + ry,
          },
          proximity,
        };
      }

      return { pt: { x: gx + rx, y: gy + ry }, proximity };
    },
    [],
  );

  // ── Draw ────────────────────────────────────────────────────────────────────

  const draw = useCallback(
    (now: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { w: W, h: H } = sizeRef.current;
      if (W === 0 || H === 0) return;

      const mouse = mouseRef.current;
      const ripples = ripplesRef.current;

      const theme = THEMES[globalColor ?? "default"];

      ctx.clearRect(0, 0, W, H);

      // Background
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, W, H);

      // Static background dot texture
      ctx.fillStyle = theme.dots;
      for (let x = DOT_SPACING / 2; x < W; x += DOT_SPACING) {
        for (let y = DOT_SPACING / 2; y < H; y += DOT_SPACING) {
          ctx.beginPath();
          ctx.arc(x, y, 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Update ripples
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        const age = (now - r.born) / 1000;
        // FIX: Ensure radius is never negative
        r.radius = Math.max(0, age * 400);
        r.opacity = Math.max(0, 1 - age * 1.2);
        if (r.opacity <= 0) ripples.splice(i, 1);
      }

      // ── Build warped grid ─────────────────────────────────────────────────
      const cols = Math.max(2, Math.ceil(W / CELL_SIZE)) + 1;
      const rows = Math.max(2, Math.ceil(H / CELL_SIZE)) + 1;
      const cellW = W / (cols - 1);
      const cellH = H / (rows - 1);

      const pts: Point[][] = [];
      const prox: number[][] = [];

      for (let row = 0; row < rows; row++) {
        pts[row] = [];
        prox[row] = [];
        for (let col = 0; col < cols; col++) {
          const { pt, proximity } = getWarpedPoint(
            col * cellW,
            row * cellH,
            col,
            row,
            mouse,
            ripples,
            cols,
            rows,
          );
          pts[row][col] = pt;
          prox[row][col] = proximity;
        }
      }

      // ── Grid lines ────────────────────────────────────────────────────────
      const drawSeg = (p1: Point, p2: Point, pr1: number, pr2: number) => {
        const avg = (pr1 + pr2) / 2;
        const t = avg * avg * (3 - 2 * avg); // smoothstep
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = lerpColor(theme.lineBase, theme.lineActive, t);
        ctx.lineWidth = lerpN(0.8, 1.5, t);
        ctx.stroke();
      };

      ctx.lineCap = "butt";

      for (let row = 0; row < rows; row++)
        for (let col = 0; col < cols - 1; col++)
          drawSeg(
            pts[row][col],
            pts[row][col + 1],
            prox[row][col],
            prox[row][col + 1],
          );

      for (let col = 0; col < cols; col++)
        for (let row = 0; row < rows - 1; row++)
          drawSeg(
            pts[row][col],
            pts[row + 1][col],
            prox[row][col],
            prox[row + 1][col],
          );

      // ── Intersection nodes ────────────────────────────────────────────────
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const p = pts[row][col];
          const pr = prox[row][col];
          const t = pr * pr * (3 - 2 * pr); // smoothstep
          const r = lerpN(NODE_BASE_RADIUS, NODE_ACTIVE_RADIUS, t);

          // Outer glow ring for active nodes
          if (t > 0.3) {
            const glowR = r + lerpN(0, 6, (t - 0.3) / 0.7);
            const grd = ctx.createRadialGradient(
              p.x,
              p.y,
              r * 0.5,
              p.x,
              p.y,
              glowR,
            );
            grd.addColorStop(0, `rgba(${theme.glow},${(t * 0.3).toFixed(3)})`);
            grd.addColorStop(1, `rgba(${theme.glow},0)`);
            ctx.beginPath();
            ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
            ctx.fillStyle = grd;
            ctx.fill();
          }

          // Node fill
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fillStyle = lerpColor(theme.nodeBase, theme.nodeActive, t);
          ctx.fill();
        }
      }

      // ── Ripple rings ──────────────────────────────────────────────────────
      for (const r of ripples) {
        // FIX: Ensure radius is positive before drawing arc
        const safeRadius = Math.max(0, r.radius);
        ctx.beginPath();
        ctx.arc(r.x, r.y, safeRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${theme.ripple},${(r.opacity * 0.28).toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    },
    [getWarpedPoint, globalColor],
  );

  // ── Setup ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    // Size the backing store to the container in device pixels, then scale the
    // context back down so all draw code keeps working in CSS pixels.
    const setSize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width === 0 || height === 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d");
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

      sizeRef.current = { w: width, h: height };
    };

    setSize();

    const resizeObserver = new ResizeObserver(setSize);
    resizeObserver.observe(container);

    // Pointer positions are container-relative, matching the canvas coordinates.
    const onPointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      targetMouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    const onPointerLeave = () => {
      targetMouseRef.current = { ...OFFSCREEN };
    };

    const onClick = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      ripplesRef.current.push({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        radius: 0,
        opacity: 1,
        born: performance.now(),
      });
    };

    // Declared (not a const arrow) so the self-referencing rAF call below is
    // hoisted — the eslint react-hooks rules reject the read-before-declare form.
    function tick(now: number) {
      const m = mouseRef.current;
      const t = targetMouseRef.current;

      m.x = lerpN(m.x, t.x, LERP_SPEED);
      m.y = lerpN(m.y, t.y, LERP_SPEED);

      draw(now);
      rafRef.current = requestAnimationFrame(tick);
    }

    // Honour the same reduced-motion contract the rest of the landing page uses:
    // render one static frame and skip the rAF loop entirely.
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const start = () => {
      cancelAnimationFrame(rafRef.current);
      if (reducedMotion.matches) {
        mouseRef.current = { ...OFFSCREEN };
        targetMouseRef.current = { ...OFFSCREEN };
        ripplesRef.current = [];
        draw(performance.now());
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    const bindPointer = () => {
      container.addEventListener("pointermove", onPointerMove);
      container.addEventListener("pointerleave", onPointerLeave);
      container.addEventListener("click", onClick);
    };

    const unbindPointer = () => {
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      container.removeEventListener("click", onClick);
    };

    const onMotionPreferenceChange = () => {
      unbindPointer();
      if (!reducedMotion.matches) bindPointer();
      start();
    };

    if (!reducedMotion.matches) bindPointer();
    start();
    reducedMotion.addEventListener("change", onMotionPreferenceChange);

    return () => {
      resizeObserver.disconnect();
      unbindPointer();
      reducedMotion.removeEventListener("change", onMotionPreferenceChange);
      cancelAnimationFrame(rafRef.current);
    };
  }, [draw]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full min-h-screen overflow-hidden",
        // Matches theme.bg so there is no flash before the canvas first paints.
        globalColor === "light"
          ? "bg-white"
          : globalColor === "monochrome"
          ? "bg-[#000000]"
          : "bg-[#161618]",
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        className="absolute inset-0 z-0 h-full w-full pointer-events-none"
      />

      <div className="relative z-10 w-full h-full">{children}</div>
    </div>
  );
}
