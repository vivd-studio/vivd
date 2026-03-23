import { useTheme } from "@/components/theme";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:!bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:backdrop-blur-none",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success:
            "!bg-emerald-600 !text-white !border-emerald-700 dark:!bg-emerald-500 dark:!text-white dark:!border-emerald-400",
          error:
            "!bg-red-600 !text-white !border-red-700 dark:!bg-red-500 dark:!text-white dark:!border-red-400",
          info: "!bg-blue-500 !text-white !border-blue-600",
          warning: "!bg-amber-500 !text-white !border-amber-600",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
