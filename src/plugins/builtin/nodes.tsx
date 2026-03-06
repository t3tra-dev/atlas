import * as React from "react";
import { Input } from "@/components/ui/input";
import { InputGroup } from "@/components/ui/input-group";
import {
  isEmbeddedBinaryMedia,
  type EmbeddedBinaryMedia,
} from "@/components/document/atlas-binary";
import { ThreeCanvasView } from "@/plugins/builtin/three-canvas-view";

import type { NodeTypeDef } from "@/components/document/sdk";
import type { DocNodeBase } from "@/components/document/model";

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
    media: EmbeddedBinaryMedia;
    fit: "cover" | "contain";
    borderRadius: number;
  }
>;

export type ShapeNode = DocNodeBase<
  "shape",
  {
    text: string;
    shape:
      | "rect"
      | "stadium"
      | "subroutine"
      | "cylinder"
      | "circle"
      | "doublecircle"
      | "diamond"
      | "hexagon"
      | "parallelogram"
      | "trapezoid"
      | "invtrapezoid";
    fill: string;
    stroke: string;
    strokeWidth: number;
    radius?: number;
  }
>;

export type ThreeCanvasNode = DocNodeBase<
  "three-canvas",
  {
    model: EmbeddedBinaryMedia | null;
    fileName: string;
    background: string;
  }
>;

const PLACEHOLDER_IMAGE_URL = "https://placehold.co/320x220.png";
const FALLBACK_IMAGE_BYTES = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0,
  0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 252, 255, 31, 0, 3, 3, 2, 0, 239,
  191, 105, 30, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

function createFallbackImageMedia(): EmbeddedBinaryMedia {
  return {
    kind: "embedded",
    mimeType: "image/png",
    bytes: new Uint8Array(FALLBACK_IMAGE_BYTES),
  };
}

function ensureImageMedia(value: unknown): EmbeddedBinaryMedia {
  if (!isEmbeddedBinaryMedia(value)) {
    return createFallbackImageMedia();
  }
  return value;
}

function ensureOptionalMedia(value: unknown): EmbeddedBinaryMedia | null {
  if (value == null) return null;
  if (!isEmbeddedBinaryMedia(value)) return null;
  return value;
}

async function fetchPlaceholderImageMedia(): Promise<EmbeddedBinaryMedia> {
  if (typeof fetch !== "function") {
    return createFallbackImageMedia();
  }

  try {
    const response = await fetch(PLACEHOLDER_IMAGE_URL);
    if (!response.ok) {
      return createFallbackImageMedia();
    }
    const mimeType =
      response.headers
        .get("content-type")
        ?.split(";")
        .map((v) => v.trim())
        .filter(Boolean)[0] ?? "image/png";
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) return createFallbackImageMedia();
    return {
      kind: "embedded",
      mimeType,
      bytes,
    };
  } catch {
    return createFallbackImageMedia();
  }
}

async function fileToEmbeddedMedia(file: File): Promise<EmbeddedBinaryMedia | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) return null;
  return {
    kind: "embedded",
    mimeType: file.type || "application/octet-stream",
    bytes,
  };
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);

    const done = (file: File | null) => {
      input.removeEventListener("change", onChange);
      input.remove();
      resolve(file);
    };

    const onChange = () => {
      done(input.files?.[0] ?? null);
    };

    input.addEventListener("change", onChange, { once: true });
    input.click();
  });
}

function pickImageFile(): Promise<File | null> {
  return pickFile("image/*");
}

function pickModelFile(): Promise<File | null> {
  return pickFile(".gltf,.glb,model/gltf+json,model/gltf-binary");
}

function inferModelMimeType(file: File): string {
  if (file.type?.trim()) return file.type;
  const lowered = file.name.toLowerCase();
  if (lowered.endsWith(".gltf")) return "model/gltf+json";
  if (lowered.endsWith(".glb")) return "model/gltf-binary";
  return "application/octet-stream";
}

async function modelFileToMedia(file: File): Promise<EmbeddedBinaryMedia | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) return null;
  return {
    kind: "embedded",
    mimeType: inferModelMimeType(file),
    bytes,
  };
}

const mediaDataUrlCache = new WeakMap<Uint8Array, string>();

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa !== "function") return "";
  const CHUNK_SIZE = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function mediaToDataUrl(media: EmbeddedBinaryMedia): string {
  const cached = mediaDataUrlCache.get(media.bytes);
  if (cached) return cached;

  const base64 = bytesToBase64(media.bytes);
  const url = `data:${media.mimeType};base64,${base64}`;
  mediaDataUrlCache.set(media.bytes, url);
  return url;
}

