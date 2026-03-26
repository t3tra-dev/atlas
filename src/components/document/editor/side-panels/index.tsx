import { cn } from "@/lib/utils";
import type { DocEdge, DocNode } from "@/components/document/model";
import type { NodeRegistry } from "@/components/document/plugin-system";
import { ChatSidePanel } from "./chat";
import { EdgeSidePanel } from "./edge";
import { NodeSidePanel } from "./node";
import type { EditorSidePanelMode, SetDocument } from "./types";

export type { EditorSidePanelMode } from "./types";

export function DocumentEditorSidePanel({
  visible,
  mode,
  selectedNode,
  selectedEdge,
  nodeRegistry,
  setDoc,
  onDeleteSelected,
  atlasIOError,
}: {
  visible: boolean;
  mode: EditorSidePanelMode;
  selectedNode: DocNode | null;
  selectedEdge: DocEdge | null;
  nodeRegistry: NodeRegistry;
  setDoc: SetDocument;
  onDeleteSelected: () => void;
  atlasIOError: string | null;
}) {
  return (
    <div
      className={cn(
        "absolute right-0 top-0 z-[2147483647] hidden h-full w-[320px] border-l bg-background p-3 transition-opacity duration-150 md:block",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      {mode === "chat" ? <ChatSidePanel selectedNode={selectedNode} /> : null}

      {mode === "node" && selectedNode ? (
        <NodeSidePanel
          selectedNode={selectedNode}
          nodeRegistry={nodeRegistry}
          setDoc={setDoc}
          onDeleteSelected={onDeleteSelected}
        />
      ) : null}

      {mode === "edge" && selectedEdge ? (
        <EdgeSidePanel
          selectedEdge={selectedEdge}
          setDoc={setDoc}
          onDeleteSelected={onDeleteSelected}
        />
      ) : null}

      {atlasIOError ? (
        <div className="mt-6">
          <div className="mt-2 text-xs text-destructive">{atlasIOError}</div>
        </div>
      ) : null}
    </div>
  );
}
