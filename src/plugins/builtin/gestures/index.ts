import type { GestureRegister } from "@/components/document/sdk";
import { ClosedFistPanGestureRegister } from "./closed-fist-pan";

export function builtinGestureRegisters(): Array<GestureRegister> {
  return [new ClosedFistPanGestureRegister()];
}
