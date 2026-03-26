import { runForceAtlas2OnPlaced } from "./forceatlas2";
import {
  FORCE_ATLAS2_LAYOUT_SCALE,
  FORCE_ATLAS2_PADDING,
  SEMANTIC_CHILD_PRIMARY_GAP,
  SEMANTIC_CHILD_SECONDARY_GAP,
  SEMANTIC_GROUP_MEMBER_GAP,
  axesToPoint,
  centerPlacedAroundOrigin,
  estimateNodeSize,
  getPrimarySize,
  getSecondarySize,
  isHorizontalDirection,
  normalizePlaced,
  primaryDirectionSign,
  scalePlacedAroundCenter,
} from "./shared";

import type {
  FlowchartEdge,
  FlowchartNode,
  LayoutBox,
  MermaidDirection,
  MermaidLayoutResult,
  MindmapEdge,
  MindmapNode,
  SemanticFlowchartGroup,
} from "./types";

function seedBoxesForItems(
  items: Array<{ id: string; w: number; h: number }>,
  direction: MermaidDirection,
) {
  const placed = new Map<string, LayoutBox>();
  if (items.length === 0) return placed;

  const gap = 120;
  if (isHorizontalDirection(direction)) {
    let y = 0;
    const maxWidth = Math.max(...items.map((item) => item.w));
    for (const item of items) {
      placed.set(item.id, {
        x: (maxWidth - item.w) / 2,
        y,
        w: item.w,
        h: item.h,
      });
      y += item.h + gap;
    }
  } else {
    let x = 0;
    const maxHeight = Math.max(...items.map((item) => item.h));
    for (const item of items) {
      placed.set(item.id, {
        x,
        y: (maxHeight - item.h) / 2,
        w: item.w,
        h: item.h,
      });
      x += item.w + gap;
    }
  }

  return centerPlacedAroundOrigin(placed);
}

function createSemanticGroupLayout(
  nodesById: Map<string, FlowchartNode>,
  memberIds: string[],
  direction: MermaidDirection,
) {
  const horizontal = isHorizontalDirection(direction);
  const placed = new Map<string, LayoutBox>();
  const sizes = memberIds.map((id) => {
    const node = nodesById.get(id)!;
    return { id, ...estimateNodeSize(node.text, node.shape) };
  });

  if (sizes.length === 0) {
    return { memberPlaced: placed, w: 0, h: 0 };
  }

  if (horizontal) {
    let y = 0;
    const width = Math.max(...sizes.map((size) => size.w));
    for (const size of sizes) {
      placed.set(size.id, {
        x: (width - size.w) / 2,
        y,
        w: size.w,
        h: size.h,
      });
      y += size.h + SEMANTIC_GROUP_MEMBER_GAP;
    }
    return {
      memberPlaced: placed,
      w: width,
      h: y - SEMANTIC_GROUP_MEMBER_GAP,
    };
  }

  let x = 0;
  const height = Math.max(...sizes.map((size) => size.h));
  for (const size of sizes) {
    placed.set(size.id, {
      x,
      y: (height - size.h) / 2,
      w: size.w,
      h: size.h,
    });
    x += size.w + SEMANTIC_GROUP_MEMBER_GAP;
  }
  return {
    memberPlaced: placed,
    w: x - SEMANTIC_GROUP_MEMBER_GAP,
    h: height,
  };
}