function textNodeDef(): NodeTypeDef {
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
    inspector: ({ node, updateNode }) =>
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

function imageNodeDef(): NodeTypeDef {
  return {
    type: "image",
    title: "画像",
    category: "追加",
    placement: {
      kind: "click",
      defaultSize: { w: 320, h: 220 },
      minSize: { w: 24, h: 24 },
    },
    create: async ({ id, x, y }) => {
      const media = await fetchPlaceholderImageMedia();
      return {
        id,
        type: "image",
        x: x - 160,
        y: y - 110,
        w: 320,
        h: 220,
        props: {
          media,
          fit: "cover",
          borderRadius: 14,
        },
      };
    },
    render: ({ node, scale, cn }) => {
      if (node.type !== "image") return { ariaLabel: "image" };
      const p = node.props as ImageNode["props"];
      const media = ensureImageMedia(p.media);
      return {
        ariaLabel: "image",
        className: cn("select-none overflow-hidden bg-muted"),
        style: {
          borderRadius: p.borderRadius * scale,
        },
        children: (
          <img
            src={mediaToDataUrl(media)}
            alt=""
            className="h-full w-full"
            style={{ objectFit: p.fit }}
            draggable={false}
          />
        ),
      };
    },
    inspector: ({ node, updateNode }) =>
      node.type !== "image" ? null : (
        <InputGroup label="画像ファイル" description="image/* を埋め込み保存">
          <Input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              e.currentTarget.value = "";
              if (!file) return;

              void (async () => {
                const media = await fileToEmbeddedMedia(file);
                if (!media) return;
                updateNode((prev) => ({
                  ...prev,
                  props: {
                    ...(prev.props as Record<string, unknown>),
                    media,
                  },
                }));
              })();
            }}
          />
          <div className="mt-1 text-[11px] text-muted-foreground">
            {ensureImageMedia((node.props as ImageNode["props"]).media).mimeType}
          </div>
        </InputGroup>
      ),
    onDoubleClick: ({ node, updateNode }) => {
      if (node.type !== "image") return;
      void (async () => {
        const file = await pickImageFile();
        if (!file) return;
        const media = await fileToEmbeddedMedia(file);
        if (!media) return;
        updateNode((prev) => ({
          ...prev,
          props: {
            ...(prev.props as Record<string, unknown>),
            media,
          },
        }));
      })();
    },
  };
}

