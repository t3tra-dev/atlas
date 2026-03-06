import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/components/ui/menubar";
import { cn } from "@/lib/utils";

import { createDocumentSDK } from "@/components/document/sdk";
import type { GestureRegister, NodeTypeDef } from "@/components/document/sdk";
import {
  ATLAS_FILE_EXTENSION,
  ATLAS_MIME_TYPE,
  createAtlasBlob,
  decodeAtlasDocument,
} from "@/components/document/atlas-binary";
import { createPluginHost } from "@/components/document/plugin-system";
import { useDocumentStore } from "@/components/document/store";
import { createDefaultDocument } from "@/components/document/default-doc";
import { BuiltinPlugin } from "@/plugins/builtin";
import { builtinGestureRegisters } from "@/plugins/builtin/gestures";
import { buildMermaidElements } from "@/plugins/builtin/mermaid";
import { subscribeGestureFrame } from "@/components/vision/gesture-frame-bus";

import type { MenuEntry } from "@/plugin";

import type {
  Camera,
  DocEdge,
  DocNode,
  DocumentModel,
  DragState,
  EdgeShape,
  Selection,
  Tool,
} from "@/components/document/model";

function isTextInputTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  return false;
}

function normalizeHotkeyKey(k: string) {
  const key = k.toLowerCase();
  if (key === " ") return "space";
  if (key === "esc") return "escape";
  return key;
}

function matchKeybinding(keys: string, e: KeyboardEvent, isMac: boolean): boolean {
  const parts = keys
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);

  const wants = new Set(parts);
  const keyPart = parts.find(
    (p) => !["mod", "meta", "cmd", "ctrl", "shift", "alt", "option"].includes(p),
  );
  if (!keyPart) return false;

  const wantShift = wants.has("shift");
  const wantAlt = wants.has("alt") || wants.has("option");
  const wantCtrl = wants.has("ctrl");
  const wantMeta = wants.has("meta") || wants.has("cmd");
  const wantMod = wants.has("mod");

  const modOk = !wantMod || (isMac ? e.metaKey : e.ctrlKey);
  if (!modOk) return false;

  if (wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;

  if (wantCtrl && !e.ctrlKey) return false;
  if (wantMeta && !e.metaKey) return false;

  const wantsAnyCtrlMeta = wantCtrl || wantMeta || wantMod;
  if (!wantsAnyCtrlMeta && (e.ctrlKey || e.metaKey)) return false;

  return normalizeHotkeyKey(e.key) === normalizeHotkeyKey(keyPart);
}

