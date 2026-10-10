import { forceCenter, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { quadtree, type Quadtree } from 'd3-quadtree';
import type { GraphModelType } from '../../shared/contracts/graph';

/** Time one frame may spend on layout ticks, so the page stays responsive while the graph settles (D-170). */
export const LAYOUT_FRAME_BUDGET_MS = 8;

export interface LayoutNode extends SimulationNodeDatum {
  index: number;
  radius: number;
  x: number;
  y: number;
}

export type LayoutLink = SimulationLinkDatum<LayoutNode> & { source: LayoutNode; target: LayoutNode };

/** A node's radius by its degree: well-linked items stand out, within bounds. */
export const nodeRadius = (degree: number): number => Math.min(18, 4 + 2 * Math.sqrt(degree));

/**
 * A force layout of a graph model (d3-force) that runs in slices: `step` ticks until its time budget is used or the
 * layout has settled, so a frame never blocks for long. Nodes start on a phyllotaxis spiral (deterministic), linked
 * items pull together, all push apart, and weak gravity keeps separate groups near the middle. Hit tests use a
 * quadtree rebuilt only after nodes moved.
 */
export class GraphLayout {
  readonly nodes: LayoutNode[];
  readonly links: LayoutLink[];
  private readonly simulation: Simulation<LayoutNode, LayoutLink>;
  private tree: Quadtree<LayoutNode> | null = null;

  constructor(model: Pick<GraphModelType, 'nodes' | 'edges'>) {
    this.nodes = model.nodes.map((n, index) => {
      const r = 10 * Math.sqrt(index + 0.5);
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      return { index, radius: nodeRadius(n.degree), x: r * Math.cos(angle), y: r * Math.sin(angle) };
    });
    this.links = model.edges.map((e) => ({ source: this.nodes[e.source]!, target: this.nodes[e.target]! }));
    const crowded = this.nodes.length > 1000;
    this.simulation = forceSimulation<LayoutNode, LayoutLink>(this.nodes)
      .force('link', forceLink<LayoutNode, LayoutLink>(this.links).distance(48).strength(0.4))
      .force('charge', forceManyBody<LayoutNode>().strength(crowded ? -30 : -60).theta(crowded ? 1.2 : 0.9).distanceMax(600))
      .force('x', forceX<LayoutNode>(0).strength(0.04))
      .force('y', forceY<LayoutNode>(0).strength(0.04))
      .force('center', forceCenter<LayoutNode>(0, 0))
      .alphaDecay(crowded ? 0.04 : 0.0228)
      .stop();
  }

  get settled(): boolean {
    return this.simulation.alpha() < this.simulation.alphaMin();
  }

  /** Ticks until `budgetMs` has passed or the layout settled; returns the number of ticks run. */
  step(budgetMs = LAYOUT_FRAME_BUDGET_MS, now: () => number = () => performance.now()): number {
    const start = now();
    let ticks = 0;
    while (!this.settled && now() - start < budgetMs) {
      this.simulation.tick();
      ticks += 1;
    }
    if (ticks > 0) this.tree = null;
    return ticks;
  }

  /** Wakes the layout (a node was dragged). */
  reheat(alpha = 0.3): void {
    this.simulation.alpha(Math.max(this.simulation.alpha(), alpha));
  }

  /** Holds a node where it is dragged to; `null` lets it go. */
  pin(index: number, at: { x: number; y: number } | null): void {
    const node = this.nodes[index];
    if (!node) return;
    node.fx = at?.x ?? null;
    node.fy = at?.y ?? null;
    if (at) {
      node.x = at.x;
      node.y = at.y;
    }
    this.tree = null;
  }

  /** The node under a point (world coordinates), within its radius plus `slack`. */
  find(x: number, y: number, slack = 2): LayoutNode | null {
    this.tree ??= quadtree<LayoutNode>()
      .x((n) => n.x)
      .y((n) => n.y)
      .addAll(this.nodes);
    const near = this.tree.find(x, y, 18 + slack);
    if (!near) return null;
    return Math.hypot(near.x - x, near.y - y) <= near.radius + slack ? near : null;
  }

  /** The box holding every node, or null for an empty graph. */
  bounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    if (this.nodes.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of this.nodes) {
      minX = Math.min(minX, n.x - n.radius);
      minY = Math.min(minY, n.y - n.radius);
      maxX = Math.max(maxX, n.x + n.radius);
      maxY = Math.max(maxY, n.y + n.radius);
    }
    return { minX, minY, maxX, maxY };
  }
}
