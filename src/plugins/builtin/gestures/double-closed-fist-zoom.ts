import { GestureRegister } from "@/components/document/sdk";
import type { GestureFrame, GestureRunContext } from "@/components/document/sdk";

const CLOSED_FIST_LABEL = "Closed_Fist";
const CLOSED_FIST_INDEX = 1;
const MIN_CLOSED_FIST_SCORE = 0.5;
const WRIST_INDEX = 0;
const MIN_HAND_DISTANCE_PX = 16;

type Point = {
  x: number;
  y: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export class DoubleClosedFistZoomGestureRegister extends GestureRegister {
  readonly id = "builtin.gesture.double-closed-fist-zoom";
  private previousDistancePx: number | null = null;
  private previousMidpoint: Point | null = null;

  private resetState() {
    this.previousDistancePx = null;
    this.previousMidpoint = null;
  }

  private isClosedFist(hand: GestureFrame["hands"][number]) {
    return hand.gestures.some((gesture) => {
      if (gesture.score < MIN_CLOSED_FIST_SCORE) return false;
      if (gesture.categoryName === CLOSED_FIST_LABEL) return true;
      if (gesture.displayName?.toLowerCase().replaceAll(" ", "_") === "closed_fist") return true;
      return gesture.index === CLOSED_FIST_INDEX;
    });
  }

  private toScreenPoint(raw: { x: number; y: number }, frame: GestureFrame): Point {
    const normalizedX = frame.mirrored ? 1 - raw.x : raw.x;
    return {
      x: normalizedX * frame.viewportWidth,
      y: raw.y * frame.viewportHeight,
    };
  }

  onFrame(frame: GestureFrame, ctx: GestureRunContext) {
    if (frame.hands.length < 2) {
      this.resetState();
      return;
    }

    const closedHands = frame.hands.filter((hand) => this.isClosedFist(hand));
    if (closedHands.length !== 2) {
      this.resetState();
      return;
    }

    const wristA = closedHands[0].landmarks[WRIST_INDEX];
    const wristB = closedHands[1].landmarks[WRIST_INDEX];
    if (!wristA || !wristB) {
      this.resetState();
      return;
    }

    const a = this.toScreenPoint(wristA, frame);
    const b = this.toScreenPoint(wristB, frame);
    const currentDistancePx = distance(a, b);
    if (!Number.isFinite(currentDistancePx) || currentDistancePx < MIN_HAND_DISTANCE_PX) {
      this.resetState();
      return;
    }

    const midpoint: Point = {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };

    if (this.previousDistancePx == null || this.previousMidpoint == null) {
      this.previousDistancePx = currentDistancePx;
      this.previousMidpoint = midpoint;
      return;
    }

    const ratio = currentDistancePx / this.previousDistancePx;
    this.previousDistancePx = currentDistancePx;
    this.previousMidpoint = midpoint;

    if (!Number.isFinite(ratio) || ratio <= 0) return;

    ctx.sdk.camera.set((camera) => {
      const nextScale = clamp(Number((camera.scale * ratio).toFixed(4)), 0.2, 3);
      if (Math.abs(nextScale - camera.scale) < 1e-4) {
        return camera;
      }

      const anchorWorldX = camera.x + midpoint.x / camera.scale;
      const anchorWorldY = camera.y + midpoint.y / camera.scale;

      return {
        x: anchorWorldX - midpoint.x / nextScale,
        y: anchorWorldY - midpoint.y / nextScale,
        scale: nextScale,
      };
    });
    ctx.scheduleCameraCommit(60);
  }

  onReset() {
    this.resetState();
  }
}