function isMacPlatform() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function newId(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
  return `${prefix}_${String(random).replaceAll("-", "")}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalizeHexColor(color: string): string | null {
  const trimmed = color.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) return trimmed;

  // rgb/rgba -> #rrggbb (ignores alpha)
  const m = trimmed
    .replaceAll(" ", "")
    .match(/^rgba?\((\d{1,3}),(\d{1,3}),(\d{1,3})(?:,([0-9.]+))?\)$/);
  if (!m) return null;
  const r = clamp(Number(m[1]), 0, 255);
  const g = clamp(Number(m[2]), 0, 255);
  const b = clamp(Number(m[3]), 0, 255);
  const to2 = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

function getNodeCenter(node: DocNode) {
  return { x: node.x + node.w / 2, y: node.y + node.h / 2 };
}

type ConnectionShape = "rect" | "ellipse" | "diamond";

function getNodeConnectionShape(node: DocNode): ConnectionShape {
  if (node.type === "shape") {
    const shape = (node.props as { shape?: string }).shape;
    if (shape === "diamond") return "diamond";
    if (shape === "circle" || shape === "doublecircle") return "ellipse";
    return "rect";
  }
  return "rect";
}

function getNodeConnectionPoint(node: DocNode, toward: { x: number; y: number }) {
  const center = getNodeCenter(node);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;

  const halfW = Math.max(1, node.w / 2);
  const halfH = Math.max(1, node.h / 2);
  const shape = getNodeConnectionShape(node);

  if (shape === "diamond") {
    const denom = Math.abs(dx) / halfW + Math.abs(dy) / halfH;
    const scale = denom > 0 ? 1 / denom : 1;
    return { x: center.x + dx * scale, y: center.y + dy * scale };
  }

  let scale = 1;
  if (shape === "ellipse") {
    const denom = Math.sqrt((dx * dx) / (halfW * halfW) + (dy * dy) / (halfH * halfH));
    scale = denom > 0 ? 1 / denom : 1;
  } else {
    const denom = Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);
    scale = denom > 0 ? 1 / denom : 1;
  }

  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function computeBoundsFromNodes(nodes: Record<string, DocNode>) {
  let bounds: null | {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } = null;
  for (const node of Object.values(nodes)) {
    if (!bounds) {
      bounds = {
        minX: node.x,
        minY: node.y,
        maxX: node.x + node.w,
        maxY: node.y + node.h,
      };
      continue;
    }
    bounds = {
      minX: Math.min(bounds.minX, node.x),
      minY: Math.min(bounds.minY, node.y),
      maxX: Math.max(bounds.maxX, node.x + node.w),
      maxY: Math.max(bounds.maxY, node.y + node.h),
    };
  }
  return bounds;
}

function sanitizeDocumentNameForFile(title: string): string {
  const trimmed = title.trim();
  const base = trimmed || "document";
  const normalized = base
    .replace(/[\\/:*?"<>|]/g, "_")
    .replaceAll("\n", " ")
    .trim();
  return normalized || "document";
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

function pickAtlasFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `${ATLAS_FILE_EXTENSION},${ATLAS_MIME_TYPE},application/octet-stream`;
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

function toDocPoint(e: React.PointerEvent, viewport: HTMLDivElement, camera: Camera) {
  const rect = viewport.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const x = camera.x + sx / camera.scale;
  const y = camera.y + sy / camera.scale;
  return { x, y };
}

function computeEdgePathFromPoints(
  shape: EdgeShape,
  a: { x: number; y: number },
  b: { x: number; y: number },
  curveStrength = 0.25,
) {
  if (shape === "line") {
    return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  }

  // curve
  const { c1x, c1y, c2x, c2y } = computeCurveControlPoints(a, b, curveStrength);
  // NOTE: keep numbers separated by spaces only (no commas) so scaling remains simple.
  return `M ${a.x} ${a.y} C ${c1x} ${c1y} ${c2x} ${c2y} ${b.x} ${b.y}`;
}

function computeCurveControlPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
  curveStrength: number,
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const strength = clamp(curveStrength, 0.05, 0.6);
  // perpendicular bend
  const nx = (-dy / dist) * Math.min(160, dist * strength);
  const ny = (dx / dist) * Math.min(160, dist * strength);

  const c1x = a.x + dx * 0.35 + nx;
  const c1y = a.y + dy * 0.35 + ny;
  const c2x = a.x + dx * 0.65 + nx;
  const c2y = a.y + dy * 0.65 + ny;
  return { c1x, c1y, c2x, c2y };
}

function computeEdgePath(edge: DocEdge, fromNode: DocNode, toNode: DocNode) {
  const toCenter = getNodeCenter(toNode);
  const fromCenter = getNodeCenter(fromNode);
  const a = getNodeConnectionPoint(fromNode, toCenter);
  const b = getNodeConnectionPoint(toNode, fromCenter);
  return computeEdgePathFromPoints(edge.shape, a, b, edge.props.curve ?? 0.25);
}

function computeEdgeLabelPosition(edge: DocEdge, fromNode: DocNode, toNode: DocNode) {
  const toCenter = getNodeCenter(toNode);
  const fromCenter = getNodeCenter(fromNode);
  const a = getNodeConnectionPoint(fromNode, toCenter);
  const b = getNodeConnectionPoint(toNode, fromCenter);

  if (edge.shape === "line") {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  const { c1x, c1y, c2x, c2y } = computeCurveControlPoints(a, b, edge.props.curve ?? 0.25);
  const t = 0.5;
  const mt = 1 - t;
  const x = mt ** 3 * a.x + 3 * mt ** 2 * t * c1x + 3 * mt * t ** 2 * c2x + t ** 3 * b.x;
  const y = mt ** 3 * a.y + 3 * mt ** 2 * t * c1y + 3 * mt * t ** 2 * c2y + t ** 3 * b.y;
  return { x, y };
}

function NodeView({
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

export function DocumentEditor({ className }: { className?: string }) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);

  const { activeDoc, setActiveDoc } = useDocumentStore();
  const doc = activeDoc?.doc as DocumentModel;
  const setDoc = React.useCallback(
    (next: DocumentModel | ((prev: DocumentModel) => DocumentModel)) => {
      setActiveDoc(next);
    },
    [setActiveDoc],
  );

  const [viewportSize, setViewportSize] = React.useState({
    width: 1,
    height: 1,
  });
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
  const [tool, setTool] = React.useState<Tool>({ kind: "select" });
  const [selection, setSelection] = React.useState<Selection>({ kind: "none" });
  const [drag, setDrag] = React.useState<DragState>({ kind: "none" });

  const [spaceDown, setSpaceDown] = React.useState(false);

  const [connectPreview, setConnectPreview] = React.useState<null | {
    x: number;
    y: number;
  }>(null);

  const [atlasIOError, setAtlasIOError] = React.useState<string | null>(null);

  const [mermaidDialog, setMermaidDialog] = React.useState<null | {
    error: string | null;
  }>(null);
  const [mermaidDraft, setMermaidDraft] = React.useState<string>("");

  React.useEffect(() => {
    if (cameraCommitTimerRef.current != null) {
      window.clearTimeout(cameraCommitTimerRef.current);
      cameraCommitTimerRef.current = null;
    }
    setSelection({ kind: "none" });
    setTool({ kind: "select" });
    setDrag({ kind: "none" });
    setConnectPreview(null);
    setCameraState(doc.camera);
  }, [activeDoc?.id, doc.camera, setCameraState]);

  React.useEffect(() => {
    return () => {
      if (cameraCommitTimerRef.current != null) {
        window.clearTimeout(cameraCommitTimerRef.current);
        cameraCommitTimerRef.current = null;
      }
    };
  }, []);

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

  const handleWheel = React.useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY;
      const zoomFactor = Math.exp(-delta * 0.0012);
      zoomToAtClient(zoomFactor, e.clientX, e.clientY);
    },
    [zoomToAtClient],
  );

  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => handleWheel(event);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [handleWheel]);

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

  const exportAtlas = React.useCallback(async () => {
    try {
      const targetDoc: DocumentModel = { ...doc, camera };
      const blob = createAtlasBlob(targetDoc);
      const fileName = `${sanitizeDocumentNameForFile(targetDoc.title)}${ATLAS_FILE_EXTENSION}`;
      downloadBlob(blob, fileName);
      setAtlasIOError(null);
    } catch (error) {
      setAtlasIOError(
        error instanceof Error
          ? `ATLAS書き出しに失敗しました: ${error.message}`
          : "ATLAS書き出しに失敗しました",
      );
    }
  }, [camera, doc]);

  const importAtlas = React.useCallback(async () => {
    try {
      const file = await pickAtlasFile();
      if (!file) return;

      const buffer = await file.arrayBuffer();
      const parsed = decodeAtlasDocument(buffer);
      setDoc(parsed);
      setSelection({ kind: "none" });
      setTool({ kind: "select" });
      setAtlasIOError(null);
    } catch (error) {
      setAtlasIOError(
        error instanceof Error
          ? `ATLAS読み込みに失敗しました: ${error.message}`
          : "ATLAS読み込みに失敗しました",
      );
    }
  }, [setDoc]);

  const openMermaidImportDialog = React.useCallback(() => {
    const flowchartSource: string = `flowchart TD
    A[Christmas] -->|Get money| B(Go shopping)
    B --> C{Let me think}
    C -->|One| D[Laptop]
    C -->|Two| E[iPhone]
    C -->|Three| F[fa:fa-car Car]`;
    setMermaidDraft(flowchartSource.trim());
    setMermaidDialog({ error: null });
  }, []);

  const sdk = React.useMemo(
    () =>
      createDocumentSDK({
        ui: { exportAtlas, importAtlas, openMermaidImportDialog },
        doc: {
          get: () => doc,
          set: (next) => setDoc(next),
          update: (updater) => setDoc((prev) => updater(prev)),
        },
        selection: {
          get: () => selection,
          set: (next) => setSelection(next),
          clear: () => setSelection({ kind: "none" }),
        },
        tool: {
          get: () => tool,
          set: (next) => setTool(next),
        },
        camera: {
          get: () => camera,
          set: (next) => {
            setCameraState(next);
            scheduleCameraCommit(150);
          },
        },
        viewport: {
          zoomTo: (nextScale) => zoomToCentered(nextScale),
          zoomBy: (delta) => zoomToCentered((prev) => prev + delta),
        },
      }),
    [
      camera,
      doc,
      exportAtlas,
      importAtlas,
      openMermaidImportDialog,
      selection,
      setDoc,
      setCameraState,
      scheduleCameraCommit,
      tool,
      zoomToCentered,
    ],
  );

  const sdkRef = React.useRef(sdk);
  const scheduleCameraCommitRef = React.useRef(scheduleCameraCommit);
  React.useEffect(() => {
    sdkRef.current = sdk;
  }, [sdk]);
  React.useEffect(() => {
    scheduleCameraCommitRef.current = scheduleCameraCommit;
  }, [scheduleCameraCommit]);

  const gestureRegistersRef = React.useRef<Array<GestureRegister> | null>(null);
  if (!gestureRegistersRef.current) {
    gestureRegistersRef.current = builtinGestureRegisters();
  }

  React.useEffect(() => {
    const unsubscribe = subscribeGestureFrame((frame) => {
      const registers = gestureRegistersRef.current ?? [];
      const ctx = {
        sdk: sdkRef.current,
        scheduleCameraCommit: scheduleCameraCommitRef.current,
      };
      for (const register of registers) {
        register.onFrame(frame, ctx);
      }
    });

    return () => {
      unsubscribe();
      const registers = gestureRegistersRef.current ?? [];
      const ctx = {
        sdk: sdkRef.current,
        scheduleCameraCommit: scheduleCameraCommitRef.current,
      };
      for (const register of registers) {
        register.onReset?.(ctx);
      }
    };
  }, []);

  React.useEffect(() => {
    const registers = gestureRegistersRef.current ?? [];
    const ctx = {
      sdk: sdkRef.current,
      scheduleCameraCommit: scheduleCameraCommitRef.current,
    };
    for (const register of registers) {
      register.onReset?.(ctx);
    }
  }, [activeDoc?.id]);

  const pluginHost = React.useMemo(() => createPluginHost([BuiltinPlugin], { sdk }), [sdk]);
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

  const selectedNodeId = selection.kind === "node" ? selection.id : null;
  const selectedEdgeId = selection.kind === "edge" ? selection.id : null;

  // Keyboard shortcuts
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === " ") {
        setSpaceDown(true);
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
    [doc.nodes],
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
    [doc.nodes],
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
    [camera.x, camera.y],
  );

  // Dragging/resizing must work even when the pointer leaves the node.
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
      }

      if (drag.kind === "drawShape") {
        const curWorldX = drag.startWorldX + dx;
        const curWorldY = drag.startWorldY + dy;
        const rawW = curWorldX - drag.startWorldX;
        const rawH = curWorldY - drag.startWorldY;

        const absW = Math.abs(rawW);
        const absH = Math.abs(rawH);

        const lock = (e as PointerEvent).shiftKey;
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
          // treat as click placement (default size centered)
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
  }, [camera.scale, drag, nodeRegistry, scheduleCameraCommit, setCameraState, setDoc]);

  const onCanvasPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (!viewportRef.current) return;

      if (e.button === 1 || spaceDown) {
        beginPan(e);
        return;
      }

      // Clicking empty canvas clears selection
      if (tool.kind === "select") {
        // drag -> pan, click -> clear selection
        beginPan(e, { clickClearsSelection: true });
        return;
      }

      if (tool.kind === "add") {
        const point = toDocPoint(e, viewportRef.current, camera);
        const id = newId("node");

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
    [beginPan, camera, nodeRegistry, setDoc, spaceDown, tool],
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
          const edgeId = newId("edge");
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
    [doc.nodes, setDoc, tool],
  );

  React.useEffect(() => {
    if (tool.kind !== "connect") {
      setConnectPreview(null);
      return;
    }
    if (!tool.fromId) {
      setConnectPreview(null);
    }
  }, [tool]);

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

  const onMermaidConfirm = React.useCallback(() => {
    const source = mermaidDraft.trim();
    if (!source) {
      setMermaidDialog({ error: "Mermaidコードを入力してください" });
      return;
    }

    const result = buildMermaidElements(source, {
      existingNodeIds: new Set(Object.keys(doc.nodes)),
      existingEdgeIds: new Set(Object.keys(doc.edges)),
      idPrefix: "mmd_",
    });

    if (result.nodeOrder.length === 0) {
      setMermaidDialog({ error: "ノードが見つかりませんでした" });
      return;
    }

    setDoc((d) => {
      const nextNodes = { ...d.nodes, ...result.nodes };
      const nextEdges = { ...d.edges, ...result.edges };
      const nodeOrder = [...d.nodeOrder, ...result.nodeOrder];
      const edgeOrder = [...d.edgeOrder, ...result.edgeOrder];

      const bounds = computeBoundsFromNodes(nextNodes);
      if (!bounds) {
        return {
          ...d,
          nodes: nextNodes,
          nodeOrder,
          edges: nextEdges,
          edgeOrder,
        };
      }

      const padding = 200;
      const nextWidth = Math.max(d.canvas.width, bounds.maxX - bounds.minX + padding * 2);
      const nextHeight = Math.max(d.canvas.height, bounds.maxY - bounds.minY + padding * 2);

      return {
        ...d,
        nodes: nextNodes,
        nodeOrder,
        edges: nextEdges,
        edgeOrder,
        canvas: { ...d.canvas, width: nextWidth, height: nextHeight },
      };
    });

    setSelection({ kind: "none" });
    setTool({ kind: "select" });
    setMermaidDialog(null);
  }, [doc.edges, doc.nodes, mermaidDraft, setDoc]);

  const selectedNode = selectedNodeId ? doc.nodes[selectedNodeId] : null;
  const selectedEdge = selectedEdgeId ? doc.edges[selectedEdgeId] : null;
  const hasSelection = Boolean(selectedNode || selectedEdge);

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
          nodeOrder: d.nodeOrder.filter((x) => x !== id),
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
          edgeOrder: d.edgeOrder.filter((x) => x !== edgeId),
        };
      });
      setSelection({ kind: "none" });
    }
  }, [selection, setDoc]);

  const renderMenuEntries = React.useCallback(
    function renderMenuEntries(entries: Array<MenuEntry>, keyPrefix: string) {
      return entries.map((entry, i) => {
        if (entry.kind === "separator") {
          return <MenubarSeparator key={`${keyPrefix}-sep-${i}`} />;
        }

        if (entry.kind === "submenu") {
          const key = entry.id ?? `${keyPrefix}-submenu-${i}`;
          return (
            <MenubarSub key={key}>
              <MenubarSubTrigger disabled={entry.disabled}>{entry.label}</MenubarSubTrigger>
              <MenubarSubContent>
                {renderMenuEntries(entry.entries, `${keyPrefix}-${key}`)}
              </MenubarSubContent>
            </MenubarSub>
          );
        }

        const key = entry.id ?? `${keyPrefix}-item-${i}`;
        return (
          <MenubarItem
            key={key}
            onSelect={() => {
              if (entry.onSelect) return entry.onSelect();
              if (entry.command) return executeCommand(entry.command);
            }}
            variant={entry.variant ?? "default"}
            disabled={entry.disabled}
          >
            {entry.label}
            {entry.shortcut ? <MenubarShortcut>{entry.shortcut}</MenubarShortcut> : null}
          </MenubarItem>
        );
      });
    },
    [executeCommand],
  );

  if (!activeDoc) {
    return null;
  }

  return (
    <div className={cn("flex h-full min-h-0 w-full min-w-0 flex-col", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
        <Menubar className="h-9">
          <MenubarMenu>
            <MenubarTrigger>追加</MenubarTrigger>
            <MenubarContent>{renderMenuEntries(addMenuEntries, "add")}</MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>ファイル</MenubarTrigger>
            <MenubarContent>
              {renderMenuEntries(fileMenuEntries, "file")}

              {fileMenuEntries.length ? <MenubarSeparator /> : null}
              <MenubarItem
                variant="destructive"
                onSelect={() => {
                  setDoc(createDefaultDocument(doc.title || "ドキュメント"));
                  setSelection({ kind: "none" });
                  setTool({ kind: "select" });
                  setCameraState({ x: 0, y: 0, scale: 1 });
                }}
              >
                リセット
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>編集</MenubarTrigger>
            <MenubarContent>{renderMenuEntries(editMenuEntries, "edit")}</MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>表示</MenubarTrigger>
            <MenubarContent>{renderMenuEntries(viewMenuEntries, "view")}</MenubarContent>
          </MenubarMenu>
        </Menubar>

        <div className="ml-2 flex items-center gap-1">
          <Button
            size="sm"
            variant={tool.kind === "select" ? "default" : "outline"}
            onClick={() => setTool({ kind: "select" })}
          >
            選択
          </Button>
          {tool.kind === "add" ? (
            <div className="text-xs text-muted-foreground">配置モード</div>
          ) : null}
          {tool.kind === "connect" ? (
            <div className="text-xs text-muted-foreground">接続モード</div>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => zoomToCentered(camera.scale - 0.1)}>
              −
            </Button>
            <div className="min-w-14 text-center text-xs tabular-nums">
              {Math.round(camera.scale * 100)}%
            </div>
            <Button size="sm" variant="outline" onClick={() => zoomToCentered(camera.scale + 0.1)}>
              ＋
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            {spaceDown ? "パン: Space+ドラッグ" : "パン: Space+ドラッグ / 中クリック"}
          </div>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
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
                const labelPos = labelText
                  ? computeEdgeLabelPosition(edge, fromNode, toNode)
                  : null;
                const labelWidth = labelText
                  ? Math.min(240, Math.max(44, labelText.length * 7 + 16))
                  : 0;
                const labelHeight = labelText ? 24 : 0;

                return (
                  <g key={edgeId}>
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
                      style={{ cursor: "pointer" }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSelection({ kind: "edge", id: edgeId });
                      }}
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
                    const markerStart =
                      tool.edge.arrow === "both" ? "url(#arrow-start)" : undefined;
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
                  node={{
                    ...node,
                    x: screenX / camera.scale,
                    y: screenY / camera.scale,
                    w: screenW / camera.scale,
                    h: screenH / camera.scale,
                  }}
                  nodeDef={nodeDef}
                  selected={selected}
                  scale={camera.scale}
                  onPointerDown={(e) => {
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
                  onResizeHandlePointerDown={(e) => {
                    if (tool.kind !== "select") {
                      e.preventDefault();
                      e.stopPropagation();
                      return;
                    }
                    beginResize(e, nodeId);
                  }}
                  onDoubleClick={() => onNodeDoubleClick(nodeId)}
                />
              );
            })}
          </div>
        </div>

        {
          <div
            className={cn(
              "absolute right-0 top-0 hidden h-full w-[320px] border-l bg-background p-3 transition-opacity duration-150 md:block",
              hasSelection ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <div className="text-sm font-semibold">プロパティ</div>

            {selectedNode ? (
              <div className="mt-3 text-xs text-muted-foreground">
                クリックで選択、ドラッグで移動、右下ハンドルでリサイズ。
                <br />
                ダブルクリックでテキスト/画像ファイルを編集。
                <br />
                関係(矢印)は「関係ツール→始点ノード→終点ノード」。
              </div>
            ) : null}

            <div className="mt-4">
              <div className="text-xs font-medium text-muted-foreground">選択</div>
              <div className="mt-1 text-sm">
                {selection.kind === "none" && "なし"}
                {selection.kind === "node" && `ノード: ${selection.id}`}
                {selection.kind === "edge" && `関係: ${selection.id}`}
              </div>
            </div>

            {selectedNode ? (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <InputGroup label="X">
                    <Input
                      inputMode="numeric"
                      value={String(Math.round(selectedNode.x))}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (!Number.isFinite(next)) return;
                        setDoc((d) => ({
                          ...d,
                          nodes: {
                            ...d.nodes,
                            [selectedNode.id]: { ...selectedNode, x: next },
                          },
                        }));
                      }}
                    />
                  </InputGroup>
                  <InputGroup label="Y">
                    <Input
                      inputMode="numeric"
                      value={String(Math.round(selectedNode.y))}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (!Number.isFinite(next)) return;
                        setDoc((d) => ({
                          ...d,
                          nodes: {
                            ...d.nodes,
                            [selectedNode.id]: { ...selectedNode, y: next },
                          },
                        }));
                      }}
                    />
                  </InputGroup>
                  <InputGroup label="W">
                    <Input
                      inputMode="numeric"
                      value={String(Math.round(selectedNode.w))}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (!Number.isFinite(next)) return;
                        setDoc((d) => ({
                          ...d,
                          nodes: {
                            ...d.nodes,
                            [selectedNode.id]: {
                              ...selectedNode,
                              w: clamp(next, 24, 3200),
                            },
                          },
                        }));
                      }}
                    />
                  </InputGroup>
                  <InputGroup label="H">
                    <Input
                      inputMode="numeric"
                      value={String(Math.round(selectedNode.h))}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (!Number.isFinite(next)) return;
                        setDoc((d) => ({
                          ...d,
                          nodes: {
                            ...d.nodes,
                            [selectedNode.id]: {
                              ...selectedNode,
                              h: clamp(next, 24, 3200),
                            },
                          },
                        }));
                      }}
                    />
                  </InputGroup>
                </div>

                {(() => {
                  const nodeDef = nodeRegistry.get(selectedNode.type);
                  if (!nodeDef?.inspector) return null;
                  return nodeDef.inspector({
                    node: selectedNode as never,
                    updateNode: (updater) =>
                      setDoc((d) => {
                        const cur = d.nodes[selectedNode.id];
                        if (!cur) return d;
                        return {
                          ...d,
                          nodes: {
                            ...d.nodes,
                            [selectedNode.id]: updater(cur as never) as DocNode,
                          },
                        };
                      }),
                  });
                })()}

                <Button
                  variant="destructive"
                  onClick={() => {
                    setDoc((d) => {
                      const nextNodes = { ...d.nodes };
                      delete nextNodes[selectedNode.id];

                      const nextEdges: Record<string, DocEdge> = {};
                      const nextEdgeOrder: string[] = [];
                      for (const edgeId of d.edgeOrder) {
                        const edge = d.edges[edgeId];
                        if (!edge) continue;
                        if (edge.from === selectedNode.id || edge.to === selectedNode.id) continue;
                        nextEdges[edgeId] = edge;
                        nextEdgeOrder.push(edgeId);
                      }

                      return {
                        ...d,
                        nodes: nextNodes,
                        nodeOrder: d.nodeOrder.filter((x) => x !== selectedNode.id),
                        edges: nextEdges,
                        edgeOrder: nextEdgeOrder,
                      };
                    });
                    setSelection({ kind: "none" });
                  }}
                >
                  ノード削除
                </Button>
              </div>
            ) : null}

            {selectedEdge ? (
              <div className="mt-4 space-y-3">
                <div className="text-sm font-semibold">関係プロパティ</div>

                <InputGroup label="線分">
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant={selectedEdge.shape === "line" ? "default" : "outline"}
                      onClick={() =>
                        setDoc((d) => ({
                          ...d,
                          edges: {
                            ...d.edges,
                            [selectedEdge.id]: {
                              ...selectedEdge,
                              shape: "line",
                            },
                          },
                        }))
                      }
                    >
                      直線
                    </Button>
                    <Button
                      size="sm"
                      variant={selectedEdge.shape === "curve" ? "default" : "outline"}
                      onClick={() =>
                        setDoc((d) => ({
                          ...d,
                          edges: {
                            ...d.edges,
                            [selectedEdge.id]: {
                              ...selectedEdge,
                              shape: "curve",
                            },
                          },
                        }))
                      }
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
                      onClick={() =>
                        setDoc((d) => ({
                          ...d,
                          edges: {
                            ...d.edges,
                            [selectedEdge.id]: {
                              ...selectedEdge,
                              arrow: "none",
                            },
                          },
                        }))
                      }
                    >
                      なし
                    </Button>
                    <Button
                      size="sm"
                      variant={selectedEdge.arrow === "end" ? "default" : "outline"}
                      onClick={() =>
                        setDoc((d) => ({
                          ...d,
                          edges: {
                            ...d.edges,
                            [selectedEdge.id]: {
                              ...selectedEdge,
                              arrow: "end",
                            },
                          },
                        }))
                      }
                    >
                      方
                    </Button>
                    <Button
                      size="sm"
                      variant={selectedEdge.arrow === "both" ? "default" : "outline"}
                      onClick={() =>
                        setDoc((d) => ({
                          ...d,
                          edges: {
                            ...d.edges,
                            [selectedEdge.id]: {
                              ...selectedEdge,
                              arrow: "both",
                            },
                          },
                        }))
                      }
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
                          setDoc((d) => ({
                            ...d,
                            edges: {
                              ...d.edges,
                              [selectedEdge.id]: {
                                ...selectedEdge,
                                props: {
                                  ...selectedEdge.props,
                                  curve: clamp(next, 0.05, 0.6),
                                },
                              },
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
                        setDoc((d) => ({
                          ...d,
                          edges: {
                            ...d.edges,
                            [selectedEdge.id]: {
                              ...selectedEdge,
                              props: {
                                ...selectedEdge.props,
                                width: clamp(next, 1, 24),
                              },
                            },
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
                          setDoc((d) => ({
                            ...d,
                            edges: {
                              ...d.edges,
                              [selectedEdge.id]: {
                                ...selectedEdge,
                                props: { ...selectedEdge.props, dash: "solid" },
                              },
                            },
                          }))
                        }
                      >
                        実線
                      </Button>
                      <Button
                        size="sm"
                        variant={selectedEdge.props.dash === "dashed" ? "default" : "outline"}
                        onClick={() =>
                          setDoc((d) => ({
                            ...d,
                            edges: {
                              ...d.edges,
                              [selectedEdge.id]: {
                                ...selectedEdge,
                                props: {
                                  ...selectedEdge.props,
                                  dash: "dashed",
                                },
                              },
                            },
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
                        setDoc((d) => ({
                          ...d,
                          edges: {
                            ...d.edges,
                            [selectedEdge.id]: {
                              ...selectedEdge,
                              props: { ...selectedEdge.props, color: next },
                            },
                          },
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
                      setDoc((d) => ({
                        ...d,
                        edges: {
                          ...d.edges,
                          [selectedEdge.id]: {
                            ...selectedEdge,
                            props: {
                              ...selectedEdge.props,
                              label: next.trim() ? next : undefined,
                            },
                          },
                        },
                      }));
                    }}
                  />
                </InputGroup>

                <Button variant="destructive" onClick={() => deleteSelected()}>
                  関係削除
                </Button>
              </div>
            ) : null}

            <div className="mt-6">
              <div className="text-xs font-medium text-muted-foreground">ATLAS</div>
              <div className="mt-1 text-xs text-muted-foreground">
                保存はIndexedDB（.atlasバイナリ）。Cmd/Ctrl+Sで書き出し。
              </div>
              {atlasIOError ? (
                <div className="mt-2 text-xs text-destructive">{atlasIOError}</div>
              ) : null}
            </div>
          </div>
        }
      </div>

      <Dialog
        open={mermaidDialog != null}
        onOpenChange={(open) => {
          if (!open) setMermaidDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Mermaid読み込み</DialogTitle>
            <DialogDescription>
              Mermaidコードを貼り付けてノードと関係を追加します。
            </DialogDescription>
          </DialogHeader>

          <InputGroup
            label={<Label htmlFor="mermaid-input">Mermaidコード</Label>}
            description="flowchart / graph / mindmap 記法に対応"
          >
            <textarea
              id="mermaid-input"
              className="h-56 w-full resize-none rounded-md border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
              value={mermaidDraft}
              onChange={(e) => {
                setMermaidDraft(e.target.value);
                if (mermaidDialog?.error) {
                  setMermaidDialog({ error: null });
                }
              }}
              placeholder="flowchart TD\n  A --> B"
            />
          </InputGroup>

          {mermaidDialog?.error ? (
            <div className="text-sm text-destructive">{mermaidDialog.error}</div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMermaidDialog(null)}>
              キャンセル
            </Button>
            <Button onClick={onMermaidConfirm}>読み込み</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
