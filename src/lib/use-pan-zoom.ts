import { useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent, PointerEvent, RefObject } from "react";

export type View = { x: number; y: number; scale: number };

const MAX_SCALE = 8;
const FIT_PADDING = 48;
// How much of the chart (in screen pixels, per axis) must always stay on screen.
const KEEP_VISIBLE = 120;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Drag / wheel / pinch / keyboard pan-zoom. `layer` is the element that gets
 * transformed and `content` the chart inside it, measured for fitting and bounds.
 *
 * The view lives in a ref and is written straight to the layer's style once per
 * animation frame, so moving a large chart never re-renders React.
 */
export function usePanZoom(
  stage: RefObject<HTMLElement | null>,
  layer: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
) {
  const view = useRef<View>({ x: 0, y: 0, scale: 1 });
  const size = useRef({ width: 0, height: 0, fitScale: 1 });
  const frame = useRef(0);
  // Once the user moves the map we stop auto-fitting new renders.
  const moved = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const pinch = useRef<{
    dist: number;
    scale: number;
    cx: number;
    cy: number;
    ox: number;
    oy: number;
  } | null>(null);

  // Never smaller than half the "fit" size, never so far off that the chart is gone.
  const bound = useCallback(
    (next: View): View => {
      const box = stage.current;
      const { width, height, fitScale } = size.current;
      if (!box || !width || !height) return next;
      const scale = clamp(next.scale, Math.min(fitScale / 2, 1), MAX_SCALE);
      const w = width * scale;
      const h = height * scale;
      const keepX = Math.min(KEEP_VISIBLE, w, box.clientWidth / 2);
      const keepY = Math.min(KEEP_VISIBLE, h, box.clientHeight / 2);
      return {
        scale,
        x: clamp(next.x, keepX - w, box.clientWidth - keepX),
        y: clamp(next.y, keepY - h, box.clientHeight - keepY),
      };
    },
    [stage],
  );

  const apply = useCallback(
    (next: View) => {
      view.current = bound(next);
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const { x, y, scale } = view.current;
        if (layer.current)
          layer.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      });
    },
    [bound, layer],
  );

  const move = useCallback(
    (next: View | ((current: View) => View)) => {
      moved.current = true;
      apply(typeof next === "function" ? next(view.current) : next);
    },
    [apply],
  );

  // offsetWidth/Height ignore transforms, so this is the chart's own size.
  const measure = useCallback(() => {
    const box = stage.current;
    const inner = content.current;
    if (!box || !inner?.offsetWidth || !inner.offsetHeight) return false;
    const width = inner.offsetWidth;
    const height = inner.offsetHeight;
    const fitScale = Math.min(
      (box.clientWidth - FIT_PADDING * 2) / width,
      (box.clientHeight - FIT_PADDING * 2) / height,
      1.6,
    );
    size.current = { width, height, fitScale };
    return true;
  }, [stage, content]);

  const fit = useCallback(() => {
    const box = stage.current;
    if (!box || !measure()) return;
    const { width, height, fitScale } = size.current;
    moved.current = false;
    apply({
      x: (box.clientWidth - width * fitScale) / 2,
      y: (box.clientHeight - height * fitScale) / 2,
      scale: fitScale,
    });
  }, [stage, measure, apply]);

  /** Call after the chart changes: fits it, or keeps the user's view within the new bounds. */
  const refresh = useCallback(() => {
    if (!moved.current) fit();
    else if (measure()) apply(view.current);
  }, [fit, measure, apply]);

  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      const current = view.current;
      const scale = bound({ ...current, scale: current.scale * factor }).scale;
      const ratio = scale / current.scale;
      move({ x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio, scale });
    },
    [bound, move],
  );

  const zoom = useCallback(
    (factor: number) => {
      const box = stage.current;
      if (box) zoomAt(factor, box.clientWidth / 2, box.clientHeight / 2);
    },
    [stage, zoomAt],
  );

  useEffect(() => {
    window.addEventListener("resize", refresh);
    return () => {
      window.removeEventListener("resize", refresh);
      cancelAnimationFrame(frame.current);
    };
  }, [refresh]);

  // Wheel must be non-passive so the page itself never scrolls.
  useEffect(() => {
    const box = stage.current;
    if (!box) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = box.getBoundingClientRect();
      const pinchGesture = event.ctrlKey || event.metaKey;
      if (pinchGesture || event.deltaMode !== 0 || Math.abs(event.deltaY) >= 50) {
        zoomAt(
          Math.exp(-event.deltaY * (pinchGesture ? 0.01 : 0.002)),
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
      } else {
        // Trackpad two-finger scroll pans.
        move((current) => ({
          ...current,
          x: current.x - event.deltaX,
          y: current.y - event.deltaY,
        }));
      }
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [stage, zoomAt, move]);

  const grabbing = (on: boolean) => stage.current?.classList.toggle("is-grabbing", on);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = view.current;
    if (pointers.current.size === 1) {
      drag.current = { x: event.clientX, y: event.clientY, ox: current.x, oy: current.y };
      grabbing(true);
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = event.currentTarget.getBoundingClientRect();
      drag.current = null;
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale: current.scale,
        cx: (a.x + b.x) / 2 - rect.left,
        cy: (a.y + b.y) / 2 - rect.top,
        ox: current.x,
        oy: current.y,
      };
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const start = pinch.current;
    if (start && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = event.currentTarget.getBoundingClientRect();
      const wanted = start.scale * (Math.hypot(a.x - b.x, a.y - b.y) / start.dist);
      const scale = bound({ ...view.current, scale: wanted }).scale;
      const ratio = scale / start.scale;
      const cx = (a.x + b.x) / 2 - rect.left;
      const cy = (a.y + b.y) / 2 - rect.top;
      move({ x: cx - (start.cx - start.ox) * ratio, y: cy - (start.cy - start.oy) * ratio, scale });
    } else if (drag.current) {
      const d = drag.current;
      move((current) => ({
        ...current,
        x: d.ox + event.clientX - d.x,
        y: d.oy + event.clientY - d.y,
      }));
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1) {
      // Continue as a drag from wherever the view is now (it may have hit a bound).
      const [rest] = [...pointers.current.values()];
      const current = view.current;
      drag.current = { x: rest.x, y: rest.y, ox: current.x, oy: current.y };
    } else if (pointers.current.size === 0) {
      drag.current = null;
      grabbing(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const pan = (dx: number, dy: number) => move((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
    const actions: Record<string, () => void> = {
      "+": () => zoom(1.25),
      "=": () => zoom(1.25),
      "-": () => zoom(0.8),
      "0": fit,
      ArrowLeft: () => pan(60, 0),
      ArrowRight: () => pan(-60, 0),
      ArrowUp: () => pan(0, 60),
      ArrowDown: () => pan(0, -60),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const resetFit = useCallback(() => {
    moved.current = false;
  }, []);

  return {
    fit,
    refresh,
    resetFit,
    zoom,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick: fit,
      onKeyDown,
    },
  };
}
