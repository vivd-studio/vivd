import type { FlyApiError, FlyMachine, FlyMachineConfig } from "./types";

export class FlyApiClient {
  private machinesCache: { machines: FlyMachine[]; fetchedAt: number } | null = null;
  private readonly options: {
    getToken: () => string;
    getAppName: () => string;
  };

  constructor(options: { getToken: () => string; getAppName: () => string }) {
    this.options = options;
  }

  clearMachinesCache(): void {
    this.machinesCache = null;
  }

  async flyFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `https://api.machines.dev/v1/apps/${this.options.getAppName()}${path}`;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.options.getToken()}`);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(url, { ...init, headers });
    if (response.ok) {
      // Some endpoints return empty bodies.
      const text = await response.text();
      if (!text) return undefined as T;
      return JSON.parse(text) as T;
    }

    const bodyText = await response.text();
    let body: FlyApiError | null = null;
    try {
      body = bodyText ? (JSON.parse(bodyText) as FlyApiError) : null;
    } catch {
      body = null;
    }

    const message =
      body?.error ||
      body?.message ||
      (bodyText ? bodyText.slice(0, 400) : "") ||
      `${response.status} ${response.statusText}`;

    throw new Error(`[FlyMachines] ${message}`);
  }

  async listMachines(): Promise<FlyMachine[]> {
    const now = Date.now();
    if (this.machinesCache && now - this.machinesCache.fetchedAt < 2000) {
      return this.machinesCache.machines;
    }
    const machines = await this.flyFetch<FlyMachine[]>("/machines", {
      method: "GET",
    });
    this.machinesCache = { machines, fetchedAt: now };
    return machines;
  }

  async getMachine(machineId: string): Promise<FlyMachine> {
    return this.flyFetch<FlyMachine>(`/machines/${machineId}`, { method: "GET" });
  }

  async createMachine(options: {
    machineName: string;
    region: string;
    config: FlyMachineConfig;
  }): Promise<FlyMachine> {
    return this.flyFetch<FlyMachine>("/machines", {
      method: "POST",
      body: JSON.stringify({
        name: options.machineName || undefined,
        region: options.region,
        config: options.config,
      }),
    });
  }

  async updateMachineConfig(options: {
    machineId: string;
    config: FlyMachineConfig;
    skipLaunch?: boolean;
  }): Promise<FlyMachine> {
    const body: Record<string, unknown> = { config: options.config };
    if (options.skipLaunch) body.skip_launch = true;
    const machine = await this.flyFetch<FlyMachine>(`/machines/${options.machineId}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    this.clearMachinesCache();
    return machine;
  }

  async startMachine(machineId: string): Promise<void> {
    await this.flyFetch(`/machines/${machineId}/start`, { method: "POST" });
  }

  async stopMachine(machineId: string): Promise<void> {
    await this.flyFetch(`/machines/${machineId}/stop`, { method: "POST" });
  }

  async destroyMachine(machineId: string): Promise<void> {
    await this.flyFetch<void>(`/machines/${machineId}`, { method: "DELETE" });
    this.clearMachinesCache();
  }

  async suspendMachine(machineId: string): Promise<void> {
    await this.flyFetch(`/machines/${machineId}/suspend`, { method: "POST" });
  }
}
