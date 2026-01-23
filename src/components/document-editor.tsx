import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup } from "@/components/ui/input-group"
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
} from "@/components/ui/menubar"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

type NodeType = "text" | "rect" | "ellipse" | "image"
type EdgeShape = "line" | "curve"
type EdgeArrow = "none" | "end" | "both"

type BaseNode = {
  id: string
  type: NodeType
  x: number
  y: number
  w: number
  h: number
  rotation?: number
}

type TextNode = BaseNode & {
  type: "text"
  props: {
    text: string
    fontSize: number
    color: string
    align: "left" | "center" | "right"
  }
}

type RectNode = BaseNode & {
  type: "rect"
  props: {
    fill: string
    stroke: string
    strokeWidth: number
    radius: {
      tl: number
      tr: number
      br: number
      bl: number
    }
  }
}

type EllipseNode = BaseNode & {
  type: "ellipse"
  props: {
    fill: string
    stroke: string
    strokeWidth: number
  }
}

type ImageNode = BaseNode & {
  type: "image"
  props: {
    src: string
    fit: "cover" | "contain"
    borderRadius: number
  }
}

type DocNode = TextNode | RectNode | EllipseNode | ImageNode

type DocEdge = {
  id: string
  shape: EdgeShape
  arrow: EdgeArrow
  from: string
  to: string
  props: {
    color: string
    width: number
    dash?: "solid" | "dashed"
  }
}

type DocumentModelV1 = {
  version: 1
  canvas: {
    width: number
    height: number
    background: "grid" | "plain"
  }
  nodes: Record<string, DocNode>
  nodeOrder: string[]
  edges: Record<string, DocEdge>
  edgeOrder: string[]
}

type Tool =
  | { kind: "select" }
  | { kind: "add"; nodeType: NodeType }
  | { kind: "connect"; edge: { shape: EdgeShape; arrow: EdgeArrow }; fromId: string | null }

type Selection =
  | { kind: "none" }
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }

const STORAGE_KEY = "atlas.document.v1"

type Camera = {
  x: number // world coordinate at viewport's left
  y: number // world coordinate at viewport's top
  scale: number
}

function newId(prefix: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  return `${prefix}_${String(random).replaceAll("-", "")}`
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function normalizeHexColor(color: string): string | null {
  const trimmed = color.trim()
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) return trimmed

  // rgb/rgba -> #rrggbb (ignores alpha)
  const m = trimmed
    .replaceAll(" ", "")
    .match(/^rgba?\((\d{1,3}),(\d{1,3}),(\d{1,3})(?:,([0-9.]+))?\)$/)
  if (!m) return null
  const r = clamp(Number(m[1]), 0, 255)
  const g = clamp(Number(m[2]), 0, 255)
  const b = clamp(Number(m[3]), 0, 255)
  const to2 = (n: number) => n.toString(16).padStart(2, "0")
  return `#${to2(r)}${to2(g)}${to2(b)}`
}

function getNodeCenter(node: DocNode) {
  return { x: node.x + node.w / 2, y: node.y + node.h / 2 }
}

function defaultDoc(): DocumentModelV1 {
  const rectId = newId("node")
  const textId = newId("node")
  const ellipseId = newId("node")

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
      props: { fill: "rgba(16, 185, 129, 0.10)", stroke: "rgba(16, 185, 129, 0.55)", strokeWidth: 2 },
    },
    [textId]: {
      id: textId,
      type: "text",
      x: 560,
      y: 160,
      w: 260,
      h: 90,
      props: { text: "Atlas Document\n(HTMLベース)", fontSize: 18, color: "var(--foreground)", align: "left" },
    },
  }

  const edgeId = newId("edge")
  const edges: Record<string, DocEdge> = {
    [edgeId]: {
      id: edgeId,
      shape: "curve",
      arrow: "none",
      from: rectId,
      to: ellipseId,
      props: { color: "#111827", width: 2, dash: "solid" },
    },
  }

  return {
    version: 1,
    canvas: { width: 3200, height: 2200, background: "grid" },
    nodes,
    nodeOrder: [rectId, textId, ellipseId],
    edges,
    edgeOrder: [edgeId],
  }
}

function safeParseDoc(json: string): { ok: true; doc: DocumentModelV1 } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== "object") return { ok: false, error: "JSONがオブジェクトではありません" }
    const p = parsed as Partial<DocumentModelV1>
    if (p.version !== 1) return { ok: false, error: "version=1のドキュメントのみ対応しています" }
    if (!p.nodes || !p.nodeOrder || !p.edges || !p.edgeOrder || !p.canvas) return { ok: false, error: "必須フィールドが不足しています" }

    // Light validation + small migrations (keeps it flexible for extension)
    const migrated = p as DocumentModelV1

    // Migrate legacy edges: { type: 'arrow'|'doubleArrow'|'curve' } -> { shape, arrow }
    const nextEdges: Record<string, DocEdge> = {}
    for (const edgeId of migrated.edgeOrder) {
      const rawEdge = (migrated.edges as Record<string, unknown>)[edgeId]
      if (!rawEdge || typeof rawEdge !== "object") continue

      const edgeObj = rawEdge as Record<string, unknown>

      if (typeof edgeObj.shape === "string" && typeof edgeObj.arrow === "string") {
        nextEdges[edgeId] = rawEdge as DocEdge
        continue
      }

      const legacyType: unknown = edgeObj.type
      const base: DocEdge = {
        id: String(edgeObj.id ?? edgeId),
        from: String(edgeObj.from),
        to: String(edgeObj.to),
        shape: "line",
        arrow: "none",
        props: {
          color: (() => {
            const props = edgeObj.props
            const propsObj = props && typeof props === "object" ? (props as Record<string, unknown>) : null
            return String(propsObj?.color ?? "#111827")
          })(),
          width: (() => {
            const props = edgeObj.props
            const propsObj = props && typeof props === "object" ? (props as Record<string, unknown>) : null
            return Number(propsObj?.width ?? 2)
          })(),
          dash: (() => {
            const props = edgeObj.props
            const propsObj = props && typeof props === "object" ? (props as Record<string, unknown>) : null
            return propsObj?.dash === "dashed" ? "dashed" : "solid"
          })(),
        },
      }

      if (legacyType === "arrow") {
        base.shape = "line"
        base.arrow = "end"
      } else if (legacyType === "doubleArrow") {
        base.shape = "line"
        base.arrow = "both"
      } else if (legacyType === "curve") {
        base.shape = "curve"
        // Old implementation always rendered an end marker for curve.
        base.arrow = "end"
      }

      nextEdges[edgeId] = base
    }

    migrated.edges = nextEdges

    // Migrate legacy rect props.radius: number -> {tl,tr,br,bl}
    const nextNodes: Record<string, DocNode> = { ...migrated.nodes }
    for (const nodeId of migrated.nodeOrder) {
      const rawNode = (migrated.nodes as Record<string, unknown>)[nodeId]
      if (!rawNode || typeof rawNode !== "object") continue
      const nodeObj = rawNode as Record<string, unknown>
      if (nodeObj.type !== "rect") continue
      const props = nodeObj.props
      const propsObj = props && typeof props === "object" ? (props as Record<string, unknown>) : null
      const r = propsObj?.radius as unknown
      if (typeof r === "number") {
        const rect = rawNode as RectNode
        nextNodes[nodeId] = {
          ...rect,
          props: {
            ...rect.props,
            radius: { tl: r, tr: r, br: r, bl: r },
          },
        }
      } else if (!r || typeof r !== "object") {
        const rect = rawNode as RectNode
        nextNodes[nodeId] = {
          ...rect,
          props: {
            ...rect.props,
            radius: { tl: 0, tr: 0, br: 0, bl: 0 },
          },
        }
      }
    }
    migrated.nodes = nextNodes

    return { ok: true, doc: migrated }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "JSONの解析に失敗しました" }
  }
}

