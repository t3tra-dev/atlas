import type { DocEdge, DocNode, DocumentModel } from "@/components/document/model";

export type MermaidDirection = "TB" | "TD" | "LR" | "RL" | "BT";
export type FlowchartShape =
  | "rect"
  | "stadium"
  | "subroutine"
  | "cylinder"
  | "circle"
  | "doublecircle"
  | "diamond"
  | "hexagon"
  | "parallelogram"
  | "trapezoid"
  | "invtrapezoid";

type FlowchartNode = {
  id: string;
  text: string;
  shape: FlowchartShape;
  radius?: number;
};

type FlowchartEdge = {
  from: string;
  to: string;
  arrow: "none" | "end" | "both";
  dashed: boolean;
  width: number;
  label?: string;
};

type MindmapNode = {
  id: string;
  text: string;
  shape: FlowchartShape;
  radius?: number;
};

type MindmapEdge = {
  from: string;
  to: string;
};

export type MermaidBuildResult = {
  nodes: Record<string, DocNode>;
  nodeOrder: string[];
  edges: Record<string, DocEdge>;
  edgeOrder: string[];
  bounds: null | { minX: number; minY: number; maxX: number; maxY: number };
};

const BASIC_ARROW_TOKENS = ["<-->", "<==>", "-.->", "<--", "<==", "-->", "==>", "---"];

function normalizeDirection(token: string | undefined): MermaidDirection {
  switch ((token ?? "").trim().toUpperCase()) {
    case "TD":
      return "TD";
    case "TB":
      return "TB";
    case "LR":
      return "LR";
    case "RL":
      return "RL";
    case "BT":
      return "BT";
    default:
      return "TB";
  }
}

function stripQuotes(text: string) {
  const t = text.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function normalizeLabel(label: string) {
  return label.replace(/fa:fa-[\w-]+\s*/g, "").trim();
}

function slugify(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/<[^>]*>/g, "")
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "node"
  );
}

function parseNodeToken(raw: string): FlowchartNode | null {
  const text = raw.trim();
  if (!text) return null;

  const doubleCircle = text.match(/^([\w-]+)\s*\(\(\((.*)\)\)\)\s*$/);
  if (doubleCircle) {
    return {
      id: doubleCircle[1],
      text: normalizeLabel(stripQuotes(doubleCircle[2])),
      shape: "doublecircle",
    };
  }

  const circle = text.match(/^([\w-]+)\s*\(\((.*)\)\)\s*$/);
  if (circle) {
    return {
      id: circle[1],
      text: normalizeLabel(stripQuotes(circle[2])),
      shape: "circle",
    };
  }

  const stadium = text.match(/^([\w-]+)\s*\(\[(.*)\]\)\s*$/);
  if (stadium) {
    return {
      id: stadium[1],
      text: normalizeLabel(stripQuotes(stadium[2])),
      shape: "stadium",
    };
  }

  const subroutine = text.match(/^([\w-]+)\s*\[\[(.*)\]\]\s*$/);
  if (subroutine) {
    return {
      id: subroutine[1],
      text: normalizeLabel(stripQuotes(subroutine[2])),
      shape: "subroutine",
    };
  }

  const cylinder = text.match(/^([\w-]+)\s*\[\((.*)\)\]\s*$/);
  if (cylinder) {
    return {
      id: cylinder[1],
      text: normalizeLabel(stripQuotes(cylinder[2])),
      shape: "cylinder",
    };
  }

  const hexagon = text.match(/^([\w-]+)\s*\{\{(.*)\}\}\s*$/);
  if (hexagon) {
    return {
      id: hexagon[1],
      text: normalizeLabel(stripQuotes(hexagon[2])),
      shape: "hexagon",
    };
  }

  const parallelogram = text.match(/^([\w-]+)\s*\[(?:\/(.*)\/|\\(.*)\\)\]\s*$/);
  if (parallelogram) {
    return {
      id: parallelogram[1],
      text: normalizeLabel(stripQuotes(parallelogram[2] ?? parallelogram[3] ?? "")),
      shape: "parallelogram",
    };
  }

  const trapezoid = text.match(/^([\w-]+)\s*\[\/(.*)\\\]\s*$/);
  if (trapezoid) {
    return {
      id: trapezoid[1],
      text: normalizeLabel(stripQuotes(trapezoid[2])),
      shape: "trapezoid",
    };
  }

  const invTrapezoid = text.match(/^([\w-]+)\s*\[\\(.*)\/\]\s*$/);
  if (invTrapezoid) {
    return {
      id: invTrapezoid[1],
      text: normalizeLabel(stripQuotes(invTrapezoid[2])),
      shape: "invtrapezoid",
    };
  }

  const diamond = text.match(/^([\w-]+)\s*\{(.*)\}\s*$/);
  if (diamond) {
    return {
      id: diamond[1],
      text: normalizeLabel(stripQuotes(diamond[2])),
      shape: "diamond",
    };
  }

  const rect = text.match(/^([\w-]+)\s*\[(.*)\]\s*$/);
  if (rect) {
    return {
      id: rect[1],
      text: normalizeLabel(stripQuotes(rect[2])),
      shape: "rect",
    };
  }

  const round = text.match(/^([\w-]+)\s*\((.*)\)\s*$/);
  if (round) {
    return {
      id: round[1],
      text: normalizeLabel(stripQuotes(round[2])),
      shape: "rect",
      radius: 18,
    };
  }

  const simple = text.match(/^([\w-]+)\s*$/);
  if (simple) {
    return {
      id: simple[1],
      text: simple[1],
      shape: "rect",
    };
  }

  return null;
}

