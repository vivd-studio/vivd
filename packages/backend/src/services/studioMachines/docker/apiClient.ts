import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import type {
  DockerApiError,
  DockerContainerCreateConfig,
  DockerContainerCreateResponse,
  DockerContainerInfo,
  DockerImageInfo,
  DockerNetworkSummary,
  DockerContainerSummary,
} from "./types";

type DockerRequestOptions = {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

export class DockerApiClient {
  private readonly options: {
    getSocketPath: () => string | null;
    getBaseUrl: () => string | null;
    getApiVersion: () => string;
  };

  constructor(options: {
    getSocketPath: () => string | null;
    getBaseUrl: () => string | null;
    getApiVersion: () => string;
  }) {
    this.options = options;
  }

  private async dockerRequest<T>(
    method: string,
    path: string,
    options: DockerRequestOptions = {},
  ): Promise<T> {
    const apiPath = `/${this.options.getApiVersion()}${path}`;
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value === undefined) continue;
      search.set(key, String(value));
    }

    const body =
      options.body === undefined ? null : JSON.stringify(options.body);

    const baseUrl = this.options.getBaseUrl();
    const socketPath = this.options.getSocketPath();
    if (!baseUrl && !socketPath) {
      throw new Error(
        "Missing Docker API connection. Set DOCKER_STUDIO_SOCKET_PATH or DOCKER_STUDIO_API_BASE_URL.",
      );
    }

    return await new Promise<T>((resolve, reject) => {
      const onResponse = (response: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          const ok =
            typeof response.statusCode === "number" &&
            response.statusCode >= 200 &&
            response.statusCode < 300;
          if (ok) {
            if (!text) {
              resolve(undefined as T);
              return;
            }

            try {
              resolve(JSON.parse(text) as T);
            } catch {
              resolve(text as T);
            }
            return;
          }

          let message = text.trim();
          try {
            const parsed = JSON.parse(text) as DockerApiError;
            if (typeof parsed.message === "string" && parsed.message.trim()) {
              message = parsed.message.trim();
            }
          } catch {
            // Keep raw text fallback.
          }

          reject(
            new Error(
              `[DockerMachines] ${message || `${response.statusCode} ${response.statusMessage}`}`,
            ),
          );
        });
      };

      const requestOptions: http.RequestOptions = {
        method,
        headers: body
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            }
          : undefined,
      };

      let request:
        | http.ClientRequest
        | ReturnType<typeof https.request>;

      if (baseUrl) {
        const url = new URL(apiPath, baseUrl);
        url.search = search.toString();
        const transport = url.protocol === "https:" ? https : http;
        request = transport.request(url, requestOptions, onResponse);
      } else {
        requestOptions.socketPath = socketPath || undefined;
        requestOptions.path = `${apiPath}${search.size > 0 ? `?${search.toString()}` : ""}`;
        request = http.request(requestOptions, onResponse);
      }

      request.on("error", reject);
      if (body) request.write(body);
      request.end();
    });
  }

  async listContainers(): Promise<DockerContainerSummary[]> {
    return await this.dockerRequest<DockerContainerSummary[]>(
      "GET",
      "/containers/json",
      {
        query: { all: 1 },
      },
    );
  }

  async inspectContainer(containerId: string): Promise<DockerContainerInfo> {
    return await this.dockerRequest<DockerContainerInfo>(
      "GET",
      `/containers/${containerId}/json`,
    );
  }

  async inspectImage(imageRefOrId: string): Promise<DockerImageInfo> {
    return await this.dockerRequest<DockerImageInfo>(
      "GET",
      `/images/${encodeURIComponent(imageRefOrId)}/json`,
    );
  }

  async listNetworks(): Promise<DockerNetworkSummary[]> {
    return await this.dockerRequest<DockerNetworkSummary[]>(
      "GET",
      "/networks",
    );
  }

  async createContainer(options: {
    name: string;
    config: DockerContainerCreateConfig;
    platform?: string;
  }): Promise<DockerContainerCreateResponse> {
    return await this.dockerRequest<DockerContainerCreateResponse>(
      "POST",
      "/containers/create",
      {
        query: { name: options.name, platform: options.platform },
        body: options.config,
      },
    );
  }

  async pullImage(
    imageRef: string,
    options?: { platform?: string },
  ): Promise<void> {
    const trimmed = imageRef.trim();
    if (!trimmed) {
      throw new Error("[DockerMachines] Cannot pull an empty image reference");
    }

    const digestIndex = trimmed.indexOf("@");
    if (digestIndex >= 0) {
      await this.dockerRequest<void>("POST", "/images/create", {
        query: { fromImage: trimmed, platform: options?.platform },
      });
      return;
    }

    const lastSlash = trimmed.lastIndexOf("/");
    const lastColon = trimmed.lastIndexOf(":");
    const hasExplicitTag = lastColon > lastSlash;
    const fromImage = hasExplicitTag ? trimmed.slice(0, lastColon) : trimmed;
    const tag = hasExplicitTag ? trimmed.slice(lastColon + 1) : undefined;

    await this.dockerRequest<void>("POST", "/images/create", {
      query: {
        fromImage,
        tag,
        platform: options?.platform,
      },
    });
  }

  async startContainer(containerId: string): Promise<void> {
    await this.dockerRequest<void>("POST", `/containers/${containerId}/start`);
  }

  async stopContainer(
    containerId: string,
    timeoutSeconds: number,
  ): Promise<void> {
    await this.dockerRequest<void>("POST", `/containers/${containerId}/stop`, {
      query: { t: timeoutSeconds },
    });
  }

  async removeContainer(containerId: string): Promise<void> {
    await this.dockerRequest<void>("DELETE", `/containers/${containerId}`, {
      query: { force: 0, v: 0 },
    });
  }
}
