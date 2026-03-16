export type LockedRectPreviewState = {
  left: number;
  top: number;
  width: number;
  height: number;
  remainingMs: number;
  progress: number;
};

type LockedRectPreviewListener = (state: LockedRectPreviewState | null) => void;

const listeners = new Set<LockedRectPreviewListener>();

export function publishLockedRectPreview(state: LockedRectPreviewState | null) {
  for (const listener of listeners) {
    listener(state);
  }
}

export function subscribeLockedRectPreview(listener: LockedRectPreviewListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