function threeCanvasNodeDef(): NodeTypeDef {
  return {
    type: "three-canvas",
    title: "3D Canvas",
    category: "追加",
    placement: {
      kind: "click",
      defaultSize: { w: 460, h: 320 },
      minSize: { w: 220, h: 180 },
    },
    create: ({ id, x, y }) => ({
      id,
      type: "three-canvas",
      x: x - 230,
      y: y - 160,
      w: 460,
      h: 320,
      props: {
        model: null,
        fileName: "No model",
        background: "#0b1220",
      },
    }),
    render: ({ node, scale, cn }) => {
      if (node.type !== "three-canvas") return { ariaLabel: "3D Canvas" };
      const p = node.props as ThreeCanvasNode["props"];
      const model = ensureOptionalMedia(p.model);
      const fileName =
        typeof p.fileName === "string" && p.fileName.trim() ? p.fileName : "No model";
      const background =
        typeof p.background === "string" && p.background.trim() ? p.background : "#0b1220";

      return {
        ariaLabel: "3D Canvas",
        className: cn("overflow-hidden bg-transparent"),
        style: {
          borderRadius: 14 * scale,
          border: `${Math.max(1, scale)}px solid var(--border)`,
        },
        children: (
          <div className="flex h-full w-full flex-col overflow-hidden rounded-[inherit] bg-transparent">
            <div className="flex h-8 shrink-0 items-center border-b border-border/80 bg-background/55 px-2 text-[11px] font-medium text-foreground">
              <span className="truncate">{fileName}</span>
            </div>
            <div className="min-h-0 flex-1">
              <ThreeCanvasView nodeId={node.id} model={model} background={background} />
            </div>
          </div>
        ),
      };
    },
    inspector: ({ node, updateNode }) =>
      node.type !== "three-canvas" ? null : (
        <div className="space-y-3">
          <InputGroup label="3Dモデル(glTF)" description="gltf/glb を埋め込み保存">
            <Input
              type="file"
              accept=".gltf,.glb,model/gltf+json,model/gltf-binary"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                e.currentTarget.value = "";
                if (!file) return;

                void (async () => {
                  const model = await modelFileToMedia(file);
                  if (!model) return;
                  updateNode((prev) => ({
                    ...prev,
                    props: {
                      ...(prev.props as Record<string, unknown>),
                      model,
                      fileName: file.name,
                    },
                  }));
                })();
              }}
            />
            <div className="mt-1 text-[11px] text-muted-foreground">
              ファイル: {(node.props as ThreeCanvasNode["props"]).fileName || "No model"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              MIME:{" "}
              {ensureOptionalMedia((node.props as ThreeCanvasNode["props"]).model)?.mimeType ?? "-"}
            </div>
          </InputGroup>

          <InputGroup label="背景色">
            <Input
              type="color"
              value={(node.props as ThreeCanvasNode["props"]).background}
              onChange={(e) => {
                const next = e.target.value;
                updateNode((prev) => ({
                  ...prev,
                  props: {
                    ...(prev.props as Record<string, unknown>),
                    background: next,
                  },
                }));
              }}
            />
          </InputGroup>
        </div>
      ),
    onDoubleClick: ({ node, updateNode }) => {
      if (node.type !== "three-canvas") return;
      void (async () => {
        const file = await pickModelFile();
        if (!file) return;
        const model = await modelFileToMedia(file);
        if (!model) return;
        updateNode((prev) => ({
          ...prev,
          props: {
            ...(prev.props as Record<string, unknown>),
            model,
            fileName: file.name,
          },
        }));
      })();
    },
  };
}

