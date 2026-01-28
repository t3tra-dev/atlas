import type { MenuEntry } from "@/plugin";
import type { NodeTypeDefinition } from "@/components/document/sdk";
import { BUILTIN_COMMANDS, builtinAddNodeCommandId } from "./commands";

function compareJa(a: string, b: string) {
  return a.localeCompare(b, "ja");
}

export function builtinAddMenu(nodes: Array<NodeTypeDefinition>): Array<MenuEntry> {
  const shapeNodes = nodes
    .filter((d) => (d.category ?? "追加") === "図形")
    .slice()
    .sort((a, b) => compareJa(a.title, b.title));

  const otherNodes = nodes
    .filter((d) => (d.category ?? "追加") !== "図形")
    .slice()
    .sort((a, b) => compareJa(a.title, b.title));

  const nodeItems: Array<MenuEntry> = otherNodes.map((d) => ({
    kind: "item",
    id: `builtin.add.node.${d.type}`,
    label: d.title,
    command: builtinAddNodeCommandId(d.type),
  }));

  const shapeItems: Array<MenuEntry> = shapeNodes.map((d) => ({
    kind: "item",
    id: `builtin.add.node.${d.type}`,
    label: d.title,
    command: builtinAddNodeCommandId(d.type),
  }));

  const connectMenu: MenuEntry = {
    kind: "submenu",
    id: "builtin.add.connect",
    label: "線分",
    entries: [
      {
        kind: "submenu",
        id: "builtin.add.connect.line",
        label: "直線",
        entries: [
          {
            kind: "item",
            id: "builtin.add.connect.line.none",
            label: "矢印なし",
            command: BUILTIN_COMMANDS.addConnectLineNone,
          },
          {
            kind: "item",
            id: "builtin.add.connect.line.end",
            label: "片矢印",
            command: BUILTIN_COMMANDS.addConnectLineEnd,
          },
          {
            kind: "item",
            id: "builtin.add.connect.line.both",
            label: "両矢印",
            command: BUILTIN_COMMANDS.addConnectLineBoth,
          },
        ],
      },
      {
        kind: "submenu",
        id: "builtin.add.connect.curve",
        label: "曲線",
        entries: [
          {
            kind: "item",
            id: "builtin.add.connect.curve.none",
            label: "矢印なし",
            command: BUILTIN_COMMANDS.addConnectCurveNone,
          },
          {
            kind: "item",
            id: "builtin.add.connect.curve.end",
            label: "片矢印",
            command: BUILTIN_COMMANDS.addConnectCurveEnd,
          },
          {
            kind: "item",
            id: "builtin.add.connect.curve.both",
            label: "両矢印",
            command: BUILTIN_COMMANDS.addConnectCurveBoth,
          },
        ],
      },
    ],
  };

  const addMenu: Array<MenuEntry> = [...nodeItems];

  if (shapeItems.length) {
    addMenu.push({
      kind: "submenu",
      id: "builtin.add.shapes",
      label: "図形",
      entries: [
        ...shapeItems,
        { kind: "separator" },
        connectMenu,
      ],
    });
  }

  return addMenu;
}

export function builtinFileMenu(): Array<MenuEntry> {
  return [
    {
      kind: "item",
      id: "builtin.json.export",
      label: "JSON書き出し",
      shortcut: "⌘S",
      command: BUILTIN_COMMANDS.fileExportJson,
    },
    {
      kind: "item",
      id: "builtin.json.import",
      label: "JSON読み込み",
      command: BUILTIN_COMMANDS.fileImportJson,
    },
  ];
}

export function builtinEditMenu(): Array<MenuEntry> {
  return [
    {
      kind: "item",
      id: "builtin.edit.delete",
      label: "削除",
      shortcut: "⌫",
      variant: "destructive",
      command: BUILTIN_COMMANDS.editDeleteSelected,
    },
    { kind: "separator" },
    {
      kind: "item",
      id: "builtin.edit.clearSelection",
      label: "選択解除",
      shortcut: "Esc",
      command: BUILTIN_COMMANDS.editClearSelection,
    },
  ];
}

export function builtinViewMenu(): Array<MenuEntry> {
  return [
    {
      kind: "item",
      id: "builtin.view.zoomIn",
      label: "ズームイン",
      command: BUILTIN_COMMANDS.viewZoomIn,
    },
    {
      kind: "item",
      id: "builtin.view.zoomOut",
      label: "ズームアウト",
      command: BUILTIN_COMMANDS.viewZoomOut,
    },
    {
      kind: "item",
      id: "builtin.view.zoomReset",
      label: "等倍",
      command: BUILTIN_COMMANDS.viewZoomReset,
    },
    { kind: "separator" },
    {
      kind: "item",
      id: "builtin.view.toggleGrid",
      label: "グリッド切替",
      command: BUILTIN_COMMANDS.viewToggleGrid,
    },
  ];
}
