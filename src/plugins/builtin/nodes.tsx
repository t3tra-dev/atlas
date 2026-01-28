import { Input } from "@/components/ui/input";
import { InputGroup } from "@/components/ui/input-group";

import type {
  NodeRenderResult,
  NodeTypeDefinition,
} from "@/components/document/sdk";
import type { DocNode, DocNodeBase } from "@/components/document/model";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export type RectNode = DocNodeBase<
  "rect",
  {
    fill: string;
    stroke: string;
    strokeWidth: number;
    radius: { tl: number; tr: number; br: number; bl: number };
  }
>;

export type EllipseNode = DocNodeBase<
  "ellipse",
  {
    fill: string;
    stroke: string;
    strokeWidth: number;
  }
>;

export type TextNode = DocNodeBase<
  "text",
  {
    text: string;
    fontSize: number;
    color: string;
    align: "left" | "center" | "right";
  }
>;

export type ImageNode = DocNodeBase<
  "image",
  {
    src: string;
    fit: "cover" | "contain";
    borderRadius: number;
  }
>;

function rectNodeDef(): NodeTypeDefinition {
  return {
    type: "rect",
    title: "四角形",
    category: "図形",
    placement: {
      kind: "drag",
      defaultSize: { w: 240, h: 140 },
      minSize: { w: 24, h: 24 },
    },
    create: ({ id, x, y }) => ({
      id,
      type: "rect",
      x,
      y,
      w: 1,
      h: 1,
      props: {
        fill: "rgba(99, 102, 241, 0.10)",
        stroke: "rgba(99, 102, 241, 0.55)",
        strokeWidth: 2,
        radius: { tl: 14, tr: 14, br: 14, bl: 14 },
      },
    }),
    render: ({ node, scale, cn }): NodeRenderResult => {
      if (node.type !== "rect") return { ariaLabel: "rectangle" };
      const p = (node as RectNode).props;
      return {
        ariaLabel: "rectangle",
        className: cn("select-none"),
        style: {
          borderRadius: `${p.radius.tl * scale}px ${p.radius.tr * scale}px ${
            p.radius.br * scale
          }px ${p.radius.bl * scale}px`,
          background: p.fill,
          border: `${p.strokeWidth * scale}px solid ${p.stroke}`,
        },
      };
    },
    inspector: ({ node, updateNode }) => (
      node.type !== "rect" ? null : (
        <div>
          <div className="text-sm font-semibold">角丸</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <InputGroup label="左上">
              <Input
                inputMode="numeric"
                value={String(Math.round((node as RectNode).props.radius.tl))}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (!Number.isFinite(next)) return;
                  updateNode((prev) => {
                    if (prev.type !== "rect") return prev;
                    const p = (prev as RectNode).props;
                    return {
                      ...prev,
                      props: {
                        ...p,
                        radius: { ...p.radius, tl: clamp(next, 0, 999) },
                      },
                    } as DocNode;
                  });
                }}
              />
            </InputGroup>
            <InputGroup label="右上">
              <Input
                inputMode="numeric"
                value={String(Math.round((node as RectNode).props.radius.tr))}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (!Number.isFinite(next)) return;
                  updateNode((prev) => {
                    if (prev.type !== "rect") return prev;
                    const p = (prev as RectNode).props;
                    return {
                      ...prev,
                      props: {
                        ...p,
                        radius: { ...p.radius, tr: clamp(next, 0, 999) },
                      },
                    } as DocNode;
                  });
                }}
              />
            </InputGroup>
            <InputGroup label="右下">
              <Input
                inputMode="numeric"
                value={String(Math.round((node as RectNode).props.radius.br))}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (!Number.isFinite(next)) return;
                  updateNode((prev) => {
                    if (prev.type !== "rect") return prev;
                    const p = (prev as RectNode).props;
                    return {
                      ...prev,
                      props: {
                        ...p,
                        radius: { ...p.radius, br: clamp(next, 0, 999) },
                      },
                    } as DocNode;
                  });
                }}
              />
            </InputGroup>
            <InputGroup label="左下">
              <Input
                inputMode="numeric"
                value={String(Math.round((node as RectNode).props.radius.bl))}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (!Number.isFinite(next)) return;
                  updateNode((prev) => {
                    if (prev.type !== "rect") return prev;
                    const p = (prev as RectNode).props;
                    return {
                      ...prev,
                      props: {
                        ...p,
                        radius: { ...p.radius, bl: clamp(next, 0, 999) },
                      },
                    } as DocNode;
                  });
                }}
              />
            </InputGroup>
          </div>
        </div>
      )
    ),
  };
}

