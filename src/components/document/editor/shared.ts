import { ATLAS_FILE_EXTENSION, ATLAS_MIME_TYPE } from "@/components/document/atlas-binary";
import type { Camera, DocEdge, DocNode, EdgeShape } from "@/components/document/model";
import { createHashId, createUniqueHashId } from "@/lib/hash-id";
import type { MermaidBuildResult } from "@/plugins/builtin/mermaid";
export {
  collectNodeStartPositions,
  mergeMermaidBuildResultIntoDocument,
  runNodeAnimation,
} from "./document-editing";

export function isTextInputTarget(target: EventTarget | null) {
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

export function matchKeybinding(keys: string, e: KeyboardEvent, isMac: boolean): boolean {
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

export function isMacPlatform() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export function newId(prefix: string, existing?: Set<string>) {
  if (existing) {
    return createUniqueHashId(prefix, existing);
  }
  return createHashId(prefix);
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function normalizeHexColor(color: string): string | null {
  const trimmed = color.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) return trimmed;

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

export function getNodeCenter(node: DocNode) {
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

export function getNodeConnectionPoint(node: DocNode, toward: { x: number; y: number }) {
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

export function computeBoundsFromNodes(nodes: Record<string, DocNode>) {
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

function translateMermaidBuildResult(
  result: MermaidBuildResult,
  offsetX: number,
  offsetY: number,
): MermaidBuildResult {
  if (offsetX === 0 && offsetY === 0) return result;

  const nodes = Object.fromEntries(
    Object.entries(result.nodes).map(([id, node]) => [
      id,
      { ...node, x: node.x + offsetX, y: node.y + offsetY },
    ]),
  );

  const animation = result.animation
    ? {
        ...result.animation,
        targetPositions: Object.fromEntries(
          Object.entries(result.animation.targetPositions).map(([id, pos]) => [
            id,
            { x: pos.x + offsetX, y: pos.y + offsetY },
          ]),
        ),
      }
    : undefined;

  const bounds = result.bounds
    ? {
        minX: result.bounds.minX + offsetX,
        minY: result.bounds.minY + offsetY,
        maxX: result.bounds.maxX + offsetX,
        maxY: result.bounds.maxY + offsetY,
      }
    : null;

  return {
    ...result,
    nodes,
    bounds,
    animation,
  };
}

export function centerMermaidBuildResultOnCamera(
  result: MermaidBuildResult,
  camera: Camera,
  viewportSize: { width: number; height: number },
) {
  const bounds = result.bounds ?? computeBoundsFromNodes(result.nodes);
  if (!bounds) return result;

  const graphCenterX = (bounds.minX + bounds.maxX) / 2;
  const graphCenterY = (bounds.minY + bounds.maxY) / 2;
  const cameraCenterX = camera.x + viewportSize.width / (2 * camera.scale);
  const cameraCenterY = camera.y + viewportSize.height / (2 * camera.scale);

  return translateMermaidBuildResult(
    result,
    cameraCenterX - graphCenterX,
    cameraCenterY - graphCenterY,
  );
}

export function centerMermaidBuildResultOnPoint(
  result: MermaidBuildResult,
  center: { x: number; y: number },
) {
  const bounds = result.bounds ?? computeBoundsFromNodes(result.nodes);
  if (!bounds) return result;

  const graphCenterX = (bounds.minX + bounds.maxX) / 2;
  const graphCenterY = (bounds.minY + bounds.maxY) / 2;

  return translateMermaidBuildResult(result, center.x - graphCenterX, center.y - graphCenterY);
}

export function sanitizeDocumentNameForFile(title: string) {
  const trimmed = title.trim();
  const base = trimmed || "document";
  const normalized = base
    .replace(/[\\/:*?"<>|]/g, "_")
    .replaceAll("\n", " ")
    .trim();
  return normalized || "document";
}

export function downloadBlob(blob: Blob, fileName: string) {
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

export function pickAtlasFile(): Promise<File | null> {
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

export function toDocPoint(
  e: { clientX: number; clientY: number },
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

export function computeEdgePathFromPoints(
  shape: EdgeShape,
  a: { x: number; y: number },
  b: { x: number; y: number },
  curveStrength = 0.25,
) {
  if (shape === "line") {
    return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  }

  const { c1x, c1y, c2x, c2y } = computeCurveControlPoints(a, b, curveStrength);
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
  const nx = (-dy / dist) * Math.min(160, dist * strength);
  const ny = (dx / dist) * Math.min(160, dist * strength);

  const c1x = a.x + dx * 0.35 + nx;
  const c1y = a.y + dy * 0.35 + ny;
  const c2x = a.x + dx * 0.65 + nx;
  const c2y = a.y + dy * 0.65 + ny;
  return { c1x, c1y, c2x, c2y };
}

export function computeEdgePath(edge: DocEdge, fromNode: DocNode, toNode: DocNode) {
  const toCenter = getNodeCenter(toNode);
  const fromCenter = getNodeCenter(fromNode);
  const a = getNodeConnectionPoint(fromNode, toCenter);
  const b = getNodeConnectionPoint(toNode, fromCenter);
  return computeEdgePathFromPoints(edge.shape, a, b, edge.props.curve ?? 0.25);
}

export function computeEdgeLabelPosition(edge: DocEdge, fromNode: DocNode, toNode: DocNode) {
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
