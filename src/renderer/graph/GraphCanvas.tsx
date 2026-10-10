import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import type { GraphModelType, GraphNodeType } from '../../shared/contracts/graph';
import { drawGraph, fitView, labelOf, readGraphColors, toWorld, zoomAt, type GraphColors, type ViewTransform } from './graph-draw';
import { FrameLoop } from './frame-loop';
import { GraphLayout } from './graph-layout';

/** Moves under this many pixels between press and release count as a click. */
const CLICK_SLOP = 4;
const PAN_STEP = 60;

/** Each node's neighbors (by index), for the hover highlight. */
export function neighborsOf(model: Pick<GraphModelType, 'nodes' | 'edges'>): Array<Set<number>> {
  const out = model.nodes.map(() => new Set<number>());
  for (const e of model.edges) {
    out[e.source]!.add(e.target);
    out[e.target]!.add(e.source);
  }
  return out;
}

type Gesture = { kind: 'pan'; startX: number; startY: number; view: ViewTransform; moved: boolean } | { kind: 'drag'; index: number; startX: number; startY: number; moved: boolean };

/**
 * The drawn relation graph (D-170): a canvas with a force layout that settles a slice per frame, wheel or +/- zoom,
 * drag to pan or to move a node, hover to show a node's neighbors, click or Enter on the hovered node to open it. The
 * view fits the graph until the user moves it. `highlight` dims everything else (search matches).
 */
export function GraphCanvas({
  model,
  highlight,
  ringed,
  label,
  className,
  onOpen,
}: {
  model: GraphModelType;
  highlight: ReadonlySet<number> | null;
  ringed?: ReadonlySet<number>;
  label: string;
  className?: string;
  onOpen: (node: GraphNodeType) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layout = useMemo(() => new GraphLayout(model), [model]);
  const neighbors = useMemo(() => neighborsOf(model), [model]);
  const [hovered, setHovered] = useState<number | null>(null);
  const live = useRef({ view: { x: 0, y: 0, k: 1 } as ViewTransform, fitted: true, size: { width: 0, height: 0 }, colors: null as GraphColors | null, dirty: true });
  const loop = useRef<FrameLoop | null>(null);
  /** Something on screen changed: draw it in the next frame. */
  const invalidate = useCallback(() => {
    live.current.dirty = true;
    loop.current?.kick();
  }, []);
  const gesture = useRef<Gesture | null>(null);

  const focus = useMemo<ReadonlySet<number> | null>(() => {
    if (hovered !== null) return new Set([hovered, ...neighbors[hovered]!]);
    return highlight;
  }, [hovered, neighbors, highlight]);
  const ring = useMemo(() => new Set([...(ringed ?? []), ...(highlight ?? [])]), [ringed, highlight]);

  // One frame loop per layout: it ticks while the layout settles and draws when anything changed.
  const drawState = useRef({ focus, ring, hovered });
  useEffect(() => {
    drawState.current = { focus, ring, hovered };
    invalidate();
  }, [focus, ring, hovered, invalidate]);
  useEffect(() => {
    const s = live.current;
    s.fitted = true;
    s.dirty = true;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d') ?? null;
    const frame = () => {
      const ticked = layout.step() > 0;
      if (ticked && s.fitted) s.view = fitView(layout.bounds(), s.size);
      if ((ticked || s.dirty) && ctx && canvas) {
        s.colors ??= readGraphColors(canvas);
        const ratio = window.devicePixelRatio || 1;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        const { focus: f, ring: r, hovered: h } = drawState.current;
        drawGraph(ctx, s.size, layout, model, s.view, { focus: f, ringed: r, hovered: h }, s.colors);
        s.dirty = false;
      }
      return !layout.settled;
    };
    const frames = new FrameLoop(frame);
    loop.current = frames;
    frames.kick();
    return () => {
      frames.stop();
      loop.current = null;
    };
  }, [layout, model]);

  // The canvas follows its box; the theme is read again when it changes.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return undefined;
    const resize = () => {
      const s = live.current;
      const ratio = window.devicePixelRatio || 1;
      s.size = { width: wrap.clientWidth, height: wrap.clientHeight };
      canvas.width = Math.max(1, Math.round(s.size.width * ratio));
      canvas.height = Math.max(1, Math.round(s.size.height * ratio));
      canvas.style.width = `${s.size.width}px`;
      canvas.style.height = `${s.size.height}px`;
      if (s.fitted) s.view = fitView(layout.bounds(), s.size);
      invalidate();
    };
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(wrap);
    const themeWatch = new MutationObserver(() => {
      live.current.colors = null;
      invalidate();
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      observer?.disconnect();
      themeWatch.disconnect();
    };
  }, [layout, invalidate]);

  const setView = (view: ViewTransform) => {
    live.current.view = view;
    live.current.fitted = false;
    invalidate();
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };
  const nodeAt = (e: { clientX: number; clientY: number }) => {
    const { px, py } = local(e);
    const p = toWorld(live.current.view, px, py);
    return layout.find(p.x, p.y, 3 / live.current.view.k);
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const hit = nodeAt(e);
    gesture.current = hit
      ? { kind: 'drag', index: hit.index, startX: e.clientX, startY: e.clientY, moved: false }
      : { kind: 'pan', startX: e.clientX, startY: e.clientY, view: live.current.view, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (!g) {
      const hit = nodeAt(e);
      setHovered(hit ? hit.index : null);
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    g.moved = true;
    if (g.kind === 'pan') setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
    else {
      const { px, py } = local(e);
      layout.pin(g.index, toWorld(live.current.view, px, py));
      layout.reheat();
      live.current.fitted = false;
      invalidate();
    }
  };
  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'drag') {
      layout.pin(g.index, null);
      if (!g.moved) onOpen(model.nodes[g.index]!);
    }
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  const onWheel = (e: WheelEvent<HTMLCanvasElement>) => {
    const { px, py } = local(e);
    setView(zoomAt(live.current.view, px, py, Math.exp(-e.deltaY * 0.0015)));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const s = live.current;
    const center = { px: s.size.width / 2, py: s.size.height / 2 };
    const pan = { ArrowLeft: [PAN_STEP, 0], ArrowRight: [-PAN_STEP, 0], ArrowUp: [0, PAN_STEP], ArrowDown: [0, -PAN_STEP] }[e.key];
    if (pan) setView({ ...s.view, x: s.view.x + pan[0]!, y: s.view.y + pan[1]! });
    else if (e.key === '+' || e.key === '=') setView(zoomAt(s.view, center.px, center.py, 1.25));
    else if (e.key === '-') setView(zoomAt(s.view, center.px, center.py, 0.8));
    else if (e.key === '0') {
      s.view = fitView(layout.bounds(), s.size);
      s.fitted = true;
      invalidate();
    } else if (e.key === 'Enter' && hovered !== null) onOpen(model.nodes[hovered]!);
    else return;
    e.preventDefault();
  };

  const hoveredNode = hovered !== null ? model.nodes[hovered] : undefined;
  return (
    <div ref={wrapRef} className={`graph-canvas ${className ?? ''}`.trim()}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label={`${label}: ${model.nodes.length} items, ${model.edges.length} links. Arrow keys pan, plus and minus zoom, 0 fits the graph.`}
        className={hoveredNode ? 'is-pointing' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          if (!gesture.current) setHovered(null);
        }}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      />
      {hoveredNode ? (
        <div className="graph-tooltip" role="status">
          {labelOf(hoveredNode)}
        </div>
      ) : null}
    </div>
  );
}
