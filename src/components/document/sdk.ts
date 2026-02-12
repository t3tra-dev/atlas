import * as React from "react";

import { cn } from "@/lib/utils";

import type { Camera, DocumentModel, DocNode, Selection, Tool } from "@/components/document/model";

export type JSONSheetMode = "export" | "import";

export interface DocumentAPI {
  get: () => DocumentModel;
  set: (next: DocumentModel) => void;
  update: (updater: (prev: DocumentModel) => DocumentModel) => void;
}

export interface SelectionAPI {
  get: () => Selection;
  set: (next: Selection) => void;
  clear: () => void;
}

export interface ToolAPI {
  get: () => Tool;
  set: (next: Tool) => void;
}

export interface CameraAPI {
  get: () => Camera;
  set: (next: Camera | ((prev: Camera) => Camera)) => void;
}

export interface ViewportAPI {
  /** Zoom to a target scale (host decides anchor/clamping). */
  zoomTo: (nextScale: number) => void;
  /** Zoom relative to current scale (host decides anchor/clamping). */
  zoomBy: (delta: number) => void;
}

export type PlacementKind = "click" | "drag";

export interface NodePlacement {
  kind: PlacementKind;
  defaultSize?: { w: number; h: number };
  minSize?: { w: number; h: number };
}

export interface NodeRenderResult {
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  suppressSelectionRing?: boolean;
}

export interface RenderNodeContext {
  node: DocNode;
  selected: boolean;
  scale: number;
  cn: typeof cn;
}

export interface CreateNodeContext {
  id: string;
  x: number;
  y: number;
}

export interface NodeInspectorContext {
  node: DocNode;
  updateNode: (updater: (prev: DocNode) => DocNode) => void;
}

export interface NodeDoubleClickContext {
  node: DocNode;
  updateNode: (updater: (prev: DocNode) => DocNode) => void;
}

export interface NodeTypeDef {
  type: string;
  title: string;
  category?: string;
  placement?: NodePlacement;

  create: (ctx: CreateNodeContext) => DocNode;
  render: (ctx: RenderNodeContext) => NodeRenderResult;
  inspector?: (ctx: NodeInspectorContext) => React.ReactNode;
  onDoubleClick?: (ctx: NodeDoubleClickContext) => void;
}

export interface DocumentSDK {
  version: 3;
  react: typeof React;
  cn: typeof cn;

  /**
   * Host/editor-provided UI actions.
   * Plugins can call these to trigger editor UI.
   */
  ui: {
    openJSONSheet: (mode: JSONSheetMode) => void;
    openMermaidImportDialog: () => void;
  };

  doc: DocumentAPI;
  selection: SelectionAPI;
  tool: ToolAPI;
  camera: CameraAPI;
  viewport: ViewportAPI;
}

const noopUi: DocumentSDK["ui"] = {
  openJSONSheet: () => {
    // no-op (useful for tests or non-editor contexts)
  },
  openMermaidImportDialog: () => {
    // no-op
  },
};

const noopDoc: DocumentAPI = {
  get: () => ({
    version: 1,
    title: "Untitled",
    camera: { x: 0, y: 0, scale: 1 },
    canvas: { width: 1920, height: 1080, background: "grid" },
    nodes: {},
    nodeOrder: [],
    edges: {},
    edgeOrder: [],
  }),
  set: () => {
    // no-op
  },
  update: () => {
    // no-op
  },
};

const noopSelection: SelectionAPI = {
  get: () => ({ kind: "none" }),
  set: () => {
    // no-op
  },
  clear: () => {
    // no-op
  },
};

const noopTool: ToolAPI = {
  get: () => ({ kind: "select" }),
  set: () => {
    // no-op
  },
};

const noopCamera: CameraAPI = {
  get: () => ({ x: 0, y: 0, scale: 1 }),
  set: () => {
    // no-op
  },
};

const noopViewport: ViewportAPI = {
  zoomTo: () => {
    // no-op
  },
  zoomBy: () => {
    // no-op
  },
};

export function createDocumentSDK(opts?: {
  ui?: DocumentSDK["ui"];
  doc?: DocumentAPI;
  selection?: SelectionAPI;
  tool?: ToolAPI;
  camera?: CameraAPI;
  viewport?: ViewportAPI;
}): DocumentSDK {
  const ui = opts?.ui ?? noopUi;
  const doc = opts?.doc ?? noopDoc;
  const selection = opts?.selection ?? noopSelection;
  const tool = opts?.tool ?? noopTool;
  const camera = opts?.camera ?? noopCamera;
  const viewport = opts?.viewport ?? noopViewport;

  return {
    version: 3,
    react: React,
    cn,
    ui: { ...ui },
    doc: { ...doc },
    selection: { ...selection },
    tool: { ...tool },
    camera: { ...camera },
    viewport: { ...viewport },
  };
}
