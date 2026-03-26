import * as React from "react";

import type { DocNode } from "@/components/document/model";
import type { NodeTypeDef } from "@/components/document/sdk";
import { cn } from "@/lib/utils";

function ResizeHandle({
  scale,
  onPointerDown,
}: {
  scale: number;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const size = 10 * scale;
  return (
    <div
      role="button"
      aria-label="resize"
      onPointerDown={onPointerDown}
      className="absolute bg-background border border-border"
      style={{
        width: size,
        height: size,
        right: -size / 2,
        bottom: -size / 2,
        borderRadius: 3 * scale,
        cursor: "nwse-resize",
      }}
    />
  );
}

export function NodeView({
  node,
  nodeDef,
  selected,
  scale,
  onPointerDown,
  onResizeHandlePointerDown,
  onDoubleClick,
}: {
  node: DocNode;
  nodeDef: NodeTypeDef;
  selected: boolean;
  scale: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onResizeHandlePointerDown: (e: React.PointerEvent) => void;
  onDoubleClick: () => void;
}) {
  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: node.x * scale,
    top: node.y * scale,
    width: node.w * scale,
    height: node.h * scale,
    transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
    transformOrigin: "center",
  };

  const rendered = nodeDef.render({
    node,
    selected,
    scale,
    cn,
  });

  const outlineClass =
    selected && !rendered.suppressSelectionRing
      ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
      : "";

  return (
    <div
      role="group"
      aria-label={rendered.ariaLabel ?? node.type}
      className={cn(rendered.className, outlineClass)}
      style={{
        ...baseStyle,
        ...(rendered.style ?? null),
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {rendered.children}
      {selected && <ResizeHandle scale={scale} onPointerDown={onResizeHandlePointerDown} />}
    </div>
  );
}
