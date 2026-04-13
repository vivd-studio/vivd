import { newsletterCliModule } from "./module";
import { newsletterPluginManifest } from "../manifest";

export const newsletterCliPluginPackage = {
  ...newsletterPluginManifest,
  cli: newsletterCliModule,
} as const;
