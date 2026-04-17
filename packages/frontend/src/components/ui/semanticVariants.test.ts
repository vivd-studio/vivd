import { describe, expect, it } from "vitest";

import { badgeVariants } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

describe("shared semantic variants", () => {
  it("keeps primary buttons subtle in dark mode", () => {
    const classes = buttonVariants({ variant: "default" });

    expect(classes).toContain("dark:bg-primary/12");
    expect(classes).toContain("dark:text-primary");
    expect(classes).toContain("dark:border-primary/40");
  });

  it("keeps destructive buttons subtle in dark mode", () => {
    const classes = buttonVariants({ variant: "destructive" });

    expect(classes).toContain("dark:bg-destructive/12");
    expect(classes).toContain("dark:text-destructive");
    expect(classes).toContain("dark:border-destructive/40");
  });

  it("keeps default and destructive badges readable in dark mode", () => {
    const defaultClasses = badgeVariants({ variant: "default" });
    const destructiveClasses = badgeVariants({ variant: "destructive" });

    expect(defaultClasses).toContain("dark:bg-primary/12");
    expect(defaultClasses).toContain("dark:text-primary");
    expect(destructiveClasses).toContain("dark:bg-destructive/12");
    expect(destructiveClasses).toContain("dark:text-destructive");
  });
});
