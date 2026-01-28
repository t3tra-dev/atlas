import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup } from "@/components/ui/input-group";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { createDocumentSdk } from "@/components/document/sdk";
import type { NodeTypeDefinition } from "@/components/document/sdk";
import { createPluginHost } from "@/components/document/plugin-system";
import { BuiltinPlugin } from "@/plugins/builtin";

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
import { STORAGE_KEY } from "@/components/document/model";

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

function matchKeybinding(
  keys: string,
  e: KeyboardEvent,
  isMac: boolean,
): boolean {
  const parts = keys
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);

  const wants = new Set(parts);
  const keyPart = parts.find(
    (p) =>
      !["mod", "meta", "cmd", "ctrl", "shift", "alt", "option"].includes(p),
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
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform)
  );
}

function newId(prefix: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
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

function defaultDoc(): DocumentModel {
  const rectId = newId("node");
  const textId = newId("node");
  const ellipseId = newId("node");

  const nodes: Record<string, DocNode> = {
    [rectId]: {
      id: rectId,
      type: "rect",
      x: 240,
      y: 180,
      w: 240,
      h: 140,
      props: {
        fill: "rgba(59, 130, 246, 0.10)",
        stroke: "rgba(59, 130, 246, 0.55)",
        strokeWidth: 2,
        radius: { tl: 14, tr: 14, br: 14, bl: 14 },
      },
    },
    [ellipseId]: {
      id: ellipseId,
      type: "ellipse",
      x: 620,
      y: 360,
      w: 180,
      h: 140,
      props: {
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

  const edgeId = newId("edge");
  const edges: Record<string, DocEdge> = {
    [edgeId]: {
      id: edgeId,
      shape: "curve",
      arrow: "none",
      from: rectId,
      to: ellipseId,
      props: { color: "#111827", width: 2, dash: "solid" },
    },
  };

  return {
    version: 1,
    canvas: { width: 3200, height: 2200, background: "grid" },
    nodes,
    nodeOrder: [rectId, textId, ellipseId],
    edges,
    edgeOrder: [edgeId],
  };
}

function safeParseDoc(
  json: string,
): { ok: true; doc: DocumentModel } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: "JSONがオブジェクトではありません" };
    }
    const p = parsed as Partial<DocumentModel>;
    if (p.version !== 1) {
      return { ok: false, error: "version=1のドキュメントのみ対応しています" };
    }
    if (!p.nodes || !p.nodeOrder || !p.edges || !p.edgeOrder || !p.canvas) {
      return { ok: false, error: "必須フィールドが不足しています" };
    }

    // Light validation + small migrations (keeps it flexible for extension)
    const migrated = p as DocumentModel;

    // Migrate legacy edges: { type: 'arrow'|'doubleArrow'|'curve' } -> { shape, arrow }
    const nextEdges: Record<string, DocEdge> = {};
    for (const edgeId of migrated.edgeOrder) {
      const rawEdge = (migrated.edges as Record<string, unknown>)[edgeId];
      if (!rawEdge || typeof rawEdge !== "object") continue;

      const edgeObj = rawEdge as Record<string, unknown>;

      if (
        typeof edgeObj.shape === "string" && typeof edgeObj.arrow === "string"
      ) {
        nextEdges[edgeId] = rawEdge as DocEdge;
        continue;
      }

      const legacyType: unknown = edgeObj.type;
      const base: DocEdge = {
        id: String(edgeObj.id ?? edgeId),
        from: String(edgeObj.from),
        to: String(edgeObj.to),
        shape: "line",
        arrow: "none",
        props: {
          color: (() => {
            const props = edgeObj.props;
            const propsObj = props && typeof props === "object"
              ? (props as Record<string, unknown>)
              : null;
            return String(propsObj?.color ?? "#111827");
          })(),
          width: (() => {
            const props = edgeObj.props;
            const propsObj = props && typeof props === "object"
              ? (props as Record<string, unknown>)
              : null;
            return Number(propsObj?.width ?? 2);
          })(),
          dash: (() => {
            const props = edgeObj.props;
            const propsObj = props && typeof props === "object"
              ? (props as Record<string, unknown>)
              : null;
            return propsObj?.dash === "dashed" ? "dashed" : "solid";
          })(),
        },
      };

      if (legacyType === "arrow") {
        base.shape = "line";
        base.arrow = "end";
      } else if (legacyType === "doubleArrow") {
        base.shape = "line";
        base.arrow = "both";
      } else if (legacyType === "curve") {
        base.shape = "curve";
        // Old implementation always rendered an end marker for curve.
        base.arrow = "end";
      }

      nextEdges[edgeId] = base;
    }

    migrated.edges = nextEdges;

    // Migrate legacy rect props.radius: number -> {tl,tr,br,bl}
    const nextNodes: Record<string, DocNode> = { ...migrated.nodes };
    for (const nodeId of migrated.nodeOrder) {
      const rawNode = (migrated.nodes as Record<string, unknown>)[nodeId];
      if (!rawNode || typeof rawNode !== "object") continue;
      const nodeObj = rawNode as Record<string, unknown>;
      if (nodeObj.type !== "rect") continue;
      const props = nodeObj.props;
      const propsObj = props && typeof props === "object"
        ? (props as Record<string, unknown>)
        : null;
      const r = propsObj?.radius as unknown;
      if (typeof r === "number") {
        const rect = rawNode as DocNode;
        nextNodes[nodeId] = {
          ...rect,
          props: {
            ...(rect.props as Record<string, unknown>),
            radius: { tl: r, tr: r, br: r, bl: r },
          },
        } as DocNode;
      } else if (!r || typeof r !== "object") {
        const rect = rawNode as DocNode;
        nextNodes[nodeId] = {
          ...rect,
          props: {
            ...(rect.props as Record<string, unknown>),
            radius: { tl: 0, tr: 0, br: 0, bl: 0 },
          },
        } as DocNode;
      }
    }
    migrated.nodes = nextNodes;

    return { ok: true, doc: migrated };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "JSONの解析に失敗しました",
    };
  }
}

