import * as React from "react";

import {
  subscribeLockedRectPreview,
  type LockedRectPreviewState,
} from "@/plugins/builtin/gestures/locked-rect-preview-bus";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const COUNTDOWN_BOX_WIDTH = 96;
const COUNTDOWN_BOX_HEIGHT = 32;
const COUNTDOWN_PADDING = 6;

export function LockedRectGesturePreview({
  viewportWidth,
  viewportHeight,
}: {
  viewportWidth: number;
  viewportHeight: number;
}) {
  const [preview, setPreview] = React.useState<LockedRectPreviewState | null>(null);

  React.useEffect(() => {
    return subscribeLockedRectPreview(setPreview);
  }, []);

  if (!preview || preview.remainingMs <= 0) {
    return null;
  }

  const centerX = preview.left + preview.width / 2;
  const centerY = preview.top + preview.height / 2;
  const badgeLeft = clamp(
    centerX - COUNTDOWN_BOX_WIDTH / 2,
    COUNTDOWN_PADDING,
    Math.max(COUNTDOWN_PADDING, viewportWidth - COUNTDOWN_BOX_WIDTH - COUNTDOWN_PADDING),
  );
  const badgeTop = clamp(
    centerY - COUNTDOWN_BOX_HEIGHT / 2,
    COUNTDOWN_PADDING,
    Math.max(COUNTDOWN_PADDING, viewportHeight - COUNTDOWN_BOX_HEIGHT - COUNTDOWN_PADDING),
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div
        className="absolute rounded-md border-4 border-dashed"
        style={{
          left: preview.left,
          top: preview.top,
          width: preview.width,
          height: preview.height,
          borderColor: "rgba(246, 255, 0, 0.6)",
        }}
      />
      <div
        className="absolute overflow-hidden rounded-lg bg-black/65 font-mono text-sm text-white"
        style={{
          left: badgeLeft,
          top: badgeTop,
          width: COUNTDOWN_BOX_WIDTH,
          height: COUNTDOWN_BOX_HEIGHT,
        }}
      >
        <div
          className="absolute inset-y-0 left-0 bg-black/35"
          style={{ width: `${clamp(preview.progress, 0, 1) * 100}%` }}
        />
        <div className="relative flex h-full items-center justify-center">
          {(preview.remainingMs / 1000).toFixed(2)}
        </div>
      </div>
    </div>
  );
}
