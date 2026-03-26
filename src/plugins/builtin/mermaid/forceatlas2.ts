import {
  FORCE_ATLAS2_COLLISION_PADDING,
  FORCE_ATLAS2_GRAVITY,
  FORCE_ATLAS2_ITERATIONS,
  FORCE_ATLAS2_JITTER_TOLERANCE,
  FORCE_ATLAS2_PRIMARY_AXIS_BIAS,
  FORCE_ATLAS2_SCALING_RATIO,
  FORCE_ATLAS2_SECONDARY_AXIS_BIAS,
  centerPlacedAroundOrigin,
  isHorizontalDirection,
  measurePlacedBounds,
} from "./shared";

import type { ForceAtlas2NodeState, LayoutBox, MermaidDirection } from "./types";

export function runForceAtlas2OnPlaced(
  seedPlaced: Map<string, LayoutBox>,
  direction: MermaidDirection,
  edges: Array<{ from: string; to: string; weight: number }> = [],
  massById?: Map<string, number>,
) {
  if (seedPlaced.size <= 1) {
    return centerPlacedAroundOrigin(seedPlaced);
  }

  const bounds = measurePlacedBounds(seedPlaced);
  if (!bounds) return seedPlaced;

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const states: ForceAtlas2NodeState[] = Array.from(seedPlaced.entries()).map(([id, pos]) => ({
    id,
    w: pos.w,
    h: pos.h,
    x: pos.x + pos.w / 2 - centerX,
    y: pos.y + pos.h / 2 - centerY,
    dx: 0,
    dy: 0,
    oldDx: 0,
    oldDy: 0,
    mass: massById?.get(id) ?? 1,
    size: Math.max(pos.w, pos.h) / 2 + FORCE_ATLAS2_COLLISION_PADDING,
    seedPrimary: isHorizontalDirection(direction)
      ? pos.x + pos.w / 2 - centerX
      : pos.y + pos.h / 2 - centerY,
    seedSecondary: isHorizontalDirection(direction)
      ? pos.y + pos.h / 2 - centerY
      : pos.x + pos.w / 2 - centerX,
  }));

  const indexById = new Map(states.map((state, index) => [state.id, index]));
  const edgePairs = edges
    .map((edge) => {
      const fromIndex = indexById.get(edge.from);
      const toIndex = indexById.get(edge.to);
      if (fromIndex == null || toIndex == null) return null;
      return { fromIndex, toIndex, weight: edge.weight };
    })
    .filter(
      (value): value is { fromIndex: number; toIndex: number; weight: number } => value != null,
    );

  let speed = 1;
  let speedEfficiency = 1;
  const horizontal = isHorizontalDirection(direction);

  for (let iteration = 0; iteration < FORCE_ATLAS2_ITERATIONS; iteration += 1) {
    for (const state of states) {
      state.dx = 0;
      state.dy = 0;
    }

    for (let i = 0; i < states.length; i += 1) {
      const a = states[i];
      for (let j = i + 1; j < states.length; j += 1) {
        const b = states[j];
        const xDist = a.x - b.x;
        const yDist = a.y - b.y;
        const euclidean = Math.hypot(xDist, yDist);
        if (euclidean === 0) continue;
        const distance = euclidean - a.size - b.size;
        const factor =
          distance <= 0
            ? 100 * FORCE_ATLAS2_SCALING_RATIO * a.mass * b.mass
            : (FORCE_ATLAS2_SCALING_RATIO * a.mass * b.mass) / (distance * distance);
        a.dx += xDist * factor;
        a.dy += yDist * factor;
        b.dx -= xDist * factor;
        b.dy -= yDist * factor;
      }
    }

    for (const state of states) {
      const distance = Math.hypot(state.x, state.y);
      if (distance > 0) {
        const gravityFactor = (state.mass * FORCE_ATLAS2_GRAVITY) / distance;
        state.dx -= state.x * gravityFactor;
        state.dy -= state.y * gravityFactor;
      }

      const primary = horizontal ? state.x : state.y;
      const secondary = horizontal ? state.y : state.x;
      const primaryDelta = state.seedPrimary - primary;
      const secondaryDelta = state.seedSecondary - secondary;
      if (horizontal) {
        state.dx += primaryDelta * FORCE_ATLAS2_PRIMARY_AXIS_BIAS;
        state.dy += secondaryDelta * FORCE_ATLAS2_SECONDARY_AXIS_BIAS;
      } else {
        state.dy += primaryDelta * FORCE_ATLAS2_PRIMARY_AXIS_BIAS;
        state.dx += secondaryDelta * FORCE_ATLAS2_SECONDARY_AXIS_BIAS;
      }
    }

    for (const edge of edgePairs) {
      const from = states[edge.fromIndex];
      const to = states[edge.toIndex];
      const xDist = from.x - to.x;
      const yDist = from.y - to.y;
      const factor = -edge.weight;
      from.dx += xDist * factor;
      from.dy += yDist * factor;
      to.dx -= xDist * factor;
      to.dy -= yDist * factor;
    }

    let totalSwinging = 0;
    let totalEffectiveTraction = 0;
    for (const state of states) {
      const diffX = state.oldDx - state.dx;
      const diffY = state.oldDy - state.dy;
      const sumX = state.oldDx + state.dx;
      const sumY = state.oldDy + state.dy;
      const swinging = Math.hypot(diffX, diffY);
      totalSwinging += state.mass * swinging;
      totalEffectiveTraction += 0.5 * state.mass * Math.hypot(sumX, sumY);
    }

    const estimatedOptimalJitterTolerance = 0.05 * Math.sqrt(states.length || 1);
    const minJT = Math.sqrt(estimatedOptimalJitterTolerance);
    const maxJT = 10;
    let jt =
      totalEffectiveTraction > 0
        ? FORCE_ATLAS2_JITTER_TOLERANCE *
          Math.max(
            minJT,
            Math.min(
              maxJT,
              (estimatedOptimalJitterTolerance * totalEffectiveTraction) /
                Math.max(1, states.length * states.length),
            ),
          )
        : FORCE_ATLAS2_JITTER_TOLERANCE * minJT;

    const minSpeedEfficiency = 0.05;
    if (totalEffectiveTraction > 0 && totalSwinging / totalEffectiveTraction > 2) {
      if (speedEfficiency > minSpeedEfficiency) {
        speedEfficiency *= 0.5;
      }
      jt = Math.max(jt, FORCE_ATLAS2_JITTER_TOLERANCE);
    }

    const targetSpeed =
      totalSwinging === 0
        ? Number.POSITIVE_INFINITY
        : (jt * speedEfficiency * totalEffectiveTraction) / totalSwinging;

    if (totalSwinging > jt * totalEffectiveTraction) {
      if (speedEfficiency > minSpeedEfficiency) {
        speedEfficiency *= 0.7;
      }
    } else if (speed < 1000) {
      speedEfficiency *= 1.3;
    }

    speed += Math.min(targetSpeed - speed, 0.5 * speed);

    for (const state of states) {
      const diffX = state.oldDx - state.dx;
      const diffY = state.oldDy - state.dy;
      const swinging = state.mass * Math.hypot(diffX, diffY);
      let factor = speed / (1 + Math.sqrt(speed * swinging));
      const maxFactor = 10 / Math.max(1, state.size);
      if (factor > maxFactor) {
        factor = maxFactor;
      }
      state.x += state.dx * factor;
      state.y += state.dy * factor;
      state.oldDx = state.dx;
      state.oldDy = state.dy;
    }
  }

  const placed = new Map<string, LayoutBox>();
  for (const state of states) {
    placed.set(state.id, {
      x: state.x - state.w / 2,
      y: state.y - state.h / 2,
      w: state.w,
      h: state.h,
    });
  }

  return centerPlacedAroundOrigin(placed);
}
