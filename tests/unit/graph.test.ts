import { describe, expect, it } from 'vitest';
import { GraphModel, type GraphModelType } from '../../src/shared/contracts/graph';
import { buildGraphModel, type GraphItem, type GraphLink } from '../../src/main/graph/graph-model';
import { fitView, MAX_ZOOM, MIN_ZOOM, toWorld, zoomAt } from '../../src/renderer/graph/graph-draw';
import { GraphLayout, LAYOUT_FRAME_BUDGET_MS, nodeRadius } from '../../src/renderer/graph/graph-layout';
import { matchNodes } from '../../src/renderer/graph/graph-search';
import { FrameLoop } from '../../src/renderer/graph/frame-loop';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const note = (n: number, title = `Note ${n}`): GraphItem => ({ kind: 'note', id: id(n), documentKind: null, title, locked: false, projectId: null, folderId: null });
const doc = (n: number): GraphItem => ({ kind: 'document', id: id(n), documentKind: 'pdf', title: `Doc ${n}`, locked: false, projectId: null, folderId: null });
const ref = (a: number, b: number, kind: GraphLink['kind'] = 'reference', toKind: GraphItem['kind'] = 'note'): GraphLink => ({
  from: { kind: 'note', id: id(a) },
  to: { kind: toKind, id: id(b) },
  kind,
});

/** A synthetic graph: `nodes` notes, `edges` links between pseudo-random distinct pairs (deterministic). */
function synthetic(nodes: number, edges: number): { items: GraphItem[]; links: GraphLink[] } {
  const items = Array.from({ length: nodes }, (_, i) => note(i));
  const links: GraphLink[] = [];
  let seed = 7;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const used = new Set<string>();
  while (links.length < edges) {
    const a = next() % nodes;
    const b = next() % nodes;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (a === b || used.has(key)) continue;
    used.add(key);
    links.push(ref(a, b));
  }
  return { items, links };
}

describe('graph model builder (D-170)', () => {
  it('joins each pair once per kind whatever the direction, counts degrees and drops links to items outside', () => {
    const model = buildGraphModel({
      items: [note(1), note(2), doc(3)],
      links: [ref(1, 2), ref(2, 1), ref(1, 3, 'documentLink', 'document'), ref(1, 3, 'file', 'document'), ref(1, 99), ref(1, 1)],
      includeOrphans: true,
    });
    expect(model.edges).toEqual([
      { source: 0, target: 1, kind: 'reference' },
      { source: 0, target: 2, kind: 'documentLink' },
      { source: 0, target: 2, kind: 'file' },
    ]);
    expect(model.nodes.map((n) => n.degree)).toEqual([3, 1, 2]);
    expect(model.truncated).toBe(false);
    expect(GraphModel.safeParse(model).success).toBe(true);
  });

  it('leaves out unlinked items unless orphans are included, renumbering the edges', () => {
    const items = [note(1), note(2), note(3)];
    const links = [ref(1, 3)];
    expect(buildGraphModel({ items, links, includeOrphans: true }).nodes).toHaveLength(3);
    const linked = buildGraphModel({ items, links, includeOrphans: false });
    expect(linked.nodes.map((n) => n.id)).toEqual([id(1), id(3)]);
    expect(linked.edges).toEqual([{ source: 0, target: 1, kind: 'reference' }]);
  });

  it('keeps the best-linked items at the node limit and stops at the edge limit, and says so', () => {
    const items = [note(1), note(2), note(3), note(4)];
    const links = [ref(1, 2), ref(1, 3), ref(1, 4), ref(2, 3)];
    const model = buildGraphModel({ items, links, includeOrphans: false, limits: { nodes: 3, edges: 10 } });
    expect(model.truncated).toBe(true);
    expect(model.nodes.map((n) => n.id)).toEqual([id(1), id(2), id(3)]);
    expect(model.edges).toHaveLength(3);
    const fewer = buildGraphModel({ items, links, includeOrphans: true, limits: { nodes: 10, edges: 2 } });
    expect(fewer.truncated).toBe(true);
    expect(fewer.edges).toHaveLength(2);
    expect(GraphModel.safeParse(fewer).success).toBe(true);
  });

  it('builds a 2,000-node, 5,000-edge graph well within an interactive budget', () => {
    const { items, links } = synthetic(2000, 5000);
    const start = performance.now();
    const model = buildGraphModel({ items, links, includeOrphans: true });
    const elapsed = performance.now() - start;
    expect(model.nodes).toHaveLength(2000);
    expect(model.edges).toHaveLength(5000);
    expect(elapsed).toBeLessThan(250);
  });
});

