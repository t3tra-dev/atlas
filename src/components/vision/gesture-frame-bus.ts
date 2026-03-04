import type { GestureFrame } from "@/components/document/sdk";

type GestureFrameListener = (frame: GestureFrame) => void;

const listeners = new Set<GestureFrameListener>();

export function publishGestureFrame(frame: GestureFrame) {
  for (const listener of listeners) {
    listener(frame);
  }
}

export function subscribeGestureFrame(listener: GestureFrameListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
