import type { GestureRegister } from "@/components/document/sdk";
import { ClosedFistPanGestureRegister } from "./closed-fist-pan";
import { DoubleClosedFistZoomGestureRegister } from "./double-closed-fist-zoom";
import { LockedRectNodeGestureRegister } from "./locked-rect-node";
import { PinchDragNodeGestureRegister } from "./pinch-drag-node";
import { PinchToggleVoiceInputGestureRegister } from "./pinch-toggle-voice-input";

export function builtinGestureRegisters(): Array<GestureRegister> {
  return [
    new DoubleClosedFistZoomGestureRegister(),
    new LockedRectNodeGestureRegister(),
    new PinchDragNodeGestureRegister(),
    new PinchToggleVoiceInputGestureRegister(),
    new ClosedFistPanGestureRegister(),
  ];
}
