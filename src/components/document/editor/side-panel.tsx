import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import type { DocEdge, DocNode, DocumentModel } from "@/components/document/model";
import type { NodeRegistry } from "@/components/document/plugin-system";
import { cn } from "@/lib/utils";
import { MessageSquareIcon } from "lucide-react";
import { clamp, normalizeHexColor } from "./shared";

export type EditorSidePanelMode = "none" | "node" | "edge" | "chat";

type SetDocument = (next: DocumentModel | ((prev: DocumentModel) => DocumentModel)) => void;

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
      {mode === "chat" ? (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquareIcon className="size-4" />
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            チャット連携のプレースホルダーです。
            <br />
            将来的にドキュメント文脈、選択ノード、操作履歴を接続できます。
          </div>

          <div className="mt-4 rounded-lg border bg-muted/30 p-3">
            <div className="text-xs font-medium text-muted-foreground">状態</div>
            <div className="mt-2 flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm">
              <span>Provider</span>
              <span className="text-xs text-muted-foreground">Not connected</span>
            </div>
            <div className="mt-2 flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm">
              <span>Context</span>
              <span className="text-xs text-muted-foreground">
                {selectedNode ? `Node ${selectedNode.id}` : "Canvas only"}
              </span>
            </div>
          </div>

          <div className="mt-4 flex-1 space-y-3 overflow-hidden">
            <div className="text-xs font-medium text-muted-foreground">Conversation</div>
            <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
              <div className="rounded-md bg-background px-3 py-2 text-sm">
                AIアシスタントの準備中です。
              </div>
              <div className="rounded-md border border-dashed bg-background px-3 py-3 text-sm text-muted-foreground">
                ここにスレッド、提案、ノード選択に応じた補助UIを表示します。
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-2 border-t pt-4">
            <Label htmlFor="atlas-chat-draft">Prompt</Label>
            <textarea
              id="atlas-chat-draft"
              className="min-h-28 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none"
              placeholder="Ask Atlas AI about this canvas..."
              disabled
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" disabled>
                New Thread
              </Button>
              <Button className="flex-1" disabled>
                Send
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {mode === "node" && selectedNode ? (
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
                  setDoc((d) => ({
                    ...d,
                    nodes: {
                      ...d.nodes,
                      [selectedNode.id]: { ...selectedNode, x: next },
                    },
                  }));
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
                  setDoc((d) => ({
                    ...d,
                    nodes: {
                      ...d.nodes,
                      [selectedNode.id]: { ...selectedNode, y: next },
                    },
                  }));
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
                  setDoc((d) => ({
                    ...d,
                    nodes: {
                      ...d.nodes,
                      [selectedNode.id]: {
                        ...selectedNode,
                        w: clamp(next, 24, 3200),
                      },
                    },
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
                  setDoc((d) => ({
                    ...d,
                    nodes: {
                      ...d.nodes,
                      [selectedNode.id]: {
                        ...selectedNode,
                        h: clamp(next, 24, 3200),
                      },
                    },
                  }));
                }}
              />
            </InputGroup>
          </div>

          {(() => {
            const nodeDef = nodeRegistry.get(selectedNode.type);
            if (!nodeDef?.inspector) return null;
            return nodeDef.inspector({
              node: selectedNode as never,
              updateNode: (updater) =>
                setDoc((d) => {
                  const cur = d.nodes[selectedNode.id];
                  if (!cur) return d;
                  return {
                    ...d,
                    nodes: {
                      ...d.nodes,
                      [selectedNode.id]: updater(cur as never) as DocNode,
                    },
                  };
                }),
            });
          })()}

          <Button variant="destructive" onClick={onDeleteSelected}>
            ノード削除
          </Button>
        </div>
      ) : null}

      {mode === "edge" && selectedEdge ? (
        <div className="space-y-3">
          <div className="text-sm font-semibold">関係プロパティ</div>

          <div>
            <div className="text-xs font-medium text-muted-foreground">選択</div>
            <div className="mt-1 text-sm">{`関係: ${selectedEdge.id}`}</div>
          </div>

          <InputGroup label="線分">
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant={selectedEdge.shape === "line" ? "default" : "outline"}
                onClick={() =>
                  setDoc((d) => ({
                    ...d,
                    edges: {
                      ...d.edges,
                      [selectedEdge.id]: {
                        ...selectedEdge,
                        shape: "line",
                      },
                    },
                  }))
                }
              >
                直線
              </Button>
              <Button
                size="sm"
                variant={selectedEdge.shape === "curve" ? "default" : "outline"}
                onClick={() =>
                  setDoc((d) => ({
                    ...d,
                    edges: {
                      ...d.edges,
                      [selectedEdge.id]: {
                        ...selectedEdge,
                        shape: "curve",
                      },
                    },
                  }))
                }
              >
                曲線
              </Button>
            </div>
          </InputGroup>

          <InputGroup label="矢印">
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant={selectedEdge.arrow === "none" ? "default" : "outline"}
                onClick={() =>
                  setDoc((d) => ({
                    ...d,
                    edges: {
                      ...d.edges,
                      [selectedEdge.id]: {
                        ...selectedEdge,
                        arrow: "none",
                      },
                    },
                  }))
                }
              >
                なし
              </Button>
              <Button
                size="sm"
                variant={selectedEdge.arrow === "end" ? "default" : "outline"}
                onClick={() =>
                  setDoc((d) => ({
                    ...d,
                    edges: {
                      ...d.edges,
                      [selectedEdge.id]: {
                        ...selectedEdge,
                        arrow: "end",
                      },
                    },
                  }))
                }
              >
                方
              </Button>
              <Button
                size="sm"
                variant={selectedEdge.arrow === "both" ? "default" : "outline"}
                onClick={() =>
                  setDoc((d) => ({
                    ...d,
                    edges: {
                      ...d.edges,
                      [selectedEdge.id]: {
                        ...selectedEdge,
                        arrow: "both",
                      },
                    },
                  }))
                }
              >
                両
              </Button>
            </div>
          </InputGroup>

          {selectedEdge.shape === "curve" ? (
            <InputGroup label="曲率">
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0.05}
                  max={0.6}
                  step={0.01}
                  value={selectedEdge.props.curve ?? 0.25}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (!Number.isFinite(next)) return;
                    setDoc((d) => ({
                      ...d,
                      edges: {
                        ...d.edges,
                        [selectedEdge.id]: {
                          ...selectedEdge,
                          props: {
                            ...selectedEdge.props,
                            curve: clamp(next, 0.05, 0.6),
                          },
                        },
                      },
                    }));
                  }}
                  className="w-full accent-foreground"
                />
                <div className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                  {(selectedEdge.props.curve ?? 0.25).toFixed(2)}
                </div>
              </div>
            </InputGroup>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <InputGroup label="太さ">
              <Input
                inputMode="numeric"
                value={String(selectedEdge.props.width)}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (!Number.isFinite(next)) return;
                  setDoc((d) => ({
                    ...d,
                    edges: {
                      ...d.edges,
                      [selectedEdge.id]: {
                        ...selectedEdge,
                        props: {
                          ...selectedEdge.props,
                          width: clamp(next, 1, 24),
                        },
                      },
                    },
                  }));
                }}
              />
            </InputGroup>
            <InputGroup label="線種">
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={selectedEdge.props.dash !== "dashed" ? "default" : "outline"}
                  onClick={() =>
                    setDoc((d) => ({
                      ...d,
                      edges: {
                        ...d.edges,
                        [selectedEdge.id]: {
                          ...selectedEdge,
                          props: { ...selectedEdge.props, dash: "solid" },
                        },
                      },
                    }))
                  }
                >
                  実線
                </Button>
                <Button
                  size="sm"
                  variant={selectedEdge.props.dash === "dashed" ? "default" : "outline"}
                  onClick={() =>
                    setDoc((d) => ({
                      ...d,
                      edges: {
                        ...d.edges,
                        [selectedEdge.id]: {
                          ...selectedEdge,
                          props: {
                            ...selectedEdge.props,
                            dash: "dashed",
                          },
                        },
                      },
                    }))
                  }
                >
                  破線
                </Button>
              </div>
            </InputGroup>
          </div>

          <InputGroup label="色">
            <div className="flex items-center gap-2">
              <Input
                type="color"
                className="h-9 w-14 p-1"
                value={normalizeHexColor(selectedEdge.props.color) ?? "#5a75bc"}
                onChange={(e) => {
                  const next = e.target.value;
                  setDoc((d) => ({
                    ...d,
                    edges: {
                      ...d.edges,
                      [selectedEdge.id]: {
                        ...selectedEdge,
                        props: { ...selectedEdge.props, color: next },
                      },
                    },
                  }));
                }}
              />
              <div className="text-xs text-muted-foreground tabular-nums">
                {normalizeHexColor(selectedEdge.props.color) ?? selectedEdge.props.color}
              </div>
            </div>
          </InputGroup>

          <InputGroup label="ラベル">
            <Input
              placeholder="関係ラベル"
              value={selectedEdge.props.label ?? ""}
              onChange={(e) => {
                const next = e.target.value;
                setDoc((d) => ({
                  ...d,
                  edges: {
                    ...d.edges,
                    [selectedEdge.id]: {
                      ...selectedEdge,
                      props: {
                        ...selectedEdge.props,
                        label: next.trim() ? next : undefined,
                      },
                    },
                  },
                }));
              }}
            />
          </InputGroup>

          <Button variant="destructive" onClick={onDeleteSelected}>
            関係削除
          </Button>
        </div>
      ) : null}

      {atlasIOError ? (
        <div className="mt-6">
          <div className="mt-2 text-xs text-destructive">{atlasIOError}</div>
        </div>
      ) : null}
    </div>
  );
}
