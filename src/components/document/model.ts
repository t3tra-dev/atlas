export type NodeType = string;
export type EdgeShape = "line" | "curve";
export type EdgeArrow = "none" | "end" | "both";

export type BaseNode = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
};

export type DocNodeBase<
  TType extends string = string,
  TProps = Record<string, unknown>,
> = BaseNode & {
  type: TType;
  props: TProps;
};

/**
 * Extensible node type for documents.
 * Built-in node typings live in plugins (e.g. `src/plugins/builtin.tsx`).
 */
export type DocNode = DocNodeBase<string, Record<string, unknown>>;

export type DocEdge = {
  id: string;
  shape: EdgeShape;
  arrow: EdgeArrow;
  from: string;
  to: string;
  props: {
    color: string;
    width: number;
    dash?: "solid" | "dashed";
    label?: string;
    curve?: number;
  };
};

export type DocumentModel = {
  version: 1;
  title: string;
  canvas: {
    width: number;
    height: number;
    background: "grid" | "plain";
  };
  nodes: Record<string, DocNode>;
  nodeOrder: string[];
  edges: Record<string, DocEdge>;
  edgeOrder: string[];
};

export type Tool =
  | { kind: "select" }
  | {
      kind: "add";
      nodeType: NodeType;
      preset?: {
        props?: Record<string, unknown>;
        w?: number;
        h?: number;
      };
    }
  | { kind: "connect"; edge: { shape: EdgeShape; arrow: EdgeArrow }; fromId: string | null };

export type Selection =
  | { kind: "none" }
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string };

export const STORAGE_KEY = "atlas.documents.v1";

export type Camera = {
  x: number; // world coordinate at viewport's left
  y: number; // world coordinate at viewport's top
  scale: number;
};

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
      nodeType: string;
      pointerId: number;
      startWorldX: number;
      startWorldY: number;
      startClientX: number;
      startClientY: number;
    };
