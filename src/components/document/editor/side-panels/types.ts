import type { DocEdge, DocNode, DocumentModel } from "@/components/document/model";
import type { NodeRegistry } from "@/components/document/plugin-system";

export type EditorSidePanelMode = "none" | "node" | "edge" | "chat";

export type SetDocument = (next: DocumentModel | ((prev: DocumentModel) => DocumentModel)) => void;

export type NodeSidePanelProps = {
  selectedNode: DocNode;
  nodeRegistry: NodeRegistry;
  setDoc: SetDocument;
  onDeleteSelected: () => void;
};

export type EdgeSidePanelProps = {
  selectedEdge: DocEdge;
  setDoc: SetDocument;
  onDeleteSelected: () => void;
};

export type ChatSidePanelProps = {
  selectedNode: DocNode | null;
  isActive: boolean;
};
