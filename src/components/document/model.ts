export type NodeType = "text" | "rect" | "ellipse" | "image"
export type EdgeShape = "line" | "curve"
export type EdgeArrow = "none" | "end" | "both"

export type BaseNode = {
  id: string
  type: NodeType
  x: number
  y: number
  w: number
  h: number
  rotation?: number
}

export type TextNode = BaseNode & {
  type: "text"
  props: {
    text: string
    fontSize: number
    color: string
    align: "left" | "center" | "right"
  }
}

export type RectNode = BaseNode & {
  type: "rect"
  props: {
    fill: string
    stroke: string
    strokeWidth: number
    radius: {
      tl: number
      tr: number
      br: number
      bl: number
    }
  }
}

export type EllipseNode = BaseNode & {
  type: "ellipse"
  props: {
    fill: string
    stroke: string
    strokeWidth: number
  }
}

export type ImageNode = BaseNode & {
  type: "image"
  props: {
    src: string
    fit: "cover" | "contain"
    borderRadius: number
  }
}

export type DocNode = TextNode | RectNode | EllipseNode | ImageNode

export type DocEdge = {
  id: string
  shape: EdgeShape
  arrow: EdgeArrow
  from: string
  to: string
  props: {
    color: string
    width: number
    dash?: "solid" | "dashed"
  }
}

export type DocumentModel = {
  version: 1
  canvas: {
    width: number
    height: number
    background: "grid" | "plain"
  }
  nodes: Record<string, DocNode>
  nodeOrder: string[]
  edges: Record<string, DocEdge>
  edgeOrder: string[]
}

export type Tool =
  | { kind: "select" }
  | { kind: "add"; nodeType: NodeType }
  | { kind: "connect"; edge: { shape: EdgeShape; arrow: EdgeArrow }; fromId: string | null }

export type Selection =
  | { kind: "none" }
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }

export const STORAGE_KEY = "atlas.document.v1"

export type Camera = {
  x: number // world coordinate at viewport's left
  y: number // world coordinate at viewport's top
  scale: number
}

export type DragState =
  | { kind: "none" }
  | {
    kind: "pan";
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCamX: number;
    startCamY: number;
    didPan: boolean;
    clickClearsSelection: boolean;
  }
  | {
    kind: "move";
    nodeId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  }
  | {
    kind: "resize";
    nodeId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startW: number;
    startH: number;
  }
  | {
    kind: "drawShape";
    nodeId: string;
    nodeType: "rect" | "ellipse";
    pointerId: number;
    startWorldX: number;
    startWorldY: number;
    startClientX: number;
    startClientY: number;
  };
