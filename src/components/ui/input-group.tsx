import * as React from "react"

import { cn } from "@/lib/utils"

function InputGroup({
  className,
  label,
  description,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  label?: React.ReactNode
  description?: React.ReactNode
}) {
  return (
    <div data-slot="input-group" className={cn("space-y-1", className)} {...props}>
      {label != null ? (
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
      ) : null}
      {description != null ? (
        <div className="text-xs text-muted-foreground">{description}</div>
      ) : null}
      <div>{children}</div>
    </div>
  )
}

export { InputGroup }
