import { BASIC_ARROW_TOKENS, ensureUniqueId } from "./shared";

import type {
  FlowchartEdge,
  FlowchartNode,
  FlowchartParseResult,
  MermaidDirection,
  MindmapNode,
  MindmapParseResult,
} from "./types";

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

export function parseMermaidFlowchart(source: string): FlowchartParseResult {
  const nodes = new Map<string, FlowchartNode>();
  const edges: FlowchartEdge[] = [];
  let direction: MermaidDirection = "TB";

  const lines = source.split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("%%")) continue;

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

export function parseMermaidMindmap(source: string): MindmapParseResult {
  const nodes = new Map<string, MindmapNode>();
  const edges: { from: string; to: string }[] = [];
  const stack: Array<{ level: number; id: string }> = [];
  let rootId: string | null = null;
  let counter = 0;

  const lines = source.split(/\r?\n/);
  let inMindmap = false;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("%%")) continue;

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
    nodes.set(id, { id, text, shape, radius: parsed?.radius ?? 18 });

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
