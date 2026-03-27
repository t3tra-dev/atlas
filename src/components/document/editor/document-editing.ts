import type { DocEdge, DocNode, DocumentModel } from "@/components/document/model";
import { createUniqueHashId } from "@/lib/hash-id";
import { layoutFlowchart } from "@/plugins/builtin/mermaid/layout";
import { MERMAID_LAYOUT_ANIMATION_MS, estimateNodeSize } from "@/plugins/builtin/mermaid/shared";
import type {
  FlowchartEdge,
  FlowchartNode,
  FlowchartShape,
  MermaidBuildResult,
  MermaidDirection,
} from "@/plugins/builtin/mermaid/types";
import { clamp, computeBoundsFromNodes, getNodeCenter } from "./shared";

export type SupportedShape = FlowchartShape;

export type PositionedShapeNodeInput = {
  x: number;
  y: number;
  shape: SupportedShape;
  text: string;
};

export type DerivedShapeNodeInput = {
  shape: SupportedShape;
  text: string;
  edgeLabel?: string;
};

export type NodeAnimationPlan = {
  durationMs: number;
  targetPositions: Record<string, { x: number; y: number }>;
};

export type MergeDocumentEntitiesResult = {
  nextDoc: DocumentModel;
  bounds: null | { minX: number; minY: number; maxX: number; maxY: number };
};

type FrameRef = {
  current: number | null;
};

const DEFAULT_EDGE_COLOR = "#5a75bc";
const DEFAULT_SHAPE_FILL = "rgba(99, 102, 241, 0.08)";
const DEFAULT_SHAPE_STROKE = "rgba(99, 102, 241, 0.6)";
const CANVAS_PADDING = 200;

function buildShapeNode(
  id: string,
  pos: { x: number; y: number; w: number; h: number },
  text: string,
  shape: SupportedShape,
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
      fill: DEFAULT_SHAPE_FILL,
      stroke: DEFAULT_SHAPE_STROKE,
      strokeWidth: 2,
      radius: shape === "rect" ? 8 : shape === "stadium" ? 18 : undefined,
    },
  };
}

function mergeBounds(
  left: null | { minX: number; minY: number; maxX: number; maxY: number },
  right: null | { minX: number; minY: number; maxX: number; maxY: number },
) {
  if (!left) return right;
  if (!right) return left;
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
  };
}

function computeCanvasSize(
  doc: DocumentModel,
  nextNodes: Record<string, DocNode>,
  incomingBounds: null | { minX: number; minY: number; maxX: number; maxY: number },
) {
  const existingBounds = computeBoundsFromNodes(doc.nodes);
  const fallbackBounds = computeBoundsFromNodes(nextNodes);
  const bounds = mergeBounds(mergeBounds(existingBounds, incomingBounds), fallbackBounds);
  if (!bounds) {
    return doc.canvas;
  }

  return {
    ...doc.canvas,
    width: Math.max(doc.canvas.width, bounds.maxX - bounds.minX + CANVAS_PADDING * 2),
    height: Math.max(doc.canvas.height, bounds.maxY - bounds.minY + CANVAS_PADDING * 2),
  };
}

function getNodeDisplayText(node: DocNode) {
  if (node.type === "shape") {
    const text = typeof node.props.text === "string" ? node.props.text.trim() : "";
    return text || node.id;
  }

  if (node.type === "text") {
    const text = typeof node.props.text === "string" ? node.props.text.trim() : "";
    return text || node.id;
  }

  if (node.type === "three-canvas") {
    const fileName = typeof node.props.fileName === "string" ? node.props.fileName.trim() : "";
    return fileName || "3D";
  }

  return node.id;
}

function getNodeLayoutShape(node: DocNode): SupportedShape {
  if (node.type === "shape" && typeof node.props.shape === "string") {
    switch (node.props.shape) {
      case "rect":
      case "stadium":
      case "subroutine":
      case "cylinder":
      case "circle":
      case "doublecircle":
      case "diamond":
      case "hexagon":
      case "parallelogram":
      case "trapezoid":
      case "invtrapezoid":
        return node.props.shape;
      default:
        break;
    }
  }

  return "rect";
}

function buildChildSeed(sourceNodeId: string, node: DerivedShapeNodeInput, index: number) {
  return `${sourceNodeId}:${node.shape}:${node.text}:${index}`;
}

export function cancelNodeAnimation(frameRef: FrameRef) {
  if (frameRef.current != null) {
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }
}

