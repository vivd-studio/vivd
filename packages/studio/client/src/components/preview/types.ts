// Mobile device presets with popular phone dimensions
export const DEVICE_PRESETS = [
  { name: "iPhone 14 Pro", width: 393, height: 852 },
  { name: "iPhone 14 Pro Max", width: 430, height: 932 },
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "Samsung Galaxy S23", width: 360, height: 780 },
  { name: "Samsung Galaxy S23 Ultra", width: 384, height: 824 },
  { name: "Google Pixel 8", width: 412, height: 915 },
  { name: "Google Pixel 8 Pro", width: 448, height: 998 },
] as const;

export type DevicePreset = (typeof DEVICE_PRESETS)[number];
export type ViewportMode = "desktop" | "tablet" | "mobile";
export type PreviewMode = "static" | "devserver";

export interface PreviewImageContextMenuEvent {
  clientX: number;
  clientY: number;
  src: string | null;
  currentSrc: string | null;
}

export const TABLET_PRESET = {
  name: "iPad Air",
  width: 820,
  height: 1180,
} as const;

export interface PreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string | null;
  originalUrl?: string | null;
  projectSlug?: string;
  version?: number;
}
