import { Moon, Sun, Palette } from "lucide-react";
import type { ColorTheme } from "@vivd/shared/types";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@vivd/ui";

import { useTheme } from "./theme-provider";

type ColorThemeOption = {
  value: ColorTheme;
  label: string;
  preview: [string, string];
};

const COLOR_THEME_OPTIONS: ColorThemeOption[] = [
  { value: "vivd-sharp", label: "Vivd Sharp", preview: ["#059669", "#f59e0b"] },
];

function ThemeIndicator({ preview }: { preview: [string, string] }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-2.5 w-2.5 rounded-full border border-black/10 dark:border-white/20"
        style={{ backgroundColor: preview[0] }}
      />
      <span
        className="h-2.5 w-2.5 rounded-full border border-black/10 dark:border-white/20"
        style={{ backgroundColor: preview[1] }}
      />
    </span>
  );
}

export function ModeToggle() {
  const { setTheme, colorTheme, setColorTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Sun className="h-3.5 w-3.5" /> Mode
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => setTheme("light")}>
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          System
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2">
          <Palette className="h-3.5 w-3.5" /> Color Theme
        </DropdownMenuLabel>
        {COLOR_THEME_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setColorTheme(option.value)}
            className={colorTheme === option.value ? "bg-accent" : ""}
          >
            <ThemeIndicator preview={option.preview} />
            <span>{option.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
