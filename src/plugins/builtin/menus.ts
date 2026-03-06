import type { MenuEntry } from "@/plugin";
import type { NodeTypeDef } from "@/components/document/sdk";
import { BUILTIN_COMMANDS, builtinAddNodeCommandId } from "./commands";

function compareJa(a: string, b: string) {
  return a.localeCompare(b, "ja");
}

export function builtinAddMenu(nodes: Array<NodeTypeDef>): Array<MenuEntry> {
  const shapeNode = nodes.find((d) => d.type === "shape");
  const shapeNodes = nodes
    .filter((d) => (d.category ?? "追加") === "図形" && d.type !== "shape")
    .slice()
    .sort((a, b) => compareJa(a.title, b.title));

  const otherNodes = nodes
    .filter((d) => (d.category ?? "追加") !== "図形" && d.type !== "shape")
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

  if (shapeNode) {
    const shapePresetEntries: Array<MenuEntry> = [
      {
        kind: "item",
        id: "builtin.shape.rect",
        label: "四角形",
        command: BUILTIN_COMMANDS.addShapeRect,
      },
      {
        kind: "item",
        id: "builtin.shape.stadium",
        label: "スタジアム",
        command: BUILTIN_COMMANDS.addShapeStadium,
      },
      {
        kind: "item",
        id: "builtin.shape.circle",
        label: "円",
        command: BUILTIN_COMMANDS.addShapeCircle,
      },
      {
        kind: "item",
        id: "builtin.shape.doublecircle",
        label: "二重円",
        command: BUILTIN_COMMANDS.addShapeDoubleCircle,
      },
      {
        kind: "item",
        id: "builtin.shape.diamond",
        label: "ダイヤ",
        command: BUILTIN_COMMANDS.addShapeDiamond,
      },
      {
        kind: "item",
        id: "builtin.shape.hexagon",
        label: "六角形",
        command: BUILTIN_COMMANDS.addShapeHexagon,
      },
      {
        kind: "item",
        id: "builtin.shape.parallelogram",
        label: "平行四辺形",
        command: BUILTIN_COMMANDS.addShapeParallelogram,
      },
      {
        kind: "item",
        id: "builtin.shape.trapezoid",
        label: "台形",
        command: BUILTIN_COMMANDS.addShapeTrapezoid,
      },
      {
        kind: "item",
        id: "builtin.shape.invtrapezoid",
        label: "逆台形",
        command: BUILTIN_COMMANDS.addShapeInvTrapezoid,
      },
      {
        kind: "item",
        id: "builtin.shape.subroutine",
        label: "サブルーチン",
        command: BUILTIN_COMMANDS.addShapeSubroutine,
      },
      {
        kind: "item",
        id: "builtin.shape.cylinder",
        label: "データベース",
        command: BUILTIN_COMMANDS.addShapeCylinder,
      },
    ];

    addMenu.push({
      kind: "submenu",
      id: "builtin.add.shapes",
      label: "図形",
      entries: [
        ...shapePresetEntries,
        ...(shapeItems.length ? [{ kind: "separator" } as MenuEntry, ...shapeItems] : []),
        { kind: "separator" } as MenuEntry,
        connectMenu,
      ],
    });

    return addMenu;
  }

  if (shapeItems.length) {
    addMenu.push({
      kind: "submenu",
      id: "builtin.add.shapes",
      label: "図形",
      entries: [...shapeItems, { kind: "separator" }, connectMenu],
    });
  }

  return addMenu;
}

export function builtinFileMenu(): Array<MenuEntry> {
  return [
    {
      kind: "item",
      id: "builtin.atlas.export",
      label: "ATLAS書き出し",
      shortcut: "⌘S",
      command: BUILTIN_COMMANDS.fileExportAtlas,
    },
    {
      kind: "item",
      id: "builtin.atlas.import",
      label: "ATLAS読み込み",
      command: BUILTIN_COMMANDS.fileImportAtlas,
    },
    {
      kind: "item",
      id: "builtin.mermaid.import",
      label: "Mermaid読み込み",
      command: BUILTIN_COMMANDS.fileImportMermaid,
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
