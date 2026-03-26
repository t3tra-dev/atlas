import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup } from "@/components/ui/input-group";
import type { DocNode } from "@/components/document/model";
import { clamp } from "../shared";
import type { NodeSidePanelProps } from "./types";

export function NodeSidePanel({
  selectedNode,
  nodeRegistry,
  setDoc,
  onDeleteSelected,
}: NodeSidePanelProps) {
  const updateSelectedNode = (updater: (node: DocNode) => DocNode) => {
    setDoc((doc) => {
      const currentNode = doc.nodes[selectedNode.id];
      if (!currentNode) return doc;
      return {
        ...doc,
        nodes: {
          ...doc.nodes,
          [selectedNode.id]: updater(currentNode),
        },
      };
    });
  };

  const nodeDef = nodeRegistry.get(selectedNode.type);

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">プロパティ</div>

      <div className="text-xs text-muted-foreground">
        クリックで選択、ドラッグで移動、右下ハンドルでリサイズ。
        <br />
        ダブルクリックでテキスト/画像ファイルを編集。
        <br />
        関係(矢印)は「関係ツール→始点ノード→終点ノード」。
      </div>

      <div>
        <div className="text-xs font-medium text-muted-foreground">選択</div>
        <div className="mt-1 text-sm">{`ノード: ${selectedNode.id}`}</div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <InputGroup label="X">
          <Input
            inputMode="numeric"
            value={String(Math.round(selectedNode.x))}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next)) return;
              updateSelectedNode((node) => ({ ...node, x: next }));
            }}
          />
        </InputGroup>
        <InputGroup label="Y">
          <Input
            inputMode="numeric"
            value={String(Math.round(selectedNode.y))}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next)) return;
              updateSelectedNode((node) => ({ ...node, y: next }));
            }}
          />
        </InputGroup>
        <InputGroup label="W">
          <Input
            inputMode="numeric"
            value={String(Math.round(selectedNode.w))}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next)) return;
              updateSelectedNode((node) => ({
                ...node,
                w: clamp(next, 24, 3200),
              }));
            }}
          />
        </InputGroup>
        <InputGroup label="H">
          <Input
            inputMode="numeric"
            value={String(Math.round(selectedNode.h))}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next)) return;
              updateSelectedNode((node) => ({
                ...node,
                h: clamp(next, 24, 3200),
              }));
            }}
          />
        </InputGroup>
      </div>

      {nodeDef?.inspector
        ? nodeDef.inspector({
            node: selectedNode as never,
            updateNode: (updater) =>
              updateSelectedNode((node) => updater(node as never) as DocNode),
          })
        : null}

      <Button variant="destructive" onClick={onDeleteSelected}>
        ノード削除
      </Button>
    </div>
  );
}
