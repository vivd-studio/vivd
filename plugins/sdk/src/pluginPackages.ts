import type { PluginCliModule } from "./pluginCli.js";
import type { EmailTemplateBrandingResolver } from "./emailTemplates.js";
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

export type PluginConsentCategory = "functional" | "analytics" | "marketing";

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

export interface BackendHostSourceHeaders {
  origin?: string | null;
  referer?: string | null;
}

export interface BackendHostUtils {
  extractSourceHostFromHeaders(
    headers: BackendHostSourceHeaders,
  ): string | null;
  isHostAllowed(sourceHost: string | null, allowlist: string[]): boolean;
  normalizeHostCandidate(raw: string | null | undefined): string | null;
}

export interface BackendHostProjectPluginInstanceService {
  ensurePluginInstance(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: string;
    defaultConfig: unknown;
  }): Promise<{ row: any; created: boolean }>;
  getPluginInstance(options: {
    organizationId: string;
    projectSlug: string;
    pluginId: string;
  }): Promise<any>;
  updatePluginInstance(options: {
    instanceId: string;
    configJson?: unknown;
    status?: string;
    updatedAt?: Date;
  }): Promise<any>;
}

export interface BackendHostContext {
  db: any;
  tables: Record<string, any>;
  pluginEntitlementService: any;
  projectPluginInstanceService: BackendHostProjectPluginInstanceService;
  runtime: {
    getPublicPluginApiBaseUrl(options?: {
      requestHost?: string | null;
    }): Promise<string>;
    getControlPlaneOrigin(options?: { requestHost?: string | null }): string;
    inferProjectPluginSourceHosts(options: {
      organizationId: string;
      projectSlug: string;
    }): Promise<string[]>;
    hostUtils: BackendHostUtils;
    env: {
      nodeEnv?: string;
      flyStudioPublicHost?: string;
      flyStudioApp?: string;
    };
  };
  email: {
    deliveryService: any;
    deliverabilityService: any;
    brandingResolver: EmailTemplateBrandingResolver;
    isSesFeedbackAutoConfirmEnabled?: () => boolean;
  };
  system: {
    installProfileService: {
      getInstallProfile(): Promise<string>;
      resolvePolicy(): Promise<unknown>;
    };
  };
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
> extends BasePluginPackageManifest<
  TPluginId,
  TFrontend,
  TBackend,
  PluginCliModule | undefined,
  SharedProjectPluginUiDefinition | undefined,
  "native"
> {}

export interface ExternalEmbedPluginPackageManifest<
  TPluginId extends string = string,
> extends BasePluginPackageManifest<
  TPluginId,
  never,
  never,
  never,
  SharedProjectPluginUiDefinition | undefined,
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
  TBackendContribution extends PluginContribution<TPluginId> =
    PluginContribution<TPluginId>,
  TFrontend = unknown,
  THostContext = BackendHostContext,
> extends NativePluginPackageManifest<
  TPluginId,
  TFrontend,
  PluginContributionFactory<TBackendDeps, TBackendContribution> & {
    createHostContribution?: (
      hostContext: THostContext,
    ) => TBackendContribution;
  }
> {
  backend: PluginContributionFactory<TBackendDeps, TBackendContribution> & {
    createHostContribution?: (
      hostContext: THostContext,
    ) => TBackendContribution;
  };
}

export type PluginStopFn = () => void;

export function definePluginPackageManifest<
  const T extends PluginPackageManifest,
>(manifest: T): T {
  return manifest;
}

export function definePluginPackageDescriptors<
  const T extends readonly PluginPackageDescriptor[],
>(descriptors: T): T {
  return descriptors;
}

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

export type PluginIdsFromDescriptors<
  T extends readonly { pluginId: string }[],
> = {
  [K in keyof T]: T[K] extends { pluginId: infer TPluginId extends string }
    ? TPluginId
    : never;
};

export function extractPluginIds<
  const T extends readonly { pluginId: string }[],
>(descriptors: T): PluginIdsFromDescriptors<T> {
  return descriptors.map(
    (descriptor) => descriptor.pluginId,
  ) as PluginIdsFromDescriptors<T>;
}

export function buildSharedProjectPluginUiRegistry(
  descriptors: readonly Pick<
    PluginPackageDescriptor,
    "pluginId" | "sharedProjectUi"
  >[],
): ProjectPluginUiRegistry {
  return Object.fromEntries(
    descriptors.flatMap((descriptor) =>
      descriptor.sharedProjectUi
        ? [[descriptor.pluginId, descriptor.sharedProjectUi] as const]
        : [],
    ),
  ) satisfies ProjectPluginUiRegistry;
}
