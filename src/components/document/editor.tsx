import * as React from "react";

import { createDefaultDocument } from "@/components/document/default-doc";
import { DocumentEditorCanvas } from "@/components/document/editor/canvas";
import { MermaidImportDialog } from "@/components/document/editor/mermaid-dialog";
import {
  DocumentEditorSidePanel,
  type EditorSidePanelMode,
} from "@/components/document/editor/side-panels";
import {
  clamp,
  isMacPlatform,
  isTextInputTarget,
  matchKeybinding,
} from "@/components/document/editor/shared";
import { DocumentEditorToolbar } from "@/components/document/editor/toolbar";
import { useCanvasInteractions } from "@/components/document/editor/use-canvas-interactions";
import { useDocumentIO } from "@/components/document/editor/use-document-io";
import { useEditorRuntime } from "@/components/document/editor/use-editor-runtime";
import type {
  Camera,
  DocEdge,
  DocumentModel,
  DragState,
  Selection,
  Tool,
} from "@/components/document/model";
import { useDocumentStore } from "@/components/document/store";
import { cn } from "@/lib/utils";

export function DocumentEditor({ className }: { className?: string }) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const cameraAnimationFrameRef = React.useRef<number | null>(null);
  const resetStateDocIdRef = React.useRef<string | undefined>(undefined);
  const fallbackDoc = React.useMemo(() => createDefaultDocument(), []);

  const { activeDoc, setActiveDoc } = useDocumentStore();
  const doc = (activeDoc?.doc ?? fallbackDoc) as DocumentModel;
  const setDoc = React.useCallback(
    (next: DocumentModel | ((prev: DocumentModel) => DocumentModel)) => {
      setActiveDoc(next);
    },
    [setActiveDoc],
  );

  const [viewportSize, setViewportSize] = React.useState({ width: 1, height: 1 });
  React.useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setViewportSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [camera, setCamera] = React.useState<Camera>(() => doc.camera);
  const cameraRef = React.useRef(camera);
  const cameraCommitTimerRef = React.useRef<number | null>(null);

  const setCameraState = React.useCallback((next: Camera | ((prev: Camera) => Camera)) => {
    setCamera((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      cameraRef.current = resolved;
      return resolved;
    });
  }, []);

  const commitCamera = React.useCallback(() => {
    const next = cameraRef.current;
    setDoc((prev) => {
      if (
        prev.camera.x === next.x &&
        prev.camera.y === next.y &&
        prev.camera.scale === next.scale
      ) {
        return prev;
      }
      return { ...prev, camera: next };
    });
  }, [setDoc]);

  const scheduleCameraCommit = React.useCallback(
    (delayMs = 150) => {
      if (cameraCommitTimerRef.current != null) {
        window.clearTimeout(cameraCommitTimerRef.current);
      }
      cameraCommitTimerRef.current = window.setTimeout(() => {
        cameraCommitTimerRef.current = null;
        commitCamera();
      }, delayMs);
    },
    [commitCamera],
  );

  const cancelCameraAnimation = React.useCallback(() => {
    if (cameraAnimationFrameRef.current != null) {
      window.cancelAnimationFrame(cameraAnimationFrameRef.current);
      cameraAnimationFrameRef.current = null;
    }
  }, []);

  const [tool, setTool] = React.useState<Tool>({ kind: "select" });
  const [selection, setSelection] = React.useState<Selection>({ kind: "none" });
  const [drag, setDrag] = React.useState<DragState>({ kind: "none" });
  const [spaceDown, setSpaceDown] = React.useState(false);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [connectPreview, setConnectPreview] = React.useState<null | { x: number; y: number }>(null);

  const {
    atlasIOError,
    mermaidDialog,
    mermaidDraft,
    setMermaidDialog,
    setMermaidDraft,
    exportAtlas,
    importAtlas,
    openMermaidImportDialog,
    onMermaidConfirm,
    cancelMermaidAnimation,
  } = useDocumentIO({
    doc,
    camera,
    viewportSize,
    setDoc,
    setSelection,
    setTool,
  });

  React.useEffect(() => {
    if (resetStateDocIdRef.current === activeDoc?.id) {
      return;
    }

    resetStateDocIdRef.current = activeDoc?.id;
    cancelMermaidAnimation();
    cancelCameraAnimation();
    if (cameraCommitTimerRef.current != null) {
      window.clearTimeout(cameraCommitTimerRef.current);
      cameraCommitTimerRef.current = null;
    }
    setSelection({ kind: "none" });
    setTool({ kind: "select" });
    setDrag({ kind: "none" });
    setConnectPreview(null);
    setChatOpen(false);
    setCameraState(doc.camera);
  }, [activeDoc?.id, cancelCameraAnimation, cancelMermaidAnimation, doc.camera, setCameraState]);

  React.useEffect(() => {
    return () => {
      cancelMermaidAnimation();
      cancelCameraAnimation();
      if (cameraCommitTimerRef.current != null) {
        window.clearTimeout(cameraCommitTimerRef.current);
        cameraCommitTimerRef.current = null;
      }
    };
  }, [cancelCameraAnimation, cancelMermaidAnimation]);

  const focusElementReference = React.useCallback(
    (elementId: string) => {
      const viewportEl = viewportRef.current;
      if (!viewportEl) return;

      setChatOpen(true);

      const kind = elementId.startsWith("edge_")
        ? "edge"
        : elementId.startsWith("node_")
          ? "node"
          : null;
      if (!kind) return;

      setSelection(
        kind === "node" ? { kind: "node", id: elementId } : { kind: "edge", id: elementId },
      );

      const selector =
        kind === "node"
          ? `[data-atlas-node-id="${elementId}"]`
          : `[data-atlas-edge-id="${elementId}"]`;
      const target = viewportEl.querySelector<HTMLElement | SVGElement>(selector);
      if (!target) return;

      const centerX = Number(target.getAttribute("data-atlas-center-x"));
      const centerY = Number(target.getAttribute("data-atlas-center-y"));
      if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return;

      const sidePanelEl = viewportEl.parentElement?.querySelector<HTMLElement>(
        '[data-atlas-side-panel="true"]',
      );
      const occludedWidth =
        sidePanelEl && sidePanelEl.offsetParent !== null
          ? sidePanelEl.getBoundingClientRect().width
          : 0;
      const visibleCenterScreenX = Math.max(0, (viewportSize.width - occludedWidth) / 2);
      const visibleCenterScreenY = viewportSize.height / 2;

      const startCamera = cameraRef.current;
      const targetCamera = {
        x: centerX - visibleCenterScreenX / startCamera.scale,
        y: centerY - visibleCenterScreenY / startCamera.scale,
        scale: startCamera.scale,
      };

      cancelCameraAnimation();

      const startAt = performance.now();
      const durationMs = 200;
      const easeOutCubic = (progress: number) => 1 - (1 - progress) ** 3;

      const animate = (timestamp: number) => {
        const progress = Math.min(1, (timestamp - startAt) / durationMs);
        const eased = easeOutCubic(progress);

        setCameraState({
          x: startCamera.x + (targetCamera.x - startCamera.x) * eased,
          y: startCamera.y + (targetCamera.y - startCamera.y) * eased,
          scale: startCamera.scale,
        });

        if (progress < 1) {
          cameraAnimationFrameRef.current = window.requestAnimationFrame(animate);
          return;
        }

        cameraAnimationFrameRef.current = null;
        setCameraState(targetCamera);
        scheduleCameraCommit(0);
      };

      cameraAnimationFrameRef.current = window.requestAnimationFrame(animate);
    },
    [
      cancelCameraAnimation,
      scheduleCameraCommit,
      setCameraState,
      viewportSize.height,
      viewportSize.width,
    ],
  );

  const viewportRect = React.useCallback(
    () => viewportRef.current?.getBoundingClientRect() ?? null,
    [],
  );

  const zoomToAtClient = React.useCallback(
    (zoomFactor: number, clientX?: number, clientY?: number) => {
      const rect = viewportRect();
      setCameraState((prev) => {
        const clamped = clamp(Number((prev.scale * zoomFactor).toFixed(3)), 0.2, 3);
        if (!rect) {
          return { ...prev, scale: clamped };
        }

        const sx = (clientX ?? rect.left + rect.width / 2) - rect.left;
        const sy = (clientY ?? rect.top + rect.height / 2) - rect.top;
        const worldX = prev.x + sx / prev.scale;
        const worldY = prev.y + sy / prev.scale;

        return {
          x: worldX - sx / clamped,
          y: worldY - sy / clamped,
          scale: clamped,
        };
      });
      scheduleCameraCommit(150);
    },
    [scheduleCameraCommit, setCameraState, viewportRect],
  );

  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = Math.exp(-e.deltaY * 0.0012);
      zoomToAtClient(zoomFactor, e.clientX, e.clientY);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomToAtClient]);

  const zoomToCentered = React.useCallback(
    (nextScale: number | ((prev: number) => number)) => {
      setCameraState((prev) => {
        const targetScale = typeof nextScale === "function" ? nextScale(prev.scale) : nextScale;
        const clamped = clamp(Number(targetScale.toFixed(3)), 0.2, 3);

        const sx = viewportSize.width / 2;
        const sy = viewportSize.height / 2;
        const worldX = prev.x + sx / prev.scale;
        const worldY = prev.y + sy / prev.scale;

        return {
          x: worldX - sx / clamped,
          y: worldY - sy / clamped,
          scale: clamped,
        };
      });
      scheduleCameraCommit(150);
    },
    [scheduleCameraCommit, setCameraState, viewportSize.height, viewportSize.width],
  );

  const { pluginHost } = useEditorRuntime({
    doc,
    selection,
    tool,
    camera,
    exportAtlas,
    importAtlas,
    openMermaidImportDialog,
    setDoc,
    setSelection,
    setTool,
    setCameraState,
    scheduleCameraCommit,
    zoomToCentered,
    activeDocId: activeDoc?.id,
  });

  const nodeRegistry = pluginHost.nodeRegistry;
  const addMenuEntries = pluginHost.menus.add;
  const fileMenuEntries = pluginHost.menus.file;
  const editMenuEntries = pluginHost.menus.edit;
  const viewMenuEntries = pluginHost.menus.view;
  const keybindings = pluginHost.keybindings;
  const executeCommand = pluginHost.commands.execute;

  const keybindingsRef = React.useRef(keybindings);
  const executeCommandRef = React.useRef(executeCommand);
  React.useEffect(() => {
    keybindingsRef.current = keybindings;
    executeCommandRef.current = executeCommand;
  }, [executeCommand, keybindings]);

  const { beginMove, beginResize, beginPan, onCanvasPointerDown, onNodeClick, onNodeDoubleClick } =
    useCanvasInteractions({
      doc,
      camera,
      drag,
      tool,
      spaceDown,
      getViewportElement: React.useCallback(() => viewportRef.current, []),
      nodeRegistry,
      setDoc,
      setSelection,
      setTool,
      setDrag,
      setConnectPreview,
      setCameraState,
      scheduleCameraCommit,
    });

  const selectedNodeId = selection.kind === "node" ? selection.id : null;
  const selectedEdgeId = selection.kind === "edge" ? selection.id : null;

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === " ") {
        if (!isTextInputTarget(e.target)) {
          e.preventDefault();
          setSpaceDown(true);
        }
        return;
      }

      const isTyping = isTextInputTarget(e.target);
      const isMac = isMacPlatform();
      for (const kb of keybindingsRef.current) {
        if (isTyping && !kb.allowInTextInput) continue;
        if (!matchKeybinding(kb.keys, e, isMac)) continue;
        if (kb.preventDefault ?? true) e.preventDefault();
        executeCommandRef.current(kb.command);
        return;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") {
        setSpaceDown(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const svgViewBox = React.useMemo(() => {
    const w = viewportSize.width / camera.scale;
    const h = viewportSize.height / camera.scale;
    return `${camera.x} ${camera.y} ${w} ${h}`;
  }, [camera.scale, camera.x, camera.y, viewportSize.height, viewportSize.width]);

  const viewportStyle = React.useMemo(() => {
    const grid = 24;
    if (doc.canvas.background !== "grid") {
      return { backgroundColor: "transparent" } as React.CSSProperties;
    }

    return {
      backgroundColor: "transparent",
      backgroundImage:
        "linear-gradient(to right, rgba(127,127,127,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(127,127,127,0.15) 1px, transparent 1px)",
      backgroundSize: `${grid * camera.scale}px ${grid * camera.scale}px`,
      backgroundPosition: `${-camera.x * camera.scale}px ${-camera.y * camera.scale}px`,
    } as React.CSSProperties;
  }, [camera.scale, camera.x, camera.y, doc.canvas.background]);

  const selectedNode = selectedNodeId ? doc.nodes[selectedNodeId] : null;
  const selectedEdge = selectedEdgeId ? doc.edges[selectedEdgeId] : null;
  const sidePanelMode: EditorSidePanelMode = chatOpen
    ? "chat"
    : selectedNode
      ? "node"
      : selectedEdge
        ? "edge"
        : "none";
  const showSidePanel = sidePanelMode !== "none";

  const deleteSelected = React.useCallback(() => {
    if (selection.kind === "node") {
      const id = selection.id;
      setDoc((d) => {
        const nextNodes = { ...d.nodes };
        delete nextNodes[id];

        const nextEdges: Record<string, DocEdge> = {};
        const nextEdgeOrder: string[] = [];
        for (const edgeId of d.edgeOrder) {
          const edge = d.edges[edgeId];
          if (!edge) continue;
          if (edge.from === id || edge.to === id) continue;
          nextEdges[edgeId] = edge;
          nextEdgeOrder.push(edgeId);
        }

        return {
          ...d,
          nodes: nextNodes,
          nodeOrder: d.nodeOrder.filter((nodeId) => nodeId !== id),
          edges: nextEdges,
          edgeOrder: nextEdgeOrder,
        };
      });
      setSelection({ kind: "none" });
      return;
    }

    if (selection.kind === "edge") {
      const edgeId = selection.id;
      setDoc((d) => {
        const nextEdges = { ...d.edges };
        delete nextEdges[edgeId];
        return {
          ...d,
          edges: nextEdges,
          edgeOrder: d.edgeOrder.filter((id) => id !== edgeId),
        };
      });
      setSelection({ kind: "none" });
    }
  }, [selection, setDoc]);

  if (!activeDoc) {
    return null;
  }

  return (
    <div className={cn("flex h-full min-h-0 w-full min-w-0 flex-col", className)}>
      <DocumentEditorToolbar
        addMenuEntries={addMenuEntries}
        fileMenuEntries={fileMenuEntries}
        editMenuEntries={editMenuEntries}
        viewMenuEntries={viewMenuEntries}
        onExecuteCommand={executeCommand}
        onReset={() => {
          setDoc(createDefaultDocument(doc.title || "ドキュメント"));
          setSelection({ kind: "none" });
          setTool({ kind: "select" });
          setCameraState({ x: 0, y: 0, scale: 1 });
        }}
        onZoomOut={() => zoomToCentered(camera.scale - 0.1)}
        onZoomIn={() => zoomToCentered(camera.scale + 0.1)}
        zoomPercent={Math.round(camera.scale * 100)}
        tool={tool}
        onSelectTool={() => setTool({ kind: "select" })}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((prev) => !prev)}
      />

      <div className="relative flex min-h-0 flex-1">
        <DocumentEditorCanvas
          viewportRef={viewportRef}
          viewportStyle={viewportStyle}
          camera={camera}
          viewportSize={viewportSize}
          doc={doc}
          tool={tool}
          connectPreview={connectPreview}
          setConnectPreview={setConnectPreview}
          svgViewBox={svgViewBox}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          nodeRegistry={nodeRegistry}
          onCanvasPointerDown={onCanvasPointerDown}
          onNodePointerDown={(e, nodeId) => {
            if (e.button === 1 || spaceDown) {
              beginPan(e);
              return;
            }
            if (tool.kind === "select") {
              onNodeClick(nodeId);
              beginMove(e, nodeId);
              return;
            }

            e.preventDefault();
            e.stopPropagation();
            onNodeClick(nodeId);
          }}
          onNodeResizePointerDown={(e, nodeId) => {
            if (tool.kind !== "select") {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            beginResize(e, nodeId);
          }}
          onNodeDoubleClick={onNodeDoubleClick}
          onEdgePointerDown={(edgeId, e) => {
            e.preventDefault();
            e.stopPropagation();
            setSelection({ kind: "edge", id: edgeId });
          }}
        />

        <DocumentEditorSidePanel
          visible={showSidePanel}
          mode={sidePanelMode}
          doc={doc}
          activeDocId={activeDoc?.id}
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          nodeRegistry={nodeRegistry}
          setDoc={setDoc}
          onDeleteSelected={deleteSelected}
          atlasIOError={atlasIOError}
          onElementReferenceActivate={focusElementReference}
        />
      </div>

      <MermaidImportDialog
        open={mermaidDialog != null}
        draft={mermaidDraft}
        error={mermaidDialog?.error ?? null}
        onDraftChange={setMermaidDraft}
        onClose={() => setMermaidDialog(null)}
        onConfirm={onMermaidConfirm}
      />
    </div>
  );
}
