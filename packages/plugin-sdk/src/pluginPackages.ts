import type { PluginCliModule } from "./pluginCli.js";
import type { PluginDefinition } from "./pluginContracts.js";
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
  manifestVersion: 1;
}

export interface PluginPackageSurfaceExports {
  backend: string;
  frontend: string;
  cli: string;
}

export interface PluginPackageInstallDescriptor<
  TPluginId extends string = string,
> {
  pluginId: TPluginId;
  manifest: PluginPackageManifest<TPluginId>;
  surfaceExports: PluginPackageSurfaceExports;
}

export type PluginStopFn = () => void;

export function definePluginPackageManifest<
  const T extends PluginPackageManifest,
>(manifest: T): T {
  return manifest;
}

export function definePluginPackageInstallDescriptor<
  const T extends PluginPackageInstallDescriptor,
>(descriptor: T): T {
  return descriptor;
}

export function definePluginPackageInstallDescriptors<
  const T extends readonly PluginPackageInstallDescriptor[],
>(descriptors: T): T {
  return descriptors;
}

export function definePluginPackageDescriptors<
  const T extends readonly PluginPackageDescriptor[],
>(descriptors: T): T {
  return descriptors;
}

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
