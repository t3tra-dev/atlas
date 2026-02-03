import * as React from "react";
import { PanelLeftIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useDocumentStore } from "@/components/document/store";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function AppSidebar() {
  const { state, setOpen, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { docs, activeId, setActiveId, createDoc, renameDoc, deleteDoc } = useDocumentStore();
  const [query, setQuery] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingTitle, setEditingTitle] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null);
  const editRef = React.useRef<HTMLInputElement | null>(null);

  const normalizedQuery = query.trim().toLowerCase();

  const getDocBodyText = React.useCallback(
    (doc: { nodes: Record<string, { props?: Record<string, unknown> }> }) => {
      const parts: string[] = [];
      for (const node of Object.values(doc.nodes)) {
        const props = node.props ?? {};
        for (const value of Object.values(props)) {
          if (typeof value === "string") parts.push(value);
        }
      }
      return parts.join(" ").toLowerCase();
    },
    [],
  );

  const filteredDocs = React.useMemo(() => {
    if (!normalizedQuery) return docs;
    const titleMatches: typeof docs = [];
    const bodyMatches: typeof docs = [];

    for (const doc of docs) {
      const title = String(doc.title ?? "").toLowerCase();
      if (title.includes(normalizedQuery)) {
        titleMatches.push(doc);
        continue;
      }
      const body = getDocBodyText(doc.doc);
      if (body.includes(normalizedQuery)) {
        bodyMatches.push(doc);
      }
    }

    return [...titleMatches, ...bodyMatches];
  }, [docs, getDocBodyText, normalizedQuery]);

  React.useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingId]);

  const startRename = React.useCallback((id: string, title: string) => {
    setEditingId(id);
    setEditingTitle(String(title ?? ""));
  }, []);

  const commitRename = React.useCallback(() => {
    if (!editingId) return;
    const nextTitle = editingTitle.trim();
    if (nextTitle) {
      renameDoc(editingId, nextTitle);
    }
    setEditingId(null);
  }, [editingId, editingTitle, renameDoc]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {isCollapsed ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                tooltip="検索"
                onClick={() => setOpen(true)}
                aria-label="検索"
              >
                <SearchIcon />
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                tooltip="新規ドキュメント"
                className="bg-white text-black border border-black/20 hover:bg-white/90 hover:text-black dark:bg-white dark:text-black"
                onClick={() => {
                  createDoc();
                  setOpen(true);
                }}
                aria-label="新規ドキュメント"
              >
                <PlusIcon />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        ) : (
          <>
            <SidebarInput
              placeholder="検索…"
              aria-label="ドキュメントを検索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button
              className="w-full justify-start bg-white text-black border border-black/20 hover:bg-white/90 hover:text-black dark:bg-white dark:text-black"
              type="button"
              onClick={() => createDoc()}
            >
              <PlusIcon />
              新規ドキュメント
            </Button>
          </>
        )}
      </SidebarHeader>

      {!isCollapsed && <SidebarSeparator />}

      <SidebarContent>
        {!isCollapsed && (
          <SidebarGroup>
            <SidebarGroupLabel>ドキュメント</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {filteredDocs.map((doc) => (
                  <SidebarMenuItem key={doc.id}>
                    {editingId === doc.id ? (
                      <div className="flex items-center gap-2 px-2 py-1">
                        <Input
                          ref={editRef}
                          className="h-7 text-xs"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitRename();
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setEditingId(null);
                            }
                          }}
                          onBlur={() => commitRename()}
                        />
                      </div>
                    ) : (
                      <SidebarMenuButton
                        type="button"
                        isActive={doc.id === activeId}
                        onClick={() => setActiveId(doc.id)}
                      >
                        {String(doc.title ?? "")}
                      </SidebarMenuButton>
                    )}

                    {editingId !== doc.id && !isCollapsed ? (
                      <div className="absolute right-2 top-1.5 flex items-center gap-1 opacity-0 group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100">
                        <SidebarMenuAction
                          showOnHover
                          className="static"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            startRename(doc.id, doc.title);
                          }}
                          aria-label="Rename"
                        >
                          <PencilIcon />
                        </SidebarMenuAction>
                        <SidebarMenuAction
                          showOnHover
                          className="static"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDeleteTarget(doc.id);
                          }}
                          aria-label="Delete"
                        >
                          <Trash2Icon />
                        </SidebarMenuAction>
                      </div>
                    ) : null}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <Dialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ドキュメントを削除</DialogTitle>
            <DialogDescription>この操作は取り消せません。よろしいですか？</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget) {
                  deleteDoc(deleteTarget);
                }
                setDeleteTarget(null);
              }}
            >
              削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SidebarFooter className="border-t">
        <Button
          type="button"
          variant="ghost"
          className={cn("w-full gap-2", isCollapsed ? "justify-center" : "justify-start")}
          onClick={toggleSidebar}
          aria-label="サイドバーを開閉"
        >
          <PanelLeftIcon className="size-4" />
          {!isCollapsed && <span>Menu</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
