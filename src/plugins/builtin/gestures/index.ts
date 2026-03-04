import type { GestureRegister } from "@/components/document/sdk";
import { ClosedFistPanGestureRegister } from "./closed-fist-pan";
import { DoubleClosedFistZoomGestureRegister } from "./double-closed-fist-zoom";
import { PinchDragNodeGestureRegister } from "./pinch-drag-node";

export function builtinGestureRegisters(): Array<GestureRegister> {
  return [
    new DoubleClosedFistZoomGestureRegister(),
    new PinchDragNodeGestureRegister(),
    new ClosedFistPanGestureRegister(),
  ];
}
