import { Moon, Sun, Palette } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@vivd/ui";

import { COLOR_THEME_OPTIONS, ThemeIndicator } from "./color-theme-options";
import { useTheme } from "./theme-provider";

export function ModeToggle() {
  const { theme, setTheme, colorTheme, setColorTheme } = useTheme();

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
        <DropdownMenuItem
          onClick={() => setTheme("light")}
          className={theme === "light" ? "vivd-menu-item-selected" : ""}
        >
          Light
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("dark")}
          className={theme === "dark" ? "vivd-menu-item-selected" : ""}
        >
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("system")}
          className={theme === "system" ? "vivd-menu-item-selected" : ""}
        >
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
            className={
              colorTheme === option.value ? "vivd-menu-item-selected" : ""
            }
          >
            <ThemeIndicator preview={option.preview} />
            <span>{option.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
