import { AppSidebar } from "@/components/app-sidebar"
import { DocumentPane } from "@/components/document-pane"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import type { ReactNode } from "react"

export default function Layout({ children }: { children?: ReactNode }) {
  return (
    <div className="min-h-svh flex flex-col">
      <SidebarProvider topOffset="3rem" className="flex flex-1 min-h-0 min-w-0 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="md:hidden" />
          <div className="text-sm font-semibold">Atlas</div>
        </header>

        <div className="flex flex-1 min-h-0 min-w-0">
          <AppSidebar />

          <SidebarInset>
            <div className="flex flex-1 min-h-0 min-w-0">
              <DocumentPane className="flex-1 min-w-0">{children}</DocumentPane>
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  )
}
