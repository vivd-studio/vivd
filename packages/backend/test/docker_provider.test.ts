import { afterEach, describe, expect, it, vi } from "vitest";
import { DockerStudioMachineProvider } from "../src/services/studioMachines/docker/provider";
import * as visitStore from "../src/services/studioMachines/visitStore";

const DEFAULT_DOCKER_STUDIO_MEMORY_BYTES = 2048 * 1024 * 1024;

describe("DockerStudioMachineProvider", () => {
  const envSnapshot = {
    DATABASE_URL: process.env.DATABASE_URL,
    DOCKER_STUDIO_API_VERSION: process.env.DOCKER_STUDIO_API_VERSION,
    DOCKER_STUDIO_FALLBACK_PLATFORM: process.env.DOCKER_STUDIO_FALLBACK_PLATFORM,
    DOCKER_STUDIO_MAIN_BACKEND_URL: process.env.DOCKER_STUDIO_MAIN_BACKEND_URL,
    DOCKER_STUDIO_RECONCILER_CONCURRENCY:
      process.env.DOCKER_STUDIO_RECONCILER_CONCURRENCY,
  };

  afterEach(() => {
    vi.restoreAllMocks();

    if (typeof envSnapshot.DATABASE_URL === "string") {
      process.env.DATABASE_URL = envSnapshot.DATABASE_URL;
    } else {
      delete process.env.DATABASE_URL;
    }

    if (typeof envSnapshot.DOCKER_STUDIO_API_VERSION === "string") {
      process.env.DOCKER_STUDIO_API_VERSION = envSnapshot.DOCKER_STUDIO_API_VERSION;
    } else {
      delete process.env.DOCKER_STUDIO_API_VERSION;
    }

    if (typeof envSnapshot.DOCKER_STUDIO_FALLBACK_PLATFORM === "string") {
      process.env.DOCKER_STUDIO_FALLBACK_PLATFORM =
        envSnapshot.DOCKER_STUDIO_FALLBACK_PLATFORM;
    } else {
      delete process.env.DOCKER_STUDIO_FALLBACK_PLATFORM;
    }

    if (typeof envSnapshot.DOCKER_STUDIO_MAIN_BACKEND_URL === "string") {
      process.env.DOCKER_STUDIO_MAIN_BACKEND_URL =
        envSnapshot.DOCKER_STUDIO_MAIN_BACKEND_URL;
    } else {
      delete process.env.DOCKER_STUDIO_MAIN_BACKEND_URL;
    }

    if (typeof envSnapshot.DOCKER_STUDIO_RECONCILER_CONCURRENCY === "string") {
      process.env.DOCKER_STUDIO_RECONCILER_CONCURRENCY =
        envSnapshot.DOCKER_STUDIO_RECONCILER_CONCURRENCY;
    } else {
      delete process.env.DOCKER_STUDIO_RECONCILER_CONCURRENCY;
    }
  });

  it("pulls a missing image and retries container creation", async () => {
    delete process.env.DATABASE_URL;
    const provider = new DockerStudioMachineProvider();
    const apiClient = (provider as any).apiClient;

    const createContainerMock = vi
      .spyOn(apiClient, "createContainer")
      .mockRejectedValueOnce(
        new Error("[DockerMachines] No such image: ghcr.io/vivd-studio/vivd-studio:0.8.0"),
      )
      .mockResolvedValueOnce({ Id: "container-1" });
    const pullImageMock = vi.spyOn(apiClient, "pullImage").mockResolvedValue(undefined);
    vi.spyOn(apiClient, "inspectContainer").mockResolvedValue({
      Id: "container-1",
      Name: "/studio-site-1-v1",
      Config: {
        Image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
        Env: [
          "STUDIO_ID=studio-1",
          "STUDIO_ACCESS_TOKEN=access-1",
          "VIVD_TENANT_ID=org-1",
          "VIVD_PROJECT_SLUG=site-1",
          "VIVD_PROJECT_VERSION=1",
        ],
        Labels: {
          vivd_managed: "true",
          vivd_provider: "docker",
          vivd_organization_id: "org-1",
          vivd_project_slug: "site-1",
          vivd_project_version: "1",
          vivd_studio_id: "studio-1",
          vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
          vivd_route_id: "site-1-v1",
        },
      },
      State: {
        Status: "created",
      },
      HostConfig: {
        NetworkMode: "vivd-network",
        NanoCpus: 1_000_000_000,
        Memory: DEFAULT_DOCKER_STUDIO_MEMORY_BYTES,
      },
      Created: new Date().toISOString(),
    });

    const container = await (provider as any).createFreshContainer({
      args: {
        organizationId: "org-1",
        projectSlug: "site-1",
        version: 1,
        env: {},
      },
      desiredImage: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
    });

    expect(pullImageMock).toHaveBeenCalledWith("ghcr.io/vivd-studio/vivd-studio:0.8.0");
    expect(createContainerMock).toHaveBeenCalledTimes(2);
    expect(container.Id).toBe("container-1");
  });

  it("falls back to linux/amd64 when the native manifest is unavailable", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.DOCKER_STUDIO_FALLBACK_PLATFORM;
    const provider = new DockerStudioMachineProvider();
    const apiClient = (provider as any).apiClient;

    const createContainerMock = vi
      .spyOn(apiClient, "createContainer")
      .mockRejectedValueOnce(
        new Error("[DockerMachines] No such image: ghcr.io/vivd-studio/vivd-studio:0.8.0"),
      )
      .mockResolvedValueOnce({ Id: "container-2" });
    const pullImageMock = vi
      .spyOn(apiClient, "pullImage")
      .mockRejectedValueOnce(
        new Error(
          "[DockerMachines] no matching manifest for linux/arm64/v8 in the manifest list entries: no match for platform in manifest: not found",
        ),
      )
      .mockResolvedValueOnce(undefined);
    vi.spyOn(apiClient, "inspectContainer").mockResolvedValue({
      Id: "container-2",
      Name: "/studio-site-1-v1",
      Config: {
        Image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
        Env: [
          "STUDIO_ID=studio-2",
          "STUDIO_ACCESS_TOKEN=access-2",
          "VIVD_TENANT_ID=org-1",
          "VIVD_PROJECT_SLUG=site-1",
          "VIVD_PROJECT_VERSION=1",
        ],
        Labels: {
          vivd_managed: "true",
          vivd_provider: "docker",
          vivd_organization_id: "org-1",
          vivd_project_slug: "site-1",
          vivd_project_version: "1",
          vivd_studio_id: "studio-2",
          vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
          vivd_route_id: "site-1-v1",
        },
      },
      State: {
        Status: "created",
      },
      HostConfig: {
        NetworkMode: "vivd-network",
        NanoCpus: 1_000_000_000,
        Memory: DEFAULT_DOCKER_STUDIO_MEMORY_BYTES,
      },
      Created: new Date().toISOString(),
    });

    const container = await (provider as any).createFreshContainer({
      args: {
        organizationId: "org-1",
        projectSlug: "site-1",
        version: 1,
        env: {},
      },
      desiredImage: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
    });

    expect(pullImageMock).toHaveBeenNthCalledWith(
      1,
      "ghcr.io/vivd-studio/vivd-studio:0.8.0",
    );
    expect(pullImageMock).toHaveBeenNthCalledWith(
      2,
      "ghcr.io/vivd-studio/vivd-studio:0.8.0",
      { platform: "linux/amd64" },
    );
    expect(createContainerMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        platform: "linux/amd64",
      }),
    );
    expect(container.Id).toBe("container-2");
  });

  it("resolves a compose-prefixed Docker network name before container creation", async () => {
    delete process.env.DATABASE_URL;
    const provider = new DockerStudioMachineProvider();
    const apiClient = (provider as any).apiClient;

    vi.spyOn(apiClient, "listNetworks").mockResolvedValue([
      { Name: "bridge" },
      { Name: "vivd_vivd-network" },
    ]);
    const createContainerMock = vi
      .spyOn(apiClient, "createContainer")
      .mockResolvedValueOnce({ Id: "container-3" });
    vi.spyOn(apiClient, "inspectContainer").mockResolvedValue({
      Id: "container-3",
      Name: "/studio-site-1-v1",
      Config: {
        Image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
        Env: [
          "STUDIO_ID=studio-3",
          "STUDIO_ACCESS_TOKEN=access-3",
          "VIVD_TENANT_ID=org-1",
          "VIVD_PROJECT_SLUG=site-1",
          "VIVD_PROJECT_VERSION=1",
        ],
        Labels: {
          vivd_managed: "true",
          vivd_provider: "docker",
          vivd_organization_id: "org-1",
          vivd_project_slug: "site-1",
          vivd_project_version: "1",
          vivd_studio_id: "studio-3",
          vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
          vivd_route_id: "site-1-v1",
        },
      },
      State: {
        Status: "created",
      },
      HostConfig: {
        NetworkMode: "vivd_vivd-network",
        NanoCpus: 1_000_000_000,
        Memory: DEFAULT_DOCKER_STUDIO_MEMORY_BYTES,
      },
      Created: new Date().toISOString(),
    });

    await (provider as any).createFreshContainer({
      args: {
        organizationId: "org-1",
        projectSlug: "site-1",
        version: 1,
        env: {},
      },
      desiredImage: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
    });

    expect(createContainerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          HostConfig: expect.objectContaining({
            NetworkMode: "vivd_vivd-network",
          }),
        }),
      }),
    );
  });

  it("recovers from a deterministic container name conflict by inspecting the existing container", async () => {
    delete process.env.DATABASE_URL;
    const provider = new DockerStudioMachineProvider();
    const apiClient = (provider as any).apiClient;

    vi.spyOn(apiClient, "createContainer").mockRejectedValueOnce(
      new Error(
        '[DockerMachines] Conflict. The container name "/studio-site-1-v1-a3f6fad7ba" is already in use by container "existing".',
      ),
    );
    const inspectContainerMock = vi
      .spyOn(apiClient, "inspectContainer")
      .mockResolvedValueOnce({
        Id: "existing",
        Name: "/studio-site-1-v1-a3f6fad7ba",
        Config: {
          Image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
          Env: [
            "STUDIO_ID=studio-existing",
            "STUDIO_ACCESS_TOKEN=access-existing",
            "VIVD_TENANT_ID=org-1",
            "VIVD_PROJECT_SLUG=site-1",
            "VIVD_PROJECT_VERSION=1",
          ],
          Labels: {
            vivd_managed: "true",
            vivd_provider: "docker",
            vivd_organization_id: "org-1",
            vivd_project_slug: "site-1",
            vivd_project_version: "1",
            vivd_studio_id: "studio-existing",
            vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
            vivd_route_id: "site-1-v1",
          },
        },
        State: {
          Status: "created",
        },
        HostConfig: {
          NetworkMode: "vivd-network",
          NanoCpus: 1_000_000_000,
          Memory: DEFAULT_DOCKER_STUDIO_MEMORY_BYTES,
        },
        Created: new Date().toISOString(),
      });

    const container = await (provider as any).createFreshContainer({
      args: {
        organizationId: "org-1",
        projectSlug: "site-1",
        version: 1,
        env: {},
      },
      desiredImage: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
    });

    expect(inspectContainerMock).toHaveBeenCalledWith(
      expect.stringMatching(/^studio-site-1-v1-[a-f0-9]{10}$/),
    );
    expect(container.Id).toBe("existing");
  });

  it("recreates a stopped container when its stored network mode no longer matches the resolved network", async () => {
    delete process.env.DATABASE_URL;
    const provider = new DockerStudioMachineProvider();
    const apiClient = (provider as any).apiClient;
    const routeService = (provider as any).routeService;

    vi.spyOn(provider, "getDesiredImage").mockResolvedValue(
      "ghcr.io/vivd-studio/vivd-studio:0.8.0",
    );
    vi.spyOn(provider as any, "waitForReady").mockResolvedValue(undefined);
    vi.spyOn(routeService, "upsertRuntimeRoute").mockResolvedValue("/_studio/site-1-v1");

    vi.spyOn(apiClient, "listContainers").mockResolvedValue([
      {
        Id: "existing",
        Names: ["/studio-site-1-v1-a3f6fad7ba"],
        Image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
        Labels: {
          vivd_managed: "true",
          vivd_provider: "docker",
          vivd_organization_id: "org-1",
          vivd_project_slug: "site-1",
          vivd_project_version: "1",
          vivd_studio_id: "studio-existing",
          vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
          vivd_route_id: "site-1-v1",
        },
        State: "exited",
      },
    ]);
    vi.spyOn(apiClient, "listNetworks").mockResolvedValue([
      { Name: "vivd_vivd-network" },
    ]);
    vi.spyOn(apiClient, "inspectContainer")
      .mockResolvedValueOnce({
        Id: "existing",
        Name: "/studio-site-1-v1-a3f6fad7ba",
        Config: {
          Image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
          Env: [
            "STUDIO_ID=studio-existing",
            "STUDIO_ACCESS_TOKEN=access-existing",
            "VIVD_TENANT_ID=org-1",
            "VIVD_PROJECT_SLUG=site-1",
            "VIVD_PROJECT_VERSION=1",
          ],
          Labels: {
            vivd_managed: "true",
            vivd_provider: "docker",
            vivd_organization_id: "org-1",
            vivd_project_slug: "site-1",
            vivd_project_version: "1",
            vivd_studio_id: "studio-existing",
            vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
            vivd_route_id: "site-1-v1",
          },
        },
        State: {
          Status: "exited",
        },
        HostConfig: {
          NetworkMode: "vivd-network",
          NanoCpus: 1_000_000_000,
          Memory: DEFAULT_DOCKER_STUDIO_MEMORY_BYTES,
        },
        Created: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        Id: "replacement",
        Name: "/studio-site-1-v1-a3f6fad7ba",
        Config: {
          Image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
          Env: [
            "STUDIO_ID=studio-existing",
            "STUDIO_ACCESS_TOKEN=access-existing",
            "VIVD_TENANT_ID=org-1",
            "VIVD_PROJECT_SLUG=site-1",
            "VIVD_PROJECT_VERSION=1",
          ],
          Labels: {
            vivd_managed: "true",
            vivd_provider: "docker",
            vivd_organization_id: "org-1",
            vivd_project_slug: "site-1",
            vivd_project_version: "1",
            vivd_studio_id: "studio-existing",
            vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
            vivd_route_id: "site-1-v1",
          },
        },
        State: {
          Status: "created",
        },
        HostConfig: {
          NetworkMode: "vivd_vivd-network",
          NanoCpus: 1_000_000_000,
          Memory: DEFAULT_DOCKER_STUDIO_MEMORY_BYTES,
        },
        Created: new Date().toISOString(),
      });
    const removeContainerMock = vi
      .spyOn(apiClient, "removeContainer")
      .mockResolvedValue(undefined);
    const createContainerMock = vi
      .spyOn(apiClient, "createContainer")
      .mockResolvedValue({ Id: "replacement" });
    const startContainerMock = vi
      .spyOn(apiClient, "startContainer")
      .mockResolvedValue(undefined);

    const result = await provider.ensureRunning({
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 1,
      env: {},
    });

    expect(removeContainerMock).toHaveBeenCalledWith("existing");
    expect(createContainerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          HostConfig: expect.objectContaining({
            NetworkMode: "vivd_vivd-network",
          }),
        }),
      }),
    );
    expect(startContainerMock).toHaveBeenCalledWith("replacement");
    expect(result.accessToken).toBe("access-existing");
  });

  it("recreates a running container when its managed backend callback URL is stale", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.DOCKER_STUDIO_MAIN_BACKEND_URL;
    const provider = new DockerStudioMachineProvider();
    const apiClient = (provider as any).apiClient;
    const routeService = (provider as any).routeService;

    vi.spyOn(provider, "getDesiredImage").mockResolvedValue(
      "ghcr.io/vivd-studio/vivd-studio:0.8.0",
    );
    vi.spyOn(provider as any, "waitForReady").mockResolvedValue(undefined);
    vi.spyOn(routeService, "upsertRuntimeRoute").mockResolvedValue("/_studio/site-1-v1");
    vi.spyOn(apiClient, "listNetworks").mockResolvedValue([
      { Name: "vivd_vivd-network" },
    ]);
    vi.spyOn(apiClient, "listContainers").mockResolvedValue([
      {
        Id: "existing",
        Names: ["/studio-site-1-v1-a3f6fad7ba"],
        Image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
        Labels: {
          vivd_managed: "true",
          vivd_provider: "docker",
          vivd_organization_id: "org-1",
          vivd_project_slug: "site-1",
          vivd_project_version: "1",
          vivd_studio_id: "studio-existing",
          vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
          vivd_route_id: "site-1-v1",
        },
        State: "running",
        HostConfig: {
          NetworkMode: "vivd_vivd-network",
        },
      },
    ]);
    vi.spyOn(apiClient, "inspectContainer")
      .mockResolvedValueOnce({
        Id: "existing",
        Name: "/studio-site-1-v1-a3f6fad7ba",
        Config: {
          Image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
          Env: [
            "STUDIO_ID=studio-existing",
            "STUDIO_ACCESS_TOKEN=access-existing",
            "VIVD_TENANT_ID=org-1",
            "VIVD_PROJECT_SLUG=site-1",
            "VIVD_PROJECT_VERSION=1",
            "MAIN_BACKEND_URL=http://localhost/vivd-studio",
          ],
          Labels: {
            vivd_managed: "true",
            vivd_provider: "docker",
            vivd_organization_id: "org-1",
            vivd_project_slug: "site-1",
            vivd_project_version: "1",
            vivd_studio_id: "studio-existing",
            vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
            vivd_route_id: "site-1-v1",
          },
        },
        State: {
          Status: "running",
        },
        HostConfig: {
          NetworkMode: "vivd_vivd-network",
          NanoCpus: 1_000_000_000,
          Memory: DEFAULT_DOCKER_STUDIO_MEMORY_BYTES,
        },
        Created: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        Id: "replacement",
        Name: "/studio-site-1-v1-a3f6fad7ba",
        Config: {
          Image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
          Env: [
            "STUDIO_ID=studio-existing",
            "STUDIO_ACCESS_TOKEN=access-existing",
            "VIVD_TENANT_ID=org-1",
            "VIVD_PROJECT_SLUG=site-1",
            "VIVD_PROJECT_VERSION=1",
            "MAIN_BACKEND_URL=http://backend:3000/vivd-studio",
          ],
          Labels: {
            vivd_managed: "true",
            vivd_provider: "docker",
            vivd_organization_id: "org-1",
            vivd_project_slug: "site-1",
            vivd_project_version: "1",
            vivd_studio_id: "studio-existing",
            vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
            vivd_route_id: "site-1-v1",
          },
        },
        State: {
          Status: "created",
        },
        HostConfig: {
          NetworkMode: "vivd_vivd-network",
          NanoCpus: 1_000_000_000,
          Memory: DEFAULT_DOCKER_STUDIO_MEMORY_BYTES,
        },
        Created: new Date().toISOString(),
      });
    const stopContainerMock = vi
      .spyOn(apiClient, "stopContainer")
      .mockResolvedValue(undefined);
    const removeContainerMock = vi
      .spyOn(apiClient, "removeContainer")
      .mockResolvedValue(undefined);
    const createContainerMock = vi
      .spyOn(apiClient, "createContainer")
      .mockResolvedValue({ Id: "replacement" });
    const startContainerMock = vi
      .spyOn(apiClient, "startContainer")
      .mockResolvedValue(undefined);

    const result = await provider.ensureRunning({
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 1,
      env: {
        MAIN_BACKEND_URL: "http://localhost/vivd-studio",
      },
    });

    expect(stopContainerMock).toHaveBeenCalledWith("existing", 180);
    expect(removeContainerMock).toHaveBeenCalledWith("existing");
    expect(createContainerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          Env: expect.arrayContaining([
            "MAIN_BACKEND_URL=http://backend:3000/vivd-studio",
          ]),
        }),
      }),
    );
    expect(startContainerMock).toHaveBeenCalledWith("replacement");
    expect(result.accessToken).toBe("access-existing");
  });

  it("recreates a stale created container when Docker start fails because its network no longer exists", async () => {
    delete process.env.DATABASE_URL;
    const provider = new DockerStudioMachineProvider();
    const apiClient = (provider as any).apiClient;
    const routeService = (provider as any).routeService;

    vi.spyOn(routeService, "upsertRuntimeRoute").mockResolvedValue("/_studio/site-1-v1");
    vi.spyOn(provider as any, "waitForReady").mockResolvedValue(undefined);
    vi.spyOn(apiClient, "listNetworks").mockResolvedValue([
      { Name: "vivd_vivd-network" },
    ]);
    const startContainerMock = vi
      .spyOn(apiClient, "startContainer")
      .mockRejectedValueOnce(
        new Error(
          "[DockerMachines] failed to set up container networking: network vivd-network not found",
        ),
      )
      .mockResolvedValueOnce(undefined);
    const removeContainerMock = vi
      .spyOn(apiClient, "removeContainer")
      .mockResolvedValue(undefined);
    const createContainerMock = vi
      .spyOn(apiClient, "createContainer")
      .mockResolvedValue({ Id: "replacement" });
    vi.spyOn(apiClient, "inspectContainer").mockResolvedValue({
      Id: "replacement",
      Name: "/studio-site-1-v1-a3f6fad7ba",
      Config: {
        Image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
        Env: [
          "STUDIO_ID=studio-existing",
          "STUDIO_ACCESS_TOKEN=access-existing",
          "VIVD_TENANT_ID=org-1",
          "VIVD_PROJECT_SLUG=site-1",
          "VIVD_PROJECT_VERSION=1",
        ],
        Labels: {
          vivd_managed: "true",
          vivd_provider: "docker",
          vivd_organization_id: "org-1",
          vivd_project_slug: "site-1",
          vivd_project_version: "1",
          vivd_studio_id: "studio-existing",
          vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
          vivd_route_id: "site-1-v1",
        },
      },
      State: {
        Status: "created",
      },
      HostConfig: {
        NetworkMode: "vivd_vivd-network",
        NanoCpus: 1_000_000_000,
        Memory: DEFAULT_DOCKER_STUDIO_MEMORY_BYTES,
      },
      Created: new Date().toISOString(),
    });

    const result = await (provider as any).ensureContainerRunning(
      {
        organizationId: "org-1",
        projectSlug: "site-1",
        version: 1,
        env: {},
      },
      {
        Id: "existing",
        Name: "/studio-site-1-v1-a3f6fad7ba",
        Config: {
          Image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
          Env: [
            "STUDIO_ID=studio-existing",
            "STUDIO_ACCESS_TOKEN=access-existing",
            "VIVD_TENANT_ID=org-1",
            "VIVD_PROJECT_SLUG=site-1",
            "VIVD_PROJECT_VERSION=1",
          ],
          Labels: {
            vivd_managed: "true",
            vivd_provider: "docker",
            vivd_organization_id: "org-1",
            vivd_project_slug: "site-1",
            vivd_project_version: "1",
            vivd_studio_id: "studio-existing",
            vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
            vivd_route_id: "site-1-v1",
          },
        },
        State: {
          Status: "created",
        },
        HostConfig: {
          NetworkMode: "vivd-network",
          NanoCpus: 1_000_000_000,
          Memory: DEFAULT_DOCKER_STUDIO_MEMORY_BYTES,
        },
        Created: new Date().toISOString(),
      },
      "access-existing",
      "ghcr.io/vivd-studio/vivd-studio:0.8.0",
    );

    expect(startContainerMock).toHaveBeenNthCalledWith(1, "existing");
    expect(removeContainerMock).toHaveBeenCalledWith("existing");
    expect(createContainerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          HostConfig: expect.objectContaining({
            NetworkMode: "vivd_vivd-network",
          }),
        }),
      }),
    );
    expect(startContainerMock).toHaveBeenNthCalledWith(2, "replacement");
    expect(result.accessToken).toBe("access-existing");
  });

  it("recognizes managed machines from Docker container summaries that include HostConfig", async () => {
    delete process.env.DATABASE_URL;
    const provider = new DockerStudioMachineProvider();
    const apiClient = (provider as any).apiClient;

    vi.spyOn(provider, "getDesiredImage").mockResolvedValue(
      "ghcr.io/vivd-studio/vivd-studio:0.8.0",
    );
    vi.spyOn(apiClient, "listContainers").mockResolvedValue([
      {
        Id: "existing",
        Names: ["/studio-site-1-v1-a3f6fad7ba"],
        Image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
        Labels: {
          vivd_managed: "true",
          vivd_provider: "docker",
          vivd_organization_id: "org-1",
          vivd_project_slug: "site-1",
          vivd_project_version: "1",
          vivd_studio_id: "studio-existing",
          vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
          vivd_route_id: "site-1-v1",
        },
        State: "running",
        HostConfig: {
          NetworkMode: "vivd_vivd-network",
        },
      },
    ]);
    vi.spyOn(apiClient, "inspectContainer").mockResolvedValue({
      Id: "existing",
      Name: "/studio-site-1-v1-a3f6fad7ba",
      Config: {
        Image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
        Env: [
          "STUDIO_ID=studio-existing",
          "STUDIO_ACCESS_TOKEN=access-existing",
          "VIVD_TENANT_ID=org-1",
          "VIVD_PROJECT_SLUG=site-1",
          "VIVD_PROJECT_VERSION=1",
          "MAIN_BACKEND_URL=http://backend:3000/vivd-studio",
        ],
        Labels: {
          vivd_managed: "true",
          vivd_provider: "docker",
          vivd_organization_id: "org-1",
          vivd_project_slug: "site-1",
          vivd_project_version: "1",
          vivd_studio_id: "studio-existing",
          vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
          vivd_route_id: "site-1-v1",
        },
      },
      State: {
        Status: "running",
        StartedAt: new Date().toISOString(),
      },
      HostConfig: {
        NetworkMode: "vivd_vivd-network",
        NanoCpus: 1_000_000_000,
        Memory: DEFAULT_DOCKER_STUDIO_MEMORY_BYTES,
      },
      Created: new Date().toISOString(),
    });

    const summaries = await provider.listStudioMachines();
    const url = await provider.getUrl("org-1", "site-1", 1);
    const isRunning = await provider.isRunning("org-1", "site-1", 1);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: "existing",
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 1,
      state: "started",
    });
    expect(url).toMatchObject({
      url: "http://app.localhost/_studio/site-1-v1",
      accessToken: "access-existing",
    });
    expect(isRunning).toBe(true);
  });

  it("uses the configured reconcile concurrency when warming drifted containers", async () => {
    delete process.env.DATABASE_URL;
    process.env.DOCKER_STUDIO_RECONCILER_CONCURRENCY = "1";

    const provider = new DockerStudioMachineProvider();
    const apiClient = (provider as any).apiClient;
    vi.spyOn(provider, "getDesiredImage").mockResolvedValue(
      "ghcr.io/vivd-studio/vivd-studio:0.8.0",
    );
    vi.spyOn(visitStore, "listStudioVisitMsByIdentity").mockResolvedValue(new Map());
    vi.spyOn(apiClient, "listContainers").mockResolvedValue([
      {
        Id: "container-1",
        Names: ["/studio-site-1-v1-a3f6fad7ba"],
        Image: "ghcr.io/vivd-studio/vivd-studio:0.7.0",
        Labels: {
          vivd_managed: "true",
          vivd_provider: "docker",
          vivd_organization_id: "org-1",
          vivd_project_slug: "site-1",
          vivd_project_version: "1",
          vivd_studio_id: "studio-1",
          vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.7.0",
          vivd_route_id: "site-1-v1",
        },
        State: "exited",
      },
      {
        Id: "container-2",
        Names: ["/studio-site-2-v1-a3f6fad7ba"],
        Image: "ghcr.io/vivd-studio/vivd-studio:0.7.0",
        Labels: {
          vivd_managed: "true",
          vivd_provider: "docker",
          vivd_organization_id: "org-1",
          vivd_project_slug: "site-2",
          vivd_project_version: "1",
          vivd_studio_id: "studio-2",
          vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.7.0",
          vivd_route_id: "site-2-v1",
        },
        State: "exited",
      },
    ]);
    vi.spyOn(apiClient, "inspectContainer").mockImplementation(async (containerId: string) => {
      const projectSlug = containerId === "container-1" ? "site-1" : "site-2";
      return {
        Id: containerId,
        Name: `/studio-${projectSlug}-v1-a3f6fad7ba`,
        Config: {
          Image: "ghcr.io/vivd-studio/vivd-studio:0.7.0",
          Env: [
            `STUDIO_ID=studio-${projectSlug}`,
            `STUDIO_ACCESS_TOKEN=access-${projectSlug}`,
            "VIVD_TENANT_ID=org-1",
            `VIVD_PROJECT_SLUG=${projectSlug}`,
            "VIVD_PROJECT_VERSION=1",
          ],
          Labels: {
            vivd_managed: "true",
            vivd_provider: "docker",
            vivd_organization_id: "org-1",
            vivd_project_slug: projectSlug,
            vivd_project_version: "1",
            vivd_studio_id: `studio-${projectSlug}`,
            vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.7.0",
            vivd_route_id: `${projectSlug}-v1`,
          },
        },
        State: {
          Status: "exited",
        },
        HostConfig: {
          NetworkMode: "vivd_vivd-network",
          NanoCpus: 1_000_000_000,
          Memory: DEFAULT_DOCKER_STUDIO_MEMORY_BYTES,
        },
        Created: new Date().toISOString(),
      };
    });

    let releaseFirst: (() => void) | null = null;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let signalFirstEntered: (() => void) | null = null;
    const firstEntered = new Promise<void>((resolve) => {
      signalFirstEntered = resolve;
    });
    let secondStarted = false;
    let active = 0;
    let maxActive = 0;
    vi.spyOn(provider as any, "warmReconcileContainer").mockImplementation(
      async ({ container }: { container: { Id: string } }) => {
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          if (container.Id === "container-1") {
            signalFirstEntered?.();
            await firstReleased;
            return;
          }
          secondStarted = true;
        } finally {
          active--;
        }
      },
    );

    const reconcilePromise = provider.reconcileStudioMachines();
    await firstEntered;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(secondStarted).toBe(false);
    releaseFirst?.();
    const result = await reconcilePromise;

    expect(secondStarted).toBe(true);
    expect(maxActive).toBe(1);
    expect(result.warmedOutdatedImages).toBe(2);
  });

  it("warm reconciles a drifted stopped container and parks it stopped again", async () => {
    delete process.env.DATABASE_URL;

    const provider = new DockerStudioMachineProvider();
    const apiClient = (provider as any).apiClient;
    const routeService = (provider as any).routeService;

    vi.spyOn(apiClient, "listNetworks").mockResolvedValue([
      { Name: "vivd_vivd-network" },
    ]);
    vi.spyOn(routeService, "upsertRuntimeRoute").mockResolvedValue("/_studio/site-1-v1");
    vi.spyOn(routeService, "removeRuntimeRoute").mockResolvedValue(undefined);
    vi.spyOn(provider as any, "waitForReady").mockResolvedValue(undefined);
    vi.spyOn(apiClient, "removeContainer").mockResolvedValue(undefined);
    const createContainerMock = vi
      .spyOn(apiClient, "createContainer")
      .mockResolvedValue({ Id: "replacement" });
    const startContainerMock = vi
      .spyOn(apiClient, "startContainer")
      .mockResolvedValue(undefined);
    const stopContainerMock = vi
      .spyOn(apiClient, "stopContainer")
      .mockResolvedValue(undefined);
    vi.spyOn(apiClient, "listContainers").mockResolvedValue([
      {
        Id: "replacement",
        Names: ["/studio-site-1-v1-a3f6fad7ba"],
        Image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
        Labels: {
          vivd_managed: "true",
          vivd_provider: "docker",
          vivd_organization_id: "org-1",
          vivd_project_slug: "site-1",
          vivd_project_version: "1",
          vivd_studio_id: "studio-existing",
          vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
          vivd_route_id: "site-1-v1",
        },
        State: "running",
      },
    ]);
    vi.spyOn(apiClient, "inspectContainer")
      .mockResolvedValueOnce({
        Id: "replacement",
        Name: "/studio-site-1-v1-a3f6fad7ba",
        Config: {
          Image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
          Env: [
            "STUDIO_ID=studio-existing",
            "STUDIO_ACCESS_TOKEN=access-existing",
            "VIVD_TENANT_ID=org-1",
            "VIVD_PROJECT_SLUG=site-1",
            "VIVD_PROJECT_VERSION=1",
          ],
          Labels: {
            vivd_managed: "true",
            vivd_provider: "docker",
            vivd_organization_id: "org-1",
            vivd_project_slug: "site-1",
            vivd_project_version: "1",
            vivd_studio_id: "studio-existing",
            vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
            vivd_route_id: "site-1-v1",
          },
        },
        State: {
          Status: "created",
        },
        HostConfig: {
          NetworkMode: "vivd_vivd-network",
          NanoCpus: 1_000_000_000,
          Memory: DEFAULT_DOCKER_STUDIO_MEMORY_BYTES,
        },
        Created: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        Id: "replacement",
        Name: "/studio-site-1-v1-a3f6fad7ba",
        Config: {
          Image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
          Env: [
            "STUDIO_ID=studio-existing",
            "STUDIO_ACCESS_TOKEN=access-existing",
            "VIVD_TENANT_ID=org-1",
            "VIVD_PROJECT_SLUG=site-1",
            "VIVD_PROJECT_VERSION=1",
          ],
          Labels: {
            vivd_managed: "true",
            vivd_provider: "docker",
            vivd_organization_id: "org-1",
            vivd_project_slug: "site-1",
            vivd_project_version: "1",
            vivd_studio_id: "studio-existing",
            vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
            vivd_route_id: "site-1-v1",
          },
        },
        State: {
          Status: "running",
        },
        HostConfig: {
          NetworkMode: "vivd_vivd-network",
          NanoCpus: 1_000_000_000,
          Memory: DEFAULT_DOCKER_STUDIO_MEMORY_BYTES,
        },
        Created: new Date().toISOString(),
      });

    await (provider as any).warmReconcileContainer({
      container: {
        Id: "existing",
        Name: "/studio-site-1-v1-a3f6fad7ba",
        Config: {
          Image: "ghcr.io/vivd-studio/vivd-studio:0.7.0",
          Env: [
            "STUDIO_ID=studio-existing",
            "STUDIO_ACCESS_TOKEN=access-existing",
            "VIVD_TENANT_ID=org-1",
            "VIVD_PROJECT_SLUG=site-1",
            "VIVD_PROJECT_VERSION=1",
          ],
          Labels: {
            vivd_managed: "true",
            vivd_provider: "docker",
            vivd_organization_id: "org-1",
            vivd_project_slug: "site-1",
            vivd_project_version: "1",
            vivd_studio_id: "studio-existing",
            vivd_image: "ghcr.io/vivd-studio/vivd-studio:0.7.0",
            vivd_route_id: "site-1-v1",
          },
        },
        State: {
          Status: "exited",
        },
        HostConfig: {
          NetworkMode: "vivd_vivd-network",
          NanoCpus: 1_000_000_000,
          Memory: DEFAULT_DOCKER_STUDIO_MEMORY_BYTES,
        },
        Created: new Date().toISOString(),
      },
      identity: {
        organizationId: "org-1",
        projectSlug: "site-1",
        version: 1,
      },
      desiredImage: "ghcr.io/vivd-studio/vivd-studio:0.8.0",
      desiredNetworkName: "vivd_vivd-network",
    });

    expect(createContainerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          HostConfig: expect.objectContaining({
            NetworkMode: "vivd_vivd-network",
          }),
          Env: expect.arrayContaining([
            "STUDIO_ACCESS_TOKEN=access-existing",
          ]),
        }),
      }),
    );
    expect(startContainerMock).toHaveBeenCalledWith("replacement");
    expect(stopContainerMock).toHaveBeenCalledWith("replacement", 180);
    expect(routeService.removeRuntimeRoute).toHaveBeenCalledWith("site-1-v1");
  });
});
