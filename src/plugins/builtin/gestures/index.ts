import type { GestureRegister } from "@/components/document/sdk";
import { ClosedFistPanGestureRegister } from "./closed-fist-pan";
import { PinchDragNodeGestureRegister } from "./pinch-drag-node";

export function builtinGestureRegisters(): Array<GestureRegister> {
  return [new PinchDragNodeGestureRegister(), new ClosedFistPanGestureRegister()];
}
