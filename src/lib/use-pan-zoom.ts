import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, RefObject } from "react";

export type View = { x: number; y: number; scale: number };

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const FIT_PADDING = 48;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Drag / wheel / pinch / keyboard pan-zoom for a stage element whose child is
 * transformed by the returned view. `content` is measured to fit it on screen.
 */
export function usePanZoom(
  stage: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
) {
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [grabbing, setGrabbing] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
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

  const move = useCallback((next: View | ((current: View) => View)) => {
    moved.current = true;
    setView(next);
  }, []);

  const fit = useCallback(() => {
    const box = stage.current;
    const inner = content.current;
    if (!box || !inner) return;
    const rect = inner.getBoundingClientRect();
    const width = rect.width / viewRef.current.scale;
    const height = rect.height / viewRef.current.scale;
    if (!width || !height) return;
    const scale = clamp(
      Math.min(
        (box.clientWidth - FIT_PADDING * 2) / width,
        (box.clientHeight - FIT_PADDING * 2) / height,
        1.6,
      ),
      MIN_SCALE,
      MAX_SCALE,
    );
    moved.current = false;
    setView({
      x: (box.clientWidth - width * scale) / 2,
      y: (box.clientHeight - height * scale) / 2,
      scale,
    });
  }, [stage, content]);

  const autoFit = useCallback(() => {
    if (!moved.current) fit();
  }, [fit]);

  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      const current = viewRef.current;
      const scale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      const ratio = scale / current.scale;
      move({ x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio, scale });
    },
    [move],
  );

  const zoom = useCallback(
    (factor: number) => {
      const box = stage.current;
      if (box) zoomAt(factor, box.clientWidth / 2, box.clientHeight / 2);
    },
    [stage, zoomAt],
  );

  useEffect(() => {
    window.addEventListener("resize", autoFit);
    return () => window.removeEventListener("resize", autoFit);
  }, [autoFit]);

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

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = viewRef.current;
    if (pointers.current.size === 1) {
      drag.current = { x: event.clientX, y: event.clientY, ox: current.x, oy: current.y };
      setGrabbing(true);
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
      const scale = clamp(
        start.scale * (Math.hypot(a.x - b.x, a.y - b.y) / start.dist),
        MIN_SCALE,
        MAX_SCALE,
      );
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
      const [rest] = [...pointers.current.values()];
      const current = viewRef.current;
      drag.current = { x: rest.x, y: rest.y, ox: current.x, oy: current.y };
    } else if (pointers.current.size === 0) {
      drag.current = null;
      setGrabbing(false);
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
    view,
    grabbing,
    fit,
    autoFit,
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
