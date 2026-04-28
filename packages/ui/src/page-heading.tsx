import * as React from "react";

import { cn } from "./utils";

const PageHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-start justify-between gap-4", className)}
    {...props}
  />
));
PageHeader.displayName = "PageHeader";

const PageHeaderContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("min-w-0", className)} {...props} />
));
PageHeaderContent.displayName = "PageHeaderContent";

const PageTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h1
    ref={ref}
    className={cn(
      "text-[1.625rem] font-semibold leading-8 tracking-tight",
      className,
    )}
    {...props}
  />
));
PageTitle.displayName = "PageTitle";

const PageDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("mt-1 text-sm text-muted-foreground", className)}
    {...props}
  />
));
PageDescription.displayName = "PageDescription";

export { PageHeader, PageHeaderContent, PageTitle, PageDescription };