function toDocPoint(
  e: React.PointerEvent,
  viewport: HTMLDivElement,
  camera: Camera,
) {
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
) {
  if (shape === "line") {
    return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  }

  // curve
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  // perpendicular bend
  const nx = (-dy / dist) * Math.min(160, dist * 0.25);
  const ny = (dx / dist) * Math.min(160, dist * 0.25);

  const c1x = a.x + dx * 0.35 + nx;
  const c1y = a.y + dy * 0.35 + ny;
  const c2x = a.x + dx * 0.65 + nx;
  const c2y = a.y + dy * 0.65 + ny;
  // NOTE: keep numbers separated by spaces only (no commas) so scaling remains simple.
  return `M ${a.x} ${a.y} C ${c1x} ${c1y} ${c2x} ${c2y} ${b.x} ${b.y}`;
}

function computeEdgePath(edge: DocEdge, fromNode: DocNode, toNode: DocNode) {
  const a = getNodeCenter(fromNode);
  const b = getNodeCenter(toNode);
  return computeEdgePathFromPoints(edge.shape, a, b);
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
  nodeDef: NodeTypeDefinition;
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

  const outlineClass = selected
    ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
    : "";

  const rendered = nodeDef.render({
    node,
    selected,
    scale,
    cn,
  });

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
      {selected && (
        <ResizeHandle
          scale={scale}
          onPointerDown={onResizeHandlePointerDown}
        />
      )}
    </div>
  );
}