type DragState =
  | { kind: "none" }
  | {
      kind: "pan"
      pointerId: number
      startClientX: number
      startClientY: number
      startCamX: number
      startCamY: number
      didPan: boolean
      clickClearsSelection: boolean
    }
  | {
      kind: "move"
      nodeId: string
      pointerId: number
      startClientX: number
      startClientY: number
      startX: number
      startY: number
    }
  | {
      kind: "resize"
      nodeId: string
      pointerId: number
      startClientX: number
      startClientY: number
      startW: number
      startH: number
    }
  | {
      kind: "drawShape"
      nodeId: string
      nodeType: "rect" | "ellipse"
      pointerId: number
      startWorldX: number
      startWorldY: number
      startClientX: number
      startClientY: number
    }

function toDocPoint(e: React.PointerEvent, viewport: HTMLDivElement, camera: Camera) {
  const rect = viewport.getBoundingClientRect()
  const sx = e.clientX - rect.left
  const sy = e.clientY - rect.top
  const x = camera.x + sx / camera.scale
  const y = camera.y + sy / camera.scale
  return { x, y }
}

function computeEdgePathFromPoints(shape: EdgeShape, a: { x: number; y: number }, b: { x: number; y: number }) {
  if (shape === "line") {
    return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  }

  // curve
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dist = Math.max(1, Math.hypot(dx, dy))
  // perpendicular bend
  const nx = (-dy / dist) * Math.min(160, dist * 0.25)
  const ny = (dx / dist) * Math.min(160, dist * 0.25)

  const c1x = a.x + dx * 0.35 + nx
  const c1y = a.y + dy * 0.35 + ny
  const c2x = a.x + dx * 0.65 + nx
  const c2y = a.y + dy * 0.65 + ny
  // NOTE: keep numbers separated by spaces only (no commas) so scaling remains simple.
  return `M ${a.x} ${a.y} C ${c1x} ${c1y} ${c2x} ${c2y} ${b.x} ${b.y}`
}

function computeEdgePath(edge: DocEdge, fromNode: DocNode, toNode: DocNode) {
  const a = getNodeCenter(fromNode)
  const b = getNodeCenter(toNode)
  return computeEdgePathFromPoints(edge.shape, a, b)
}