export function runNodeAnimation({
  frameRef,
  setDoc,
  startPositions,
  animation,
}: {
  frameRef: FrameRef;
  setDoc: (next: DocumentModel | ((prev: DocumentModel) => DocumentModel)) => void;
  startPositions: Record<string, { x: number; y: number }>;
  animation: NodeAnimationPlan;
}) {
  cancelNodeAnimation(frameRef);

  const startedAt = performance.now();
  const step = (now: number) => {
    const rawProgress = (now - startedAt) / animation.durationMs;
    const progress = clamp(rawProgress, 0, 1);
    const eased = 1 - (1 - progress) ** 3;

    setDoc((prev) => {
      let changed = false;
      const nextNodes = { ...prev.nodes };

      for (const [nodeId, target] of Object.entries(animation.targetPositions)) {
        const node = nextNodes[nodeId];
        const start = startPositions[nodeId];
        if (!node || !start) continue;
        const x = start.x + (target.x - start.x) * eased;
        const y = start.y + (target.y - start.y) * eased;
        if (node.x === x && node.y === y) continue;
        nextNodes[nodeId] = { ...node, x, y };
        changed = true;
      }

      return changed ? { ...prev, nodes: nextNodes } : prev;
    });

    if (progress < 1) {
      frameRef.current = window.requestAnimationFrame(step);
      return;
    }

    frameRef.current = null;
  };

  frameRef.current = window.requestAnimationFrame(step);
}

export function collectNodeStartPositions(nodes: Record<string, DocNode>, nodeIds: string[]) {
  return Object.fromEntries(
    nodeIds
      .map((nodeId) => {
        const node = nodes[nodeId];
        if (!node) return null;
        return [nodeId, { x: node.x, y: node.y }] as const;
      })
      .filter((entry): entry is readonly [string, { x: number; y: number }] => entry != null),
  );
}

export function mergeDocumentEntities(
  doc: DocumentModel,
  incoming: {
    nodes: Record<string, DocNode>;
    nodeOrder: string[];
    edges: Record<string, DocEdge>;
    edgeOrder: string[];
    bounds?: null | { minX: number; minY: number; maxX: number; maxY: number };
  },
): MergeDocumentEntitiesResult {
  const nextNodes = { ...doc.nodes, ...incoming.nodes };
  const nextEdges = { ...doc.edges, ...incoming.edges };

  return {
    nextDoc: {
      ...doc,
      nodes: nextNodes,
      nodeOrder: [...doc.nodeOrder, ...incoming.nodeOrder],
      edges: nextEdges,
      edgeOrder: [...doc.edgeOrder, ...incoming.edgeOrder],
      canvas: computeCanvasSize(doc, nextNodes, incoming.bounds ?? null),
    },
    bounds: incoming.bounds ?? null,
  };
}

export function mergeMermaidBuildResultIntoDocument(
  doc: DocumentModel,
  result: MermaidBuildResult,
) {
  return mergeDocumentEntities(doc, {
    nodes: result.nodes,
    nodeOrder: result.nodeOrder,
    edges: result.edges,
    edgeOrder: result.edgeOrder,
    bounds: result.bounds,
  }).nextDoc;
}

export function createPositionedShapeNodes(doc: DocumentModel, inputs: PositionedShapeNodeInput[]) {
  const existingNodeIds = new Set(Object.keys(doc.nodes));
  const createdNodes: Record<string, DocNode> = {};
  const createdNodeIds: string[] = [];

  inputs.forEach((input, index) => {
    const size = estimateNodeSize(input.text, input.shape);
    const id = createUniqueHashId("node", existingNodeIds, `${input.shape}:${input.text}:${index}`);
    createdNodes[id] = buildShapeNode(
      id,
      { x: input.x, y: input.y, ...size },
      input.text,
      input.shape,
    );
    createdNodeIds.push(id);
  });

  const nextDoc = mergeDocumentEntities(doc, {
    nodes: createdNodes,
    nodeOrder: createdNodeIds,
    edges: {},
    edgeOrder: [],
    bounds: computeBoundsFromNodes(createdNodes),
  }).nextDoc;

  return {
    nextDoc,
    createdNodes,
    createdNodeIds,
  };
}

