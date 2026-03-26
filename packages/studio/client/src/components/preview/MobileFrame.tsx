import type { ReactNode } from "react";
import type { FramePreset } from "./types";

interface MobileFrameProps {
  device: FramePreset;
  scale: number;
  children: ReactNode;
}

export function MobileFrame({ device, scale, children }: MobileFrameProps) {
  return (
    <div
      className="relative overflow-hidden rounded-[30px] transition-transform duration-200"
      style={{
        width: device.width,
        height: device.height,
        transform: `scale(${scale})`,
        transformOrigin: "center center",
      }}
    >
      {children}
    </div>
  );
}
