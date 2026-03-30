export type FlyMachineState =
  | "pending"
  | "created"
  | "starting"
  | "started"
  | "stopping"
  | "stopped"
  | "replacing"
  | "destroying"
  | "destroyed"
  | "suspended";

export type FlyImageRef = {
  registry?: string;
  repository?: string;
  tag?: string;
  digest?: string;
  labels?: Record<string, string>;
};

export type FlyMachinePort = {
  port?: number;
  handlers?: string[];
};

export type FlyMachineService = {
  protocol?: string;
  internal_port?: number;
  ports?: FlyMachinePort[];
  // New-format string, but the API can return booleans for backwards compat.
  autostop?: "off" | "stop" | "suspend" | boolean | string;
  autostart?: boolean;
  min_machines_running?: number;
  [key: string]: unknown;
};

export type FlyMachineGuest = {
  cpu_kind?: "shared" | "performance" | string;
  cpus?: number;
  memory_mb?: number;
  [key: string]: unknown;
};

export type FlyMachineConfig = {
  image?: string;
  env?: Record<string, string>;
  guest?: FlyMachineGuest;
  services?: FlyMachineService[];
  metadata?: Record<string, string>;
  // Keep unknown fields when passing configs back to Fly.
  [key: string]: unknown;
};

export type FlyMachine = {
  id: string;
  name?: string;
  state?: FlyMachineState | string;
  region?: string;
  instance_id?: string;
  created_at?: string;
  updated_at?: string;
  image_ref?: FlyImageRef;
  config?: FlyMachineConfig;
  // Older code used to send top-level metadata, but Fly stores it on config.metadata.
  // Keep this optional for backwards compatibility with any cached shapes.
  metadata?: Record<string, string>;
};

export type FlyApiError = {
  error?: string;
  message?: string;
};

export type FlyStudioMachineSummary = {
  id: string;
  name: string | null;
  state: string | null;
  region: string | null;
  cpuKind: string | null;
  cpus: number | null;
  memoryMb: number | null;
  organizationId: string;
  projectSlug: string;
  version: number;
  externalPort: number | null;
  routePath: string | null;
  url: string | null;
  runtimeUrl: string | null;
  compatibilityUrl: string | null;
  image: string | null;
  desiredImage: string;
  imageOutdated: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type FlyStudioMachineUrlResult = {
  studioId: string;
  url: string;
  runtimeUrl: string | null;
  compatibilityUrl: string | null;
  accessToken?: string;
};

export type FlyStudioMachineReconcileResult = {
  desiredImage: string;
  scanned: number;
  warmedOutdatedImages: number;
  destroyedOldMachines: number;
  skippedRunningMachines: number;
  dryRun: boolean;
  errors: Array<{
    machineId: string;
    action: "gc" | "warm_reconciled_machine";
    message: string;
  }>;
};
