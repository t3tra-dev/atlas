import * as React from "react";

import { LockedRectGesturePreview } from "@/components/document/locked-rect-gesture-preview";
import type { Camera, DocNode, DocumentModel, Tool } from "@/components/document/model";
import type { NodeRegistry } from "@/components/document/plugin-system";
import { NodeView } from "@/components/document/editor/node-view";
import {
  computeEdgeLabelPosition,
  computeEdgePath,
  computeEdgePathFromPoints,
  getNodeConnectionPoint,
  toDocPoint,
} from "@/components/document/editor/shared";

export function DocumentEditorCanvas({
  viewportRef,
  viewportStyle,
  camera,
  viewportSize,
  doc,
  tool,
  connectPreview,
  setConnectPreview,
  svgViewBox,
  selectedNodeId,
  selectedEdgeId,
  nodeRegistry,
  onCanvasPointerDown,
  onNodePointerDown,
  onNodeResizePointerDown,
  onNodeDoubleClick,
  onEdgePointerDown,
}: {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  viewportStyle: React.CSSProperties;
  camera: Camera;
  viewportSize: { width: number; height: number };
  doc: DocumentModel;
  tool: Tool;
  connectPreview: { x: number; y: number } | null;
  setConnectPreview: React.Dispatch<React.SetStateAction<null | { x: number; y: number }>>;
  svgViewBox: string;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  nodeRegistry: NodeRegistry;
  onCanvasPointerDown: (e: React.PointerEvent) => void;
  onNodePointerDown: (e: React.PointerEvent, nodeId: string) => void;
  onNodeResizePointerDown: (e: React.PointerEvent, nodeId: string) => void;
  onNodeDoubleClick: (nodeId: string) => void;
  onEdgePointerDown: (edgeId: string, e: React.PointerEvent) => void;
}) {
  return (
    <div
      ref={viewportRef}
      data-atlas-doc-viewport="true"
      className="relative min-h-0 flex-1 overflow-hidden bg-transparent"
      style={viewportStyle}
      onPointerMove={(e) => {
        if (tool.kind !== "connect" || !tool.fromId) return;
        if (!viewportRef.current) return;
        const p = toDocPoint(e, viewportRef.current, camera);
        setConnectPreview(p);
      }}
    >
      <div className="absolute inset-0" onPointerDown={onCanvasPointerDown} aria-label="canvas">
        <svg
          className="absolute inset-0"
          width="100%"
          height="100%"
          viewBox={svgViewBox}
          preserveAspectRatio="xMinYMin meet"
        >
          <defs>
            <marker
              id="arrow-end"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
            <marker
              id="arrow-start"
              viewBox="0 0 10 10"
              refX="1"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M 10 0 L 0 5 L 10 10 z" fill="context-stroke" />
            </marker>
          </defs>

          {doc.edgeOrder.map((edgeId) => {
            const edge = doc.edges[edgeId];
            if (!edge) return null;
            const fromNode = doc.nodes[edge.from];
            const toNode = doc.nodes[edge.to];
            if (!fromNode || !toNode) return null;

            const path = computeEdgePath(edge, fromNode, toNode);
            const strokeDasharray = edge.props.dash === "dashed" ? "8 6" : undefined;
            const markerEnd =
              edge.arrow === "end" || edge.arrow === "both" ? "url(#arrow-end)" : undefined;
            const markerStart = edge.arrow === "both" ? "url(#arrow-start)" : undefined;
            const selected = selectedEdgeId === edgeId;
            const labelText = edge.props.label?.trim();
            const labelPos = labelText ? computeEdgeLabelPosition(edge, fromNode, toNode) : null;
            const labelWidth = labelText
              ? Math.min(240, Math.max(44, labelText.length * 7 + 16))
              : 0;
            const labelHeight = labelText ? 24 : 0;
            const edgeCenterX = labelPos
              ? labelPos.x
              : (fromNode.x + fromNode.w / 2 + (toNode.x + toNode.w / 2)) / 2;
            const edgeCenterY = labelPos
              ? labelPos.y
              : (fromNode.y + fromNode.h / 2 + (toNode.y + toNode.h / 2)) / 2;

            return (
              <g
                key={edgeId}
                data-atlas-edge-id={edgeId}
                data-atlas-center-x={edgeCenterX}
                data-atlas-center-y={edgeCenterY}
              >
                {selected ? (
                  <path
                    d={path}
                    fill="none"
                    stroke="rgba(99, 102, 241, 0.90)"
                    strokeWidth={edge.props.width + 5}
                    strokeDasharray={strokeDasharray}
                    style={{ pointerEvents: "none" }}
                  />
                ) : null}

                <path
                  d={path}
                  fill="none"
                  stroke={edge.props.color}
                  strokeWidth={edge.props.width}
                  strokeDasharray={strokeDasharray}
                  markerEnd={markerEnd}
                  markerStart={markerStart}
                  data-atlas-edge-id={edgeId}
                  data-atlas-center-x={edgeCenterX}
                  data-atlas-center-y={edgeCenterY}
                  style={{ cursor: "pointer" }}
                  onPointerDown={(e) => onEdgePointerDown(edgeId, e)}
                />

                {labelText && labelPos ? (
                  <g style={{ pointerEvents: "none" }}>
                    <rect
                      x={labelPos.x - labelWidth / 2}
                      y={labelPos.y - labelHeight / 2}
                      width={labelWidth}
                      height={labelHeight}
                      rx={6}
                      fill="var(--background)"
                      stroke="var(--border)"
                    />
                    <text
                      x={labelPos.x}
                      y={labelPos.y + 4}
                      textAnchor="middle"
                      fontSize={12}
                      fill="var(--foreground)"
                    >
                      {labelText}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}

          {tool.kind === "connect" && tool.fromId && connectPreview
            ? (() => {
                const fromNode = doc.nodes[tool.fromId];
                if (!fromNode) return null;
                const b = connectPreview;
                const start = getNodeConnectionPoint(fromNode, b);
                const d = computeEdgePathFromPoints(tool.edge.shape, start, b, 0.25);
                const markerEnd =
                  tool.edge.arrow === "end" || tool.edge.arrow === "both"
                    ? "url(#arrow-end)"
                    : undefined;
                const markerStart = tool.edge.arrow === "both" ? "url(#arrow-start)" : undefined;
                return (
                  <path
                    d={d}
                    fill="none"
                    stroke="rgba(99, 102, 241, 0.75)"
                    strokeWidth={2}
                    strokeDasharray="6 6"
                    markerEnd={markerEnd}
                    markerStart={markerStart}
                    style={{ pointerEvents: "none" }}
                  />
                );
              })()
            : null}
        </svg>

        {doc.nodeOrder.map((nodeId) => {
          const node = doc.nodes[nodeId];
          if (!node) return null;
          const nodeDef = nodeRegistry.get(node.type);
          if (!nodeDef) return null;
          const selected = selectedNodeId === nodeId;

          const screenX = (node.x - camera.x) * camera.scale;
          const screenY = (node.y - camera.y) * camera.scale;
          const screenW = node.w * camera.scale;
          const screenH = node.h * camera.scale;

          return (
            <NodeView
              key={nodeId}
              worldCenter={{
                x: node.x + node.w / 2,
                y: node.y + node.h / 2,
              }}
              node={
                {
                  ...node,
                  x: screenX / camera.scale,
                  y: screenY / camera.scale,
                  w: screenW / camera.scale,
                  h: screenH / camera.scale,
                } as DocNode
              }
              nodeDef={nodeDef}
              selected={selected}
              scale={camera.scale}
              onPointerDown={(e) => onNodePointerDown(e, nodeId)}
              onResizeHandlePointerDown={(e) => onNodeResizePointerDown(e, nodeId)}
              onDoubleClick={() => onNodeDoubleClick(nodeId)}
            />
          );
        })}

        <LockedRectGesturePreview
          viewportWidth={viewportSize.width}
          viewportHeight={viewportSize.height}
        />
      </div>
    </div>
  );
}