function upsertNode(map: Map<string, FlowchartNode>, node: FlowchartNode) {
  const cur = map.get(node.id);
  if (!cur) {
    map.set(node.id, node);
    return;
  }

  const shouldReplaceText = cur.text === cur.id && node.text !== cur.text;
  const shouldReplaceShape = cur.shape === "rect" && node.shape !== cur.shape;

  if (shouldReplaceText || shouldReplaceShape) {
    map.set(node.id, {
      ...cur,
      ...node,
      text: shouldReplaceText ? node.text : cur.text,
    });
  }
}

function ensureUniqueId(base: string, existing: Set<string>) {
  let id = base;
  let i = 1;
  while (existing.has(id)) {
    i += 1;
    id = `${base}_${i}`;
  }
  existing.add(id);
  return id;
}

function findArrowToken(line: string) {
  let best: { token: string; index: number } | null = null;
  for (const token of BASIC_ARROW_TOKENS) {
    const idx = line.indexOf(token);
    if (idx < 0) continue;
    if (!best || idx < best.index || (idx === best.index && token.length > best.token.length)) {
      best = { token, index: idx };
    }
  }
  return best?.token ?? null;
}

export function parseMermaidFlowchart(source: string) {
  const nodes = new Map<string, FlowchartNode>();
  const edges: FlowchartEdge[] = [];
  let direction: MermaidDirection = "TB";

  const lines = source.split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("%%")) continue;

    if (/^(flowchart|graph)\b/i.test(trimmed)) {
      const parts = trimmed.split(/\s+/);
      direction = normalizeDirection(parts[1]);
      continue;
    }

    if (/^(classDef|class|style)\b/i.test(trimmed)) continue;

    const inline = trimmed.split("%%")[0].trim();
    if (!inline) continue;

    let label: string | undefined;
    const pipeMatch = inline.match(/\|(.+?)\|/);
    let line = inline;
    if (pipeMatch) {
      label = normalizeLabel(pipeMatch[1]);
      line = inline.replace(/\|(.+?)\|/, " ");
    }

    if (!label) {
      const longLabel = line.match(/^(.*?)\s*--\s*(.+?)\s*-->\s*(.*)$/);
      if (longLabel) {
        label = normalizeLabel(longLabel[2]);
        line = `${longLabel[1]} --> ${longLabel[3]}`;
      }
    }

    const token = findArrowToken(line);
    if (!token) {
      const node = parseNodeToken(line);
      if (node) upsertNode(nodes, node);
      continue;
    }

    const idx = line.indexOf(token);
    const left = line.slice(0, idx).trim();
    const right = line.slice(idx + token.length).trim();

    const fromNode = parseNodeToken(left);
    const toNode = parseNodeToken(right);
    if (!fromNode || !toNode) continue;

    upsertNode(nodes, fromNode);
    upsertNode(nodes, toNode);

    const hasStartArrow = token.startsWith("<");
    const hasEndArrow = token.endsWith(">");
    const dashed = token.includes(".");
    const width = token.includes("=") ? 3 : 2;

    let from = fromNode.id;
    let to = toNode.id;
    let arrow: "none" | "end" | "both" = "none";

    if (hasStartArrow && hasEndArrow) {
      arrow = "both";
    } else if (hasEndArrow) {
      arrow = "end";
    } else if (hasStartArrow) {
      arrow = "end";
      from = toNode.id;
      to = fromNode.id;
    }

    edges.push({
      from,
      to,
      arrow,
      dashed,
      width,
      label,
    });
  }

  for (const edge of edges) {
    if (!nodes.has(edge.from)) {
      nodes.set(edge.from, { id: edge.from, text: edge.from, shape: "rect" });
    }
    if (!nodes.has(edge.to)) {
      nodes.set(edge.to, { id: edge.to, text: edge.to, shape: "rect" });
    }
  }

  return { direction, nodes: Array.from(nodes.values()), edges };
}

