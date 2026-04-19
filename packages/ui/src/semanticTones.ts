export const darkSemanticButtonTones = {
  default:
    "dark:border dark:border-primary/40 dark:bg-primary/12 dark:text-primary dark:shadow-none dark:hover:bg-primary/18 dark:hover:border-primary/55",
  success:
    "dark:border dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300 dark:shadow-none dark:hover:bg-emerald-500/16 dark:hover:border-emerald-500/55",
  destructive:
    "dark:border dark:border-destructive/40 dark:bg-destructive/12 dark:text-destructive dark:shadow-none dark:hover:bg-destructive/18 dark:hover:border-destructive/55",
} as const;

export const darkSemanticBadgeTones = {
  default:
    "dark:border-primary/40 dark:bg-primary/12 dark:text-primary dark:shadow-none dark:hover:bg-primary/18 dark:hover:border-primary/55",
  success:
    "dark:border-[hsl(var(--success)/0.4)] dark:bg-[hsl(var(--success)/0.12)] dark:text-[hsl(var(--success))] dark:shadow-none dark:hover:bg-[hsl(var(--success)/0.18)] dark:hover:border-[hsl(var(--success)/0.55)]",
  destructive:
    "dark:border-destructive/40 dark:bg-destructive/12 dark:text-destructive dark:shadow-none dark:hover:bg-destructive/18 dark:hover:border-destructive/55",
} as const;