function NodeView({
  node,
  selected,
  scale,
  onPointerDown,
  onResizeHandlePointerDown,
  onDoubleClick,
}: {
  node: DocNode
  selected: boolean
  scale: number
  onPointerDown: (e: React.PointerEvent) => void
  onResizeHandlePointerDown: (e: React.PointerEvent) => void
  onDoubleClick: () => void
}) {
  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: node.x * scale,
    top: node.y * scale,
    width: node.w * scale,
    height: node.h * scale,
    transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
    transformOrigin: "center",
  }

  const outlineClass = selected ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""

  if (node.type === "rect") {
    const p = node.props
    return (
      <div
        role="group"
        aria-label="rectangle"
        className={cn("select-none", outlineClass)}
        style={{
          ...baseStyle,
          borderRadius: `${p.radius.tl * scale}px ${p.radius.tr * scale}px ${p.radius.br * scale}px ${p.radius.bl * scale}px`,
          background: p.fill,
          border: `${p.strokeWidth * scale}px solid ${p.stroke}`,
        }}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
      >
        {selected && <ResizeHandle scale={scale} onPointerDown={onResizeHandlePointerDown} />}
      </div>
    )
  }

  if (node.type === "ellipse") {
    const p = node.props
    return (
      <div
        role="group"
        aria-label="ellipse"
        className={cn("select-none", outlineClass)}
        style={{
          ...baseStyle,
          borderRadius: "50%",
          background: p.fill,
          border: `${p.strokeWidth * scale}px solid ${p.stroke}`,
        }}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
      >
        {selected && <ResizeHandle scale={scale} onPointerDown={onResizeHandlePointerDown} />}
      </div>
    )
  }

  if (node.type === "image") {
    const p = node.props
    return (
      <div
        role="group"
        aria-label="image"
        className={cn("select-none overflow-hidden bg-muted", outlineClass)}
        style={{
          ...baseStyle,
          borderRadius: p.borderRadius * scale,
        }}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
      >
        <img
          src={p.src}
          alt=""
          className="h-full w-full"
          style={{ objectFit: p.fit }}
          draggable={false}
        />
        {selected && <ResizeHandle scale={scale} onPointerDown={onResizeHandlePointerDown} />}
      </div>
    )
  }

  // text
  const p = node.props
  return (
    <div
      role="group"
      aria-label="text"
      className={cn("select-none whitespace-pre-wrap bg-transparent", outlineClass)}
      style={{
        ...baseStyle,
        padding: 10 * scale,
        color: p.color,
        fontSize: p.fontSize * scale,
        lineHeight: 1.25,
        textAlign: p.align,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {p.text}
      {selected && <ResizeHandle scale={scale} onPointerDown={onResizeHandlePointerDown} />}
    </div>
  )
}

function ResizeHandle({ scale, onPointerDown }: { scale: number; onPointerDown: (e: React.PointerEvent) => void }) {
  const size = 10 * scale
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
  )
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
  open: boolean
  mode: "export" | "import"
  value: string
  error: string | null
  onOpenChange: (open: boolean) => void
  onChange: (value: string) => void
  onPrimary: () => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(960px,calc(100vw-2rem))] sm:max-w-[960px]">
        <SheetHeader>
          <SheetTitle>{mode === "export" ? "JSON（書き出し）" : "JSON（読み込み）"}</SheetTitle>
          <SheetDescription>
            {mode === "export" ? "Cmd/Ctrl+Sでも開けます" : "貼り付けて読み込み"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3">
          <textarea
            className="h-[55vh] w-full resize-none rounded-md border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {error && <div className="mt-2 text-sm text-destructive">{error}</div>}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              閉じる
            </Button>
            <Button onClick={onPrimary}>{mode === "export" ? "クリップボードへコピー" : "読み込み"}</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function DocumentEditor({ className }: { className?: string }) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null)

  const [viewportSize, setViewportSize] = React.useState({ width: 1, height: 1 })
  React.useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = () => {
      const rect = el.getBoundingClientRect()
      setViewportSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [doc, setDoc] = React.useState<DocumentModelV1>(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultDoc()
    const parsed = safeParseDoc(raw)
    return parsed.ok ? parsed.doc : defaultDoc()
  })

  const [camera, setCamera] = React.useState<Camera>({ x: 0, y: 0, scale: 1 })
  const [tool, setTool] = React.useState<Tool>({ kind: "select" })
  const [selection, setSelection] = React.useState<Selection>({ kind: "none" })
  const [drag, setDrag] = React.useState<DragState>({ kind: "none" })

  const [spaceDown, setSpaceDown] = React.useState(false)

  const [connectPreview, setConnectPreview] = React.useState<null | { x: number; y: number }>(null)

  const [jsonSheet, setJsonSheet] = React.useState<null | { mode: "export" | "import"; error: string | null }>(null)
  const [jsonDraft, setJsonDraft] = React.useState<string>("")

  const selectedNodeId = selection.kind === "node" ? selection.id : null
  const selectedEdgeId = selection.kind === "edge" ? selection.id : null

  // Persist
  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(doc))
      } catch {
        // ignore
      }
    }, 150)
    return () => window.clearTimeout(handle)
  }, [doc])

  // Keyboard shortcuts
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === " ") {
        setSpaceDown(true)
      }

      if (e.key === "Escape") {
        setTool({ kind: "select" })
        setSelection({ kind: "none" })
        return
      }

      if (e.key === "Backspace" || e.key === "Delete") {
        if (selection.kind === "node") {
          const id = selection.id
          setDoc((d) => {
            const nextNodes = { ...d.nodes }
            delete nextNodes[id]

            const nextEdges: Record<string, DocEdge> = {}
            const nextEdgeOrder: string[] = []
            for (const edgeId of d.edgeOrder) {
              const edge = d.edges[edgeId]
              if (!edge) continue
              if (edge.from === id || edge.to === id) continue
              nextEdges[edgeId] = edge
              nextEdgeOrder.push(edgeId)
            }

            return {
              ...d,
              nodes: nextNodes,
              nodeOrder: d.nodeOrder.filter((x) => x !== id),
              edges: nextEdges,
              edgeOrder: nextEdgeOrder,
            }
          })
          setSelection({ kind: "none" })
        }

        if (selection.kind === "edge") {
          const edgeId = selection.id
          setDoc((d) => {
            const nextEdges = { ...d.edges }
            delete nextEdges[edgeId]
            return {
              ...d,
              edges: nextEdges,
              edgeOrder: d.edgeOrder.filter((x) => x !== edgeId),
            }
          })
          setSelection({ kind: "none" })
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        setJsonDraft(JSON.stringify(doc, null, 2))
        setJsonSheet({ mode: "export", error: null })
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") {
        setSpaceDown(false)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [doc, selection])

  const viewportRect = React.useCallback(() => viewportRef.current?.getBoundingClientRect() ?? null, [])

  const svgViewBox = React.useMemo(() => {
    const w = viewportSize.width / camera.scale
    const h = viewportSize.height / camera.scale
    return `${camera.x} ${camera.y} ${w} ${h}`
  }, [camera.scale, camera.x, camera.y, viewportSize.height, viewportSize.width])

  const viewportStyle = React.useMemo(() => {
    const grid = 24
    if (doc.canvas.background !== "grid") {
      return { backgroundColor: "var(--background)" } as React.CSSProperties
    }

    return {
      backgroundColor: "var(--background)",
      backgroundImage:
        "linear-gradient(to right, rgba(127,127,127,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(127,127,127,0.15) 1px, transparent 1px)",
      backgroundSize: `${grid * camera.scale}px ${grid * camera.scale}px`,
      backgroundPosition: `${-camera.x * camera.scale}px ${-camera.y * camera.scale}px`,
    } as React.CSSProperties
  }, [camera.scale, camera.x, camera.y, doc.canvas.background])

  const beginMove = React.useCallback(
    (e: React.PointerEvent, nodeId: string) => {
      const node = doc.nodes[nodeId]
      if (!node) return

      e.preventDefault()
      e.stopPropagation()

      setSelection({ kind: "node", id: nodeId })

      setDrag({
        kind: "move",
        nodeId,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: node.x,
        startY: node.y,
      })
    },
    [doc.nodes]
  )

  const beginResize = React.useCallback(
    (e: React.PointerEvent, nodeId: string) => {
      const node = doc.nodes[nodeId]
      if (!node) return

      e.preventDefault()
      e.stopPropagation()

      setDrag({
        kind: "resize",
        nodeId,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startW: node.w,
        startH: node.h,
      })
    },
    [doc.nodes]
  )

  const beginPan = React.useCallback(
    (e: React.PointerEvent, opts?: { clickClearsSelection?: boolean }) => {
      e.preventDefault()
      e.stopPropagation()
      setDrag({
        kind: "pan",
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startCamX: camera.x,
        startCamY: camera.y,
        didPan: false,
        clickClearsSelection: opts?.clickClearsSelection ?? false,
      })
    },
    [camera.x, camera.y]
  )

  // Dragging/resizing must work even when the pointer leaves the node.
  React.useEffect(() => {
    if (drag.kind === "none") return

    const PAN_THRESHOLD_PX = 3

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return

      const dx = (e.clientX - drag.startClientX) / camera.scale
      const dy = (e.clientY - drag.startClientY) / camera.scale

      if (drag.kind === "pan") {
        const movedPx = Math.max(Math.abs(e.clientX - drag.startClientX), Math.abs(e.clientY - drag.startClientY))
        if (!drag.didPan && movedPx < PAN_THRESHOLD_PX) return

        setCamera((c) => ({
          ...c,
          x: drag.startCamX - (e.clientX - drag.startClientX) / c.scale,
          y: drag.startCamY - (e.clientY - drag.startClientY) / c.scale,
        }))
        if (!drag.didPan) {
          setDrag((s) => (s.kind === "pan" ? { ...s, didPan: true } : s))
        }
        return
      }

      if (drag.kind === "move") {
        setDoc((d) => {
          const node = d.nodes[drag.nodeId]
          if (!node) return d
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
          }
        })
        return
      }

      if (drag.kind === "resize") {
        setDoc((d) => {
          const node = d.nodes[drag.nodeId]
          if (!node) return d
          const nextW = clamp(drag.startW + dx, 24, 3200)
          const nextH = clamp(drag.startH + dy, 24, 3200)
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
          }
        })
      }

      if (drag.kind === "drawShape") {
        const curWorldX = drag.startWorldX + dx
        const curWorldY = drag.startWorldY + dy
        const rawW = curWorldX - drag.startWorldX
        const rawH = curWorldY - drag.startWorldY

        const absW = Math.abs(rawW)
        const absH = Math.abs(rawH)

        const lock = (e as PointerEvent).shiftKey
        const size = lock ? Math.max(absW, absH) : undefined
        const w = clamp(lock ? size! : absW, 1, 3200)
        const h = clamp(lock ? size! : absH, 1, 3200)

        const x = rawW < 0 ? drag.startWorldX - w : drag.startWorldX
        const y = rawH < 0 ? drag.startWorldY - h : drag.startWorldY

        setDoc((d) => {
          const node = d.nodes[drag.nodeId]
          if (!node) return d
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
          }
        })
      }
    }

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return

      if (drag.kind === "pan" && !drag.didPan && drag.clickClearsSelection) {
        setSelection({ kind: "none" })
      }

      if (drag.kind === "drawShape") {
        const movedPx = Math.max(Math.abs(e.clientX - drag.startClientX), Math.abs(e.clientY - drag.startClientY))
        if (movedPx < PAN_THRESHOLD_PX) {
          // treat as click placement (default size centered)
          setDoc((d) => {
            const node = d.nodes[drag.nodeId]
            if (!node) return d

            const defaults =
              drag.nodeType === "rect"
                ? { w: 240, h: 140 }
                : { w: 180, h: 140 }

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
            }
          })
        }
        setTool({ kind: "select" })
      }

      setDrag({ kind: "none" })
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)

    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [camera.scale, drag])

  const onCanvasPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (!viewportRef.current) return

      if (e.button === 1 || spaceDown) {
        beginPan(e)
        return
      }

      // Clicking empty canvas clears selection
      if (tool.kind === "select") {
        // drag -> pan, click -> clear selection
        beginPan(e, { clickClearsSelection: true })
        return
      }

      if (tool.kind === "add") {
        const point = toDocPoint(e, viewportRef.current, camera)
        const id = newId("node")

        const node: DocNode =
          tool.nodeType === "rect"
            ? {
                id,
                type: "rect",
                x: point.x,
                y: point.y,
                w: 1,
                h: 1,
                props: {
                  fill: "rgba(99, 102, 241, 0.10)",
                  stroke: "rgba(99, 102, 241, 0.55)",
                  strokeWidth: 2,
                  radius: { tl: 14, tr: 14, br: 14, bl: 14 },
                },
              }
            : tool.nodeType === "ellipse"
              ? {
                  id,
                  type: "ellipse",
                  x: point.x,
                  y: point.y,
                  w: 1,
                  h: 1,
                  props: {
                    fill: "rgba(16, 185, 129, 0.10)",
                    stroke: "rgba(16, 185, 129, 0.55)",
                    strokeWidth: 2,
                  },
                }
              : tool.nodeType === "image"
                ? {
                    id,
                    type: "image",
                    x: point.x - 160,
                    y: point.y - 110,
                    w: 320,
                    h: 220,
                    props: {
                      src: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&auto=format&fit=crop",
                      fit: "cover",
                      borderRadius: 14,
                    },
                  }
                : {
                    id,
                    type: "text",
                    x: point.x - 140,
                    y: point.y - 45,
                    w: 280,
                    h: 90,
                    props: {
                      text: "テキスト",
                      fontSize: 18,
                      color: "var(--foreground)",
                      align: "left",
                    },
                  }

        setDoc((d) => ({
          ...d,
          nodes: { ...d.nodes, [id]: node },
          nodeOrder: [...d.nodeOrder, id],
        }))
        setSelection({ kind: "node", id })

        if (tool.nodeType === "rect" || tool.nodeType === "ellipse") {
          setDrag({
            kind: "drawShape",
            nodeId: id,
            nodeType: tool.nodeType,
            pointerId: e.pointerId,
            startWorldX: point.x,
            startWorldY: point.y,
            startClientX: e.clientX,
            startClientY: e.clientY,
          })
          return
        }

        setTool({ kind: "select" })
      }
    },
    [beginPan, camera, spaceDown, tool]
  )

  const onNodeClick = React.useCallback(
    (nodeId: string) => {
      if (tool.kind === "connect") {
        if (!tool.fromId) {
          setTool({ ...tool, fromId: nodeId })
          setSelection({ kind: "node", id: nodeId })
          setConnectPreview(getNodeCenter(doc.nodes[nodeId] as DocNode))
          return
        }

        if (tool.fromId && tool.fromId !== nodeId) {
          const edgeId = newId("edge")
          const edge: DocEdge = {
            id: edgeId,
            shape: tool.edge.shape,
            arrow: tool.edge.arrow,
            from: tool.fromId,
            to: nodeId,
            props: { color: "#111827", width: 2, dash: "solid" },
          }

          setDoc((d) => ({
            ...d,
            edges: { ...d.edges, [edgeId]: edge },
            edgeOrder: [...d.edgeOrder, edgeId],
          }))
          setSelection({ kind: "edge", id: edgeId })
          setTool({ kind: "select" })
          setConnectPreview(null)
        }
      } else {
        setSelection({ kind: "node", id: nodeId })
      }
    },
    [doc.nodes, tool]
  )

  React.useEffect(() => {
    if (tool.kind !== "connect") {
      setConnectPreview(null)
      return
    }
    if (!tool.fromId) {
      setConnectPreview(null)
    }
  }, [tool])

  const onNodeDoubleClick = React.useCallback(
    (nodeId: string) => {
      const node = doc.nodes[nodeId]
      if (!node) return

      if (node.type === "text") {
        const next = window.prompt("テキストを編集", node.props.text)
        if (next == null) return
        setDoc((d) => ({
          ...d,
          nodes: {
            ...d.nodes,
            [nodeId]: { ...node, props: { ...node.props, text: next } },
          },
        }))
        return
      }

      if (node.type === "image") {
        const next = window.prompt("画像URLを編集", node.props.src)
        if (next == null) return
        setDoc((d) => ({
          ...d,
          nodes: {
            ...d.nodes,
            [nodeId]: { ...node, props: { ...node.props, src: next } },
          },
        }))
      }
    },
    [doc.nodes]
  )

  const docJson = React.useMemo(() => JSON.stringify(doc, null, 2), [doc])

  const onExport = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(docJson)
      setJsonSheet((s) => (s ? { ...s, error: null } : { mode: "export", error: null }))
    } catch {
      setJsonSheet((s) =>
        s
          ? { ...s, error: "クリップボードに書き込めませんでした（ブラウザ権限の可能性）" }
          : { mode: "export", error: "クリップボードに書き込めませんでした（ブラウザ権限の可能性）" }
      )
    }
  }, [docJson])

  const onImportConfirm = React.useCallback((value: string) => {
    const parsed = safeParseDoc(value)
    if (!parsed.ok) {
      setJsonSheet({ mode: "import", error: parsed.error })
      return
    }
    setDoc(parsed.doc)
    setSelection({ kind: "none" })
    setTool({ kind: "select" })
    setJsonSheet(null)
  }, [])

  const selectedNode = selectedNodeId ? doc.nodes[selectedNodeId] : null
  const selectedEdge = selectedEdgeId ? doc.edges[selectedEdgeId] : null

  const deleteSelected = React.useCallback(() => {
    if (selection.kind === "node") {
      const id = selection.id
      setDoc((d) => {
        const nextNodes = { ...d.nodes }
        delete nextNodes[id]

        const nextEdges: Record<string, DocEdge> = {}
        const nextEdgeOrder: string[] = []
        for (const edgeId of d.edgeOrder) {
          const edge = d.edges[edgeId]
          if (!edge) continue
          if (edge.from === id || edge.to === id) continue
          nextEdges[edgeId] = edge
          nextEdgeOrder.push(edgeId)
        }

        return {
          ...d,
          nodes: nextNodes,
          nodeOrder: d.nodeOrder.filter((x) => x !== id),
          edges: nextEdges,
          edgeOrder: nextEdgeOrder,
        }
      })
      setSelection({ kind: "none" })
      return
    }

    if (selection.kind === "edge") {
      const edgeId = selection.id
      setDoc((d) => {
        const nextEdges = { ...d.edges }
        delete nextEdges[edgeId]
        return {
          ...d,
          edges: nextEdges,
          edgeOrder: d.edgeOrder.filter((x) => x !== edgeId),
        }
      })
      setSelection({ kind: "none" })
    }
  }, [selection])

  const zoomTo = React.useCallback(
    (nextScale: number, clientX?: number, clientY?: number) => {
      const rect = viewportRect()
      const clamped = clamp(Number(nextScale.toFixed(3)), 0.2, 3)
      if (!rect) {
        setCamera((c) => ({ ...c, scale: clamped }))
        return
      }

      const sx = (clientX ?? rect.left + rect.width / 2) - rect.left
      const sy = (clientY ?? rect.top + rect.height / 2) - rect.top
      const worldX = camera.x + sx / camera.scale
      const worldY = camera.y + sy / camera.scale

      setCamera({
        x: worldX - sx / clamped,
        y: worldY - sy / clamped,
        scale: clamped,
      })
    },
    [camera.scale, camera.x, camera.y, viewportRect]
  )

  return (
    <div className={cn("flex h-full min-h-0 w-full min-w-0 flex-col", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
        <Menubar className="h-9">
          <MenubarMenu>
            <MenubarTrigger>追加</MenubarTrigger>
            <MenubarContent>
              <MenubarItem
                onSelect={() => {
                  setTool({ kind: "add", nodeType: "text" })
                }}
              >
                テキスト
              </MenubarItem>
              <MenubarSub>
                <MenubarSubTrigger>図形</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem onSelect={() => setTool({ kind: "add", nodeType: "rect" })}>四角形</MenubarItem>
                  <MenubarItem onSelect={() => setTool({ kind: "add", nodeType: "ellipse" })}>円</MenubarItem>

                  <MenubarSeparator />

                  <MenubarSub>
                    <MenubarSubTrigger>線分</MenubarSubTrigger>
                    <MenubarSubContent>
                      <MenubarSub>
                        <MenubarSubTrigger>直線</MenubarSubTrigger>
                        <MenubarSubContent>
                          <MenubarItem
                            onSelect={() => setTool({ kind: "connect", edge: { shape: "line", arrow: "none" }, fromId: null })}
                          >
                            矢印なし
                          </MenubarItem>
                          <MenubarItem
                            onSelect={() => setTool({ kind: "connect", edge: { shape: "line", arrow: "end" }, fromId: null })}
                          >
                            方矢印
                          </MenubarItem>
                          <MenubarItem
                            onSelect={() => setTool({ kind: "connect", edge: { shape: "line", arrow: "both" }, fromId: null })}
                          >
                            両矢印
                          </MenubarItem>
                        </MenubarSubContent>
                      </MenubarSub>

                      <MenubarSub>
                        <MenubarSubTrigger>曲線</MenubarSubTrigger>
                        <MenubarSubContent>
                          <MenubarItem
                            onSelect={() => setTool({ kind: "connect", edge: { shape: "curve", arrow: "none" }, fromId: null })}
                          >
                            矢印なし
                          </MenubarItem>
                          <MenubarItem
                            onSelect={() => setTool({ kind: "connect", edge: { shape: "curve", arrow: "end" }, fromId: null })}
                          >
                            方矢印
                          </MenubarItem>
                          <MenubarItem
                            onSelect={() => setTool({ kind: "connect", edge: { shape: "curve", arrow: "both" }, fromId: null })}
                          >
                            両矢印
                          </MenubarItem>
                        </MenubarSubContent>
                      </MenubarSub>
                    </MenubarSubContent>
                  </MenubarSub>
                </MenubarSubContent>
              </MenubarSub>
              <MenubarItem
                onSelect={() => {
                  setTool({ kind: "add", nodeType: "image" })
                }}
              >
                画像
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>ファイル</MenubarTrigger>
            <MenubarContent>
              <MenubarItem
                onSelect={() => {
                  setJsonDraft(JSON.stringify(doc, null, 2))
                  setJsonSheet({ mode: "export", error: null })
                }}
              >
                JSON書き出し
                <MenubarShortcut>⌘S</MenubarShortcut>
              </MenubarItem>
              <MenubarItem
                onSelect={() => {
                  setJsonDraft(JSON.stringify(doc, null, 2))
                  setJsonSheet({ mode: "import", error: null })
                }}
              >
                JSON読み込み
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem
                variant="destructive"
                onSelect={() => {
                  setDoc(defaultDoc())
                  setSelection({ kind: "none" })
                  setTool({ kind: "select" })
                  setCamera({ x: 0, y: 0, scale: 1 })
                }}
              >
                リセット
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>編集</MenubarTrigger>
            <MenubarContent>
              <MenubarItem
                onSelect={() => {
                  deleteSelected()
                }}
                variant="destructive"
              >
                削除
                <MenubarShortcut>⌫</MenubarShortcut>
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem
                onSelect={() => {
                  setSelection({ kind: "none" })
                  setTool({ kind: "select" })
                }}
              >
                選択解除
                <MenubarShortcut>Esc</MenubarShortcut>
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger>表示</MenubarTrigger>
            <MenubarContent>
              <MenubarItem onSelect={() => zoomTo(camera.scale + 0.1)}>ズームイン</MenubarItem>
              <MenubarItem onSelect={() => zoomTo(camera.scale - 0.1)}>ズームアウト</MenubarItem>
              <MenubarItem onSelect={() => setCamera((c) => ({ ...c, scale: 1 }))}>等倍</MenubarItem>
              <MenubarSeparator />
              <MenubarItem
                onSelect={() =>
                  setDoc((d) => ({
                    ...d,
                    canvas: {
                      ...d.canvas,
                      background: d.canvas.background === "grid" ? "plain" : "grid",
                    },
                  }))
                }
              >
                グリッド切替
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>

        <div className="ml-2 flex items-center gap-1">
          <Button size="sm" variant={tool.kind === "select" ? "default" : "outline"} onClick={() => setTool({ kind: "select" })}>
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
            <Button size="sm" variant="outline" onClick={() => zoomTo(camera.scale - 0.1)}>
              −
            </Button>
            <div className="min-w-14 text-center text-xs tabular-nums">{Math.round(camera.scale * 100)}%</div>
            <Button size="sm" variant="outline" onClick={() => zoomTo(camera.scale + 0.1)}>
              ＋
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            {spaceDown ? "パン: Space+ドラッグ" : "パン: Space+ドラッグ / 中クリック"}
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
            e.preventDefault()
            const delta = e.deltaY
            // Smooth & slower zoom: exponential mapping
            const zoomFactor = Math.exp(-delta * 0.0012)
            zoomTo(camera.scale * zoomFactor, e.clientX, e.clientY)
          }}
          onPointerMove={(e) => {
            if (tool.kind !== "connect" || !tool.fromId) return
            if (!viewportRef.current) return
            const p = toDocPoint(e, viewportRef.current, camera)
            setConnectPreview(p)
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
                const edge = doc.edges[edgeId]
                if (!edge) return null
                const fromNode = doc.nodes[edge.from]
                const toNode = doc.nodes[edge.to]
                if (!fromNode || !toNode) return null

                const path = computeEdgePath(edge, fromNode, toNode)
                const strokeDasharray = edge.props.dash === "dashed" ? "8 6" : undefined
                const markerEnd = edge.arrow === "end" || edge.arrow === "both" ? "url(#arrow-end)" : undefined
                const markerStart = edge.arrow === "both" ? "url(#arrow-start)" : undefined
                const selected = selectedEdgeId === edgeId

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
                        e.preventDefault()
                        e.stopPropagation()
                        setSelection({ kind: "edge", id: edgeId })
                      }}
                    />
                  </g>
                )
              })}

              {tool.kind === "connect" && tool.fromId && connectPreview ? (
                (() => {
                  const fromNode = doc.nodes[tool.fromId]
                  if (!fromNode) return null
                  const a = getNodeCenter(fromNode)
                  const b = connectPreview
                  const d = computeEdgePathFromPoints(tool.edge.shape, a, b)
                  const markerEnd = tool.edge.arrow === "end" || tool.edge.arrow === "both" ? "url(#arrow-end)" : undefined
                  const markerStart = tool.edge.arrow === "both" ? "url(#arrow-start)" : undefined
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
                  )
                })()
              ) : null}
            </svg>

            {doc.nodeOrder.map((nodeId) => {
              const node = doc.nodes[nodeId]
              if (!node) return null
              const selected = selectedNodeId === nodeId

              const screenX = (node.x - camera.x) * camera.scale
              const screenY = (node.y - camera.y) * camera.scale
              const screenW = node.w * camera.scale
              const screenH = node.h * camera.scale

              return (
                <NodeView
                  key={nodeId}
                  node={{ ...node, x: screenX / camera.scale, y: screenY / camera.scale, w: screenW / camera.scale, h: screenH / camera.scale }}
                  selected={selected}
                  scale={camera.scale}
                  onPointerDown={(e) => {
                    if (e.button === 1 || spaceDown) {
                      beginPan(e)
                      return
                    }
                    if (tool.kind === "select") {
                      onNodeClick(nodeId)
                      beginMove(e, nodeId)
                      return
                    }

                    e.preventDefault()
                    e.stopPropagation()
                    onNodeClick(nodeId)
                  }}
                  onResizeHandlePointerDown={(e) => {
                    if (tool.kind !== "select") {
                      e.preventDefault()
                      e.stopPropagation()
                      return
                    }
                    beginResize(e, nodeId)
                  }}
                  onDoubleClick={() => onNodeDoubleClick(nodeId)}
                />
              )
            })}
          </div>
        </div>

        <div className="hidden w-[320px] shrink-0 border-l bg-background p-3 md:block">
          <div className="text-sm font-semibold">プロパティ</div>

          <div className="mt-3 text-xs text-muted-foreground">
            クリックで選択、ドラッグで移動、右下ハンドルでリサイズ。\nダブルクリックでテキスト/画像URLを編集。\n関係(矢印)は「関係ツール→始点ノード→終点ノード」。
          </div>

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
                      const next = Number(e.target.value)
                      if (!Number.isFinite(next)) return
                      setDoc((d) => ({
                        ...d,
                        nodes: { ...d.nodes, [selectedNode.id]: { ...selectedNode, x: next } },
                      }))
                    }}
                  />
                </InputGroup>
                <InputGroup label="Y">
                  <Input
                    inputMode="numeric"
                    value={String(Math.round(selectedNode.y))}
                    onChange={(e) => {
                      const next = Number(e.target.value)
                      if (!Number.isFinite(next)) return
                      setDoc((d) => ({
                        ...d,
                        nodes: { ...d.nodes, [selectedNode.id]: { ...selectedNode, y: next } },
                      }))
                    }}
                  />
                </InputGroup>
                <InputGroup label="W">
                  <Input
                    inputMode="numeric"
                    value={String(Math.round(selectedNode.w))}
                    onChange={(e) => {
                      const next = Number(e.target.value)
                      if (!Number.isFinite(next)) return
                      setDoc((d) => ({
                        ...d,
                        nodes: { ...d.nodes, [selectedNode.id]: { ...selectedNode, w: clamp(next, 24, 3200) } },
                      }))
                    }}
                  />
                </InputGroup>
                <InputGroup label="H">
                  <Input
                    inputMode="numeric"
                    value={String(Math.round(selectedNode.h))}
                    onChange={(e) => {
                      const next = Number(e.target.value)
                      if (!Number.isFinite(next)) return
                      setDoc((d) => ({
                        ...d,
                        nodes: { ...d.nodes, [selectedNode.id]: { ...selectedNode, h: clamp(next, 24, 3200) } },
                      }))
                    }}
                  />
                </InputGroup>
              </div>

              {selectedNode.type === "ellipse" ? (
                <div className="grid grid-cols-2 gap-2">
                  <InputGroup label="半径X">
                    <Input
                      inputMode="numeric"
                      value={String(Math.round(selectedNode.w / 2))}
                      onChange={(e) => {
                        const nextRx = Number(e.target.value)
                        if (!Number.isFinite(nextRx)) return
                        setDoc((d) => {
                          const n = d.nodes[selectedNode.id] as EllipseNode | undefined
                          if (!n || n.type !== "ellipse") return d
                          const centerX = n.x + n.w / 2
                          const newW = clamp(nextRx * 2, 24, 3200)
                          return {
                            ...d,
                            nodes: {
                              ...d.nodes,
                              [n.id]: {
                                ...n,
                                w: newW,
                                x: centerX - newW / 2,
                              },
                            },
                          }
                        })
                      }}
                    />
                  </InputGroup>
                  <InputGroup label="半径Y">
                    <Input
                      inputMode="numeric"
                      value={String(Math.round(selectedNode.h / 2))}
                      onChange={(e) => {
                        const nextRy = Number(e.target.value)
                        if (!Number.isFinite(nextRy)) return
                        setDoc((d) => {
                          const n = d.nodes[selectedNode.id] as EllipseNode | undefined
                          if (!n || n.type !== "ellipse") return d
                          const centerY = n.y + n.h / 2
                          const newH = clamp(nextRy * 2, 24, 3200)
                          return {
                            ...d,
                            nodes: {
                              ...d.nodes,
                              [n.id]: {
                                ...n,
                                h: newH,
                                y: centerY - newH / 2,
                              },
                            },
                          }
                        })
                      }}
                    />
                  </InputGroup>
                </div>
              ) : null}

              {selectedNode.type === "rect" ? (
                <div>
                  <div className="text-sm font-semibold">角丸</div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <InputGroup label="左上">
                      <Input
                        inputMode="numeric"
                        value={String(Math.round(selectedNode.props.radius.tl))}
                        onChange={(e) => {
                          const next = Number(e.target.value)
                          if (!Number.isFinite(next)) return
                          setDoc((d) => ({
                            ...d,
                            nodes: {
                              ...d.nodes,
                              [selectedNode.id]: {
                                ...selectedNode,
                                props: {
                                  ...selectedNode.props,
                                  radius: { ...selectedNode.props.radius, tl: clamp(next, 0, 999) },
                                },
                              },
                            },
                          }))
                        }}
                      />
                    </InputGroup>
                    <InputGroup label="右上">
                      <Input
                        inputMode="numeric"
                        value={String(Math.round(selectedNode.props.radius.tr))}
                        onChange={(e) => {
                          const next = Number(e.target.value)
                          if (!Number.isFinite(next)) return
                          setDoc((d) => ({
                            ...d,
                            nodes: {
                              ...d.nodes,
                              [selectedNode.id]: {
                                ...selectedNode,
                                props: {
                                  ...selectedNode.props,
                                  radius: { ...selectedNode.props.radius, tr: clamp(next, 0, 999) },
                                },
                              },
                            },
                          }))
                        }}
                      />
                    </InputGroup>
                    <InputGroup label="右下">
                      <Input
                        inputMode="numeric"
                        value={String(Math.round(selectedNode.props.radius.br))}
                        onChange={(e) => {
                          const next = Number(e.target.value)
                          if (!Number.isFinite(next)) return
                          setDoc((d) => ({
                            ...d,
                            nodes: {
                              ...d.nodes,
                              [selectedNode.id]: {
                                ...selectedNode,
                                props: {
                                  ...selectedNode.props,
                                  radius: { ...selectedNode.props.radius, br: clamp(next, 0, 999) },
                                },
                              },
                            },
                          }))
                        }}
                      />
                    </InputGroup>
                    <InputGroup label="左下">
                      <Input
                        inputMode="numeric"
                        value={String(Math.round(selectedNode.props.radius.bl))}
                        onChange={(e) => {
                          const next = Number(e.target.value)
                          if (!Number.isFinite(next)) return
                          setDoc((d) => ({
                            ...d,
                            nodes: {
                              ...d.nodes,
                              [selectedNode.id]: {
                                ...selectedNode,
                                props: {
                                  ...selectedNode.props,
                                  radius: { ...selectedNode.props.radius, bl: clamp(next, 0, 999) },
                                },
                              },
                            },
                          }))
                        }}
                      />
                    </InputGroup>
                  </div>
                </div>
              ) : null}

              {selectedNode.type === "text" ? (
                <InputGroup label="テキスト">
                  <textarea
                    className="mt-1 h-24 w-full resize-none rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                    value={selectedNode.props.text}
                    onChange={(e) => {
                      const next = e.target.value
                      setDoc((d) => ({
                        ...d,
                        nodes: {
                          ...d.nodes,
                          [selectedNode.id]: {
                            ...selectedNode,
                            props: { ...selectedNode.props, text: next },
                          },
                        },
                      }))
                    }}
                  />
                </InputGroup>
              ) : null}

              {selectedNode.type === "image" ? (
                <InputGroup label="画像URL">
                  <Input
                    value={selectedNode.props.src}
                    onChange={(e) => {
                      const next = e.target.value
                      setDoc((d) => ({
                        ...d,
                        nodes: {
                          ...d.nodes,
                          [selectedNode.id]: {
                            ...selectedNode,
                            props: { ...selectedNode.props, src: next },
                          },
                        },
                      }))
                    }}
                  />
                </InputGroup>
              ) : null}

              <Button
                variant="destructive"
                onClick={() => {
                  setDoc((d) => {
                    const nextNodes = { ...d.nodes }
                    delete nextNodes[selectedNode.id]

                    const nextEdges: Record<string, DocEdge> = {}
                    const nextEdgeOrder: string[] = []
                    for (const edgeId of d.edgeOrder) {
                      const edge = d.edges[edgeId]
                      if (!edge) continue
                      if (edge.from === selectedNode.id || edge.to === selectedNode.id) continue
                      nextEdges[edgeId] = edge
                      nextEdgeOrder.push(edgeId)
                    }

                    return {
                      ...d,
                      nodes: nextNodes,
                      nodeOrder: d.nodeOrder.filter((x) => x !== selectedNode.id),
                      edges: nextEdges,
                      edgeOrder: nextEdgeOrder,
                    }
                  })
                  setSelection({ kind: "none" })
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
                        edges: { ...d.edges, [selectedEdge.id]: { ...selectedEdge, shape: "line" } },
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
                        edges: { ...d.edges, [selectedEdge.id]: { ...selectedEdge, shape: "curve" } },
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
                        edges: { ...d.edges, [selectedEdge.id]: { ...selectedEdge, arrow: "none" } },
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
                        edges: { ...d.edges, [selectedEdge.id]: { ...selectedEdge, arrow: "end" } },
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
                        edges: { ...d.edges, [selectedEdge.id]: { ...selectedEdge, arrow: "both" } },
                      }))
                    }
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
                      const next = Number(e.target.value)
                      if (!Number.isFinite(next)) return
                      setDoc((d) => ({
                        ...d,
                        edges: {
                          ...d.edges,
                          [selectedEdge.id]: {
                            ...selectedEdge,
                            props: { ...selectedEdge.props, width: clamp(next, 1, 24) },
                          },
                        },
                      }))
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
                              props: { ...selectedEdge.props, dash: "dashed" },
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
                    value={normalizeHexColor(selectedEdge.props.color) ?? "#111827"}
                    onChange={(e) => {
                      const next = e.target.value
                      setDoc((d) => ({
                        ...d,
                        edges: {
                          ...d.edges,
                          [selectedEdge.id]: {
                            ...selectedEdge,
                            props: { ...selectedEdge.props, color: next },
                          },
                        },
                      }))
                    }}
                  />
                  <div className="text-xs text-muted-foreground tabular-nums">{normalizeHexColor(selectedEdge.props.color) ?? selectedEdge.props.color}</div>
                </div>
              </InputGroup>

              <Button variant="destructive" onClick={() => deleteSelected()}>
                関係削除
              </Button>
            </div>
          ) : null}

          <div className="mt-6">
            <div className="text-xs font-medium text-muted-foreground">JSON</div>
            <div className="mt-1 text-xs text-muted-foreground">保存はlocalStorage（暫定）。Cmd/Ctrl+Sで書き出し。</div>
          </div>
        </div>
      </div>

      <JsonSheet
        open={jsonSheet != null}
        mode={jsonSheet?.mode ?? "export"}
        value={jsonDraft}
        error={jsonSheet?.error ?? null}
        onOpenChange={(open) => {
          if (!open) setJsonSheet(null)
        }}
        onChange={(v) => setJsonDraft(v)}
        onPrimary={async () => {
          if (jsonSheet?.mode === "export") {
            await onExport()
            return
          }
          onImportConfirm(jsonDraft)
        }}
      />
    </div>
  )
}
