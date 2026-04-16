import type { PluginUiIconName } from "@vivd/plugin-sdk";
import {
  BarChart3,
  CreditCard,
  Mail,
  Newspaper,
  Plug,
  Table2,
  type LucideIcon,
} from "lucide-react";

const pluginUiIconRegistry: Record<PluginUiIconName, LucideIcon> = {
  "bar-chart-3": BarChart3,
  "credit-card": CreditCard,
  mail: Mail,
  newspaper: Newspaper,
  plug: Plug,
  "table-2": Table2,
};

export function getPluginUiIcon(iconName: PluginUiIconName): LucideIcon {
  return pluginUiIconRegistry[iconName];
}
