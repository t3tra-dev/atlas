type ThreeCanvasGestureController = {
  orbitByScreenDelta: (dxPixels: number, dyPixels: number) => void;
};

const controllers = new Map<string, ThreeCanvasGestureController>();

export function registerThreeCanvasGestureController(
  nodeId: string,
  controller: ThreeCanvasGestureController,
) {
  controllers.set(nodeId, controller);
  return () => {
    const current = controllers.get(nodeId);
    if (current === controller) {
      controllers.delete(nodeId);
    }
  };
}

export function orbitThreeCanvasByScreenDelta(nodeId: string, dxPixels: number, dyPixels: number) {
  const controller = controllers.get(nodeId);
  if (!controller) return false;
  controller.orbitByScreenDelta(dxPixels, dyPixels);
  return true;
}
