import { cn } from "@/lib/utils";
import { DocumentEditor } from "./editor";
import type { ReactNode } from "react";

export function DocumentPane({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={cn("flex h-full w-full flex-col", className)}>
      {children ?? <DocumentEditor />}
    </section>
  );
}
