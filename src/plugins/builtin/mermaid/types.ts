import type { DocEdge, DocNode } from "@/components/document/model";

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

export type FlowchartNode = {
  id: string;
  text: string;
  shape: FlowchartShape;
  radius?: number;
};

export type FlowchartEdge = {
  from: string;
  to: string;
  arrow: "none" | "end" | "both";
  dashed: boolean;
  width: number;
  label?: string;
};

export type MindmapNode = {
  id: string;
  text: string;
  shape: FlowchartShape;
  radius?: number;
};

export type MindmapEdge = {
  from: string;
  to: string;
};

export type MermaidBuildResult = {
  nodes: Record<string, DocNode>;
  nodeOrder: string[];
  edges: Record<string, DocEdge>;
  edgeOrder: string[];
  bounds: null | { minX: number; minY: number; maxX: number; maxY: number };
  animation?: {
    durationMs: number;
    targetPositions: Record<string, { x: number; y: number }>;
  };
};

export type LayoutBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type MermaidLayoutResult = {
  placed: Map<string, LayoutBox>;
  order: string[];
  initialPlaced: Map<string, LayoutBox>;
};

export type SemanticFlowchartGroup = {
  id: string;
  members: string[];
  order: number;
  w: number;
  h: number;
  memberPlaced: Map<string, LayoutBox>;
};

export type ForceAtlas2NodeState = {
  id: string;
  w: number;
  h: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  oldDx: number;
  oldDy: number;
  mass: number;
  size: number;
  seedPrimary: number;
  seedSecondary: number;
};

export type BuildMermaidOptions = {
  existingNodeIds?: Set<string>;
  existingEdgeIds?: Set<string>;
  idPrefix?: string;
  animateIn?: boolean;
};

export type FlowchartParseResult = {
  direction: MermaidDirection;
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
};

export type MindmapParseResult = {
  nodes: MindmapNode[];
  edges: MindmapEdge[];
  rootId: string | null;
};
