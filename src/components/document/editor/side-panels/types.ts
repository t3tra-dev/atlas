import type { DocEdge, DocNode, DocumentModel, Selection } from "@/components/document/model";
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
  doc: DocumentModel;
  activeDocId?: string;
  selectedNode: DocNode | null;
  selectedEdge: DocEdge | null;
  isActive: boolean;
  setDoc: SetDocument;
  setSelection: React.Dispatch<React.SetStateAction<Selection>>;
  onElementReferenceActivate?: (elementId: string) => void;
};
