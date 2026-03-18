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
