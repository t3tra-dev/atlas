import type { FlowchartShape, LayoutBox, MermaidDirection } from "./types";

export const FORCE_ATLAS2_ITERATIONS = 220;
export const FORCE_ATLAS2_SCALING_RATIO = 14;
export const FORCE_ATLAS2_GRAVITY = 0.06;
export const FORCE_ATLAS2_JITTER_TOLERANCE = 0.9;
export const FORCE_ATLAS2_PRIMARY_AXIS_BIAS = 0.035;
export const FORCE_ATLAS2_SECONDARY_AXIS_BIAS = 0.02;
export const FORCE_ATLAS2_COLLISION_PADDING = 18;
export const FORCE_ATLAS2_LAYOUT_SCALE = 0.85;
export const FORCE_ATLAS2_PADDING = 180;
export const MERMAID_LAYOUT_ANIMATION_MS = 960;
export const SEMANTIC_GROUP_MEMBER_GAP = 40;
export const SEMANTIC_CHILD_PRIMARY_GAP = 130;
export const SEMANTIC_CHILD_SECONDARY_GAP = 84;
export const BASIC_ARROW_TOKENS = ["<-->", "<==>", "-.->", "<--", "<==", "-->", "==>", "---"];

export function ensureUniqueId(base: string, existing: Set<string>) {
  let id = base;
  let i = 1;
  while (existing.has(id)) {
    i += 1;
    id = `${base}_${i}`;
  }
  existing.add(id);
  return id;
}

export function estimateNodeSize(text: string, shape: FlowchartShape) {
  const normalized = text.replace(/<br\s*\/?>/gi, "\n").replace(/\\n/g, "\n");
  const lines = normalized.split(/\n/);
  const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const baseW = Math.min(360, Math.max(140, maxLen * 8 + 36));
  const baseH = Math.max(70, lines.length * 20 + 34);

  if (shape === "circle") {
    const size = Math.max(baseW, baseH);
    return { w: size, h: size };
  }

  if (shape === "doublecircle") {
    const size = Math.max(baseW, baseH) + 16;
    return { w: size, h: size };
  }

  if (shape === "diamond") {
    const size = Math.max(baseW, baseH) + 20;
    return { w: size, h: size };
  }

  return { w: baseW, h: baseH };
}

export function measurePlacedBounds(placed: Map<string, LayoutBox>) {
  if (placed.size === 0) return null;
  return Array.from(placed.values()).reduce(
    (acc, v) => ({
      minX: Math.min(acc.minX, v.x),
      minY: Math.min(acc.minY, v.y),
      maxX: Math.max(acc.maxX, v.x + v.w),
      maxY: Math.max(acc.maxY, v.y + v.h),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

export function translatePlaced(placed: Map<string, LayoutBox>, offsetX: number, offsetY: number) {
  const next = new Map<string, LayoutBox>();
  for (const [id, pos] of placed) {
    next.set(id, { ...pos, x: pos.x + offsetX, y: pos.y + offsetY });
  }
  return next;
}

export function normalizePlaced(placed: Map<string, LayoutBox>, padding: number) {
  const bounds = measurePlacedBounds(placed);
  if (!bounds) return placed;
  return translatePlaced(placed, padding - bounds.minX, padding - bounds.minY);
}

export function scalePlacedAroundCenter(placed: Map<string, LayoutBox>, scale: number) {
  const bounds = measurePlacedBounds(placed);
  if (!bounds) return placed;

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const next = new Map<string, LayoutBox>();

  for (const [id, pos] of placed) {
    const nodeCenterX = pos.x + pos.w / 2;
    const nodeCenterY = pos.y + pos.h / 2;
    const scaledCenterX = centerX + (nodeCenterX - centerX) * scale;
    const scaledCenterY = centerY + (nodeCenterY - centerY) * scale;
    next.set(id, {
      ...pos,
      x: scaledCenterX - pos.w / 2,
      y: scaledCenterY - pos.h / 2,
    });
  }

  return next;
}

export function centerPlacedAroundOrigin(placed: Map<string, LayoutBox>) {
  const bounds = measurePlacedBounds(placed);
  if (!bounds) return placed;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return translatePlaced(placed, -centerX, -centerY);
}

export function isHorizontalDirection(direction: MermaidDirection) {
  return direction === "LR" || direction === "RL";
}

export function primaryDirectionSign(direction: MermaidDirection) {
  return direction === "RL" || direction === "BT" ? -1 : 1;
}

export function getPrimarySize(box: { w: number; h: number }, direction: MermaidDirection) {
  return isHorizontalDirection(direction) ? box.w : box.h;
}

export function getSecondarySize(box: { w: number; h: number }, direction: MermaidDirection) {
  return isHorizontalDirection(direction) ? box.h : box.w;
}

export function axesToPoint(direction: MermaidDirection, primary: number, secondary: number) {
  return isHorizontalDirection(direction)
    ? { x: primary, y: secondary }
    : { x: secondary, y: primary };
}
