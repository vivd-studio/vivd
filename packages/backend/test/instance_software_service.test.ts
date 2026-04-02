import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildManagedSelfHostUpdateScript,
  InstanceSoftwareService,
} from "../src/services/system/InstanceSoftwareService";

describe("InstanceSoftwareService", () => {
  const inspectContainerMock = vi.fn();
  const listContainersMock = vi.fn();
  const pullImageMock = vi.fn();
  const createContainerMock = vi.fn();
  const startContainerMock = vi.fn();
  const listSemverImagesFromGhcrMock = vi.fn();

  beforeEach(() => {
    inspectContainerMock.mockReset();
    listContainersMock.mockReset();
    pullImageMock.mockReset();
    createContainerMock.mockReset();
    startContainerMock.mockReset();
    listSemverImagesFromGhcrMock.mockReset();
  });

  it("reports the current and latest release plus managed-update availability", async () => {
    inspectContainerMock.mockResolvedValue({
      Config: {
        Image: "ghcr.io/vivd-studio/vivd-server:1.1.33",
        Labels: {
          "com.docker.compose.project": "vivd",
        },
      },
      Mounts: [
        {
          Destination: "/srv/selfhost",
          Source: "/Users/test/vivd",
        },
      ],
    });
    listSemverImagesFromGhcrMock.mockResolvedValue({
      imageBase: "ghcr.io/vivd-studio/vivd-server",
      images: [
        {
          tag: "1.1.34",
          version: "1.1.34",
          image: "ghcr.io/vivd-studio/vivd-server:1.1.34",
        },
      ],
    });

    const service = new InstanceSoftwareService({
      env: {
        VIVD_SELFHOST_UPDATE_WORKDIR: "/srv/selfhost",
      },
      now: () => 1_000,
      getHostname: () => "backend-container",
      dockerApiClient: {
        inspectContainer: inspectContainerMock,
        listContainers: listContainersMock,
        pullImage: pullImageMock,
        createContainer: createContainerMock,
        startContainer: startContainerMock,
      },
      listSemverImagesFromGhcr: listSemverImagesFromGhcrMock,
    });

    const result = await service.getStatus("solo");

    expect(result).toMatchObject({
      currentVersion: "1.1.33",
      currentImageTag: "1.1.33",
      latestVersion: "1.1.34",
      latestTag: "1.1.34",
      releaseStatus: "available",
      managedUpdate: {
        enabled: true,
        workdir: "/srv/selfhost",
      },
    });
  });

  it("starts a helper-container update and rewrites pinned self-host tags", async () => {
    inspectContainerMock.mockResolvedValue({
      Config: {
        Image: "ghcr.io/vivd-studio/vivd-server:1.1.33",
        Labels: {
          "com.docker.compose.project": "vivd",
        },
      },
      Mounts: [
        {
          Destination: "/srv/selfhost",
          Source: "/Users/test/vivd",
        },
      ],
    });
    listContainersMock.mockResolvedValue([]);
    pullImageMock.mockResolvedValue(undefined);
    createContainerMock.mockResolvedValue({
      Id: "helper-1",
    });
    startContainerMock.mockResolvedValue(undefined);

    const service = new InstanceSoftwareService({
      env: {
        VIVD_SELFHOST_IMAGE_TAG: "1.1.33",
        DOCKER_STUDIO_IMAGE: "ghcr.io/vivd-studio/vivd-studio:1.1.33",
        VIVD_SELFHOST_UPDATE_WORKDIR: "/srv/selfhost",
        VIVD_SELFHOST_UPDATE_SERVICES: "backend frontend scraper",
        DOCKER_STUDIO_SOCKET_PATH: "/var/run/docker.sock",
      },
      now: () => 2_000,
      getHostname: () => "backend-container",
      dockerApiClient: {
        inspectContainer: inspectContainerMock,
        listContainers: listContainersMock,
        pullImage: pullImageMock,
        createContainer: createContainerMock,
        startContainer: startContainerMock,
      },
      listSemverImagesFromGhcr: listSemverImagesFromGhcrMock,
    });

    const result = await service.startManagedUpdate({
      installProfile: "solo",
      targetTag: "1.1.34",
    });

    expect(result).toEqual({
      started: true,
      helperContainerId: "helper-1",
      helperImage: "docker:28-cli",
      targetTag: "1.1.34",
    });
    expect(pullImageMock).toHaveBeenCalledWith("docker:28-cli");
    expect(createContainerMock).toHaveBeenCalledWith({
      name: "vivd-selfhost-updater-2000",
      config: expect.objectContaining({
        Image: "docker:28-cli",
        WorkingDir: "/workspace",
        Cmd: ["sh", "-lc", buildManagedSelfHostUpdateScript()],
        Env: expect.arrayContaining([
          "TARGET_TAG=1.1.34",
          "TARGET_STUDIO_IMAGE=ghcr.io/vivd-studio/vivd-studio:1.1.34",
          "UPDATE_SELFHOST_IMAGE_TAG=1",
          "UPDATE_STUDIO_IMAGE=1",
          "UPDATE_SERVICES=backend frontend scraper",
          "UPDATE_COMPOSE_PROJECT=vivd",
        ]),
        HostConfig: {
          AutoRemove: true,
          Binds: ["/var/run/docker.sock:/var/run/docker.sock", "/Users/test/vivd:/workspace"],
        },
      }),
    });
    expect(startContainerMock).toHaveBeenCalledWith("helper-1");
  });

  it("blocks duplicate managed updates when an updater container is already running", async () => {
    inspectContainerMock.mockResolvedValue({
      Config: {
        Image: "ghcr.io/vivd-studio/vivd-server:latest",
        Labels: {
          "com.docker.compose.project": "vivd",
        },
      },
      Mounts: [
        {
          Destination: "/srv/selfhost",
          Source: "/Users/test/vivd",
        },
      ],
    });
    listContainersMock.mockResolvedValue([
      {
        Id: "helper-running",
        State: "running",
        Labels: {
          vivd_role: "selfhost_updater",
        },
      },
    ]);

    const service = new InstanceSoftwareService({
      env: {
        VIVD_SELFHOST_UPDATE_WORKDIR: "/srv/selfhost",
      },
      now: () => 3_000,
      getHostname: () => "backend-container",
      dockerApiClient: {
        inspectContainer: inspectContainerMock,
        listContainers: listContainersMock,
        pullImage: pullImageMock,
        createContainer: createContainerMock,
        startContainer: startContainerMock,
      },
      listSemverImagesFromGhcr: listSemverImagesFromGhcrMock,
    });

    const result = await service.startManagedUpdate({
      installProfile: "solo",
      targetTag: "1.1.34",
    });

    expect(result).toEqual({
      started: false,
      error: "A managed self-host update is already running for this installation.",
      targetTag: "1.1.34",
    });
    expect(pullImageMock).not.toHaveBeenCalled();
    expect(createContainerMock).not.toHaveBeenCalled();
  });

  it("retries helper-container creation once when the helper image is still missing", async () => {
    inspectContainerMock.mockResolvedValue({
      Config: {
        Image: "ghcr.io/vivd-studio/vivd-server:latest",
        Labels: {
          "com.docker.compose.project": "vivd",
        },
      },
      Mounts: [
        {
          Destination: "/srv/selfhost",
          Source: "/Users/test/vivd",
        },
      ],
    });
    listContainersMock.mockResolvedValue([]);
    pullImageMock.mockResolvedValue(undefined);
    createContainerMock
      .mockRejectedValueOnce(new Error("[DockerMachines] No such image: docker:28-cli"))
      .mockResolvedValueOnce({
        Id: "helper-2",
      });
    startContainerMock.mockResolvedValue(undefined);

    const service = new InstanceSoftwareService({
      env: {
        VIVD_SELFHOST_UPDATE_WORKDIR: "/srv/selfhost",
      },
      now: () => 4_000,
      getHostname: () => "backend-container",
      dockerApiClient: {
        inspectContainer: inspectContainerMock,
        listContainers: listContainersMock,
        pullImage: pullImageMock,
        createContainer: createContainerMock,
        startContainer: startContainerMock,
      },
      listSemverImagesFromGhcr: listSemverImagesFromGhcrMock,
    });

    const result = await service.startManagedUpdate({
      installProfile: "solo",
      targetTag: "1.1.34",
    });

    expect(result).toEqual({
      started: true,
      helperContainerId: "helper-2",
      helperImage: "docker:28-cli",
      targetTag: "1.1.34",
    });
    expect(pullImageMock).toHaveBeenCalledTimes(2);
    expect(createContainerMock).toHaveBeenCalledTimes(2);
    expect(startContainerMock).toHaveBeenCalledWith("helper-2");
  });

  it("pins the compose project in the managed update script", () => {
    expect(buildManagedSelfHostUpdateScript()).toContain(
      'docker compose -p "${UPDATE_COMPOSE_PROJECT}" "$@"',
    );
  });
});
