import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildManagedSelfHostUpdateScript,
  InstanceSoftwareService,
} from "../src/services/system/InstanceSoftwareService";

describe("InstanceSoftwareService", () => {
  const inspectContainerMock = vi.fn();
  const pullImageMock = vi.fn();
  const createContainerMock = vi.fn();
  const startContainerMock = vi.fn();
  const listSemverImagesFromGhcrMock = vi.fn();

  beforeEach(() => {
    inspectContainerMock.mockReset();
    pullImageMock.mockReset();
    createContainerMock.mockReset();
    startContainerMock.mockReset();
    listSemverImagesFromGhcrMock.mockReset();
  });

  it("reports the current and latest release plus managed-update availability", async () => {
    inspectContainerMock.mockResolvedValue({
      Config: {
        Image: "ghcr.io/vivd-studio/vivd-server:1.1.33",
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
      },
      Mounts: [
        {
          Destination: "/srv/selfhost",
          Source: "/Users/test/vivd",
        },
      ],
    });
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
        ]),
        HostConfig: {
          AutoRemove: true,
          Binds: ["/var/run/docker.sock:/var/run/docker.sock", "/Users/test/vivd:/workspace"],
        },
      }),
    });
    expect(startContainerMock).toHaveBeenCalledWith("helper-1");
  });
});