function ellipseNodeDef(): NodeTypeDefinition {
  return {
    type: "ellipse",
    title: "円",
    category: "図形",
    placement: {
      kind: "drag",
      defaultSize: { w: 180, h: 140 },
      minSize: { w: 24, h: 24 },
    },
    create: ({ id, x, y }) => ({
      id,
      type: "ellipse",
      x,
      y,
      w: 1,
      h: 1,
      props: {
        fill: "rgba(16, 185, 129, 0.10)",
        stroke: "rgba(16, 185, 129, 0.55)",
        strokeWidth: 2,
      },
    }),
    render: ({ node, scale, cn }): NodeRenderResult => {
      if (node.type !== "ellipse") return { ariaLabel: "ellipse" };
      const p = (node as EllipseNode).props;
      return {
        ariaLabel: "ellipse",
        className: cn("select-none"),
        style: {
          borderRadius: "50%",
          background: p.fill,
          border: `${p.strokeWidth * scale}px solid ${p.stroke}`,
        },
      };
    },
    inspector: ({ node, updateNode }) => (
      node.type !== "ellipse" ? null : (
        <div className="grid grid-cols-2 gap-2">
          <InputGroup label="半径X">
            <Input
              inputMode="numeric"
              value={String(Math.round(node.w / 2))}
              onChange={(e) => {
                const nextRx = Number(e.target.value);
                if (!Number.isFinite(nextRx)) return;
                updateNode((prev) => {
                  if (prev.type !== "ellipse") return prev;
                  const centerX = prev.x + prev.w / 2;
                  const newW = clamp(nextRx * 2, 24, 3200);
                  return { ...prev, w: newW, x: centerX - newW / 2 };
                });
              }}
            />
          </InputGroup>
          <InputGroup label="半径Y">
            <Input
              inputMode="numeric"
              value={String(Math.round(node.h / 2))}
              onChange={(e) => {
                const nextRy = Number(e.target.value);
                if (!Number.isFinite(nextRy)) return;
                updateNode((prev) => {
                  if (prev.type !== "ellipse") return prev;
                  const centerY = prev.y + prev.h / 2;
                  const newH = clamp(nextRy * 2, 24, 3200);
                  return { ...prev, h: newH, y: centerY - newH / 2 };
                });
              }}
            />
          </InputGroup>
        </div>
      )
    ),
  };
}

function textNodeDef(): NodeTypeDefinition {
  return {
    type: "text",
    title: "テキスト",
    category: "追加",
    placement: {
      kind: "click",
      defaultSize: { w: 280, h: 90 },
      minSize: { w: 24, h: 24 },
    },
    create: ({ id, x, y }) => ({
      id,
      type: "text",
      x: x - 140,
      y: y - 45,
      w: 280,
      h: 90,
      props: {
        text: "テキスト",
        fontSize: 18,
        color: "var(--foreground)",
        align: "left",
      },
    }),
    render: ({ node, scale, cn }) => {
      if (node.type !== "text") return { ariaLabel: "text" };
      const p = node.props as TextNode["props"];
      return {
        ariaLabel: "text",
        className: cn("select-none whitespace-pre-wrap bg-transparent"),
        style: {
          padding: 10 * scale,
          color: p.color,
          fontSize: p.fontSize * scale,
          lineHeight: 1.25,
          textAlign: p.align,
        },
        children: p.text,
      };
    },
    inspector: ({ node, updateNode }) => (
      node.type !== "text" ? null : (
        <InputGroup label="テキスト">
          <textarea
            className="mt-1 h-24 w-full resize-none rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            value={(node.props as TextNode["props"]).text}
            onChange={(e) => {
              const next = e.target.value;
              updateNode((prev) => ({
                ...prev,
                props: {
                  ...(prev.props as Record<string, unknown>),
                  text: next,
                },
              }));
            }}
          />
        </InputGroup>
      )
    ),
    onDoubleClick: ({ node, updateNode }) => {
      if (node.type !== "text") return;
      const cur = node.props as TextNode["props"];
      const next = window.prompt("テキストを編集", cur.text);
      if (next == null) return;
      updateNode((prev) => ({
        ...prev,
        props: { ...(prev.props as Record<string, unknown>), text: next },
      }));
    },
  };
}

function imageNodeDef(): NodeTypeDefinition {
  return {
    type: "image",
    title: "画像",
    category: "追加",
    placement: {
      kind: "click",
      defaultSize: { w: 320, h: 220 },
      minSize: { w: 24, h: 24 },
    },
    create: ({ id, x, y }) => ({
      id,
      type: "image",
      x: x - 160,
      y: y - 110,
      w: 320,
      h: 220,
      props: {
        src: "https://placehold.co/320x220.png",
        fit: "cover",
        borderRadius: 14,
      },
    }),
    render: ({ node, scale, cn }) => {
      if (node.type !== "image") return { ariaLabel: "image" };
      const p = node.props as ImageNode["props"];
      return {
        ariaLabel: "image",
        className: cn("select-none overflow-hidden bg-muted"),
        style: {
          borderRadius: p.borderRadius * scale,
        },
        children: (
          <img
            src={p.src}
            alt=""
            className="h-full w-full"
            style={{ objectFit: p.fit }}
            draggable={false}
          />
        ),
      };
    },
    inspector: ({ node, updateNode }) => (
      node.type !== "image" ? null : (
        <InputGroup label="画像URL">
          <Input
            value={(node.props as ImageNode["props"]).src}
            onChange={(e) => {
              const next = e.target.value;
              updateNode((prev) => ({
                ...prev,
                props: {
                  ...(prev.props as Record<string, unknown>),
                  src: next,
                },
              }));
            }}
          />
        </InputGroup>
      )
    ),
    onDoubleClick: ({ node, updateNode }) => {
      if (node.type !== "image") return;
      const cur = node.props as ImageNode["props"];
      const next = window.prompt("画像URLを編集", cur.src);
      if (next == null) return;
      updateNode((prev) => ({
        ...prev,
        props: { ...(prev.props as Record<string, unknown>), src: next },
      }));
    },
  };
}

export function builtinNodes(): Array<NodeTypeDefinition> {
  return [textNodeDef(), rectNodeDef(), ellipseNodeDef(), imageNodeDef()];
}
