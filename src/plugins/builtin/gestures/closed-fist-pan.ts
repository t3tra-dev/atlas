import { GestureRegister } from "@/components/document/sdk";
import type { GestureFrame, GestureRunContext } from "@/components/document/sdk";

const CLOSED_FIST_LABEL = "Closed_Fist";
const CLOSED_FIST_INDEX = 2;
const MIN_CLOSED_FIST_SCORE = 0.35;

type Point = {
  x: number;
  y: number;
};

export class ClosedFistPanGestureRegister extends GestureRegister {
  readonly id = "builtin.gesture.closed-fist-pan";
  private previousWrist: Point | null = null;

  private isClosedFist(hand: GestureFrame["hands"][number]) {
    return hand.gestures.some((gesture) => {
      if (gesture.score < MIN_CLOSED_FIST_SCORE) return false;
      if (gesture.categoryName === CLOSED_FIST_LABEL) return true;
      if (gesture.displayName?.toLowerCase().replaceAll(" ", "_") === "closed_fist") return true;
      return gesture.index === CLOSED_FIST_INDEX;
    });
  }

  onFrame(frame: GestureFrame, ctx: GestureRunContext) {
    const closedFistHands = frame.hands.filter((hand) => this.isClosedFist(hand));

    if (closedFistHands.length !== 1) {
      this.previousWrist = null;
      return;
    }

    const hand = closedFistHands[0];

    const wrist = hand.landmarks[0];
    if (!wrist) {
      this.previousWrist = null;
      return;
    }

    const currentWrist: Point = {
      // Match movement direction with the rendered canvas.
      x: frame.mirrored ? 1 - wrist.x : wrist.x,
      y: wrist.y,
    };

    if (!this.previousWrist) {
      this.previousWrist = currentWrist;
      return;
    }

    const dxPixels = (currentWrist.x - this.previousWrist.x) * frame.viewportWidth;
    const dyPixels = (currentWrist.y - this.previousWrist.y) * frame.viewportHeight;
    this.previousWrist = currentWrist;

    if (Math.abs(dxPixels) < 0.5 && Math.abs(dyPixels) < 0.5) {
      return;
    }

    ctx.sdk.camera.set((camera) => ({
      ...camera,
      x: camera.x - dxPixels / camera.scale,
      y: camera.y - dyPixels / camera.scale,
    }));
    ctx.scheduleCameraCommit(120);
  }

  onReset() {
    this.previousWrist = null;
  }
}
