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
};

export type DockerContainerInfo = {
  Id: string;
  Name?: string;
  Config?: {
    Image?: string;
    Env?: string[];
    Labels?: Record<string, string>;
    StopTimeout?: number;
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
  };
  Created?: string;
};

export type DockerContainerCreateConfig = {
  Image: string;
  Env: string[];
  Labels: Record<string, string>;
  StopTimeout?: number;
  ExposedPorts?: Record<string, Record<string, never>>;
  HostConfig?: {
    NetworkMode?: string;
    NanoCpus?: number;
    Memory?: number;
  };
};

export type DockerContainerCreateResponse = {
  Id: string;
  Warnings?: string[];
};

export type DockerApiError = {
  message?: string;
};
