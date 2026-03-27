import { GestureRegister } from "@/components/document/sdk";
import type { GestureFrame, GestureLandmark, GestureRunContext } from "@/components/document/sdk";
import type { DocNode } from "@/components/document/model";
import { createUniqueHashId } from "@/lib/hash-id";
import { publishLockedRectPreview } from "./locked-rect-preview-bus";

type Point = {
  x: number;
  y: number;
};

type HandMeasurement = {
  hitPoint: Point;
};

type DynamicPoints = {
  pA: Point;
  pB: Point;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function sub2(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function add2(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function mul2(a: Point, scalar: number): Point {
  return { x: a.x * scalar, y: a.y * scalar };
}

function dot2(a: Point, b: Point) {
  return a.x * b.x + a.y * b.y;
}

function cross2(a: Point, b: Point) {
  return a.x * b.y - a.y * b.x;
}

function len2(a: Point) {
  return Math.hypot(a.x, a.y);
}

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleDegBetween(a: Point, b: Point): number | null {
  const la = len2(a);
  const lb = len2(b);
  if (la <= 1e-9 || lb <= 1e-9) return null;
  const cosine = clamp(dot2(a, b) / (la * lb), -1, 1);
  return (Math.acos(cosine) * 180) / Math.PI;
}

function intersectRays2D(
  p: Point,
  r: Point,
  q: Point,
  s: Point,
): { point: Point; t: number; u: number } | null {
  const denom = cross2(r, s);
  if (Math.abs(denom) < 1e-9) return null;
  const qp = sub2(q, p);
  const t = cross2(qp, s) / denom;
  const u = cross2(qp, r) / denom;
  if (!Number.isFinite(t) || !Number.isFinite(u)) return null;
  if (t < 0 || u < 0) return null;
  return { point: add2(p, mul2(r, t)), t, u };
}

function toScreenPoint(landmark: GestureLandmark, frame: GestureFrame): Point {
  const x = frame.mirrored ? 1 - landmark.x : landmark.x;
  return {
    x: x * frame.viewportWidth,
    y: landmark.y * frame.viewportHeight,
  };
}

function isAngleOk(angleDeg: number | null) {
  return angleDeg != null && angleDeg >= 75 && angleDeg <= 105;
}

function toDynamicPoints(a: Point, b: Point): DynamicPoints {
  if (a.x < b.x || (a.x === b.x && a.y <= b.y)) {
    return { pA: a, pB: b };
  }
  return { pA: b, pB: a };
}

function createRectShapeNode(id: string, x: number, y: number, w: number, h: number): DocNode {
  return {
    id,
    type: "shape",
    x,
    y,
    w,
    h,
    props: {
      text: "",
      shape: "rect",
      fill: "rgba(59, 130, 246, 0.10)",
      stroke: "rgba(59, 130, 246, 0.55)",
      strokeWidth: 2,
      radius: 8,
    },
  };
}

export class LockedRectNodeGestureRegister extends GestureRegister {
  readonly id = "builtin.gesture.locked-rect-node";
  private stableStartMs: number | null = null;
  private stableA: Point | null = null;
  private stableB: Point | null = null;
  private created = false;

  private resetState() {
    this.stableStartMs = null;
    this.stableA = null;
    this.stableB = null;
    this.created = false;
    publishLockedRectPreview(null);
  }

  private measureHand(
    hand: GestureFrame["hands"][number],
    frame: GestureFrame,
  ): HandMeasurement | null {
    const thumbTip = hand.landmarks[4];
    const thumbIp = hand.landmarks[3];
    const indexTip = hand.landmarks[8];
    const indexPip = hand.landmarks[6];

    if (!thumbTip || !thumbIp || !indexTip || !indexPip) return null;

    const pThumb = toScreenPoint(thumbTip, frame);
    const pIndex = toScreenPoint(indexTip, frame);
    const thumbIpPoint = toScreenPoint(thumbIp, frame);
    const indexPipPoint = toScreenPoint(indexPip, frame);

    const vThumb = sub2(thumbIpPoint, pThumb);
    const vIndex = sub2(indexPipPoint, pIndex);
    const angleDeg = angleDegBetween(vThumb, vIndex);
    if (!isAngleOk(angleDeg)) return null;

    const hit = intersectRays2D(pThumb, vThumb, pIndex, vIndex);
    if (!hit) return null;

    return {
      hitPoint: hit.point,
    };
  }

  onFrame(frame: GestureFrame, ctx: GestureRunContext) {
    if (frame.viewportWidth <= 0 || frame.viewportHeight <= 0 || frame.hands.length < 2) {
      this.resetState();
      return;
    }

    const measurements = frame.hands
      .map((hand) => this.measureHand(hand, frame))
      .filter((measurement): measurement is HandMeasurement => Boolean(measurement));

    if (measurements.length < 2) {
      this.resetState();
      return;
    }

    const dynamicPoints = toDynamicPoints(measurements[0].hitPoint, measurements[1].hitPoint);
    const now = frame.timestampMs;
    const THRESH_PX = 15;
    const LOCK_MS = 1000;

    if (!this.stableA || !this.stableB || this.stableStartMs == null) {
      this.stableA = { ...dynamicPoints.pA };
      this.stableB = { ...dynamicPoints.pB };
      this.stableStartMs = now;
    }

    const movedA = dist(dynamicPoints.pA, this.stableA);
    const movedB = dist(dynamicPoints.pB, this.stableB);
    if (movedA > THRESH_PX || movedB > THRESH_PX) {
      this.stableA = { ...dynamicPoints.pA };
      this.stableB = { ...dynamicPoints.pB };
      this.stableStartMs = now;
      this.created = false;
    }

    if (this.created) {
      publishLockedRectPreview(null);
      return;
    }

    const left = Math.min(dynamicPoints.pA.x, dynamicPoints.pB.x);
    const top = Math.min(dynamicPoints.pA.y, dynamicPoints.pB.y);
    const width = Math.abs(dynamicPoints.pA.x - dynamicPoints.pB.x);
    const height = Math.abs(dynamicPoints.pA.y - dynamicPoints.pB.y);
    const stableStartMs = this.stableStartMs ?? now;
    const elapsed = now - stableStartMs;
    const remainingMs = Math.max(0, LOCK_MS - elapsed);
    publishLockedRectPreview({
      left,
      top,
      width,
      height,
      remainingMs,
      progress: clamp(elapsed / LOCK_MS, 0, 1),
    });

    if (elapsed < LOCK_MS) {
      return;
    }

    const camera = ctx.sdk.camera.get();
    const centerWorldX = camera.x + (left + width / 2) / camera.scale;
    const centerWorldY = camera.y + (top + height / 2) / camera.scale;
    const worldW = clamp(width / camera.scale, 80, 3200);
    const worldH = clamp(height / camera.scale, 60, 3200);
    const worldX = centerWorldX - worldW / 2;
    const worldY = centerWorldY - worldH / 2;
    const nodeId = createUniqueHashId("node", new Set(Object.keys(ctx.sdk.doc.get().nodes)));
    const nextNode = createRectShapeNode(nodeId, worldX, worldY, worldW, worldH);

    ctx.sdk.doc.update((doc) => ({
      ...doc,
      nodes: {
        ...doc.nodes,
        [nodeId]: nextNode,
      },
      nodeOrder: [...doc.nodeOrder, nodeId],
    }));
    ctx.sdk.selection.set({ kind: "node", id: nodeId });
    ctx.sdk.tool.set({ kind: "select" });
    this.created = true;
    publishLockedRectPreview(null);
  }

  onReset() {
    this.resetState();
  }
}
