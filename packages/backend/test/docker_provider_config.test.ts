import { afterEach, describe, expect, it } from "vitest";
import { DockerProviderConfig } from "../src/services/studioMachines/docker/providerConfig";

describe("DockerProviderConfig.apiVersion", () => {
  const originalStudioApiVersion = process.env.DOCKER_STUDIO_API_VERSION;
  const originalDockerApiVersion = process.env.DOCKER_API_VERSION;
  const originalMainBackendUrl = process.env.DOCKER_STUDIO_MAIN_BACKEND_URL;

  afterEach(() => {
    if (typeof originalStudioApiVersion === "string") {
      process.env.DOCKER_STUDIO_API_VERSION = originalStudioApiVersion;
    } else {
      delete process.env.DOCKER_STUDIO_API_VERSION;
    }

    if (typeof originalDockerApiVersion === "string") {
      process.env.DOCKER_API_VERSION = originalDockerApiVersion;
    } else {
      delete process.env.DOCKER_API_VERSION;
    }

    if (typeof originalMainBackendUrl === "string") {
      process.env.DOCKER_STUDIO_MAIN_BACKEND_URL = originalMainBackendUrl;
    } else {
      delete process.env.DOCKER_STUDIO_MAIN_BACKEND_URL;
    }
  });

  it("defaults to v1.44 when no Docker API env var is set", () => {
    delete process.env.DOCKER_STUDIO_API_VERSION;
    delete process.env.DOCKER_API_VERSION;

    expect(new DockerProviderConfig().apiVersion).toBe("v1.44");
  });

  it("uses DOCKER_API_VERSION when the studio-specific override is unset", () => {
    delete process.env.DOCKER_STUDIO_API_VERSION;
    process.env.DOCKER_API_VERSION = "1.52";

    expect(new DockerProviderConfig().apiVersion).toBe("v1.52");
  });

  it("prefers DOCKER_STUDIO_API_VERSION over DOCKER_API_VERSION", () => {
    process.env.DOCKER_STUDIO_API_VERSION = "v1.50";
    process.env.DOCKER_API_VERSION = "1.52";

    expect(new DockerProviderConfig().apiVersion).toBe("v1.50");
  });

  it("defaults Docker-managed studio callbacks to the internal backend route", () => {
    delete process.env.DOCKER_STUDIO_MAIN_BACKEND_URL;

    expect(new DockerProviderConfig().internalMainBackendUrl).toBe(
      "http://backend:3000/vivd-studio",
    );
  });

  it("normalizes a custom Docker-managed internal backend host to /vivd-studio", () => {
    process.env.DOCKER_STUDIO_MAIN_BACKEND_URL = "backend:3000";

    expect(new DockerProviderConfig().internalMainBackendUrl).toBe(
      "http://backend:3000/vivd-studio",
    );
  });
});

describe("DockerProviderConfig.memoryMb", () => {
  const originalDockerStudioMemoryMb = process.env.DOCKER_STUDIO_MEMORY_MB;
  const originalDockerStudioMemoryAutoReserveMb =
    process.env.DOCKER_STUDIO_MEMORY_AUTO_RESERVE_MB;
  const originalDockerStudioMemoryAutoMinMb =
    process.env.DOCKER_STUDIO_MEMORY_AUTO_MIN_MB;
  const originalDockerStudioMemoryAutoMaxMb =
    process.env.DOCKER_STUDIO_MEMORY_AUTO_MAX_MB;
  const gib = 1024 * 1024 * 1024;

  afterEach(() => {
    if (typeof originalDockerStudioMemoryMb === "string") {
      process.env.DOCKER_STUDIO_MEMORY_MB = originalDockerStudioMemoryMb;
    } else {
      delete process.env.DOCKER_STUDIO_MEMORY_MB;
    }

    if (typeof originalDockerStudioMemoryAutoReserveMb === "string") {
      process.env.DOCKER_STUDIO_MEMORY_AUTO_RESERVE_MB =
        originalDockerStudioMemoryAutoReserveMb;
    } else {
      delete process.env.DOCKER_STUDIO_MEMORY_AUTO_RESERVE_MB;
    }

    if (typeof originalDockerStudioMemoryAutoMinMb === "string") {
      process.env.DOCKER_STUDIO_MEMORY_AUTO_MIN_MB =
        originalDockerStudioMemoryAutoMinMb;
    } else {
      delete process.env.DOCKER_STUDIO_MEMORY_AUTO_MIN_MB;
    }

    if (typeof originalDockerStudioMemoryAutoMaxMb === "string") {
      process.env.DOCKER_STUDIO_MEMORY_AUTO_MAX_MB =
        originalDockerStudioMemoryAutoMaxMb;
    } else {
      delete process.env.DOCKER_STUDIO_MEMORY_AUTO_MAX_MB;
    }
  });

  it("uses an explicit studio memory override when configured", () => {
    process.env.DOCKER_STUDIO_MEMORY_MB = "2816";

    const config = new DockerProviderConfig({
      totalSystemMemoryBytes: () => 8 * gib,
      readTextFile: () => {
        throw new Error("unreachable");
      },
    });

    expect(config.memoryMb).toBe(2816);
  });

  it("auto-sizes studio memory on 4 GiB hosts to leave headroom", () => {
    delete process.env.DOCKER_STUDIO_MEMORY_MB;

    const config = new DockerProviderConfig({
      totalSystemMemoryBytes: () => 4 * gib,
      readTextFile: () => {
        throw new Error("missing");
      },
    });

    expect(config.memoryMb).toBe(2560);
  });

  it("preserves the reserve on 3 GiB hosts instead of forcing the old 2 GiB floor", () => {
    delete process.env.DOCKER_STUDIO_MEMORY_MB;

    const config = new DockerProviderConfig({
      totalSystemMemoryBytes: () => 3 * gib,
      readTextFile: () => {
        throw new Error("missing");
      },
    });

    expect(config.memoryMb).toBe(1536);
  });

  it("uses the cgroup memory limit when the backend container is constrained", () => {
    delete process.env.DOCKER_STUDIO_MEMORY_MB;

    const config = new DockerProviderConfig({
      totalSystemMemoryBytes: () => 8 * gib,
      readTextFile: (filePath) => {
        if (filePath === "/sys/fs/cgroup/memory.max") {
          return String(4 * gib);
        }
        throw new Error("missing");
      },
    });

    expect(config.memoryMb).toBe(2560);
  });

  it("caps auto-sized studio memory on larger hosts by default", () => {
    delete process.env.DOCKER_STUDIO_MEMORY_MB;

    const config = new DockerProviderConfig({
      totalSystemMemoryBytes: () => 16 * gib,
      readTextFile: () => {
        throw new Error("missing");
      },
    });

    expect(config.memoryMb).toBe(4096);
  });

  it("lets self-hosters tune the auto-sizing reserve and clamp", () => {
    delete process.env.DOCKER_STUDIO_MEMORY_MB;
    process.env.DOCKER_STUDIO_MEMORY_AUTO_RESERVE_MB = "1024";
    process.env.DOCKER_STUDIO_MEMORY_AUTO_MIN_MB = "1024";
    process.env.DOCKER_STUDIO_MEMORY_AUTO_MAX_MB = "3328";

    const config = new DockerProviderConfig({
      totalSystemMemoryBytes: () => 6 * gib,
      readTextFile: () => {
        throw new Error("missing");
      },
    });

    expect(config.memoryMb).toBe(3328);
  });
});

