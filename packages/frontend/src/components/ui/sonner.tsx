import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const semanticToastContentClass =
  "[&_[data-description]]:!text-white/90 [&_[data-button]]:!border [&_[data-button]]:!border-white/20 [&_[data-button]]:!bg-white/15 [&_[data-button]]:!text-white [&_[data-close-button]]:!bg-white/15 [&_[data-close-button]]:!border-white/20 [&_[data-close-button]]:!text-white";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast bg-background text-foreground border-border shadow-lg backdrop-blur-none",
          description: "text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-muted text-muted-foreground",
          closeButton: "bg-background border-border text-foreground",
          success:
            `!bg-emerald-600 !text-white !border-emerald-700 dark:!bg-emerald-500 dark:!text-white dark:!border-emerald-400 ${semanticToastContentClass}`,
          error:
            `!bg-red-600 !text-white !border-red-700 dark:!bg-red-500 dark:!text-white dark:!border-red-400 ${semanticToastContentClass}`,
          info:
            `!bg-blue-600 !text-white !border-blue-700 dark:!bg-blue-500 dark:!text-white dark:!border-blue-400 ${semanticToastContentClass}`,
          warning:
            `!bg-amber-700 !text-white !border-amber-800 dark:!bg-amber-600 dark:!text-white dark:!border-amber-500 ${semanticToastContentClass}`,
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
