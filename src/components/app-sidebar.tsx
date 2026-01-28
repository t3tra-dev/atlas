import { PanelLeftIcon, PlusIcon, SearchIcon } from "lucide-react";

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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const { state, setOpen, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {isCollapsed
          ? (
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
                  onClick={() => setOpen(true)}
                  aria-label="新規ドキュメント"
                >
                  <PlusIcon />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          )
          : (
            <>
              <SidebarInput
                placeholder="検索…"
                aria-label="ドキュメントを検索"
              />
              <Button
                className="w-full justify-start bg-white text-black border border-black/20 hover:bg-white/90 hover:text-black dark:bg-white dark:text-black"
                type="button"
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
            <SidebarGroupContent></SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t">
        <Button
          type="button"
          variant="ghost"
          className={cn(
            "w-full gap-2",
            isCollapsed ? "justify-center" : "justify-start",
          )}
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
