import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup } from "@/components/ui/input-group";
import type { DocEdge } from "@/components/document/model";
import { clamp, normalizeHexColor } from "../shared";
import type { EdgeSidePanelProps } from "./types";

export function EdgeSidePanel({ selectedEdge, setDoc, onDeleteSelected }: EdgeSidePanelProps) {
  const updateSelectedEdge = (updater: (edge: DocEdge) => DocEdge) => {
    setDoc((doc) => {
      const currentEdge = doc.edges[selectedEdge.id];
      if (!currentEdge) return doc;
      return {
        ...doc,
        edges: {
          ...doc.edges,
          [selectedEdge.id]: updater(currentEdge),
        },
      };
    });
  };

  return (
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
            onClick={() => updateSelectedEdge((edge) => ({ ...edge, shape: "line" }))}
          >
            直線
          </Button>
          <Button
            size="sm"
            variant={selectedEdge.shape === "curve" ? "default" : "outline"}
            onClick={() => updateSelectedEdge((edge) => ({ ...edge, shape: "curve" }))}
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
            onClick={() => updateSelectedEdge((edge) => ({ ...edge, arrow: "none" }))}
          >
            なし
          </Button>
          <Button
            size="sm"
            variant={selectedEdge.arrow === "end" ? "default" : "outline"}
            onClick={() => updateSelectedEdge((edge) => ({ ...edge, arrow: "end" }))}
          >
            方
          </Button>
          <Button
            size="sm"
            variant={selectedEdge.arrow === "both" ? "default" : "outline"}
            onClick={() => updateSelectedEdge((edge) => ({ ...edge, arrow: "both" }))}
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
                updateSelectedEdge((edge) => ({
                  ...edge,
                  props: {
                    ...edge.props,
                    curve: clamp(next, 0.05, 0.6),
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
              updateSelectedEdge((edge) => ({
                ...edge,
                props: {
                  ...edge.props,
                  width: clamp(next, 1, 24),
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
                updateSelectedEdge((edge) => ({
                  ...edge,
                  props: { ...edge.props, dash: "solid" },
                }))
              }
            >
              実線
            </Button>
            <Button
              size="sm"
              variant={selectedEdge.props.dash === "dashed" ? "default" : "outline"}
              onClick={() =>
                updateSelectedEdge((edge) => ({
                  ...edge,
                  props: { ...edge.props, dash: "dashed" },
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
              updateSelectedEdge((edge) => ({
                ...edge,
                props: { ...edge.props, color: next },
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
            updateSelectedEdge((edge) => ({
              ...edge,
              props: {
                ...edge.props,
                label: next.trim() ? next : undefined,
              },
            }));
          }}
        />
      </InputGroup>

      <Button variant="destructive" onClick={onDeleteSelected}>
        関係削除
      </Button>
    </div>
  );
}
