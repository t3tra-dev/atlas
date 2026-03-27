import type { DocumentModel } from "@/components/document/model";

function compactValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > 240 ? `${value.slice(0, 240)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (depth >= 2) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((entry) => compactValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 12)
        .map(([key, entry]) => [key, compactValue(entry, depth + 1)]),
    );
  }
  return String(value);
}

export function buildDocumentSnapshot({
  doc,
  activeDocId,
  selectedNodeId,
  selectedEdgeId,
}: {
  doc: DocumentModel;
  activeDocId?: string;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
}) {
  return {
    activeDocumentId: activeDocId ?? null,
    title: doc.title,
    version: doc.version,
    selection: {
      nodeId: selectedNodeId ?? null,
      edgeId: selectedEdgeId ?? null,
    },
    camera: {
      x: doc.camera.x,
      y: doc.camera.y,
      scale: doc.camera.scale,
    },
    canvas: {
      width: doc.canvas.width,
      height: doc.canvas.height,
      background: doc.canvas.background,
    },
    counts: {
      nodes: doc.nodeOrder.length,
      edges: doc.edgeOrder.length,
    },
    nodes: doc.nodeOrder.map((nodeId) => {
      const node = doc.nodes[nodeId];
      return {
        id: node.id,
        type: node.type,
        x: node.x,
        y: node.y,
        w: node.w,
        h: node.h,
        rotation: node.rotation ?? 0,
        props: compactValue(node.props),
      };
    }),
    edges: doc.edgeOrder.map((edgeId) => {
      const edge = doc.edges[edgeId];
      return {
        id: edge.id,
        shape: edge.shape,
        arrow: edge.arrow,
        from: edge.from,
        to: edge.to,
        props: compactValue(edge.props),
      };
    }),
  };
}
