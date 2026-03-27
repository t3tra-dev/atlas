import type { DocEdge, DocNode, DocumentModel } from "@/components/document/model";
import { createUniqueHashId } from "@/lib/hash-id";

export function createDefaultDocument(title = "ドキュメント"): DocumentModel {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const rectId = createUniqueHashId("node", nodeIds);
  const textId = createUniqueHashId("node", nodeIds);
  const ellipseId = createUniqueHashId("node", nodeIds);

  const nodes: Record<string, DocNode> = {
    [rectId]: {
      id: rectId,
      type: "shape",
      x: 240,
      y: 180,
      w: 240,
      h: 140,
      props: {
        text: "",
        shape: "rect",
        fill: "rgba(59, 130, 246, 0.10)",
        stroke: "rgba(59, 130, 246, 0.55)",
        strokeWidth: 2,
        radius: 8,
      },
    },
    [ellipseId]: {
      id: ellipseId,
      type: "shape",
      x: 620,
      y: 360,
      w: 180,
      h: 140,
      props: {
        text: "",
        shape: "circle",
        fill: "rgba(16, 185, 129, 0.10)",
        stroke: "rgba(16, 185, 129, 0.55)",
        strokeWidth: 2,
      },
    },
    [textId]: {
      id: textId,
      type: "text",
      x: 560,
      y: 160,
      w: 260,
      h: 90,
      props: {
        text: "Atlas Document\n(HTMLベース)",
        fontSize: 18,
        color: "var(--foreground)",
        align: "left",
      },
    },
  };

  const edgeId = createUniqueHashId("edge", edgeIds);
  const edges: Record<string, DocEdge> = {
    [edgeId]: {
      id: edgeId,
      shape: "curve",
      arrow: "none",
      from: rectId,
      to: ellipseId,
      props: { color: "#5a75bc", width: 2, dash: "solid", curve: 0.25 },
    },
  };

  return {
    version: 1,
    title,
    camera: { x: 0, y: 0, scale: 1 },
    canvas: { width: 3200, height: 2200, background: "grid" },
    nodes,
    nodeOrder: [rectId, textId, ellipseId],
    edges,
    edgeOrder: [edgeId],
  };
}