function parseMermaidMindmap(source: string) {
  const nodes = new Map<string, MindmapNode>();
  const edges: MindmapEdge[] = [];
  const stack: Array<{ level: number; id: string }> = [];
  let rootId: string | null = null;
  let counter = 0;

  const lines = source.split(/\r?\n/);
  let inMindmap = false;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("%%")) continue;

    if (/^mindmap\b/i.test(trimmed)) {
      inMindmap = true;
      continue;
    }
    if (!inMindmap) continue;

    if (trimmed.startsWith("::icon") || trimmed.startsWith(":::")) continue;

    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const level = Math.max(0, Math.floor(indent / 2));

    const explicit = /[[\]{}()]/.test(trimmed);
    const parsed = parseNodeToken(trimmed);
    const text = parsed ? parsed.text : normalizeLabel(stripQuotes(trimmed));
    const shape = parsed?.shape ?? "rect";

    let baseId = parsed?.id;
    if (!explicit || !baseId) {
      baseId = slugify(text);
    }

    const id = ensureUniqueId(`mm_${baseId}_${counter++}`, new Set(nodes.keys()));
    const node: MindmapNode = { id, text, shape, radius: parsed?.radius ?? 18 };
    nodes.set(id, node);

    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      edges.push({ from: parent.id, to: id });
    } else if (!rootId) {
      rootId = id;
    }

    stack.push({ level, id });
  }

  return { nodes: Array.from(nodes.values()), edges, rootId };
}

function estimateNodeSize(text: string, shape: FlowchartShape) {
  const normalized = text.replace(/<br\s*\/?>/gi, "\n").replace(/\\n/g, "\n");
  const lines = normalized.split(/\n/);
  const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const baseW = Math.min(360, Math.max(140, maxLen * 8 + 36));
  const baseH = Math.max(70, lines.length * 20 + 34);

  if (shape === "circle") {
    const size = Math.max(baseW, baseH);
    return { w: size, h: size };
  }

  if (shape === "doublecircle") {
    const size = Math.max(baseW, baseH) + 16;
    return { w: size, h: size };
  }

  if (shape === "diamond") {
    const size = Math.max(baseW, baseH) + 20;
    return { w: size, h: size };
  }

  return { w: baseW, h: baseH };
}

