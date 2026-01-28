import type {
  CommandContribution,
  KeybindingContribution,
  PluginContext,
} from "@/plugin";
import type { DocEdge, DocumentModel, Selection } from "@/components/document/model";
import type { NodeTypeDefinition } from "@/components/document/sdk";

function deleteSelectedFromDoc(doc: DocumentModel, selection: Selection) {
  if (selection.kind === "node") {
    const id = selection.id;

    const nextNodes = { ...doc.nodes };
    delete nextNodes[id];

    const nextEdges: Record<string, DocEdge> = {};
    const nextEdgeOrder: string[] = [];
    for (const edgeId of doc.edgeOrder) {
      const edge = doc.edges[edgeId];
      if (!edge) continue;
      if (edge.from === id || edge.to === id) continue;
      nextEdges[edgeId] = edge;
      nextEdgeOrder.push(edgeId);
    }

    return {
      ...doc,
      nodes: nextNodes,
      nodeOrder: doc.nodeOrder.filter((x) => x !== id),
      edges: nextEdges,
      edgeOrder: nextEdgeOrder,
    };
  }

  if (selection.kind === "edge") {
    const edgeId = selection.id;
    const nextEdges = { ...doc.edges };
    delete nextEdges[edgeId];
    return {
      ...doc,
      edges: nextEdges,
      edgeOrder: doc.edgeOrder.filter((x) => x !== edgeId),
    };
  }

  return doc;
}

export const BUILTIN_COMMANDS = {
  fileExportJson: "file.exportJson",
  fileImportJson: "file.importJson",
  editDeleteSelected: "edit.deleteSelected",
  editClearSelection: "edit.clearSelection",
  viewZoomIn: "view.zoomIn",
  viewZoomOut: "view.zoomOut",
  viewZoomReset: "view.zoomReset",
  viewToggleGrid: "view.toggleGrid",

  addConnectLineNone: "add.connect.line.none",
  addConnectLineEnd: "add.connect.line.end",
  addConnectLineBoth: "add.connect.line.both",
  addConnectCurveNone: "add.connect.curve.none",
  addConnectCurveEnd: "add.connect.curve.end",
  addConnectCurveBoth: "add.connect.curve.both",
} as const;

export function builtinAddNodeCommandId(nodeType: string) {
  return `add.node.${nodeType}`;
}

export function builtinCommands(
  ctx: PluginContext,
  nodes: Array<NodeTypeDefinition>,
): Array<CommandContribution> {
  const nodeCommands: Array<CommandContribution> = nodes.map((d) => ({
    id: builtinAddNodeCommandId(d.type),
    title: `追加: ${d.title}`,
    run: () => ctx.sdk.tool.set({ kind: "add", nodeType: d.type }),
  }));

  return [
    ...nodeCommands,
    {
      id: BUILTIN_COMMANDS.fileExportJson,
      title: "JSON書き出し",
      run: () => ctx.sdk.ui.openJsonSheet("export"),
    },
    {
      id: BUILTIN_COMMANDS.fileImportJson,
      title: "JSON読み込み",
      run: () => ctx.sdk.ui.openJsonSheet("import"),
    },
    {
      id: BUILTIN_COMMANDS.editDeleteSelected,
      title: "削除",
      run: () => {
        const selection = ctx.sdk.selection.get();
        if (selection.kind === "none") return;

        ctx.sdk.doc.update((doc) => deleteSelectedFromDoc(doc, selection));
        ctx.sdk.selection.clear();
      },
    },
    {
      id: BUILTIN_COMMANDS.editClearSelection,
      title: "選択解除",
      run: () => {
        ctx.sdk.selection.clear();
        ctx.sdk.tool.set({ kind: "select" });
      },
    },
    {
      id: BUILTIN_COMMANDS.viewZoomIn,
      title: "ズームイン",
      run: () => ctx.sdk.viewport.zoomBy(0.1),
    },
    {
      id: BUILTIN_COMMANDS.viewZoomOut,
      title: "ズームアウト",
      run: () => ctx.sdk.viewport.zoomBy(-0.1),
    },
    {
      id: BUILTIN_COMMANDS.viewZoomReset,
      title: "等倍",
      run: () => ctx.sdk.viewport.zoomTo(1),
    },
    {
      id: BUILTIN_COMMANDS.viewToggleGrid,
      title: "グリッド切替",
      run: () =>
        ctx.sdk.doc.update((d) => ({
          ...d,
          canvas: {
            ...d.canvas,
            background: d.canvas.background === "grid" ? "plain" : "grid",
          },
        })),
    },

    {
      id: BUILTIN_COMMANDS.addConnectLineNone,
      title: "線分: 直線（矢印なし）",
      run: () =>
        ctx.sdk.tool.set({
          kind: "connect",
          edge: { shape: "line", arrow: "none" },
          fromId: null,
        }),
    },
    {
      id: BUILTIN_COMMANDS.addConnectLineEnd,
      title: "線分: 直線（片矢印）",
      run: () =>
        ctx.sdk.tool.set({
          kind: "connect",
          edge: { shape: "line", arrow: "end" },
          fromId: null,
        }),
    },
    {
      id: BUILTIN_COMMANDS.addConnectLineBoth,
      title: "線分: 直線（両矢印）",
      run: () =>
        ctx.sdk.tool.set({
          kind: "connect",
          edge: { shape: "line", arrow: "both" },
          fromId: null,
        }),
    },
    {
      id: BUILTIN_COMMANDS.addConnectCurveNone,
      title: "線分: 曲線（矢印なし）",
      run: () =>
        ctx.sdk.tool.set({
          kind: "connect",
          edge: { shape: "curve", arrow: "none" },
          fromId: null,
        }),
    },
    {
      id: BUILTIN_COMMANDS.addConnectCurveEnd,
      title: "線分: 曲線（片矢印）",
      run: () =>
        ctx.sdk.tool.set({
          kind: "connect",
          edge: { shape: "curve", arrow: "end" },
          fromId: null,
        }),
    },
    {
      id: BUILTIN_COMMANDS.addConnectCurveBoth,
      title: "線分: 曲線（両矢印）",
      run: () =>
        ctx.sdk.tool.set({
          kind: "connect",
          edge: { shape: "curve", arrow: "both" },
          fromId: null,
        }),
    },
  ];
}

export function builtinKeybindings(): Array<KeybindingContribution> {
  return [
    {
      keys: "mod+s",
      command: BUILTIN_COMMANDS.fileExportJson,
      preventDefault: true,
    },
    {
      keys: "delete",
      command: BUILTIN_COMMANDS.editDeleteSelected,
      preventDefault: true,
    },
    {
      keys: "backspace",
      command: BUILTIN_COMMANDS.editDeleteSelected,
      preventDefault: true,
    },
    {
      keys: "escape",
      command: BUILTIN_COMMANDS.editClearSelection,
      preventDefault: true,
    },
  ];
}
