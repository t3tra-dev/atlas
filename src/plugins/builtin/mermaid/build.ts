import type { DocEdge, DocNode, DocumentModel } from "@/components/document/model";
import { createUniqueHashId } from "@/lib/hash-id";

import { layoutFlowchart, layoutMindmap } from "./layout";
import { parseMermaidFlowchart, parseMermaidMindmap } from "./parser";
import { MERMAID_LAYOUT_ANIMATION_MS, measurePlacedBounds } from "./shared";

import type { BuildMermaidOptions, MermaidBuildResult } from "./types";

function buildShapeNode(
  id: string,
  pos: { x: number; y: number; w: number; h: number },
  text: string,
  shape: string,
  radius?: number,
): DocNode {
  return {
    id,
    type: "shape",
    x: pos.x,
    y: pos.y,
    w: pos.w,
    h: pos.h,
    props: {
      text,
      shape,
      fill: "rgba(99, 102, 241, 0.08)",
      stroke: "rgba(99, 102, 241, 0.6)",
      strokeWidth: 2,
      radius: shape === "rect" ? (radius ?? 8) : undefined,
    },
  };
}

function buildBoundsFromPlaced(
  placed: Map<string, { x: number; y: number; w: number; h: number }>,
) {
  const bounds = measurePlacedBounds(placed);
  return bounds
    ? {
        minX: bounds.minX,
        minY: bounds.minY,
        maxX: bounds.maxX,
        maxY: bounds.maxY,
      }
    : null;
}

function buildMermaidEntityPrefix(idPrefix: string, kind: "node" | "edge") {
  if (!idPrefix) return kind;
  return idPrefix.endsWith("_") ? `${idPrefix}${kind}` : `${idPrefix}_${kind}`;
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
  opts?: BuildMermaidOptions,
): MermaidBuildResult {
  const existingNodeIds = opts?.existingNodeIds ?? new Set<string>();
  const existingEdgeIds = opts?.existingEdgeIds ?? new Set<string>();
  const idPrefix = opts?.idPrefix ?? "";
  const animateIn = opts?.animateIn ?? false;

  const trimmedSource = source.trim();
  const isMindmap = /^mindmap\b/i.test(trimmedSource);

  if (isMindmap) {
    const parsed = parseMermaidMindmap(source);
    const layout = layoutMindmap(parsed.nodes, parsed.edges, parsed.rootId);
    const nodeMap: Record<string, DocNode> = {};
    const nodeOrder: string[] = [];
    const idMap = new Map<string, string>();
    const nodeById = new Map(parsed.nodes.map((node) => [node.id, node]));

    for (const id of layout.order) {
      const node = nodeById.get(id);
      const pos = layout.placed.get(id);
      if (!node || !pos) continue;
      const docId = createUniqueHashId(
        buildMermaidEntityPrefix(idPrefix, "node"),
        existingNodeIds,
        node.id,
      );
      idMap.set(node.id, docId);
      nodeMap[docId] = buildShapeNode(docId, pos, node.text, node.shape, node.radius);
      nodeOrder.push(docId);
    }

    const edgeMap: Record<string, DocEdge> = {};
    const edgeOrder: string[] = [];
    parsed.edges.forEach((edge, index) => {
      const fromId = idMap.get(edge.from);
      const toId = idMap.get(edge.to);
      if (!fromId || !toId) return;
      const id = createUniqueHashId(
        buildMermaidEntityPrefix(idPrefix, "edge"),
        existingEdgeIds,
        `${edge.from}:${edge.to}:${index}`,
      );
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

    return {
      nodes: nodeMap,
      nodeOrder,
      edges: edgeMap,
      edgeOrder,
      bounds: buildBoundsFromPlaced(layout.placed),
    };
  }

  const parsed = parseMermaidFlowchart(source);
  const layout = layoutFlowchart(parsed.nodes, parsed.edges, parsed.direction);
  const nodeMap: Record<string, DocNode> = {};
  const nodeOrder: string[] = [];
  const idMap = new Map<string, string>();
  const targetPositions: Record<string, { x: number; y: number }> = {};
  const nodeById = new Map(parsed.nodes.map((node) => [node.id, node]));

  for (const id of layout.order) {
    const node = nodeById.get(id);
    const finalPos = layout.placed.get(id);
    if (!node || !finalPos) continue;
    const docId = createUniqueHashId(
      buildMermaidEntityPrefix(idPrefix, "node"),
      existingNodeIds,
      node.id,
    );
    idMap.set(node.id, docId);
    const pos = animateIn ? (layout.initialPlaced.get(node.id) ?? finalPos) : finalPos;
    nodeMap[docId] = buildShapeNode(docId, pos, node.text, node.shape, node.radius);
    targetPositions[docId] = { x: finalPos.x, y: finalPos.y };
    nodeOrder.push(docId);
  }

  const edgeMap: Record<string, DocEdge> = {};
  const edgeOrder: string[] = [];
  parsed.edges.forEach((edge, index) => {
    const fromId = idMap.get(edge.from);
    const toId = idMap.get(edge.to);
    if (!fromId || !toId) return;
    const id = createUniqueHashId(
      buildMermaidEntityPrefix(idPrefix, "edge"),
      existingEdgeIds,
      `${edge.from}:${edge.to}:${edge.label ?? ""}:${index}`,
    );
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

  return {
    nodes: nodeMap,
    nodeOrder,
    edges: edgeMap,
    edgeOrder,
    bounds: buildBoundsFromPlaced(layout.placed),
    animation: animateIn
      ? {
          durationMs: MERMAID_LAYOUT_ANIMATION_MS,
          targetPositions,
        }
      : undefined,
  };
}
