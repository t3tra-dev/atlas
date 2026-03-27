import * as React from "react";

import type {
  Camera,
  DocEdge,
  DocNode,
  DocumentModel,
  DragState,
  Selection,
  Tool,
} from "@/components/document/model";
import type { NodeRegistry } from "@/components/document/plugin-system";
import { clamp, getNodeCenter, newId, toDocPoint } from "@/components/document/editor/shared";

type SetDocument = (next: DocumentModel | ((prev: DocumentModel) => DocumentModel)) => void;

export function useCanvasInteractions({
  doc,
  camera,
  drag,
  tool,
  spaceDown,
  getViewportElement,
  nodeRegistry,
  setDoc,
  setSelection,
  setTool,
  setDrag,
  setConnectPreview,
  setCameraState,
  scheduleCameraCommit,
}: {
  doc: DocumentModel;
  camera: Camera;
  drag: DragState;
  tool: Tool;
  spaceDown: boolean;
  getViewportElement: () => HTMLDivElement | null;
  nodeRegistry: NodeRegistry;
  setDoc: SetDocument;
  setSelection: React.Dispatch<React.SetStateAction<Selection>>;
  setTool: React.Dispatch<React.SetStateAction<Tool>>;
  setDrag: React.Dispatch<React.SetStateAction<DragState>>;
  setConnectPreview: React.Dispatch<React.SetStateAction<null | { x: number; y: number }>>;
  setCameraState:
    | React.Dispatch<React.SetStateAction<Camera>>
    | ((next: Camera | ((prev: Camera) => Camera)) => void);
  scheduleCameraCommit: (delayMs?: number) => void;
}) {
  const beginMove = React.useCallback(
    (e: React.PointerEvent, nodeId: string) => {
      const node = doc.nodes[nodeId];
      if (!node) return;

      e.preventDefault();
      e.stopPropagation();

      setSelection({ kind: "node", id: nodeId });

      setDrag({
        kind: "move",
        nodeId,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: node.x,
        startY: node.y,
      });
    },
    [doc.nodes, setDrag, setSelection],
  );

  const beginResize = React.useCallback(
    (e: React.PointerEvent, nodeId: string) => {
      const node = doc.nodes[nodeId];
      if (!node) return;

      e.preventDefault();
      e.stopPropagation();

      setDrag({
        kind: "resize",
        nodeId,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startW: node.w,
        startH: node.h,
      });
    },
    [doc.nodes, setDrag],
  );

  const beginPan = React.useCallback(
    (e: React.PointerEvent, opts?: { clickClearsSelection?: boolean }) => {
      e.preventDefault();
      e.stopPropagation();
      setDrag({
        kind: "pan",
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCamX: camera.x,
        startCamY: camera.y,
        didPan: false,
        clickClearsSelection: opts?.clickClearsSelection ?? false,
      });
    },
    [camera.x, camera.y, setDrag],
  );

  React.useEffect(() => {
    if (drag.kind === "none") return;

    const PAN_THRESHOLD_PX = 3;

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;

      const dx = (e.clientX - drag.startClientX) / camera.scale;
      const dy = (e.clientY - drag.startClientY) / camera.scale;

      if (drag.kind === "pan") {
        const movedPx = Math.max(
          Math.abs(e.clientX - drag.startClientX),
          Math.abs(e.clientY - drag.startClientY),
        );
        if (!drag.didPan && movedPx < PAN_THRESHOLD_PX) return;

        setCameraState((c) => ({
          ...c,
          x: drag.startCamX - (e.clientX - drag.startClientX) / c.scale,
          y: drag.startCamY - (e.clientY - drag.startClientY) / c.scale,
        }));
        if (!drag.didPan) {
          setDrag((s) => (s.kind === "pan" ? { ...s, didPan: true } : s));
        }
        return;
      }

      if (drag.kind === "move") {
        setDoc((d) => {
          const node = d.nodes[drag.nodeId];
          if (!node) return d;
          return {
            ...d,
            nodes: {
              ...d.nodes,
              [drag.nodeId]: {
                ...node,
                x: drag.startX + dx,
                y: drag.startY + dy,
              },
            },
          };
        });
        return;
      }

      if (drag.kind === "resize") {
        setDoc((d) => {
          const node = d.nodes[drag.nodeId];
          if (!node) return d;
          const nextW = clamp(drag.startW + dx, 24, 3200);
          const nextH = clamp(drag.startH + dy, 24, 3200);
          return {
            ...d,
            nodes: {
              ...d.nodes,
              [drag.nodeId]: {
                ...node,
                w: nextW,
                h: nextH,
              },
            },
          };
        });
        return;
      }

      if (drag.kind === "drawShape") {
        const curWorldX = drag.startWorldX + dx;
        const curWorldY = drag.startWorldY + dy;
        const rawW = curWorldX - drag.startWorldX;
        const rawH = curWorldY - drag.startWorldY;

        const absW = Math.abs(rawW);
        const absH = Math.abs(rawH);

        const lock = e.shiftKey;
        const size = lock ? Math.max(absW, absH) : undefined;

        const def = nodeRegistry.get(drag.nodeType);
        const min = def?.placement?.minSize ?? { w: 1, h: 1 };
        const w = clamp(lock ? size! : absW, min.w, 3200);
        const h = clamp(lock ? size! : absH, min.h, 3200);

        const x = rawW < 0 ? drag.startWorldX - w : drag.startWorldX;
        const y = rawH < 0 ? drag.startWorldY - h : drag.startWorldY;

        setDoc((d) => {
          const node = d.nodes[drag.nodeId];
          if (!node) return d;
          return {
            ...d,
            nodes: {
              ...d.nodes,
              [drag.nodeId]: {
                ...node,
                x,
                y,
                w,
                h,
              } as DocNode,
            },
          };
        });
      }
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;

      if (drag.kind === "pan" && !drag.didPan && drag.clickClearsSelection) {
        setSelection({ kind: "none" });
      }
      if (drag.kind === "pan" && drag.didPan) {
        scheduleCameraCommit(0);
      }

      if (drag.kind === "drawShape") {
        const movedPx = Math.max(
          Math.abs(e.clientX - drag.startClientX),
          Math.abs(e.clientY - drag.startClientY),
        );
        if (movedPx < PAN_THRESHOLD_PX) {
          setDoc((d) => {
            const node = d.nodes[drag.nodeId];
            if (!node) return d;

            const def = nodeRegistry.get(drag.nodeType);
            const defaults = def?.placement?.defaultSize ?? { w: 200, h: 140 };

            return {
              ...d,
              nodes: {
                ...d.nodes,
                [drag.nodeId]: {
                  ...node,
                  x: drag.startWorldX - defaults.w / 2,
                  y: drag.startWorldY - defaults.h / 2,
                  w: defaults.w,
                  h: defaults.h,
                },
              },
            };
          });
        }
        setTool({ kind: "select" });
      }

      setDrag({ kind: "none" });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [
    camera.scale,
    drag,
    nodeRegistry,
    scheduleCameraCommit,
    setCameraState,
    setDoc,
    setDrag,
    setSelection,
    setTool,
  ]);

  const onCanvasPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      const viewportEl = getViewportElement();
      if (!viewportEl) return;

      if (e.button === 1 || spaceDown) {
        beginPan(e);
        return;
      }

      if (tool.kind === "select") {
        beginPan(e, { clickClearsSelection: true });
        return;
      }

      if (tool.kind === "add") {
        const point = toDocPoint(e, viewportEl, camera);
        const id = newId("node", new Set(Object.keys(doc.nodes)));

        const nodeDef = nodeRegistry.get(tool.nodeType);
        if (!nodeDef) {
          setTool({ kind: "select" });
          return;
        }

        const preset = tool.preset;
        const finalizeAdd = (node: DocNode) => {
          const nextNode: DocNode = preset
            ? {
                ...node,
                ...(preset.w ? { w: preset.w } : null),
                ...(preset.h ? { h: preset.h } : null),
                ...(preset.props
                  ? {
                      props: {
                        ...(node.props as Record<string, unknown>),
                        ...preset.props,
                      },
                    }
                  : null),
              }
            : node;

          setDoc((d) => ({
            ...d,
            nodes: { ...d.nodes, [id]: nextNode },
            nodeOrder: [...d.nodeOrder, id],
          }));
          setSelection({ kind: "node", id });

          if (nodeDef.placement?.kind === "drag") {
            setDrag({
              kind: "drawShape",
              nodeId: id,
              nodeType: node.type,
              pointerId: e.pointerId,
              startWorldX: point.x,
              startWorldY: point.y,
              startClientX: e.clientX,
              startClientY: e.clientY,
            });
            return;
          }

          setTool({ kind: "select" });
        };

        const maybeNode = nodeDef.create({ id, x: point.x, y: point.y });
        if (typeof (maybeNode as Promise<DocNode>)?.then === "function") {
          void (maybeNode as Promise<DocNode>)
            .then((resolved) => {
              finalizeAdd(resolved);
            })
            .catch(() => {
              setTool({ kind: "select" });
            });
          return;
        }

        finalizeAdd(maybeNode as DocNode);
      }
    },
    [
      beginPan,
      camera,
      getViewportElement,
      nodeRegistry,
      setDoc,
      setDrag,
      setSelection,
      setTool,
      spaceDown,
      tool,
    ],
  );

  const onNodeClick = React.useCallback(
    (nodeId: string) => {
      if (tool.kind === "connect") {
        if (!tool.fromId) {
          setTool({ ...tool, fromId: nodeId });
          setSelection({ kind: "node", id: nodeId });
          setConnectPreview(getNodeCenter(doc.nodes[nodeId] as DocNode));
          return;
        }

        if (tool.fromId && tool.fromId !== nodeId) {
          const edgeId = newId("edge", new Set(Object.keys(doc.edges)));
          const edge: DocEdge = {
            id: edgeId,
            shape: tool.edge.shape,
            arrow: tool.edge.arrow,
            from: tool.fromId,
            to: nodeId,
            props: {
              color: "#5a75bc",
              width: 2,
              dash: "solid",
              curve: tool.edge.shape === "curve" ? 0.25 : undefined,
            },
          };

          setDoc((d) => ({
            ...d,
            edges: { ...d.edges, [edgeId]: edge },
            edgeOrder: [...d.edgeOrder, edgeId],
          }));
          setSelection({ kind: "edge", id: edgeId });
          setTool({ kind: "select" });
          setConnectPreview(null);
        }
      } else {
        setSelection({ kind: "node", id: nodeId });
      }
    },
    [doc.nodes, setConnectPreview, setDoc, setSelection, setTool, tool],
  );

  React.useEffect(() => {
    if (tool.kind !== "connect") {
      setConnectPreview(null);
      return;
    }
    if (!tool.fromId) {
      setConnectPreview(null);
    }
  }, [setConnectPreview, tool]);

  const onNodeDoubleClick = React.useCallback(
    (nodeId: string) => {
      const node = doc.nodes[nodeId];
      if (!node) return;

      const nodeDef = nodeRegistry.get(node.type);
      if (!nodeDef?.onDoubleClick) return;

      nodeDef.onDoubleClick({
        node: node as never,
        updateNode: (updater) =>
          setDoc((d) => {
            const cur = d.nodes[nodeId];
            if (!cur) return d;
            return {
              ...d,
              nodes: {
                ...d.nodes,
                [nodeId]: updater(cur as never) as DocNode,
              },
            };
          }),
      });
    },
    [doc.nodes, nodeRegistry, setDoc],
  );

  return {
    beginMove,
    beginResize,
    beginPan,
    onCanvasPointerDown,
    onNodeClick,
    onNodeDoubleClick,
  };
}