export function createDerivedNodesFromSource({
  doc,
  sourceNodeId,
  nodes,
  direction = "LR",
}: {
  doc: DocumentModel;
  sourceNodeId: string;
  nodes: DerivedShapeNodeInput[];
  direction?: MermaidDirection;
}) {
  const sourceNode = doc.nodes[sourceNodeId];
  if (!sourceNode) {
    throw new Error(`Node '${sourceNodeId}' was not found.`);
  }

  if (!nodes.length) {
    throw new Error("At least one derived node is required.");
  }

  const rootId = "root";
  const childFlowIds = nodes.map((_, index) => `child_${index + 1}`);
  const flowNodes: FlowchartNode[] = [
    {
      id: rootId,
      text: getNodeDisplayText(sourceNode),
      shape: getNodeLayoutShape(sourceNode),
    },
    ...nodes.map((node, index) => ({
      id: childFlowIds[index],
      text: node.text,
      shape: node.shape,
    })),
  ];
  const flowEdges: FlowchartEdge[] = nodes.map((node, index) => ({
    from: rootId,
    to: childFlowIds[index],
    arrow: "end",
    dashed: false,
    width: 2,
    label: node.edgeLabel?.trim() ? node.edgeLabel.trim() : undefined,
  }));

  const layout = layoutFlowchart(flowNodes, flowEdges, direction);
  const rootPlaced = layout.placed.get(rootId);
  if (!rootPlaced) {
    throw new Error("Failed to compute Mermaid layout.");
  }

  const sourceCenter = getNodeCenter(sourceNode);
  const rootCenter = {
    x: rootPlaced.x + rootPlaced.w / 2,
    y: rootPlaced.y + rootPlaced.h / 2,
  };
  const offsetX = sourceCenter.x - rootCenter.x;
  const offsetY = sourceCenter.y - rootCenter.y;

  const existingNodeIds = new Set(Object.keys(doc.nodes));
  const existingEdgeIds = new Set(Object.keys(doc.edges));
  const createdNodes: Record<string, DocNode> = {};
  const createdEdges: Record<string, DocEdge> = {};
  const createdNodeIds: string[] = [];
  const createdEdgeIds: string[] = [];
  const targetPositions: Record<string, { x: number; y: number }> = {};

  for (const flowId of layout.order) {
    if (flowId === rootId) continue;
    const index = childFlowIds.indexOf(flowId);
    if (index < 0) continue;

    const input = nodes[index];
    const finalPos = layout.placed.get(flowId);
    const initialPos = layout.initialPlaced.get(flowId) ?? finalPos;
    if (!finalPos || !initialPos) continue;

    const nodeId = createUniqueHashId(
      "node",
      existingNodeIds,
      buildChildSeed(sourceNodeId, input, index),
    );
    createdNodes[nodeId] = buildShapeNode(
      nodeId,
      {
        x: initialPos.x + offsetX,
        y: initialPos.y + offsetY,
        w: finalPos.w,
        h: finalPos.h,
      },
      input.text,
      input.shape,
    );
    createdNodeIds.push(nodeId);
    targetPositions[nodeId] = {
      x: finalPos.x + offsetX,
      y: finalPos.y + offsetY,
    };

    const edgeId = createUniqueHashId(
      "edge",
      existingEdgeIds,
      `${sourceNodeId}:${nodeId}:${input.edgeLabel ?? ""}:${index}`,
    );
    createdEdges[edgeId] = {
      id: edgeId,
      shape: "line",
      arrow: "end",
      from: sourceNodeId,
      to: nodeId,
      props: {
        color: DEFAULT_EDGE_COLOR,
        width: 2,
        dash: "solid",
        label: input.edgeLabel?.trim() ? input.edgeLabel.trim() : undefined,
      },
    };
    createdEdgeIds.push(edgeId);
  }

  const nextDoc = mergeDocumentEntities(doc, {
    nodes: createdNodes,
    nodeOrder: createdNodeIds,
    edges: createdEdges,
    edgeOrder: createdEdgeIds,
    bounds: computeBoundsFromNodes(createdNodes),
  }).nextDoc;

  return {
    nextDoc,
    createdNodes,
    createdEdges,
    createdNodeIds,
    createdEdgeIds,
    animation: {
      durationMs: MERMAID_LAYOUT_ANIMATION_MS,
      targetPositions,
    } satisfies NodeAnimationPlan,
    engine: {
      kind: "atlas_mermaid_flowchart",
      direction,
    },
  };
}

export function deleteNodesById(doc: DocumentModel, nodeIds: string[]) {
  const uniqueNodeIds = Array.from(new Set(nodeIds));
  const removedNodeIds = uniqueNodeIds.filter((nodeId) => !!doc.nodes[nodeId]);
  const missingNodeIds = uniqueNodeIds.filter((nodeId) => !doc.nodes[nodeId]);
  const removedNodeSet = new Set(removedNodeIds);

  const nextNodes = { ...doc.nodes };
  removedNodeIds.forEach((nodeId) => {
    delete nextNodes[nodeId];
  });

  const nextEdges: Record<string, DocEdge> = {};
  const nextEdgeOrder: string[] = [];
  const removedEdgeIds: string[] = [];
  for (const edgeId of doc.edgeOrder) {
    const edge = doc.edges[edgeId];
    if (!edge) continue;
    if (removedNodeSet.has(edge.from) || removedNodeSet.has(edge.to)) {
      removedEdgeIds.push(edgeId);
      continue;
    }
    nextEdges[edgeId] = edge;
    nextEdgeOrder.push(edgeId);
  }

  return {
    nextDoc: {
      ...doc,
      nodes: nextNodes,
      nodeOrder: doc.nodeOrder.filter((nodeId) => !removedNodeSet.has(nodeId)),
      edges: nextEdges,
      edgeOrder: nextEdgeOrder,
    },
    removedNodeIds,
    removedEdgeIds,
    missingNodeIds,
  };
}