function buildSemanticFlowchartGraph(
  nodes: Array<FlowchartNode>,
  edges: Array<FlowchartEdge>,
  direction: MermaidDirection,
) {
  const nodeIds = nodes.map((node) => node.id);
  const nodeOrder = new Map(nodeIds.map((id, index) => [id, index]));
  const parent = new Map(nodeIds.map((id) => [id, id]));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  const find = (id: string): string => {
    let current = parent.get(id) ?? id;
    while (current !== (parent.get(current) ?? current)) {
      current = parent.get(current) ?? current;
    }
    let cursor = id;
    while (cursor !== current) {
      const next = parent.get(cursor) ?? cursor;
      parent.set(cursor, current);
      cursor = next;
    }
    return current;
  };

  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    const orderA = nodeOrder.get(rootA) ?? 0;
    const orderB = nodeOrder.get(rootB) ?? 0;
    if (orderA <= orderB) {
      parent.set(rootB, rootA);
    } else {
      parent.set(rootA, rootB);
    }
  };

  for (const edge of edges) {
    if (edge.arrow !== "end") {
      union(edge.from, edge.to);
    }
  }

  const groupMembers = new Map<string, string[]>();
  for (const nodeId of nodeIds) {
    const root = find(nodeId);
    const members = groupMembers.get(root) ?? [];
    members.push(nodeId);
    groupMembers.set(root, members);
  }

  const groups = new Map<string, SemanticFlowchartGroup>();
  const groupOrder = Array.from(groupMembers.entries())
    .map(([groupId, members]) => ({
      id: groupId,
      members: members.slice().sort((a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0)),
    }))
    .sort((a, b) => (nodeOrder.get(a.members[0]) ?? 0) - (nodeOrder.get(b.members[0]) ?? 0));

  const nodeToGroup = new Map<string, string>();
  for (const entry of groupOrder) {
    const layout = createSemanticGroupLayout(nodesById, entry.members, direction);
    groups.set(entry.id, {
      id: entry.id,
      members: entry.members,
      order: nodeOrder.get(entry.members[0]) ?? 0,
      w: layout.w,
      h: layout.h,
      memberPlaced: layout.memberPlaced,
    });
    for (const memberId of entry.members) {
      nodeToGroup.set(memberId, entry.id);
    }
  }

  const directedEdges: Array<{ from: string; to: string; weight: number }> = [];
  const edgeKeys = new Set<string>();
  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  for (const groupId of groups.keys()) {
    outgoing.set(groupId, []);
    incomingCount.set(groupId, 0);
  }

  for (const edge of edges) {
    if (edge.arrow !== "end") continue;
    const fromGroup = nodeToGroup.get(edge.from);
    const toGroup = nodeToGroup.get(edge.to);
    if (!fromGroup || !toGroup || fromGroup === toGroup) continue;
    const key = `${fromGroup}->${toGroup}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    directedEdges.push({ from: fromGroup, to: toGroup, weight: edge.width >= 3 ? 1.3 : 1 });
    outgoing.get(fromGroup)?.push(toGroup);
    incomingCount.set(toGroup, (incomingCount.get(toGroup) ?? 0) + 1);
  }

  const orderedGroupIds = groupOrder.map((entry) => entry.id);
  const roots = orderedGroupIds.filter((groupId) => (incomingCount.get(groupId) ?? 0) === 0);
  if (roots.length === 0 && orderedGroupIds.length > 0) {
    roots.push(orderedGroupIds[0]);
  }

  const rootSet = new Set(roots);
  const treeChildren = new Map<string, string[]>();
  for (const groupId of orderedGroupIds) {
    treeChildren.set(groupId, []);
  }

  const assignedParent = new Map<string, string>();
  const assignFromRoot = (rootId: string) => {
    const queue = [rootId];
    const seen = new Set<string>([rootId]);
    while (queue.length) {
      const groupId = queue.shift()!;
      const nextGroups = (outgoing.get(groupId) ?? [])
        .slice()
        .sort((a, b) => (groups.get(a)?.order ?? 0) - (groups.get(b)?.order ?? 0));
      for (const nextId of nextGroups) {
        if (!rootSet.has(nextId) && !assignedParent.has(nextId)) {
          assignedParent.set(nextId, groupId);
          treeChildren.get(groupId)?.push(nextId);
        }
        if (!seen.has(nextId)) {
          seen.add(nextId);
          queue.push(nextId);
        }
      }
    }
  };

  for (const rootId of roots) {
    assignFromRoot(rootId);
  }

  for (const groupId of orderedGroupIds) {
    if (rootSet.has(groupId) || assignedParent.has(groupId)) continue;
    roots.push(groupId);
    rootSet.add(groupId);
    assignFromRoot(groupId);
  }

  return {
    groups,
    roots,
    treeChildren,
    directedEdges,
  };
}

function compressPlacedForAnimation(
  placed: Map<string, LayoutBox>,
  direction: MermaidDirection,
  order: string[],
) {
  const bounds = Array.from(placed.values()).reduce(
    (acc, v) => ({
      minX: Math.min(acc.minX, v.x),
      minY: Math.min(acc.minY, v.y),
      maxX: Math.max(acc.maxX, v.x + v.w),
      maxY: Math.max(acc.maxY, v.y + v.h),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  if (!Number.isFinite(bounds.minX)) return placed;

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const next = new Map<string, LayoutBox>();
  const collapseFactor = 0.16;
  const horizontal = isHorizontalDirection(direction);

  order.forEach((id, index) => {
    const pos = placed.get(id);
    if (!pos) return;
    const nodeCenterX = pos.x + pos.w / 2;
    const nodeCenterY = pos.y + pos.h / 2;
    const angle = index * 0.85;
    const orbit = 18 + (index % 5) * 8;
    const biasX = horizontal ? Math.cos(angle) * orbit : Math.sin(angle) * orbit * 0.75;
    const biasY = horizontal ? Math.sin(angle) * orbit * 0.75 : Math.cos(angle) * orbit;
    const nextCenterX = centerX + (nodeCenterX - centerX) * collapseFactor + biasX;
    const nextCenterY = centerY + (nodeCenterY - centerY) * collapseFactor + biasY;
    next.set(id, {
      ...pos,
      x: nextCenterX - pos.w / 2,
      y: nextCenterY - pos.h / 2,
    });
  });

  return next;
}

export function layoutFlowchart(
  nodes: Array<FlowchartNode>,
  edges: Array<FlowchartEdge>,
  direction: MermaidDirection,
): MermaidLayoutResult {
  const semantic = buildSemanticFlowchartGraph(nodes, edges, direction);
  const horizontal = isHorizontalDirection(direction);
  const sign = primaryDirectionSign(direction);
  const orderedNodeIds = nodes.map((node) => node.id);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const subtreeSecondarySpan = new Map<string, number>();

  const measureSubtreeSecondarySpan = (groupId: string): number => {
    const cached = subtreeSecondarySpan.get(groupId);
    if (cached != null) return cached;
    const group = semantic.groups.get(groupId)!;
    const children = semantic.treeChildren.get(groupId) ?? [];
    const own = getSecondarySize(group, direction);
    if (children.length === 0) {
      subtreeSecondarySpan.set(groupId, own);
      return own;
    }
    const childTotal =
      children.reduce((sum, childId) => sum + measureSubtreeSecondarySpan(childId), 0) +
      SEMANTIC_CHILD_SECONDARY_GAP * (children.length - 1);
    const span = Math.max(own, childTotal);
    subtreeSecondarySpan.set(groupId, span);
    return span;
  };

  for (const groupId of semantic.groups.keys()) {
    measureSubtreeSecondarySpan(groupId);
  }

  const rootItems = semantic.roots.map((groupId) => {
    const group = semantic.groups.get(groupId)!;
    return horizontal
      ? {
          id: groupId,
          w: group.w,
          h: Math.max(group.h, subtreeSecondarySpan.get(groupId) ?? group.h),
        }
      : {
          id: groupId,
          w: Math.max(group.w, subtreeSecondarySpan.get(groupId) ?? group.w),
          h: group.h,
        };
  });
  const rootSeedPlaced = seedBoxesForItems(rootItems, direction);
  const rootPlaced = runForceAtlas2OnPlaced(rootSeedPlaced, direction, semantic.directedEdges);

  const placed = new Map<string, LayoutBox>();
  const order: string[] = [];
  const placedGroups = new Set<string>();

  const placeGroup = (groupId: string, centerX: number, centerY: number) => {
    if (placedGroups.has(groupId)) return;
    placedGroups.add(groupId);

    const group = semantic.groups.get(groupId)!;
    const groupLeft = centerX - group.w / 2;
    const groupTop = centerY - group.h / 2;
    for (const memberId of group.members) {
      const local = group.memberPlaced.get(memberId)!;
      placed.set(memberId, {
        x: groupLeft + local.x,
        y: groupTop + local.y,
        w: local.w,
        h: local.h,
      });
      order.push(memberId);
    }

    const children = (semantic.treeChildren.get(groupId) ?? [])
      .slice()
      .sort((a, b) => (semantic.groups.get(a)?.order ?? 0) - (semantic.groups.get(b)?.order ?? 0));
    if (children.length === 0) return;

    const parentPrimary = horizontal ? centerX : centerY;
    const parentSecondary = horizontal ? centerY : centerX;
    const parentPrimarySize = getPrimarySize(group, direction);
    const totalSecondarySpan =
      children.reduce((sum, childId) => sum + (subtreeSecondarySpan.get(childId) ?? 0), 0) +
      SEMANTIC_CHILD_SECONDARY_GAP * (children.length - 1);

    let cursor = parentSecondary - totalSecondarySpan / 2;
    for (const childId of children) {
      const childGroup = semantic.groups.get(childId)!;
      const childSpan =
        subtreeSecondarySpan.get(childId) ?? getSecondarySize(childGroup, direction);
      const childPrimarySize = getPrimarySize(childGroup, direction);
      const childSecondary = cursor + childSpan / 2;
      const childPrimary =
        parentPrimary +
        sign * (parentPrimarySize / 2 + SEMANTIC_CHILD_PRIMARY_GAP + childPrimarySize / 2);
      const childCenter = axesToPoint(direction, childPrimary, childSecondary);
      placeGroup(childId, childCenter.x, childCenter.y);
      cursor += childSpan + SEMANTIC_CHILD_SECONDARY_GAP;
    }
  };

  for (const rootId of semantic.roots) {
    const rootBox = rootPlaced.get(rootId);
    if (!rootBox) continue;
    placeGroup(rootId, rootBox.x + rootBox.w / 2, rootBox.y + rootBox.h / 2);
  }

  for (const nodeId of orderedNodeIds) {
    if (placed.has(nodeId)) continue;
    const node = nodesById.get(nodeId);
    if (!node) continue;
    const size = estimateNodeSize(node.text, node.shape);
    placed.set(nodeId, { x: 0, y: 0, w: size.w, h: size.h });
    order.push(nodeId);
  }

  const normalizedPlaced = normalizePlaced(
    scalePlacedAroundCenter(placed, FORCE_ATLAS2_LAYOUT_SCALE),
    FORCE_ATLAS2_PADDING,
  );
  const initialPlaced = compressPlacedForAnimation(normalizedPlaced, direction, order);

  return {
    placed: normalizedPlaced,
    order,
    initialPlaced,
  };
}

export function layoutMindmap(
  nodes: Array<MindmapNode>,
  edges: Array<MindmapEdge>,
  rootId: string | null,
): MermaidLayoutResult {
  if (!rootId) {
    return {
      placed: new Map<string, LayoutBox>(),
      order: [],
      initialPlaced: new Map<string, LayoutBox>(),
    };
  }

  const childrenMap = new Map<string, string[]>();
  for (const node of nodes) {
    childrenMap.set(node.id, []);
  }
  for (const edge of edges) {
    childrenMap.get(edge.from)?.push(edge.to);
  }

  const sizeMap = new Map<string, { w: number; h: number }>();
  for (const node of nodes) {
    sizeMap.set(node.id, estimateNodeSize(node.text, node.shape));
  }

  const gapX = 240;
  const gapY = 60;
  const placed = new Map<string, LayoutBox>();
  const order: string[] = [];

  const subtreeHeight = (id: string): number => {
    const children = childrenMap.get(id) ?? [];
    const own = sizeMap.get(id)?.h ?? 60;
    if (!children.length) return own;
    const total =
      children.map((child) => subtreeHeight(child)).reduce((a, b) => a + b, 0) +
      gapY * (children.length - 1);
    return Math.max(own, total);
  };

  const placeNode = (id: string, x: number, y: number) => {
    const size = sizeMap.get(id) ?? { w: 160, h: 80 };
    placed.set(id, { x, y, w: size.w, h: size.h });
    order.push(id);
  };

  const layoutBranch = (
    parentId: string,
    childIds: string[],
    branchDirection: "left" | "right",
    startY: number,
  ) => {
    let y = startY;
    for (const childId of childIds) {
      const size = sizeMap.get(childId) ?? { w: 160, h: 80 };
      const height = subtreeHeight(childId);
      const parentPos = placed.get(parentId)!;
      const childX =
        branchDirection === "right"
          ? parentPos.x + parentPos.w + gapX
          : parentPos.x - gapX - size.w;
      const childY = y + (height - size.h) / 2;
      placeNode(childId, childX, childY);
      const grand = childrenMap.get(childId) ?? [];
      if (grand.length) {
        layoutBranch(childId, grand, branchDirection, y);
      }
      y += height + gapY;
    }
  };

  const rootSize = sizeMap.get(rootId) ?? { w: 200, h: 100 };
  placeNode(rootId, 0, 0);

  const rootChildren = childrenMap.get(rootId) ?? [];
  const left: string[] = [];
  const right: string[] = [];
  rootChildren.forEach((id, idx) => {
    (idx % 2 === 0 ? right : left).push(id);
  });

  const rightHeight =
    right.reduce((sum, id) => sum + subtreeHeight(id), 0) +
    (right.length > 0 ? gapY * (right.length - 1) : 0);
  const leftHeight =
    left.reduce((sum, id) => sum + subtreeHeight(id), 0) +
    (left.length > 0 ? gapY * (left.length - 1) : 0);

  const rootCenterY = rootSize.h / 2;
  if (right.length) {
    layoutBranch(rootId, right, "right", rootCenterY - rightHeight / 2);
  }
  if (left.length) {
    layoutBranch(rootId, left, "left", rootCenterY - leftHeight / 2);
  }

  const normalizedPlaced = normalizePlaced(placed, 200);
  return {
    placed: normalizedPlaced,
    order,
    initialPlaced: normalizedPlaced,
  };
}