function shapeNodeDef(): NodeTypeDef {
  const shapeOptions: Array<{ value: ShapeNode["props"]["shape"]; label: string }> = [
    { value: "rect", label: "四角形" },
    { value: "stadium", label: "スタジアム" },
    { value: "subroutine", label: "サブルーチン" },
    { value: "cylinder", label: "データベース" },
    { value: "circle", label: "円" },
    { value: "doublecircle", label: "二重円" },
    { value: "diamond", label: "ダイヤ" },
    { value: "hexagon", label: "六角形" },
    { value: "parallelogram", label: "平行四辺形" },
    { value: "trapezoid", label: "台形" },
    { value: "invtrapezoid", label: "逆台形" },
  ];

  return {
    type: "shape",
    title: "シェイプ",
    category: "図形",
    placement: {
      kind: "click",
      defaultSize: { w: 220, h: 120 },
      minSize: { w: 80, h: 60 },
    },
    create: ({ id, x, y }) => ({
      id,
      type: "shape",
      x: x - 110,
      y: y - 60,
      w: 220,
      h: 120,
      props: {
        text: "Shape",
        shape: "rect",
        fill: "rgba(99, 102, 241, 0.08)",
        stroke: "rgba(99, 102, 241, 0.6)",
        strokeWidth: 2,
        radius: 8,
      },
    }),
    render: ({ node, scale, cn, selected }) => {
      if (node.type !== "shape") return { ariaLabel: "shape" };
      const p = node.props as ShapeNode["props"];
      const isCircle = p.shape === "circle" || p.shape === "doublecircle";
      const isStadium = p.shape === "stadium";
      const isParallelogram = p.shape === "parallelogram";
      const borderWidth = Math.max(1, p.strokeWidth * scale);
      const selectionWidth = Math.max(2, 2 * scale);

      const baseStyle: React.CSSProperties = {
        position: "absolute",
        inset: 0,
        background: p.fill,
        border: `${borderWidth}px solid ${p.stroke}`,
      };

      const shapeStyle: React.CSSProperties = {
        ...baseStyle,
        borderRadius: isCircle ? "50%" : isStadium ? "999px" : `${(p.radius ?? 6) * scale}px`,
      };

      const clipPath = (() => {
        switch (p.shape) {
          case "diamond":
            return "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)";
          case "hexagon":
            return "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)";
          case "parallelogram":
            return "polygon(10% 0%, 100% 0%, 90% 100%, 0% 100%)";
          case "trapezoid":
            return "polygon(15% 0%, 85% 0%, 100% 100%, 0% 100%)";
          case "invtrapezoid":
            return "polygon(0% 0%, 100% 0%, 85% 100%, 15% 100%)";
          default:
            return undefined;
        }
      })();

      if (clipPath) {
        shapeStyle.clipPath = clipPath;
      }

      return {
        ariaLabel: "shape",
        className: cn("select-none"),
        children: (
          <div className="relative h-full w-full">
            {p.shape === "subroutine" ? (
              <div style={baseStyle}>
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: 10 * scale,
                    width: borderWidth,
                    background: p.stroke,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    right: 10 * scale,
                    width: borderWidth,
                    background: p.stroke,
                  }}
                />
              </div>
            ) : null}

            {p.shape === "cylinder" ? (
              <div style={{ ...baseStyle, borderRadius: `${12 * scale}px` }}>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: borderWidth,
                    height: 20 * scale,
                    border: `${borderWidth}px solid ${p.stroke}`,
                    borderRadius: "50%",
                    background: p.fill,
                  }}
                />
              </div>
            ) : null}

            {p.shape !== "subroutine" && p.shape !== "cylinder" && clipPath ? (
              <>
                <div
                  style={{
                    position: "absolute",
                    inset: -borderWidth,
                    background: p.stroke,
                    clipPath,
                    zIndex: 1,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    inset: borderWidth,
                    background: p.fill,
                    clipPath,
                    zIndex: 2,
                  }}
                />
              </>
            ) : null}

            {p.shape !== "subroutine" && p.shape !== "cylinder" && !clipPath ? (
              <div style={shapeStyle} />
            ) : null}

            {p.shape === "doublecircle" ? (
              <div
                style={{
                  position: "absolute",
                  inset: 10 * scale,
                  border: `${borderWidth}px solid ${p.stroke}`,
                  borderRadius: "50%",
                  boxSizing: "border-box",
                }}
              />
            ) : null}

            {selected ? (
              <div
                style={{
                  position: "absolute",
                  inset: -selectionWidth,
                  pointerEvents: "none",
                  zIndex: 2,
                }}
              >
                {clipPath ? (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      clipPath,
                      boxShadow: `inset 0 0 0 ${selectionWidth}px hsl(var(--ring))`,
                      boxSizing: "border-box",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      border: `${selectionWidth}px solid hsl(var(--ring))`,
                      borderRadius: isCircle
                        ? "50%"
                        : isStadium
                          ? "999px"
                          : `${(p.radius ?? 6) * scale}px`,
                      boxSizing: "border-box",
                    }}
                  />
                )}
              </div>
            ) : null}

            <div
              className={cn(
                "relative flex h-full w-full items-center justify-center px-3 text-center",
              )}
              style={{
                zIndex: 3,
                fontSize: 14 * scale,
                lineHeight: 1.25,
                transform: isParallelogram ? "skewX(12deg)" : undefined,
              }}
            >
              <div className="whitespace-pre-wrap">{p.text}</div>
            </div>
          </div>
        ),
      };
    },
    inspector: ({ node, updateNode }) =>
      node.type !== "shape" ? null : (
        <div className="space-y-3">
          <InputGroup label="テキスト">
            <textarea
              className="mt-1 h-24 w-full resize-none rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
              value={(node.props as ShapeNode["props"]).text}
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
          <InputGroup label="形状">
            <select
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={(node.props as ShapeNode["props"]).shape}
              onChange={(e) => {
                const next = e.target.value as ShapeNode["props"]["shape"];
                updateNode((prev) => ({
                  ...prev,
                  props: {
                    ...(prev.props as Record<string, unknown>),
                    shape: next,
                  },
                }));
              }}
            >
              {shapeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </InputGroup>
          {(node.props as ShapeNode["props"]).shape === "rect" ? (
            <InputGroup label="角丸">
              <Input
                inputMode="numeric"
                value={String(Math.round((node.props as ShapeNode["props"]).radius ?? 0))}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (!Number.isFinite(next)) return;
                  updateNode((prev) => ({
                    ...prev,
                    props: {
                      ...(prev.props as Record<string, unknown>),
                      radius: Math.max(0, Math.min(999, next)),
                    },
                  }));
                }}
              />
            </InputGroup>
          ) : null}
        </div>
      ),
  };
}

export function builtinNodes(): Array<NodeTypeDef> {
  return [textNodeDef(), imageNodeDef(), threeCanvasNodeDef(), shapeNodeDef()];
}