function ResizeHandle(
  { scale, onPointerDown }: {
    scale: number;
    onPointerDown: (e: React.PointerEvent) => void;
  },
) {
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

function JsonSheet({
  open,
  mode,
  value,
  error,
  onOpenChange,
  onChange,
  onPrimary,
}: {
  open: boolean;
  mode: "export" | "import";
  value: string;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
  onPrimary: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(960px,calc(100vw-2rem))] sm:max-w-[960px]">
        <SheetHeader>
          <SheetTitle>
            {mode === "export" ? "JSON（書き出し）" : "JSON（読み込み）"}
          </SheetTitle>
          <SheetDescription>
            {mode === "export"
              ? "Cmd/Ctrl+Sでも開けます"
              : "貼り付けて読み込み"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3">
          <textarea
            className="h-[55vh] w-full resize-none rounded-md border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {error && <div className="mt-2 text-sm text-destructive">{error}
          </div>}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              閉じる
            </Button>
            <Button onClick={onPrimary}>
              {mode === "export" ? "クリップボードへコピー" : "読み込み"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function DocumentEditor({ className }: { className?: string }) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);

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

  const [doc, setDoc] = React.useState<DocumentModel>(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultDoc();
    const parsed = safeParseDoc(raw);
    return parsed.ok ? parsed.doc : defaultDoc();
  });

  const [camera, setCamera] = React.useState<Camera>({ x: 0, y: 0, scale: 1 });
  const [tool, setTool] = React.useState<Tool>({ kind: "select" });
  const [selection, setSelection] = React.useState<Selection>({ kind: "none" });
  const [drag, setDrag] = React.useState<DragState>({ kind: "none" });

  const [spaceDown, setSpaceDown] = React.useState(false);

  const [connectPreview, setConnectPreview] = React.useState<
    null | { x: number; y: number }
  >(null);

  const [jsonSheet, setJsonSheet] = React.useState<
    null | { mode: "export" | "import"; error: string | null }
  >(null);
  const [jsonDraft, setJsonDraft] = React.useState<string>("");

  const viewportRect = React.useCallback(
    () => viewportRef.current?.getBoundingClientRect() ?? null,
    [],
  );

  const zoomToAtClient = React.useCallback(
    (nextScale: number, clientX?: number, clientY?: number) => {
      const rect = viewportRect();
      const clamped = clamp(Number(nextScale.toFixed(3)), 0.2, 3);
      if (!rect) {
        setCamera((c) => ({ ...c, scale: clamped }));
        return;
      }

      const sx = (clientX ?? rect.left + rect.width / 2) - rect.left;
      const sy = (clientY ?? rect.top + rect.height / 2) - rect.top;
      const worldX = camera.x + sx / camera.scale;
      const worldY = camera.y + sy / camera.scale;

      setCamera({
        x: worldX - sx / clamped,
        y: worldY - sy / clamped,
        scale: clamped,
      });
    },
    [camera.scale, camera.x, camera.y, viewportRect],
  );

  const zoomToCentered = React.useCallback(
    (nextScale: number) => {
      const clamped = clamp(Number(nextScale.toFixed(3)), 0.2, 3);

      const sx = viewportSize.width / 2;
      const sy = viewportSize.height / 2;
      const worldX = camera.x + sx / camera.scale;
      const worldY = camera.y + sy / camera.scale;

      setCamera({
        x: worldX - sx / clamped,
        y: worldY - sy / clamped,
        scale: clamped,
      });
    },
    [camera.scale, camera.x, camera.y, viewportSize.height, viewportSize.width],
  );

  const openJsonSheet = React.useCallback(
    (mode: "export" | "import") => {
      setJsonDraft(JSON.stringify(doc, null, 2));
      setJsonSheet({ mode, error: null });
    },
    [doc],
  );

  const sdk = React.useMemo(
    () =>
      createDocumentSdk({
        ui: { openJsonSheet },
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
          set: (next) =>
            setCamera((prev) => typeof next === "function" ? next(prev) : next),
        },
        viewport: {
          zoomTo: (nextScale) => zoomToCentered(nextScale),
          zoomBy: (delta) => zoomToCentered(camera.scale + delta),
        },
      }),
    [camera, doc, openJsonSheet, selection, tool, zoomToCentered],
  );

  const pluginHost = React.useMemo(
    () => createPluginHost([BuiltinPlugin], { sdk }),
    [sdk],
  );
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

  // Persist
  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
      } catch {
        // ignore
      }
    }, 150);
    return () => window.clearTimeout(handle);
  }, [doc]);

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
  }, [
    camera.scale,
    camera.x,
    camera.y,
    viewportSize.height,
    viewportSize.width,
  ]);

  const viewportStyle = React.useMemo(() => {
    const grid = 24;
    if (doc.canvas.background !== "grid") {
      return { backgroundColor: "var(--background)" } as React.CSSProperties;
    }

    return {
      backgroundColor: "var(--background)",
      backgroundImage:
        "linear-gradient(to right, rgba(127,127,127,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(127,127,127,0.15) 1px, transparent 1px)",
      backgroundSize: `${grid * camera.scale}px ${grid * camera.scale}px`,
      backgroundPosition: `${-camera.x * camera.scale}px ${
        -camera.y * camera.scale
      }px`,
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

        setCamera((c) => ({
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
  }, [camera.scale, drag, nodeRegistry]);

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

        const node: DocNode = nodeDef.create({ id, x: point.x, y: point.y });

        setDoc((d) => ({
          ...d,
          nodes: { ...d.nodes, [id]: node },
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
      }
    },
    [beginPan, camera, nodeRegistry, spaceDown, tool],
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
            props: { color: "#111827", width: 2, dash: "solid" },
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
    [doc.nodes, tool],
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
    [doc.nodes, nodeRegistry],
  );

  const docJson = React.useMemo(() => JSON.stringify(doc, null, 2), [doc]);

  const onExport = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(docJson);
      setJsonSheet((
        s,
      ) => (s ? { ...s, error: null } : { mode: "export", error: null }));
    } catch {
      setJsonSheet((s) =>
        s
          ? {
            ...s,
            error:
              "クリップボードに書き込めませんでした（ブラウザ権限の可能性）",
          }
          : {
            mode: "export",
            error:
              "クリップボードに書き込めませんでした（ブラウザ権限の可能性）",
          }
      );
    }
  }, [docJson]);

  const onImportConfirm = React.useCallback((value: string) => {
    const parsed = safeParseDoc(value);
    if (!parsed.ok) {
      setJsonSheet({ mode: "import", error: parsed.error });
      return;
    }
    setDoc(parsed.doc);
    setSelection({ kind: "none" });
    setTool({ kind: "select" });
    setJsonSheet(null);
  }, []);

  const selectedNode = selectedNodeId ? doc.nodes[selectedNodeId] : null;
  const selectedEdge = selectedEdgeId ? doc.edges[selectedEdgeId] : null;

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
  }, [selection]);

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
              <MenubarSubTrigger disabled={entry.disabled}>
                {entry.label}
              </MenubarSubTrigger>
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
            {entry.shortcut
              ? <MenubarShortcut>{entry.shortcut}</MenubarShortcut>
              : null}
          </MenubarItem>
        );
      });
    },
    [executeCommand],
  );

  return (
    <div
      className={cn("flex h-full min-h-0 w-full min-w-0 flex-col", className)}
    >
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
        <Menubar className="h-9">
          <MenubarMenu>
            <MenubarTrigger>追加</MenubarTrigger>
            <MenubarContent>
              {renderMenuEntries(addMenuEntries, "add")}
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>ファイル</MenubarTrigger>
            <MenubarContent>
              {renderMenuEntries(fileMenuEntries, "file")}

              {fileMenuEntries.length ? <MenubarSeparator /> : null}
              <MenubarItem
                variant="destructive"
                onSelect={() => {
                  setDoc(defaultDoc());
                  setSelection({ kind: "none" });
                  setTool({ kind: "select" });
                  setCamera({ x: 0, y: 0, scale: 1 });
                }}
              >
                リセット
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>編集</MenubarTrigger>
            <MenubarContent>
              {renderMenuEntries(editMenuEntries, "edit")}
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>表示</MenubarTrigger>
            <MenubarContent>
              {renderMenuEntries(viewMenuEntries, "view")}
            </MenubarContent>
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
          {tool.kind === "add"
            ? <div className="text-xs text-muted-foreground">配置モード</div>
            : null}
          {tool.kind === "connect"
            ? <div className="text-xs text-muted-foreground">接続モード</div>
            : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => zoomToCentered(camera.scale - 0.1)}
            >
              −
            </Button>
            <div className="min-w-14 text-center text-xs tabular-nums">
              {Math.round(camera.scale * 100)}%
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => zoomToCentered(camera.scale + 0.1)}
            >
              ＋
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            {spaceDown
              ? "パン: Space+ドラッグ"
              : "パン: Space+ドラッグ / 中クリック"}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          ref={viewportRef}
          className="relative min-h-0 flex-1 overflow-hidden bg-background"
          style={viewportStyle}
          onWheel={(e) => {
            // Prevent page scroll
            e.preventDefault();
            const delta = e.deltaY;
            // Smooth & slower zoom: exponential mapping
            const zoomFactor = Math.exp(-delta * 0.0012);
            zoomToAtClient(camera.scale * zoomFactor, e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (tool.kind !== "connect" || !tool.fromId) return;
            if (!viewportRef.current) return;
            const p = toDocPoint(e, viewportRef.current, camera);
            setConnectPreview(p);
          }}
        >
          <div
            className="absolute inset-0"
            onPointerDown={onCanvasPointerDown}
            aria-label="canvas"
          >
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
                const strokeDasharray = edge.props.dash === "dashed"
                  ? "8 6"
                  : undefined;
                const markerEnd = edge.arrow === "end" || edge.arrow === "both"
                  ? "url(#arrow-end)"
                  : undefined;
                const markerStart = edge.arrow === "both"
                  ? "url(#arrow-start)"
                  : undefined;
                const selected = selectedEdgeId === edgeId;

                return (
                  <g key={edgeId}>
                    {selected
                      ? (
                        <path
                          d={path}
                          fill="none"
                          stroke="rgba(99, 102, 241, 0.90)"
                          strokeWidth={edge.props.width + 5}
                          strokeDasharray={strokeDasharray}
                          style={{ pointerEvents: "none" }}
                        />
                      )
                      : null}

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
                  </g>
                );
              })}

              {tool.kind === "connect" && tool.fromId && connectPreview
                ? (
                  (() => {
                    const fromNode = doc.nodes[tool.fromId];
                    if (!fromNode) return null;
                    const a = getNodeCenter(fromNode);
                    const b = connectPreview;
                    const d = computeEdgePathFromPoints(tool.edge.shape, a, b);
                    const markerEnd =
                      tool.edge.arrow === "end" || tool.edge.arrow === "both"
                        ? "url(#arrow-end)"
                        : undefined;
                    const markerStart = tool.edge.arrow === "both"
                      ? "url(#arrow-start)"
                      : undefined;
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
                )
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

        <div className="hidden w-[320px] shrink-0 border-l bg-background p-3 md:block">
          <div className="text-sm font-semibold">プロパティ</div>

          <div className="mt-3 text-xs text-muted-foreground">
            クリックで選択、ドラッグで移動、右下ハンドルでリサイズ。\nダブルクリックでテキスト/画像URLを編集。\n関係(矢印)は「関係ツール→始点ノード→終点ノード」。
          </div>

          <div className="mt-4">
            <div className="text-xs font-medium text-muted-foreground">
              選択
            </div>
            <div className="mt-1 text-sm">
              {selection.kind === "none" && "なし"}
              {selection.kind === "node" && `ノード: ${selection.id}`}
              {selection.kind === "edge" && `関係: ${selection.id}`}
            </div>
          </div>

          {selectedNode
            ? (
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
                        if (
                          edge.from === selectedNode.id ||
                          edge.to === selectedNode.id
                        ) continue;
                        nextEdges[edgeId] = edge;
                        nextEdgeOrder.push(edgeId);
                      }

                      return {
                        ...d,
                        nodes: nextNodes,
                        nodeOrder: d.nodeOrder.filter((x) =>
                          x !== selectedNode.id
                        ),
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
            )
            : null}

          {selectedEdge
            ? (
              <div className="mt-4 space-y-3">
                <div className="text-sm font-semibold">関係プロパティ</div>

                <InputGroup label="線分">
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant={selectedEdge.shape === "line"
                        ? "default"
                        : "outline"}
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
                        }))}
                    >
                      直線
                    </Button>
                    <Button
                      size="sm"
                      variant={selectedEdge.shape === "curve"
                        ? "default"
                        : "outline"}
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
                        }))}
                    >
                      曲線
                    </Button>
                  </div>
                </InputGroup>

                <InputGroup label="矢印">
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant={selectedEdge.arrow === "none"
                        ? "default"
                        : "outline"}
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
                        }))}
                    >
                      なし
                    </Button>
                    <Button
                      size="sm"
                      variant={selectedEdge.arrow === "end"
                        ? "default"
                        : "outline"}
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
                        }))}
                    >
                      方
                    </Button>
                    <Button
                      size="sm"
                      variant={selectedEdge.arrow === "both"
                        ? "default"
                        : "outline"}
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
                        }))}
                    >
                      両
                    </Button>
                  </div>
                </InputGroup>

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
                        variant={selectedEdge.props.dash !== "dashed"
                          ? "default"
                          : "outline"}
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
                          }))}
                      >
                        実線
                      </Button>
                      <Button
                        size="sm"
                        variant={selectedEdge.props.dash === "dashed"
                          ? "default"
                          : "outline"}
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
                          }))}
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
                      value={normalizeHexColor(selectedEdge.props.color) ??
                        "#111827"}
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
                      {normalizeHexColor(selectedEdge.props.color) ??
                        selectedEdge.props.color}
                    </div>
                  </div>
                </InputGroup>

                <Button variant="destructive" onClick={() => deleteSelected()}>
                  関係削除
                </Button>
              </div>
            )
            : null}

          <div className="mt-6">
            <div className="text-xs font-medium text-muted-foreground">
              JSON
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              保存はlocalStorage（暫定）。Cmd/Ctrl+Sで書き出し。
            </div>
          </div>
        </div>
      </div>

      <JsonSheet
        open={jsonSheet != null}
        mode={jsonSheet?.mode ?? "export"}
        value={jsonDraft}
        error={jsonSheet?.error ?? null}
        onOpenChange={(open) => {
          if (!open) setJsonSheet(null);
        }}
        onChange={(v) => setJsonDraft(v)}
        onPrimary={async () => {
          if (jsonSheet?.mode === "export") {
            await onExport();
            return;
          }
          onImportConfirm(jsonDraft);
        }}
      />
    </div>
  );
}
