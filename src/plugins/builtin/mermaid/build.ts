import type { DocEdge, DocNode, DocumentModel } from "@/components/document/model";
import { createUniqueHashId } from "@/lib/hash-id";

import { layoutFlowchart, layoutMindmap, layoutSubgraphForceAtlas2 } from "./layout";
import { parseMermaidFlowchart, parseMermaidMindmap } from "./parser";
import {
  MERMAID_LAYOUT_ANIMATION_MS,
  estimateNodeSize,
  measurePlacedBounds,
  normalizePlaced,
  scalePlacedAroundCenter,
} from "./shared";

import type { BuildMermaidOptions, MermaidBuildResult } from "./types";

const DEFAULT_CONTAINER_FILL = "rgba(148, 163, 184, 0.08)";
const DEFAULT_CONTAINER_STROKE = "rgba(100, 116, 139, 0.7)";
const DEFAULT_CONTAINER_LABEL_BG = "rgba(15, 23, 42, 0.7)";
const DEFAULT_CONTAINER_LABEL_COLOR = "#f8fafc";
const DEFAULT_CONTAINER_PADDING = 36;

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

function buildContainerNode(
  id: string,
  pos: { x: number; y: number; w: number; h: number },
  title: string,
  padding: number,
): DocNode {
  return {
    id,
    type: "container",
    x: pos.x,
    y: pos.y,
    w: pos.w,
    h: pos.h,
    props: {
      title,
      padding,
      fill: DEFAULT_CONTAINER_FILL,
      stroke: DEFAULT_CONTAINER_STROKE,
      strokeWidth: 2,
      radius: 16,
      labelBackground: DEFAULT_CONTAINER_LABEL_BG,
      labelColor: DEFAULT_CONTAINER_LABEL_COLOR,
    },
  };
}

