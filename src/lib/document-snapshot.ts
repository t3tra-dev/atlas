import type { DocEdge, DocNode, DocumentModel } from "@/components/document/model";

function compactString(value: string, maxLength = 800) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function compactValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return compactString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return {
      kind: "binary-bytes",
      byteLength: value.byteLength,
    };
  }
  if (depth >= 3) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 16).map((entry) => compactValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (
      record.kind === "embedded" &&
      typeof record.mimeType === "string" &&
      record.bytes instanceof Uint8Array
    ) {
      return {
        kind: "embedded",
        mimeType: record.mimeType,
        byteLength: record.bytes.byteLength,
      };
    }

    return Object.fromEntries(
      Object.entries(record)
        .slice(0, 20)
        .map(([key, entry]) => [key, compactValue(entry, depth + 1)]),
    );
  }
  return String(value);
}

function summarizeNodePayload(node: DocNode) {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const base = {
    type: node.type,
    props: compactValue(props),
  };

  if (node.type === "text") {
    return {
      ...base,
      text: typeof props.text === "string" ? compactString(props.text) : "",
      textStyle: {
        fontSize: typeof props.fontSize === "number" ? props.fontSize : null,
        color: typeof props.color === "string" ? props.color : null,
        align: typeof props.align === "string" ? props.align : null,
      },
    };
  }

  if (node.type === "shape") {
    return {
      ...base,
      text: typeof props.text === "string" ? compactString(props.text) : "",
      shape: typeof props.shape === "string" ? props.shape : null,
      style: {
        fill: typeof props.fill === "string" ? props.fill : null,
        stroke: typeof props.stroke === "string" ? props.stroke : null,
        strokeWidth: typeof props.strokeWidth === "number" ? props.strokeWidth : null,
        radius: typeof props.radius === "number" ? props.radius : null,
      },
    };
  }

  if (node.type === "image") {
    const media = props.media as Record<string, unknown> | undefined;
    return {
      ...base,
      image: {
        fit: typeof props.fit === "string" ? props.fit : null,
        borderRadius: typeof props.borderRadius === "number" ? props.borderRadius : null,
        media:
          media && media.kind === "embedded" && media.bytes instanceof Uint8Array
            ? {
                kind: "embedded",
                mimeType: typeof media.mimeType === "string" ? media.mimeType : null,
                byteLength: media.bytes.byteLength,
              }
            : compactValue(props.media),
      },
    };
  }

  if (node.type === "three-canvas") {
    const model = props.model as Record<string, unknown> | null | undefined;
    return {
      ...base,
      scene: {
        fileName: typeof props.fileName === "string" ? props.fileName : null,
        background: typeof props.background === "string" ? props.background : null,
        model:
          model && model.kind === "embedded" && model.bytes instanceof Uint8Array
            ? {
                kind: "embedded",
                mimeType: typeof model.mimeType === "string" ? model.mimeType : null,
                byteLength: model.bytes.byteLength,
              }
            : compactValue(props.model),
      },
    };
  }

  return base;
}

function buildNodeRelations(nodeId: string, edges: Array<DocEdge>) {
  const incoming = edges
    .filter((edge) => edge.to === nodeId)
    .map((edge) => ({
      edgeId: edge.id,
      fromNodeId: edge.from,
      toNodeId: edge.to,
      shape: edge.shape,
      arrow: edge.arrow,
      label: edge.props.label ?? null,
      style: {
        color: edge.props.color,
        width: edge.props.width,
        dash: edge.props.dash ?? "solid",
        curve: edge.props.curve ?? null,
      },
    }));

  const outgoing = edges
    .filter((edge) => edge.from === nodeId)
    .map((edge) => ({
      edgeId: edge.id,
      fromNodeId: edge.from,
      toNodeId: edge.to,
      shape: edge.shape,
      arrow: edge.arrow,
      label: edge.props.label ?? null,
      style: {
        color: edge.props.color,
        width: edge.props.width,
        dash: edge.props.dash ?? "solid",
        curve: edge.props.curve ?? null,
      },
    }));

  return {
    incoming,
    outgoing,
    connectedNodeIds: Array.from(
      new Set([
        ...incoming.map((edge) => edge.fromNodeId),
        ...outgoing.map((edge) => edge.toNodeId),
      ]),
    ),
    degree: incoming.length + outgoing.length,
  };
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
  const orderedEdges = doc.edgeOrder
    .map((edgeId) => doc.edges[edgeId])
    .filter((edge): edge is DocEdge => edge != null);

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
      zoomPercent: Math.round(doc.camera.scale * 100),
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
      const relations = buildNodeRelations(node.id, orderedEdges);
      return {
        id: node.id,
        type: node.type,
        zIndex: doc.nodeOrder.indexOf(node.id),
        position: {
          x: node.x,
          y: node.y,
          w: node.w,
          h: node.h,
          rotation: node.rotation ?? 0,
          centerX: node.x + node.w / 2,
          centerY: node.y + node.h / 2,
          right: node.x + node.w,
          bottom: node.y + node.h,
        },
        payload: summarizeNodePayload(node),
        relations,
      };
    }),
    edges: orderedEdges.map((edge) => {
      return {
        id: edge.id,
        shape: edge.shape,
        arrow: edge.arrow,
        fromNodeId: edge.from,
        toNodeId: edge.to,
        label: edge.props.label ?? null,
        style: {
          color: edge.props.color,
          width: edge.props.width,
          dash: edge.props.dash ?? "solid",
          curve: edge.props.curve ?? null,
        },
        props: compactValue(edge.props),
      };
    }),
  };
}
