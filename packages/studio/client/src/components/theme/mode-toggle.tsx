import { Moon, Sun, Palette } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "./theme-provider";

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
        <DropdownMenuItem
          onClick={() => setColorTheme("clean")}
          className={colorTheme === "clean" ? "bg-accent" : ""}
        >
          Clean
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setColorTheme("natural")}
          className={colorTheme === "natural" ? "bg-accent" : ""}
        >
          Natural
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setColorTheme("vivd-green")}
          className={colorTheme === "vivd-green" ? "bg-accent" : ""}
        >
          Vivd Green
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setColorTheme("vivd-sharp")}
          className={colorTheme === "vivd-sharp" ? "bg-accent" : ""}
        >
          Vivd Sharp
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setColorTheme("ocean")}
          className={colorTheme === "ocean" ? "bg-accent" : ""}
        >
          Ocean
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