function layoutFlowchart(
  nodes: Array<FlowchartNode>,
  edges: Array<FlowchartEdge>,
  direction: MermaidDirection,
) {
  const nodeIds = nodes.map((n) => n.id);
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const id of nodeIds) {
    incoming.set(id, 0);
    outgoing.set(id, []);
  }

  for (const edge of edges) {
    const out = outgoing.get(edge.from);
    if (out) out.push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  const queue: string[] = nodeIds.filter((id) => (incoming.get(id) ?? 0) === 0);
  const rank = new Map<string, number>();

  for (const id of queue) rank.set(id, 0);

  while (queue.length) {
    const id = queue.shift()!;
    const r = rank.get(id) ?? 0;
    for (const next of outgoing.get(id) ?? []) {
      const nextRank = Math.max(rank.get(next) ?? 0, r + 1);
      rank.set(next, nextRank);
      incoming.set(next, (incoming.get(next) ?? 0) - 1);
      if ((incoming.get(next) ?? 0) === 0) {
        queue.push(next);
      }
    }
  }

  for (const id of nodeIds) {
    if (!rank.has(id)) rank.set(id, 0);
  }

  const ranks = new Map<number, FlowchartNode[]>();
  for (const node of nodes) {
    const r = rank.get(node.id) ?? 0;
    if (!ranks.has(r)) ranks.set(r, []);
    ranks.get(r)!.push(node);
  }

  const orderedRanks = Array.from(ranks.entries()).sort((a, b) => a[0] - b[0]);
  const placed = new Map<string, { x: number; y: number; w: number; h: number }>();

  const gapX = 120;
  const gapY = 90;
  const margin = 160;

  if (direction === "LR" || direction === "RL") {
    let x = margin;
    for (const [, group] of orderedRanks) {
      let y = margin;
      const sizes = group.map((n) => ({ id: n.id, ...estimateNodeSize(n.text, n.shape) }));
      const colWidth = Math.max(...sizes.map((s) => s.w));
      for (const size of sizes) {
        placed.set(size.id, {
          x: x + (colWidth - size.w) / 2,
          y,
          w: size.w,
          h: size.h,
        });
        y += size.h + gapY;
      }
      x += colWidth + gapX;
    }
  } else {
    let y = margin;
    for (const [, group] of orderedRanks) {
      let x = margin;
      const sizes = group.map((n) => ({ id: n.id, ...estimateNodeSize(n.text, n.shape) }));
      const rowHeight = Math.max(...sizes.map((s) => s.h));
      for (const size of sizes) {
        placed.set(size.id, {
          x,
          y: y + (rowHeight - size.h) / 2,
          w: size.w,
          h: size.h,
        });
        x += size.w + gapX;
      }
      y += rowHeight + gapY;
    }
  }

  const bounds = Array.from(placed.values()).reduce(
    (acc, v) => ({
      minX: Math.min(acc.minX, v.x),
      minY: Math.min(acc.minY, v.y),
      maxX: Math.max(acc.maxX, v.x + v.w),
      maxY: Math.max(acc.maxY, v.y + v.h),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );

  if (direction === "RL") {
    for (const [id, pos] of placed) {
      const nextX = bounds.maxX - (pos.x - bounds.minX) - pos.w;
      placed.set(id, { ...pos, x: nextX });
    }
  }

  if (direction === "BT") {
    for (const [id, pos] of placed) {
      const nextY = bounds.maxY - (pos.y - bounds.minY) - pos.h;
      placed.set(id, { ...pos, y: nextY });
    }
  }

  return { placed, order: orderedRanks.flatMap(([, group]) => group.map((n) => n.id)) };
}

function layoutMindmap(
  nodes: Array<MindmapNode>,
  edges: Array<MindmapEdge>,
  rootId: string | null,
) {
  if (!rootId) {
    return { placed: new Map<string, { x: number; y: number; w: number; h: number }>(), order: [] };
  }

  const childrenMap = new Map<string, string[]>();
  for (const node of nodes) {
    childrenMap.set(node.id, []);
  }
  for (const edge of edges) {
    const list = childrenMap.get(edge.from);
    if (list) list.push(edge.to);
  }

  const sizeMap = new Map<string, { w: number; h: number }>();
  for (const node of nodes) {
    sizeMap.set(node.id, estimateNodeSize(node.text, node.shape));
  }

  const gapX = 240;
  const gapY = 60;

  const subtreeHeight = (id: string): number => {
    const children = childrenMap.get(id) ?? [];
    const own = sizeMap.get(id)?.h ?? 60;
    if (!children.length) return own;
    const total =
      children.map((child) => subtreeHeight(child)).reduce((a, b) => a + b, 0) +
      gapY * (children.length - 1);
    return Math.max(own, total);
  };

  const placed = new Map<string, { x: number; y: number; w: number; h: number }>();
  const order: string[] = [];

  const placeNode = (id: string, x: number, y: number) => {
    const size = sizeMap.get(id) ?? { w: 160, h: 80 };
    placed.set(id, { x, y, w: size.w, h: size.h });
    order.push(id);
  };

  const layoutBranch = (
    parentId: string,
    childIds: string[],
    direction: "left" | "right",
    startY: number,
  ) => {
    let y = startY;
    for (const childId of childIds) {
      const size = sizeMap.get(childId) ?? { w: 160, h: 80 };
      const height = subtreeHeight(childId);
      const parentPos = placed.get(parentId)!;
      const childX =
        direction === "right" ? parentPos.x + parentPos.w + gapX : parentPos.x - gapX - size.w;
      const childY = y + (height - size.h) / 2;
      placeNode(childId, childX, childY);
      const grand = childrenMap.get(childId) ?? [];
      if (grand.length) {
        layoutBranch(childId, grand, direction, y);
      }
      y += height + gapY;
    }
  };

  const rootSize = sizeMap.get(rootId) ?? { w: 200, h: 100 };
  placeNode(rootId, 0, 0);

  const rootChildren = childrenMap.get(rootId) ?? [];
  const left: string[] = [];
  const right: string[] = [];
  rootChildren.forEach((id, idx) => {
    (idx % 2 === 0 ? right : left).push(id);
  });

  const rightHeight =
    right.reduce((sum, id) => sum + subtreeHeight(id), 0) +
    (right.length > 0 ? gapY * (right.length - 1) : 0);
  const leftHeight =
    left.reduce((sum, id) => sum + subtreeHeight(id), 0) +
    (left.length > 0 ? gapY * (left.length - 1) : 0);

  const rootCenterY = rootSize.h / 2;
  if (right.length) {
    layoutBranch(rootId, right, "right", rootCenterY - rightHeight / 2);
  }
  if (left.length) {
    layoutBranch(rootId, left, "left", rootCenterY - leftHeight / 2);
  }

  const bounds = Array.from(placed.values()).reduce(
    (acc, v) => ({
      minX: Math.min(acc.minX, v.x),
      minY: Math.min(acc.minY, v.y),
      maxX: Math.max(acc.maxX, v.x + v.w),
      maxY: Math.max(acc.maxY, v.y + v.h),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  const offsetX = Number.isFinite(bounds.minX) ? 200 - bounds.minX : 0;
  const offsetY = Number.isFinite(bounds.minY) ? 200 - bounds.minY : 0;
  for (const [id, pos] of placed) {
    placed.set(id, { ...pos, x: pos.x + offsetX, y: pos.y + offsetY });
  }

  return { placed, order };
}

export function buildDocumentFromMermaid(source: string): DocumentModel {
  const built = buildMermaidElements(source);
  const safeBounds = built.bounds ?? { minX: 0, minY: 0, maxX: 1200, maxY: 900 };

  const padding = 200;
  const width = Math.max(1600, safeBounds.maxX - safeBounds.minX + padding * 2);
  const height = Math.max(1200, safeBounds.maxY - safeBounds.minY + padding * 2);

  return {
    version: 1,
    title: "Mermaid",
    camera: { x: 0, y: 0, scale: 1 },
    canvas: {
      width,
      height,
      background: "grid",
    },
    nodes: built.nodes,
    nodeOrder: built.nodeOrder,
    edges: built.edges,
    edgeOrder: built.edgeOrder,
  };
}

export function buildMermaidElements(
  source: string,
  opts?: {
    existingNodeIds?: Set<string>;
    existingEdgeIds?: Set<string>;
    idPrefix?: string;
  },
): MermaidBuildResult {
  const existingNodeIds = opts?.existingNodeIds ?? new Set<string>();
  const existingEdgeIds = opts?.existingEdgeIds ?? new Set<string>();
  const idPrefix = opts?.idPrefix ?? "mmd_";

  const trimmedSource = source.trim();
  const isMindmap = /^mindmap\b/i.test(trimmedSource);

  if (isMindmap) {
    const parsed = parseMermaidMindmap(source);
    const layout = layoutMindmap(parsed.nodes, parsed.edges, parsed.rootId);

    const nodeMap: Record<string, DocNode> = {};
    const nodeOrder: string[] = [];
    const idMap = new Map<string, string>();

    for (const id of layout.order) {
      const node = parsed.nodes.find((n) => n.id === id);
      if (!node) continue;
      const baseId = `${idPrefix}node_${node.id}`;
      const docId = ensureUniqueId(baseId, existingNodeIds);
      idMap.set(node.id, docId);
      const pos = layout.placed.get(node.id);
      if (!pos) continue;
      nodeMap[docId] = {
        id: docId,
        type: "shape",
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
        props: {
          text: node.text,
          shape: node.shape,
          fill: "rgba(99, 102, 241, 0.08)",
          stroke: "rgba(99, 102, 241, 0.6)",
          strokeWidth: 2,
          radius: node.shape === "rect" ? (node.radius ?? 8) : undefined,
        },
      };
      nodeOrder.push(docId);
    }

    const edgeMap: Record<string, DocEdge> = {};
    const edgeOrder: string[] = [];
    parsed.edges.forEach((edge, index) => {
      const fromId = idMap.get(edge.from);
      const toId = idMap.get(edge.to);
      if (!fromId || !toId) return;
      const baseId = `${idPrefix}edge_${index}`;
      const id = ensureUniqueId(baseId, existingEdgeIds);
      edgeMap[id] = {
        id,
        shape: "line",
        arrow: "none",
        from: fromId,
        to: toId,
        props: {
          color: "#5a75bc",
          width: 2,
          dash: "solid",
        },
      };
      edgeOrder.push(id);
    });

    const bounds = Object.values(nodeMap).reduce<null | {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    }>((acc, node) => {
      if (!acc) {
        return {
          minX: node.x,
          minY: node.y,
          maxX: node.x + node.w,
          maxY: node.y + node.h,
        };
      }
      return {
        minX: Math.min(acc.minX, node.x),
        minY: Math.min(acc.minY, node.y),
        maxX: Math.max(acc.maxX, node.x + node.w),
        maxY: Math.max(acc.maxY, node.y + node.h),
      };
    }, null);

    return { nodes: nodeMap, nodeOrder, edges: edgeMap, edgeOrder, bounds };
  }

  const parsed = parseMermaidFlowchart(source);
  const layout = layoutFlowchart(parsed.nodes, parsed.edges, parsed.direction);

  const nodeMap: Record<string, DocNode> = {};
  const nodeOrder: string[] = [];
  const idMap = new Map<string, string>();

  for (const id of layout.order) {
    const node = parsed.nodes.find((n) => n.id === id);
    if (!node) continue;
    const baseId = `${idPrefix}node_${node.id}`;
    const docId = ensureUniqueId(baseId, existingNodeIds);
    idMap.set(node.id, docId);
    const pos = layout.placed.get(node.id);
    if (!pos) continue;
    nodeMap[docId] = {
      id: docId,
      type: "shape",
      x: pos.x,
      y: pos.y,
      w: pos.w,
      h: pos.h,
      props: {
        text: node.text,
        shape: node.shape,
        fill: "rgba(99, 102, 241, 0.08)",
        stroke: "rgba(99, 102, 241, 0.6)",
        strokeWidth: 2,
        radius: node.shape === "rect" ? (node.radius ?? 8) : undefined,
      },
    };
    nodeOrder.push(docId);
  }

  const edgeMap: Record<string, DocEdge> = {};
  const edgeOrder: string[] = [];
  parsed.edges.forEach((edge, index) => {
    const fromId = idMap.get(edge.from);
    const toId = idMap.get(edge.to);
    if (!fromId || !toId) return;
    const baseId = `${idPrefix}edge_${index}`;
    const id = ensureUniqueId(baseId, existingEdgeIds);
    edgeMap[id] = {
      id,
      shape: "line",
      arrow: edge.arrow,
      from: fromId,
      to: toId,
      props: {
        color: "#5a75bc",
        width: edge.width,
        dash: edge.dashed ? "dashed" : "solid",
        label: edge.label?.trim() ? edge.label.trim() : undefined,
      },
    };
    edgeOrder.push(id);
  });

  const bounds = Object.values(nodeMap).reduce<null | {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>((acc, node) => {
    if (!acc) {
      return {
        minX: node.x,
        minY: node.y,
        maxX: node.x + node.w,
        maxY: node.y + node.h,
      };
    }
    return {
      minX: Math.min(acc.minX, node.x),
      minY: Math.min(acc.minY, node.y),
      maxX: Math.max(acc.maxX, node.x + node.w),
      maxY: Math.max(acc.maxY, node.y + node.h),
    };
  }, null);

  return { nodes: nodeMap, nodeOrder, edges: edgeMap, edgeOrder, bounds };
}
