import { GestureRegister } from "@/components/document/sdk";
import type { GestureFrame, GestureLandmark, GestureRunContext } from "@/components/document/sdk";
import type { DocumentModel } from "@/components/document/model";
import { orbitThreeCanvasByScreenDelta } from "@/plugins/builtin/three-canvas-control-bus";

const THUMB_TIP_INDEX = 4;
const INDEX_TIP_INDEX = 8;
const PINCH_THRESHOLD_PX = 25;
const MOVE_EPSILON = 1e-3;
const ORBIT_MOVE_EPSILON_PX = 0.5;
const THREE_CANVAS_HEADER_HEIGHT_PX = 32;
const CLOSED_FIST_LABEL = "Closed_Fist";
const CLOSED_FIST_INDEX = 1;
const MIN_CLOSED_FIST_SCORE = 0.5;

type Point = {
  x: number;
  y: number;
};

type PinchMeasurement = {
  centerNodeId: string | null;
  centerWorld: Point;
  centerScreen: Point;
  pinchDistancePx: number;
};

type PinchActionMode = "move-node" | "orbit-three-canvas";

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

export class PinchDragNodeGestureRegister extends GestureRegister {
  readonly id = "builtin.gesture.pinch-drag-node";
  private activeNodeId: string | null = null;
  private activeMode: PinchActionMode | null = null;
  private previousCenterWorld: Point | null = null;
  private previousCenterScreen: Point | null = null;

  private isClosedFist(hand: GestureFrame["hands"][number]) {
    return hand.gestures.some((gesture) => {
      if (gesture.score < MIN_CLOSED_FIST_SCORE) return false;
      if (gesture.categoryName === CLOSED_FIST_LABEL) return true;
      if (gesture.displayName?.toLowerCase().replaceAll(" ", "_") === "closed_fist") return true;
      return gesture.index === CLOSED_FIST_INDEX;
    });
  }

  private resetState() {
    this.activeNodeId = null;
    this.activeMode = null;
    this.previousCenterWorld = null;
    this.previousCenterScreen = null;
  }

  private collectMeasurements(
    frame: GestureFrame,
    ctx: GestureRunContext,
  ): Array<PinchMeasurement> {
    if (frame.viewportWidth <= 0 || frame.viewportHeight <= 0) return [];

    const doc = ctx.sdk.doc.get();
    const camera = ctx.sdk.camera.get();
    const measurements: Array<PinchMeasurement> = [];

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
        centerWorld,
        centerScreen: {
          x: (thumbScreen.x + indexScreen.x) / 2,
          y: (thumbScreen.y + indexScreen.y) / 2,
        },
        pinchDistancePx,
      });
    }

    return measurements;
  }

  private resolveActionMode(
    node: DocumentModel["nodes"][string],
    pointWorld: Point,
    cameraScale: number,
  ): PinchActionMode {
    if (node.type !== "three-canvas") return "move-node";
    const headerWorldHeight = THREE_CANVAS_HEADER_HEIGHT_PX / Math.max(0.01, cameraScale);
    const headerBottomY = Math.min(node.y + node.h, node.y + headerWorldHeight);
    if (pointWorld.y <= headerBottomY) {
      return "move-node";
    }
    return "orbit-three-canvas";
  }

  onFrame(frame: GestureFrame, ctx: GestureRunContext) {
    if (frame.hands.length >= 2 && frame.hands.every((hand) => this.isClosedFist(hand))) {
      this.resetState();
      return;
    }

    const measurements = this.collectMeasurements(frame, ctx);
    const candidate =
      measurements
        .filter((m) => m.pinchDistancePx <= PINCH_THRESHOLD_PX && Boolean(m.centerNodeId))
        .slice()
        .sort((a, b) => a.pinchDistancePx - b.pinchDistancePx)[0] ?? null;

    if (!candidate || !candidate.centerNodeId) {
      this.resetState();
      return;
    }

    const targetNodeId = candidate.centerNodeId;
    const doc = ctx.sdk.doc.get();
    const targetNode = doc.nodes[targetNodeId];
    if (!targetNode) {
      this.resetState();
      return;
    }
    const camera = ctx.sdk.camera.get();
    const mode = this.resolveActionMode(targetNode, candidate.centerWorld, camera.scale);

    if (
      this.activeNodeId !== targetNodeId ||
      this.activeMode !== mode ||
      !this.previousCenterWorld ||
      !this.previousCenterScreen
    ) {
      this.activeNodeId = targetNodeId;
      this.activeMode = mode;
      this.previousCenterWorld = candidate.centerWorld;
      this.previousCenterScreen = candidate.centerScreen;
      ctx.sdk.tool.set({ kind: "select" });
      ctx.sdk.selection.set({ kind: "node", id: targetNodeId });
      return;
    }

    const dx = candidate.centerWorld.x - this.previousCenterWorld.x;
    const dy = candidate.centerWorld.y - this.previousCenterWorld.y;
    const dxScreen = candidate.centerScreen.x - this.previousCenterScreen.x;
    const dyScreen = candidate.centerScreen.y - this.previousCenterScreen.y;
    this.previousCenterWorld = candidate.centerWorld;
    this.previousCenterScreen = candidate.centerScreen;

    if (this.activeMode === "orbit-three-canvas") {
      if (
        Math.abs(dxScreen) < ORBIT_MOVE_EPSILON_PX &&
        Math.abs(dyScreen) < ORBIT_MOVE_EPSILON_PX
      ) {
        return;
      }
      orbitThreeCanvasByScreenDelta(targetNodeId, dxScreen, dyScreen);
      ctx.sdk.selection.set({ kind: "node", id: targetNodeId });
      return;
    }

    if (Math.abs(dx) < MOVE_EPSILON && Math.abs(dy) < MOVE_EPSILON) {
      return;
    }

    const activeNodeId = this.activeNodeId;
    ctx.sdk.doc.update((doc) => {
      const node = doc.nodes[activeNodeId];
      if (!node) return doc;
      return {
        ...doc,
        nodes: {
          ...doc.nodes,
          [activeNodeId]: {
            ...node,
            x: node.x + dx,
            y: node.y + dy,
          },
        },
      };
    });
    ctx.sdk.selection.set({ kind: "node", id: activeNodeId });
  }

  onReset() {
    this.resetState();
  }
}
