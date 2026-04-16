import type { PluginCliModule } from "./pluginCli.js";
import type {
  PluginDefinition,
  PluginKind,
  PluginModule,
  PluginPreviewSupport,
  PluginPublishCheckDefinition,
  PluginSetupGuide,
} from "./pluginContracts.js";
import type {
  ProjectPluginUiRegistry,
  SharedProjectPluginUiDefinition,
} from "./plugins.js";

export type PluginProjectPanelKind = "custom" | "generic";

export interface PluginControlPlanePresentation {
  projectPanel: PluginProjectPanelKind;
  usageLabel: string;
  limitPrompt: string;
  supportsMonthlyLimit: boolean;
  supportsHardStop: boolean;
  supportsTurnstile: boolean;
  dashboardPath: string | null;
}

export type ExternalEmbedRenderMode =
  | "iframe"
  | "script"
  | "html"
  | "head_tag"
  | "body_tag"
  | "link";

export type ExternalEmbedPlacementTarget =
  | "page_body"
  | "page_head"
  | "layout_head"
  | "layout_body";

export type PluginConsentCategory =
  | "functional"
  | "analytics"
  | "marketing";

export interface ExternalEmbedProviderDefinition {
  provider: string;
  websiteUrl?: string;
  docsUrl?: string;
}

export interface ExternalEmbedPlacementDefinition {
  targets: readonly ExternalEmbedPlacementTarget[];
  preferredTarget?: ExternalEmbedPlacementTarget;
}

export interface ExternalEmbedSecurityPolicy {
  consentCategory?: PluginConsentCategory;
  requiresSecrets: boolean;
  requiresBackend: boolean;
  allowedHosts?: string[];
  cspNotes?: string[];
}

export interface ExternalEmbedSnippetTemplates {
  html?: string;
  astro?: string;
}

export interface ExternalEmbedContribution {
  provider: ExternalEmbedProviderDefinition;
  renderMode: ExternalEmbedRenderMode;
  placement: ExternalEmbedPlacementDefinition;
  inputSchema: unknown;
  validationRules?: string[];
  snippetTemplates: ExternalEmbedSnippetTemplates;
  security: ExternalEmbedSecurityPolicy;
}

export type ConnectedPluginAuthMode =
  | "oauth"
  | "api_key"
  | "webhook"
  | "custom";

export interface ConnectedPluginContribution {
  authMode: ConnectedPluginAuthMode;
  requiresBackend: true;
}

export interface PluginRouteDefinition<
  TRouteHandler = unknown,
  TRouteDeps = unknown,
> {
  routeId: string;
  mountPath: string;
  createRouter: (deps: TRouteDeps) => TRouteHandler;
}

export interface PluginContribution<
  TPluginId extends string = string,
  THooks = unknown,
  TPublicRoute = unknown,
> {
  module: PluginModule<TPluginId>;
  publicRoutes?: readonly TPublicRoute[];
  hooks?: THooks;
}

export interface PluginContributionFactory<
  TDeps = unknown,
  TContribution extends PluginContribution = PluginContribution,
> {
  createContribution: (deps: TDeps) => TContribution;
}

export interface PluginPackageDescriptor<
  TPluginId extends string = string,
  TFrontend = unknown,
  TBackend = unknown,
  TCli = PluginCliModule | undefined,
  TSharedProjectUi = SharedProjectPluginUiDefinition | undefined,
  TKind extends PluginKind = PluginKind,
> {
  pluginId: TPluginId;
  definition: PluginDefinition<TPluginId> & { kind: TKind };
  sharedProjectUi?: TSharedProjectUi;
  cli?: TCli;
  frontend?: TFrontend;
  backend?: TBackend;
}

interface BasePluginPackageManifest<
  TPluginId extends string = string,
  TFrontend = unknown,
  TBackend = unknown,
  TCli = PluginCliModule | undefined,
  TSharedProjectUi = SharedProjectPluginUiDefinition | undefined,
  TKind extends PluginKind = PluginKind,
> extends PluginPackageDescriptor<
    TPluginId,
    TFrontend,
    TBackend,
    TCli,
    TSharedProjectUi,
    TKind
  > {
  manifestVersion: 2;
  kind: TKind;
  controlPlane: PluginControlPlanePresentation;
  setup?: PluginSetupGuide;
  previewSupport?: PluginPreviewSupport;
  publishChecks?: readonly PluginPublishCheckDefinition[];
}

export interface NativePluginPackageManifest<
  TPluginId extends string = string,
  TFrontend = unknown,
  TBackend = unknown,
> extends BasePluginPackageManifest<TPluginId, TFrontend, TBackend, PluginCliModule | undefined, SharedProjectPluginUiDefinition | undefined, "native"> {}

export interface ExternalEmbedPluginPackageManifest<
  TPluginId extends string = string,
> extends BasePluginPackageManifest<
    TPluginId,
    never,
    never,
    never,
    never,
    "external_embed"
  > {
  externalEmbed: ExternalEmbedContribution;
}

export interface ConnectedPluginPackageManifest<
  TPluginId extends string = string,
  TFrontend = unknown,
  TBackend = unknown,
> extends BasePluginPackageManifest<
    TPluginId,
    TFrontend,
    TBackend,
    PluginCliModule | undefined,
    SharedProjectPluginUiDefinition | undefined,
    "connected"
  > {
  connected: ConnectedPluginContribution;
}

export type PluginPackageManifest<
  TPluginId extends string = string,
  TFrontend = unknown,
  TBackend = unknown,
> =
  | NativePluginPackageManifest<TPluginId, TFrontend, TBackend>
  | ExternalEmbedPluginPackageManifest<TPluginId>
  | ConnectedPluginPackageManifest<TPluginId, TFrontend, TBackend>;

export interface NativePluginBackendPackage<
  TPluginId extends string = string,
  TBackendDeps = unknown,
  TBackendContribution extends PluginContribution<TPluginId> = PluginContribution<TPluginId>,
  TFrontend = unknown,
> extends NativePluginPackageManifest<
    TPluginId,
    TFrontend,
    PluginContributionFactory<TBackendDeps, TBackendContribution>
  > {
  backend: PluginContributionFactory<TBackendDeps, TBackendContribution>;
}

export interface PluginPackageSurfaceExports {
  backend?: string;
  frontend?: string;
  cli?: string;
}

export interface PluginBundleEntry<
  TPluginId extends string = string,
> {
  pluginId: TPluginId;
  manifest: PluginPackageManifest<TPluginId>;
  surfaceExports?: PluginPackageSurfaceExports;
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

export function isNativePluginPackageManifest(
  manifest: PluginPackageManifest,
): manifest is NativePluginPackageManifest {
  return manifest.kind === "native";
}

export function isExternalEmbedPluginPackageManifest(
  manifest: PluginPackageManifest,
): manifest is ExternalEmbedPluginPackageManifest {
  return manifest.kind === "external_embed";
}

export function isConnectedPluginPackageManifest(
  manifest: PluginPackageManifest,
): manifest is ConnectedPluginPackageManifest {
  return manifest.kind === "connected";
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
