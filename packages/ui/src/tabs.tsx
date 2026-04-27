"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

/**
 * Tabs — two variants for two hierarchy levels.
 *
 *   variant="pill"      (default) — primary nav. Pill-on-sunken-track. Use for
 *                       page-level navigation (e.g., SuperAdmin top nav).
 *   variant="underline" — section/sub-nav. Transparent row, active tab = foreground
 *                       text + 2px primary underline. Use inside a page to switch
 *                       between sub-sections (e.g., Usage/Members/Domains/Settings).
 *
 * Apply the variant on TabsList; TabsTrigger reads it from context so every
 * trigger inside the list picks up the matching styling automatically.
 */

type TabsVariant = "pill" | "underline";

const TabsVariantContext = React.createContext<TabsVariant>("pill");

const Tabs = TabsPrimitive.Root;

const tabsListVariants = cva("text-muted-foreground", {
  variants: {
    variant: {
      pill: "inline-flex h-10 items-center justify-center rounded-md bg-surface-sunken p-1 border border-border/60 dark:border-transparent",
      underline:
        "flex h-10 items-center justify-start gap-1 border-b border-border overflow-y-hidden",
    },
  },
  defaultVariants: {
    variant: "pill",
  },
});

export interface TabsListProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>,
    VariantProps<typeof tabsListVariants> {}

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({ className, variant, ...props }, ref) => {
  const resolved: TabsVariant = variant ?? "pill";
  return (
    <TabsVariantContext.Provider value={resolved}>
      <TabsPrimitive.List
        ref={ref}
        className={cn(tabsListVariants({ variant: resolved }), className)}
        {...props}
      />
    </TabsVariantContext.Provider>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const tabsTriggerVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        pill: "rounded-sm px-3 py-1.5 data-[state=active]:bg-surface-page data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        underline:
          "relative h-10 rounded-none border-b-2 border-transparent px-3 -mb-px data-[state=active]:border-primary data-[state=active]:text-foreground hover:text-foreground",
      },
    },
    defaultVariants: {
      variant: "pill",
    },
  },
);

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const variant = React.useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(tabsTriggerVariants({ variant }), className)}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants, tabsTriggerVariants };
