import type { PluginCliModule } from "./pluginCli.js";
import type {
  PluginDefinition,
  PluginKind,
  PluginPreviewSupport,
  PluginPublishCheckDefinition,
  PluginSetupGuide,
} from "./pluginContracts.js";
import type {
  ProjectPluginUiRegistry,
  SharedProjectPluginUiDefinition,
} from "./plugins.js";

export interface PluginPackageDescriptor<
  TPluginId extends string = string,
  TFrontend = unknown,
  TBackend = unknown,
> {
  pluginId: TPluginId;
  definition: PluginDefinition<TPluginId>;
  sharedProjectUi?: SharedProjectPluginUiDefinition;
  cli?: PluginCliModule;
  frontend?: TFrontend;
  backend?: TBackend;
}

export interface PluginPackageManifest<
  TPluginId extends string = string,
  TFrontend = unknown,
  TBackend = unknown,
> extends PluginPackageDescriptor<TPluginId, TFrontend, TBackend> {
  manifestVersion: 2;
  kind: PluginKind;
  setup?: PluginSetupGuide;
  previewSupport?: PluginPreviewSupport;
  publishChecks?: readonly PluginPublishCheckDefinition[];
}

export interface PluginPackageSurfaceExports {
  backend: string;
  frontend: string;
  cli: string;
}

export interface PluginBundleEntry<
  TPluginId extends string = string,
> {
  pluginId: TPluginId;
  manifest: PluginPackageManifest<TPluginId>;
  surfaceExports: PluginPackageSurfaceExports;
}

export type PluginPackageInstallDescriptor<
  TPluginId extends string = string,
> = PluginBundleEntry<TPluginId>;

export type PluginStopFn = () => void;

export function definePluginPackageManifest<
  const T extends PluginPackageManifest,
>(manifest: T): T {
  return manifest;
}

export function definePluginBundleEntry<
  const T extends PluginBundleEntry,
>(entry: T): T {
  return entry;
}

export function definePluginBundleEntries<
  const T extends readonly PluginBundleEntry[],
>(entries: T): T {
  return entries;
}

export function definePluginPackageDescriptors<
  const T extends readonly PluginPackageDescriptor[],
>(descriptors: T): T {
  return descriptors;
}

export const definePluginPackageInstallDescriptor = definePluginBundleEntry;
export const definePluginPackageInstallDescriptors = definePluginBundleEntries;

export type PluginIdsFromDescriptors<T extends readonly { pluginId: string }[]> =
  {
    [K in keyof T]: T[K] extends { pluginId: infer TPluginId extends string }
      ? TPluginId
      : never;
  };

export function extractPluginIds<const T extends readonly { pluginId: string }[]>(
  descriptors: T,
): PluginIdsFromDescriptors<T> {
  return descriptors.map((descriptor) => descriptor.pluginId) as PluginIdsFromDescriptors<T>;
}

export function buildSharedProjectPluginUiRegistry(
  descriptors: readonly Pick<PluginPackageDescriptor, "pluginId" | "sharedProjectUi">[],
): ProjectPluginUiRegistry {
  return Object.fromEntries(
    descriptors.flatMap((descriptor) =>
      descriptor.sharedProjectUi
        ? [[descriptor.pluginId, descriptor.sharedProjectUi] as const]
        : [],
    ),
  ) satisfies ProjectPluginUiRegistry;
}
