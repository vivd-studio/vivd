import http from "node:http";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";

export type RuntimeHttpResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
};

export async function requestRuntime(options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}): Promise<RuntimeHttpResponse> {
  const target = new URL(options.url);
  const client = target.protocol === "https:" ? https : http;

  return await new Promise((resolve, reject) => {
    const request = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: options.method || "GET",
        headers: {
          Connection: "close",
          ...options.headers,
        },
        agent: false,
      },
      (response) => {
        response.setEncoding("utf8");
        const chunks: string[] = [];
        response.on("data", (chunk: string) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: chunks.join(""),
          });
        });
      },
    );

    const timeoutMs = options.timeoutMs ?? 5_000;
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    request.on("error", (error) => reject(error));

    if (options.body) {
      request.write(options.body);
    }
    request.end();
  });
}
