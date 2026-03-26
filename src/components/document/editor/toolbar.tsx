import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/components/ui/menubar";
import type { Tool } from "@/components/document/model";
import type { MenuEntry } from "@/plugin";
import { MessageSquareIcon } from "lucide-react";

function renderMenuEntries(
  entries: Array<MenuEntry>,
  keyPrefix: string,
  onExecuteCommand: (command: string) => void,
): React.ReactNode {
  return entries.map((entry, i) => {
    if (entry.kind === "separator") {
      return <MenubarSeparator key={`${keyPrefix}-sep-${i}`} />;
    }

    if (entry.kind === "submenu") {
      const key = entry.id ?? `${keyPrefix}-submenu-${i}`;
      return (
        <MenubarSub key={key}>
          <MenubarSubTrigger disabled={entry.disabled}>{entry.label}</MenubarSubTrigger>
          <MenubarSubContent>
            {renderMenuEntries(entry.entries, `${keyPrefix}-${key}`, onExecuteCommand)}
          </MenubarSubContent>
        </MenubarSub>
      );
    }

    const key = entry.id ?? `${keyPrefix}-item-${i}`;
    return (
      <MenubarItem
        key={key}
        onSelect={() => {
          if (entry.onSelect) return entry.onSelect();
          if (entry.command) return onExecuteCommand(entry.command);
        }}
        variant={entry.variant ?? "default"}
        disabled={entry.disabled}
      >
        {entry.label}
        {entry.shortcut ? <MenubarShortcut>{entry.shortcut}</MenubarShortcut> : null}
      </MenubarItem>
    );
  });
}

export function DocumentEditorToolbar({
  addMenuEntries,
  fileMenuEntries,
  editMenuEntries,
  viewMenuEntries,
  onExecuteCommand,
  onReset,
  onZoomOut,
  onZoomIn,
  zoomPercent,
  tool,
  onSelectTool,
  chatOpen,
  onToggleChat,
}: {
  addMenuEntries: Array<MenuEntry>;
  fileMenuEntries: Array<MenuEntry>;
  editMenuEntries: Array<MenuEntry>;
  viewMenuEntries: Array<MenuEntry>;
  onExecuteCommand: (command: string) => void;
  onReset: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  zoomPercent: number;
  tool: Tool;
  onSelectTool: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
      <Menubar className="h-9">
        <MenubarMenu>
          <MenubarTrigger>追加</MenubarTrigger>
          <MenubarContent>
            {renderMenuEntries(addMenuEntries, "add", onExecuteCommand)}
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger>ファイル</MenubarTrigger>
          <MenubarContent>
            {renderMenuEntries(fileMenuEntries, "file", onExecuteCommand)}

            {fileMenuEntries.length ? <MenubarSeparator /> : null}
            <MenubarItem variant="destructive" onSelect={onReset}>
              リセット
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger>編集</MenubarTrigger>
          <MenubarContent>
            {renderMenuEntries(editMenuEntries, "edit", onExecuteCommand)}
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger>表示</MenubarTrigger>
          <MenubarContent>
            {renderMenuEntries(viewMenuEntries, "view", onExecuteCommand)}
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" onClick={onZoomOut}>
          −
        </Button>
        <div className="min-w-14 text-center text-xs tabular-nums">{zoomPercent}%</div>
        <Button size="sm" variant="outline" onClick={onZoomIn}>
          ＋
        </Button>
      </div>

      <div className="ml-2 flex items-center gap-1">
        <Button
          size="sm"
          variant={tool.kind === "select" ? "default" : "outline"}
          onClick={onSelectTool}
        >
          選択
        </Button>
        {tool.kind === "add" ? (
          <div className="text-xs text-muted-foreground">配置モード</div>
        ) : null}
        {tool.kind === "connect" ? (
          <div className="text-xs text-muted-foreground">接続モード</div>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button
          size="icon"
          variant={chatOpen ? "default" : "outline"}
          aria-label="チャットを開く"
          onClick={onToggleChat}
        >
          <MessageSquareIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}
