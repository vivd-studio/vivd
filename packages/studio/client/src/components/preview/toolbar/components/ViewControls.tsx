import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Check, ChevronDown, Monitor, Smartphone } from "lucide-react";
import { DEVICE_PRESETS } from "../../types";
import type { DevicePreset } from "../../types";

interface ViewControlsProps {
  mobileView: boolean;
  setMobileView: (value: boolean) => void;
  selectedDevice: DevicePreset;
  setSelectedDevice: (device: DevicePreset) => void;
}

export function ViewControls({
  mobileView,
  setMobileView,
  selectedDevice,
  setSelectedDevice,
}: ViewControlsProps) {
  return (
    <div className="hidden md:flex items-center gap-1">
      {/* Viewport Toggle */}
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={!mobileView ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setMobileView(false)}
              className="rounded-r-none px-2.5"
            >
              <Monitor className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Desktop View</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={mobileView ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setMobileView(true)}
              className="rounded-l-none border-l-0 px-2.5"
            >
              <Smartphone className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Mobile View</TooltipContent>
        </Tooltip>
      </div>

      {/* Device Selector (only when mobile view) */}
      {mobileView && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1 text-xs h-8">
              {selectedDevice.name}
              <ChevronDown className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Select Device</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {DEVICE_PRESETS.map((device) => (
              <DropdownMenuItem
                key={device.name}
                onClick={() => setSelectedDevice(device)}
                className={
                  selectedDevice.name === device.name ? "bg-accent" : ""
                }
              >
                <Check
                  className={`w-4 h-4 mr-2 ${
                    selectedDevice.name === device.name
                      ? "opacity-100"
                      : "opacity-0"
                  }`}
                />
                <span>{device.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {device.width}×{device.height}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
