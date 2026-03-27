import { describe, expect, it } from "vitest";
import {
  getObjectDownloadUrl,
  getObjectStorageConfigFromEnv,
} from "../src/services/storage/ObjectStorageService";

describe("getObjectStorageConfigFromEnv", () => {
  it("resolves the local S3-compatible envs when bucket mode is local", () => {
    const config = getObjectStorageConfigFromEnv({
      VIVD_BUCKET_MODE: "local",
      VIVD_LOCAL_S3_ACCESS_KEY: "local-access",
      VIVD_LOCAL_S3_SECRET_KEY: "local-secret",
    });

    expect(config).toEqual({
      bucket: "vivd",
      endpointUrl: "http://minio:9000",
      region: "us-east-1",
      accessKeyId: "local-access",
      secretAccessKey: "local-secret",
      sessionToken: undefined,
    });
  });

  it("also infers bundled local bucket defaults when only local credentials are set", () => {
    const config = getObjectStorageConfigFromEnv({
      VIVD_LOCAL_S3_ACCESS_KEY: "local-access",
      VIVD_LOCAL_S3_SECRET_KEY: "local-secret",
    });

    expect(config).toEqual({
      bucket: "vivd",
      endpointUrl: "http://minio:9000",
      region: "us-east-1",
      accessKeyId: "local-access",
      secretAccessKey: "local-secret",
      sessionToken: undefined,
    });
  });

  it("keeps supporting externally hosted S3-compatible storage", () => {
    const config = getObjectStorageConfigFromEnv({
      VIVD_BUCKET_MODE: "external",
      VIVD_LOCAL_S3_BUCKET: "vivd",
      VIVD_LOCAL_S3_ENDPOINT_URL: "http://minio:9000",
      VIVD_LOCAL_S3_ACCESS_KEY: "local-access",
      VIVD_LOCAL_S3_SECRET_KEY: "local-secret",
      VIVD_S3_BUCKET: "remote-bucket",
      VIVD_S3_ENDPOINT_URL: "https://s3.example.com",
      VIVD_S3_ACCESS_KEY_ID: "remote-access",
      VIVD_S3_SECRET_ACCESS_KEY: "remote-secret",
      VIVD_S3_REGION: "eu-central-1",
    });

    expect(config).toEqual({
      bucket: "remote-bucket",
      endpointUrl: "https://s3.example.com",
      region: "eu-central-1",
      accessKeyId: "remote-access",
      secretAccessKey: "remote-secret",
      sessionToken: undefined,
    });
  });

  it("derives the bundled local download endpoint from the public origin", async () => {
    const url = await getObjectDownloadUrl({
      key: "assets/logo.png",
      env: {
        VIVD_BUCKET_MODE: "local",
        VIVD_LOCAL_S3_ACCESS_KEY: "local-access",
        VIVD_LOCAL_S3_SECRET_KEY: "local-secret",
        DOMAIN: "https://example.com",
      },
    });

    expect(url).toContain("https://example.com/_vivd_s3/vivd/assets/logo.png");
  });
});
