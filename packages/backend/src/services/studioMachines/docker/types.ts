export type DockerContainerStateStatus =
  | "created"
  | "running"
  | "paused"
  | "restarting"
  | "removing"
  | "exited"
  | "dead"
  | string;

export type DockerContainerSummary = {
  Id: string;
  Names?: string[];
  Image?: string;
  State?: DockerContainerStateStatus;
  Status?: string;
  Created?: number;
  Labels?: Record<string, string>;
  HostConfig?: {
    PortBindings?: Record<string, Array<{ HostIp?: string; HostPort?: string }>>;
  };
};

export type DockerContainerInfo = {
  Id: string;
  Image?: string;
  Name?: string;
  Config?: {
    Image?: string;
    Env?: string[];
    Labels?: Record<string, string>;
    StopTimeout?: number;
    WorkingDir?: string;
    Cmd?: string[];
  };
  State?: {
    Status?: DockerContainerStateStatus;
    Running?: boolean;
    Paused?: boolean;
    ExitCode?: number;
    StartedAt?: string;
    FinishedAt?: string;
  };
  HostConfig?: {
    NetworkMode?: string;
    NanoCpus?: number;
    Memory?: number;
    AutoRemove?: boolean;
    Binds?: string[];
    PortBindings?: Record<string, Array<{ HostIp?: string; HostPort?: string }>>;
  };
  NetworkSettings?: {
    Networks?: Record<string, Record<string, unknown>>;
  };
  Mounts?: Array<{
    Type?: string;
    Source?: string;
    Destination?: string;
    RW?: boolean;
  }>;
  Created?: string;
};

export type DockerContainerCreateConfig = {
  Image: string;
  Env: string[];
  Labels: Record<string, string>;
  StopTimeout?: number;
  WorkingDir?: string;
  Cmd?: string[];
  ExposedPorts?: Record<string, Record<string, never>>;
  HostConfig?: {
    NetworkMode?: string;
    NanoCpus?: number;
    Memory?: number;
    AutoRemove?: boolean;
    Binds?: string[];
    PortBindings?: Record<string, Array<{ HostIp?: string; HostPort?: string }>>;
  };
  NetworkingConfig?: {
    EndpointsConfig?: Record<string, Record<string, never>>;
  };
};

export type DockerContainerCreateResponse = {
  Id: string;
  Warnings?: string[];
};

export type DockerNetworkSummary = {
  Id?: string;
  Name?: string;
};

export type DockerImageInfo = {
  Id?: string;
  RepoDigests?: string[];
  RepoTags?: string[];
  Config?: {
    Labels?: Record<string, string>;
  };
};

export type DockerApiError = {
  message?: string;
};