describe("DockerProviderConfig.cpuLimit", () => {
  const originalDockerStudioCpus = process.env.DOCKER_STUDIO_CPUS;
  const originalDockerStudioAutoReserve = process.env.DOCKER_STUDIO_CPUS_AUTO_RESERVE;
  const originalDockerStudioAutoMax = process.env.DOCKER_STUDIO_CPUS_AUTO_MAX;

  afterEach(() => {
    if (typeof originalDockerStudioCpus === "string") {
      process.env.DOCKER_STUDIO_CPUS = originalDockerStudioCpus;
    } else {
      delete process.env.DOCKER_STUDIO_CPUS;
    }

    if (typeof originalDockerStudioAutoReserve === "string") {
      process.env.DOCKER_STUDIO_CPUS_AUTO_RESERVE = originalDockerStudioAutoReserve;
    } else {
      delete process.env.DOCKER_STUDIO_CPUS_AUTO_RESERVE;
    }

    if (typeof originalDockerStudioAutoMax === "string") {
      process.env.DOCKER_STUDIO_CPUS_AUTO_MAX = originalDockerStudioAutoMax;
    } else {
      delete process.env.DOCKER_STUDIO_CPUS_AUTO_MAX;
    }
  });

  it("uses an explicit studio cpu override when configured", () => {
    process.env.DOCKER_STUDIO_CPUS = "2.5";

    const config = new DockerProviderConfig({
      totalSystemCpuCount: () => 8,
    });

    expect(config.cpuLimit).toBe(2.5);
  });

  it("auto-sizes studio cpu from the detected budget, while still respecting the default cap", () => {
    delete process.env.DOCKER_STUDIO_CPUS;

    const config = new DockerProviderConfig({
      totalSystemCpuCount: () => 4,
    });

    expect(config.cpuLimit).toBe(2);
  });

  it("caps auto-sized studio cpu on larger hosts by default", () => {
    delete process.env.DOCKER_STUDIO_CPUS;

    const config = new DockerProviderConfig({
      totalSystemCpuCount: () => 16,
    });

    expect(config.cpuLimit).toBe(2);
  });

  it("lets self-hosters tune the auto-sized cpu reserve", () => {
    delete process.env.DOCKER_STUDIO_CPUS;
    process.env.DOCKER_STUDIO_CPUS_AUTO_RESERVE = "2";
    process.env.DOCKER_STUDIO_CPUS_AUTO_MAX = "8";

    const config = new DockerProviderConfig({
      totalSystemCpuCount: () => 6,
    });

    expect(config.cpuLimit).toBe(4);
  });

  it("lets self-hosters raise the auto-sized cpu cap", () => {
    delete process.env.DOCKER_STUDIO_CPUS;
    process.env.DOCKER_STUDIO_CPUS_AUTO_MAX = "8";

    const config = new DockerProviderConfig({
      totalSystemCpuCount: () => 16,
    });

    expect(config.cpuLimit).toBe(8);
  });
});
