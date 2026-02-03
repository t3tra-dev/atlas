import { AppSidebar } from "@/components/app-sidebar";
import { DocumentPane } from "@/components/document/pane";
import { DocumentStoreProvider } from "@/components/document/store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useTheme, type ThemeMode } from "@/hooks/use-theme";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import type { ReactNode } from "react";

export default function Layout({ children }: { children?: ReactNode }) {
  const { theme, setTheme } = useTheme();
  const themeIcon =
    theme === "dark" ? (
      <MoonIcon className="size-4" />
    ) : theme === "light" ? (
      <SunIcon className="size-4" />
    ) : (
      <MonitorIcon className="size-4" />
    );

  return (
    <div className="min-h-svh flex flex-col">
      <SidebarProvider className="flex flex-1 min-h-0 min-w-0 flex-col">
        <DocumentStoreProvider>
          <div className="flex flex-1 min-h-0 min-w-0">
            <AppSidebar />

            <SidebarInset>
              <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
                <SidebarTrigger className="md:hidden" />
                <div className="text-sm font-semibold">Atlas</div>
                <div className="ml-auto flex items-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="テーマ切り替え">
                        {themeIcon}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Theme</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuRadioGroup
                        value={theme}
                        onValueChange={(value) => setTheme(value as ThemeMode)}
                      >
                        <DropdownMenuRadioItem value="system">
                          <MonitorIcon className="size-4" />
                          System
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="light">
                          <SunIcon className="size-4" />
                          Light
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="dark">
                          <MoonIcon className="size-4" />
                          Dark
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </header>

              <div className="flex flex-1 min-h-0 min-w-0">
                <DocumentPane className="flex-1 min-w-0">{children}</DocumentPane>
              </div>
            </SidebarInset>
          </div>
        </DocumentStoreProvider>
      </SidebarProvider>
    </div>
  );
}