describe('graph layout (D-170)', () => {
  const model = (nodes: number, edges: number): GraphModelType => buildGraphModel({ ...synthetic(nodes, edges), includeOrphans: true });

  it('sizes nodes by degree within bounds', () => {
    expect(nodeRadius(0)).toBe(4);
    expect(nodeRadius(4)).toBe(8);
    expect(nodeRadius(10_000)).toBe(18);
  });

  it('a step keeps to its time budget on 2,000 nodes and 5,000 edges (one tick at most past it)', () => {
    const layout = new GraphLayout(model(2000, 5000));
    let tickCost = 0;
    for (let frame = 0; frame < 5; frame += 1) {
      const start = performance.now();
      const ticks = layout.step(LAYOUT_FRAME_BUDGET_MS);
      const elapsed = performance.now() - start;
      expect(ticks).toBeGreaterThanOrEqual(1);
      tickCost = Math.max(tickCost, elapsed / ticks);
      expect(elapsed).toBeLessThan(LAYOUT_FRAME_BUDGET_MS + tickCost + 5);
    }
    // One tick of the full graph is cheap enough for frames to stay responsive.
    expect(tickCost).toBeLessThan(50);
  });

  it('settles: linked nodes end up nearer each other than the average pair', () => {
    const m = model(60, 80);
    const layout = new GraphLayout(m);
    for (let i = 0; i < 2000 && !layout.settled; i += 1) layout.step(1000);
    expect(layout.settled).toBe(true);
    const dist = (a: number, b: number) => Math.hypot(layout.nodes[a]!.x - layout.nodes[b]!.x, layout.nodes[a]!.y - layout.nodes[b]!.y);
    const linked = m.edges.reduce((sum, e) => sum + dist(e.source, e.target), 0) / m.edges.length;
    let all = 0;
    let pairs = 0;
    for (let a = 0; a < m.nodes.length; a += 1) {
      for (let b = a + 1; b < m.nodes.length; b += 1) {
        all += dist(a, b);
        pairs += 1;
      }
    }
    expect(linked).toBeLessThan(all / pairs);
    expect(layout.step()).toBe(0);
  });

  it('hit tests by node radius and follows a pinned node', () => {
    const layout = new GraphLayout(model(10, 9));
    const n = layout.nodes[3]!;
    expect(layout.find(n.x, n.y)?.index).toBe(3);
    layout.pin(3, { x: 500, y: 500 });
    expect(layout.find(500, 500)?.index).toBe(3);
    expect(layout.find(500 + n.radius + 10, 500)).toBeNull();
    layout.pin(3, null);
    expect(layout.nodes[3]!.fx).toBeNull();
  });
});

describe('graph view math and search (D-170)', () => {
  it('fits a box into the viewport and zooms around a point', () => {
    const view = fitView({ minX: -100, minY: -50, maxX: 100, maxY: 50 }, { width: 448, height: 300 });
    expect(view.k).toBeCloseTo(2);
    expect(toWorld(view, 224, 150)).toEqual({ x: 0, y: 0 });
    const zoomed = zoomAt(view, 100, 100, 1.5);
    const before = toWorld(view, 100, 100);
    const after = toWorld(zoomed, 100, 100);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomAt(view, 0, 0, 1000).k).toBe(MAX_ZOOM);
    expect(zoomAt(view, 0, 0, 0.00001).k).toBe(MIN_ZOOM);
  });

  it('matches every word of the query in titles, any case', () => {
    const m = { nodes: [note(1, 'Budget 2027'), note(2, 'Roadmap'), note(3, 'budget review')].map((n) => ({ ...n, degree: 0 })) };
    expect(matchNodes(m, '')).toBeNull();
    expect(matchNodes(m, 'BUDGET')).toEqual(new Set([0, 2]));
    expect(matchNodes(m, 'budget rev')).toEqual(new Set([2]));
  });

  it('the frame loop runs only while there is work', () => {
    const queue: Array<() => void> = [];
    let left = 3;
    const loop = new FrameLoop(() => --left > 0, { request: (cb) => queue.push(cb), cancel: () => undefined });
    loop.kick();
    loop.kick();
    expect(queue).toHaveLength(1);
    while (queue.length > 0) queue.shift()!();
    expect(left).toBe(0);
    loop.kick();
    expect(queue).toHaveLength(1);
  });
});