function computeBoundsFromDocNodes(nodes: Record<string, DocNode>, nodeIds: string[]) {
  let bounds: null | { minX: number; minY: number; maxX: number; maxY: number } = null;
  for (const nodeId of nodeIds) {
    const node = nodes[nodeId];
    if (!node) continue;
    if (!bounds) {
      bounds = {
        minX: node.x,
        minY: node.y,
        maxX: node.x + node.w,
        maxY: node.y + node.h,
      };
      continue;
    }
    bounds = {
      minX: Math.min(bounds.minX, node.x),
      minY: Math.min(bounds.minY, node.y),
      maxX: Math.max(bounds.maxX, node.x + node.w),
      maxY: Math.max(bounds.maxY, node.y + node.h),
    };
  }
  return bounds;
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
  const hasSubgraph = /(^|\n)\s*subgraph\b/i.test(trimmedSource);
  const hasExplicitEdges = /(^|\s)(<-->|<==>|-->|==>|<--|<==|---|-.->)/.test(trimmedSource);
  const treatMindmapAsFlowchart = isMindmap && (hasSubgraph || hasExplicitEdges);

  if (isMindmap && !treatMindmapAsFlowchart) {
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
  const nodeMap: Record<string, DocNode> = {};
  const nodeOrder: string[] = [];
  const idMap = new Map<string, string>();
  const targetPositions: Record<string, { x: number; y: number }> = {};
  const groupIds = new Set(parsed.groups.map((group) => group.id));
  const nodesWithoutGroups = parsed.nodes.filter((node) => !groupIds.has(node.id));

  for (const node of nodesWithoutGroups) {
    const docId = createUniqueHashId(
      buildMermaidEntityPrefix(idPrefix, "node"),
      existingNodeIds,
      node.id,
    );
    idMap.set(node.id, docId);
  }

  parsed.groups.forEach((group) => {
    if (!group.members.length) return;
    const memberSet = new Set(group.members);
    const hasExternalEdges = parsed.edges.some((edge) => {
      const fromIn = memberSet.has(edge.from);
      const toIn = memberSet.has(edge.to);
      return (fromIn || toIn) && !(fromIn && toIn);
    });
    if (hasExternalEdges) return;

    const memberNodes = parsed.nodes.filter((node) => memberSet.has(node.id));
    if (!memberNodes.length) return;
    const memberDocIds = memberNodes
      .map((node) => idMap.get(node.id))
      .filter((nodeId): nodeId is string => !!nodeId);
    const originalBounds = computeBoundsFromDocNodes(nodeMap, memberDocIds);
    if (!originalBounds) return;

    const memberEdges = parsed.edges.filter(
      (edge) => memberSet.has(edge.from) && memberSet.has(edge.to),
    );
    const subLayout = layoutSubgraphForceAtlas2(memberNodes, memberEdges, parsed.direction);
    const subBounds = measurePlacedBounds(subLayout.placed);
    if (!subBounds) return;

    const targetCenterX = (originalBounds.minX + originalBounds.maxX) / 2;
    const targetCenterY = (originalBounds.minY + originalBounds.maxY) / 2;
    const subCenterX = (subBounds.minX + subBounds.maxX) / 2;
    const subCenterY = (subBounds.minY + subBounds.maxY) / 2;
    const offsetX = targetCenterX - subCenterX;
    const offsetY = targetCenterY - subCenterY;

    for (const node of memberNodes) {
      const docId = idMap.get(node.id);
      const placed = subLayout.placed.get(node.id);
      if (!docId || !placed) continue;
      const finalX = placed.x + offsetX;
      const finalY = placed.y + offsetY;
      if (animateIn) {
        const initial = subLayout.initialPlaced.get(node.id) ?? placed;
        nodeMap[docId] = {
          ...nodeMap[docId],
          x: initial.x + offsetX,
          y: initial.y + offsetY,
        };
        targetPositions[docId] = { x: finalX, y: finalY };
      } else {
        nodeMap[docId] = { ...nodeMap[docId], x: finalX, y: finalY };
      }
    }
  });

  const containerMap: Record<string, DocNode> = {};
  const containerOrder: string[] = [];
  const groupIdMap = new Map<string, string>();
  const primaryGroupByNode = new Map<string, string>();
  for (const node of nodesWithoutGroups) {
    const candidates = parsed.groups.filter((group) => group.members.includes(node.id));
    if (!candidates.length) continue;
    const chosen = candidates.reduce((best, current) =>
      current.members.length < best.members.length ? current : best,
    );
    primaryGroupByNode.set(node.id, chosen.id);
  }

  const groupLayoutMap = new Map<
    string,
    {
      layout: {
        placed: Map<string, { x: number; y: number; w: number; h: number }>;
        initialPlaced: Map<string, { x: number; y: number; w: number; h: number }>;
      };
      bounds: ReturnType<typeof measurePlacedBounds>;
      members: typeof parsed.nodes;
      padding: number;
      size: { w: number; h: number };
    }
  >();

  const topLevelNodes: typeof parsed.nodes = [];
  const topLevelSizes = new Map<string, { w: number; h: number }>();

  for (const group of parsed.groups) {
    const members = nodesWithoutGroups.filter(
      (node) => primaryGroupByNode.get(node.id) === group.id,
    );
    const memberEdges = parsed.edges.filter(
      (edge) =>
        primaryGroupByNode.get(edge.from) === group.id &&
        primaryGroupByNode.get(edge.to) === group.id,
    );
    const layout = layoutFlowchart(members, memberEdges, parsed.direction);
    const padding = Math.max(16, Math.round(DEFAULT_CONTAINER_PADDING * 0.7));
    const scale = 0.72;
    const placed = normalizePlaced(scalePlacedAroundCenter(layout.placed, scale), 0);
    const initialPlaced = normalizePlaced(scalePlacedAroundCenter(layout.initialPlaced, scale), 0);
    const bounds = measurePlacedBounds(placed);

    const baseSize = bounds
      ? {
          w: Math.max(240, bounds.maxX - bounds.minX + padding * 2),
          h: Math.max(160, bounds.maxY - bounds.minY + padding * 2),
        }
      : (() => {
          const size = estimateNodeSize(group.title, "rect");
          return { w: Math.max(260, size.w + 80), h: Math.max(180, size.h + 80) };
        })();

    groupLayoutMap.set(group.id, {
      layout: { placed, initialPlaced },
      bounds,
      members,
      padding,
      size: baseSize,
    });

    topLevelNodes.push({
      id: group.id,
      text: group.title,
      shape: "rect",
    });
    topLevelSizes.set(group.id, baseSize);
  }

  for (const node of nodesWithoutGroups) {
    if (primaryGroupByNode.has(node.id)) continue;
    topLevelNodes.push(node);
    topLevelSizes.set(node.id, estimateNodeSize(node.text, node.shape));
  }

  const topLevelEdges = parsed.edges.flatMap((edge) => {
    const fromGroup =
      primaryGroupByNode.get(edge.from) ?? (groupIds.has(edge.from) ? edge.from : undefined);
    const toGroup =
      primaryGroupByNode.get(edge.to) ?? (groupIds.has(edge.to) ? edge.to : undefined);
    const fromId = fromGroup ?? edge.from;
    const toId = toGroup ?? edge.to;
    if (fromId === toId) return [];
    return [
      {
        from: fromId,
        to: toId,
        arrow: edge.arrow,
        dashed: edge.dashed,
        width: edge.width,
        label: edge.label,
      },
    ];
  });

  const topLevelLayout = layoutFlowchart(topLevelNodes, topLevelEdges, parsed.direction, {
    sizeById: topLevelSizes,
  });

  parsed.groups.forEach((group, index) => {
    const layoutEntry = groupLayoutMap.get(group.id);
    const placed = topLevelLayout.placed.get(group.id);
    const initial = topLevelLayout.initialPlaced.get(group.id) ?? placed;
    if (!layoutEntry || !placed || !initial) return;

    const groupDocId = createUniqueHashId(
      buildMermaidEntityPrefix(idPrefix, "node"),
      existingNodeIds,
      `group:${group.id}:${index}`,
    );
    groupIdMap.set(group.id, groupDocId);

    const containerPos = animateIn ? initial : placed;
    containerMap[groupDocId] = buildContainerNode(
      groupDocId,
      {
        x: containerPos.x,
        y: containerPos.y,
        w: layoutEntry.size.w,
        h: layoutEntry.size.h,
      },
      group.title,
      layoutEntry.padding,
    );
    containerOrder.push(groupDocId);

    if (animateIn) {
      targetPositions[groupDocId] = { x: placed.x, y: placed.y };
    }

    const subBounds = layoutEntry.bounds;
    if (!subBounds) return;
    const initialBounds = measurePlacedBounds(layoutEntry.layout.initialPlaced) ?? subBounds;
    const offsetStartX = containerPos.x + layoutEntry.padding - initialBounds.minX;
    const offsetStartY = containerPos.y + layoutEntry.padding - initialBounds.minY;
    const offsetTargetX = placed.x + layoutEntry.padding - subBounds.minX;
    const offsetTargetY = placed.y + layoutEntry.padding - subBounds.minY;

    for (const member of layoutEntry.members) {
      const docId = idMap.get(member.id);
      const subPlaced = layoutEntry.layout.placed.get(member.id);
      if (!docId || !subPlaced) continue;
      const subInitial = layoutEntry.layout.initialPlaced.get(member.id) ?? subPlaced;
      const finalX = subPlaced.x + offsetTargetX;
      const finalY = subPlaced.y + offsetTargetY;
      const initialX = subInitial.x + offsetStartX;
      const initialY = subInitial.y + offsetStartY;
      const pos = animateIn
        ? { x: initialX, y: initialY, w: subPlaced.w, h: subPlaced.h }
        : { x: finalX, y: finalY, w: subPlaced.w, h: subPlaced.h };
      const built = buildShapeNode(docId, pos, member.text, member.shape, member.radius);
      nodeMap[docId] = {
        ...built,
        props: {
          ...(built.props as Record<string, unknown>),
          containerId: groupDocId,
        },
      };
      if (animateIn) {
        targetPositions[docId] = { x: finalX, y: finalY };
      }
      nodeOrder.push(docId);
    }
  });

  for (const node of nodesWithoutGroups) {
    if (primaryGroupByNode.has(node.id)) continue;
    const docId = idMap.get(node.id);
    const placed = topLevelLayout.placed.get(node.id);
    if (!docId || !placed) continue;
    const initial = topLevelLayout.initialPlaced.get(node.id) ?? placed;
    const pos = animateIn ? initial : placed;
    nodeMap[docId] = buildShapeNode(docId, pos, node.text, node.shape, node.radius);
    if (animateIn) {
      targetPositions[docId] = { x: placed.x, y: placed.y };
    }
    nodeOrder.push(docId);
  }

  const edgeMap: Record<string, DocEdge> = {};
  const edgeOrder: string[] = [];

  parsed.edges.forEach((edge, index) => {
    const fromGroup =
      primaryGroupByNode.get(edge.from) ?? (groupIds.has(edge.from) ? edge.from : undefined);
    const toGroup =
      primaryGroupByNode.get(edge.to) ?? (groupIds.has(edge.to) ? edge.to : undefined);
    const fromId = fromGroup ? groupIdMap.get(fromGroup) : idMap.get(edge.from);
    const toId = toGroup ? groupIdMap.get(toGroup) : idMap.get(edge.to);
    if (!fromId || !toId || fromId === toId) return;
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

  const mergedNodes = { ...containerMap, ...nodeMap };
  const mergedOrder = [...containerOrder, ...nodeOrder];
  const bounds = computeBoundsFromDocNodes(mergedNodes, mergedOrder);

  return {
    nodes: mergedNodes,
    nodeOrder: mergedOrder,
    edges: edgeMap,
    edgeOrder,
    bounds,
    animation: animateIn
      ? {
          durationMs: MERMAID_LAYOUT_ANIMATION_MS,
          targetPositions,
        }
      : undefined,
  };
}
