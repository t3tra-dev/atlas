import { GestureRegister } from "@/components/document/sdk";
import type { GestureFrame, GestureLandmark, GestureRunContext } from "@/components/document/sdk";
import type { DocumentModel } from "@/components/document/model";
import { publishVoiceInputToggle } from "./voice-input-toggle-bus";

const THUMB_TIP_INDEX = 4;
const INDEX_TIP_INDEX = 8;
const PINCH_THRESHOLD_PX = 30;
const DOUBLE_TAP_WINDOW_MS = 500;

type Point = {
  x: number;
  y: number;
};

type PinchMeasurement = {
  centerNodeId: string | null;
  pinchDistancePx: number;
};

function toScreenPoint(landmark: GestureLandmark, frame: GestureFrame): Point {
  const x = frame.mirrored ? 1 - landmark.x : landmark.x;
  return {
    x: x * frame.viewportWidth,
    y: landmark.y * frame.viewportHeight,
  };
}

function toWorldPoint(screen: Point, camera: { x: number; y: number; scale: number }): Point {
  return {
    x: camera.x + screen.x / camera.scale,
    y: camera.y + screen.y / camera.scale,
  };
}

function computeDistancePx(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointInNode(point: Point, node: { x: number; y: number; w: number; h: number }) {
  return (
    point.x >= node.x &&
    point.x <= node.x + node.w &&
    point.y >= node.y &&
    point.y <= node.y + node.h
  );
}

function findTopNodeIdAtPoint(doc: DocumentModel, point: Point): string | null {
  for (let i = doc.nodeOrder.length - 1; i >= 0; i -= 1) {
    const nodeId = doc.nodeOrder[i];
    const node = doc.nodes[nodeId];
    if (!node) continue;
    if (!pointInNode(point, node)) continue;
    return nodeId;
  }
  return null;
}

export class PinchToggleVoiceInputGestureRegister extends GestureRegister {
  readonly id = "builtin.gesture.pinch-toggle-voice-input";
  private lastTapAt: number | null = null;
  private wasPinching = false;

  private resetState() {
    this.lastTapAt = null;
    this.wasPinching = false;
  }

  private collectMeasurements(frame: GestureFrame, ctx: GestureRunContext): PinchMeasurement[] {
    if (frame.viewportWidth <= 0 || frame.viewportHeight <= 0) return [];

    const doc = ctx.sdk.doc.get();
    const camera = ctx.sdk.camera.get();
    const measurements: PinchMeasurement[] = [];

    for (const hand of frame.hands) {
      const thumb = hand.landmarks[THUMB_TIP_INDEX];
      const index = hand.landmarks[INDEX_TIP_INDEX];
      if (!thumb || !index) continue;

      const thumbScreen = toScreenPoint(thumb, frame);
      const indexScreen = toScreenPoint(index, frame);
      const pinchDistancePx = computeDistancePx(thumbScreen, indexScreen);

      const thumbWorld = toWorldPoint(thumbScreen, camera);
      const indexWorld = toWorldPoint(indexScreen, camera);
      const centerWorld = {
        x: (thumbWorld.x + indexWorld.x) / 2,
        y: (thumbWorld.y + indexWorld.y) / 2,
      };
      const centerNodeId = findTopNodeIdAtPoint(doc, centerWorld);

      measurements.push({
        centerNodeId,
        pinchDistancePx,
      });
    }

    return measurements;
  }

  onFrame(frame: GestureFrame, ctx: GestureRunContext) {
    const now = frame.timestampMs;
    const measurements = this.collectMeasurements(frame, ctx);
    const candidate =
      measurements
        .filter((measurement) => measurement.pinchDistancePx <= PINCH_THRESHOLD_PX)
        .slice()
        .sort((a, b) => a.pinchDistancePx - b.pinchDistancePx)[0] ?? null;

    if (!candidate) {
      this.wasPinching = false;
      if (this.lastTapAt && now - this.lastTapAt > DOUBLE_TAP_WINDOW_MS) {
        this.lastTapAt = null;
      }
      return;
    }

    if (this.wasPinching) {
      return;
    }

    this.wasPinching = true;

    if (candidate.centerNodeId) {
      this.lastTapAt = null;
      return;
    }

    if (this.lastTapAt && now - this.lastTapAt <= DOUBLE_TAP_WINDOW_MS) {
      this.lastTapAt = null;
      publishVoiceInputToggle({ source: "gesture", timestampMs: now });
      return;
    }

    this.lastTapAt = now;
  }

  onReset() {
    this.resetState();
  }
}
