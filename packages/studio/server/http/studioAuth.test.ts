import {
  createStudioBootstrapToken,
  STUDIO_USER_ACTION_TOKEN_COOKIE,
  STUDIO_USER_ACTION_TOKEN_PARAM,
} from "@vivd/shared/studio";
import { describe, expect, it, vi } from "vitest";

import {
  createStudioBootstrapHandler,
  createRequireStudioAuth,
  isStudioRequestAuthorized,
  resolveStudioBootstrapRedirectTarget,
  STUDIO_AUTH_COOKIE,
  STUDIO_AUTH_HEADER,
  STUDIO_AUTH_QUERY,
} from "./studioAuth";

type MockRequestOptions = {
  baseUrl?: string;
  path?: string;
  method?: string;
  secure?: boolean;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
};

function createMockRequest(options: MockRequestOptions = {}) {
  const headers = Object.fromEntries(
    Object.entries(options.headers ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );

  return {
    baseUrl: options.baseUrl ?? "",
    path: options.path ?? "/",
    method: options.method ?? "GET",
    query: options.query ?? {},
    secure: options.secure ?? false,
    body: {},
    headers,
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  } as any;
}

function createMockResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    cookies: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: unknown) {
      this.headers = this.headers || {};
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    redirect(status: number, location: string) {
      this.statusCode = status;
      this.redirectedTo = location;
      return this;
    },
    cookie(name: string, value: string, options: Record<string, unknown>) {
      this.cookies.push({ name, value, options });
      return this;
    },
  } as any;
}

describe("createRequireStudioAuth", () => {
  it("rejects unauthenticated shell requests", () => {
    const middleware = createRequireStudioAuth({ STUDIO_ACCESS_TOKEN: "studio-token" } as any);
    const req = createMockRequest({ path: "/vivd-studio" });
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe("Unauthorized");
  });

  it("returns json errors for unauthorized api routes", () => {
    const middleware = createRequireStudioAuth({ STUDIO_ACCESS_TOKEN: "studio-token" } as any);
    const req = createMockRequest({
      baseUrl: "/vivd-studio/api/preview/site/v1",
      path: "/",
    });
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  it("accepts a query token and persists a scoped auth cookie", () => {
    const middleware = createRequireStudioAuth({ STUDIO_ACCESS_TOKEN: "studio-token" } as any);
    const req = createMockRequest({
      path: "/vivd-studio",
      secure: true,
      query: { [STUDIO_AUTH_QUERY]: "studio-token" },
      headers: {
        "x-forwarded-prefix": "/_studio/runtime-123",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.cookies).toEqual([
      {
        name: STUDIO_AUTH_COOKIE,
        value: "studio-token",
        options: {
          httpOnly: true,
          partitioned: true,
          sameSite: "none",
          secure: true,
          path: "/_studio/runtime-123",
        },
      },
    ]);
  });

  it("keeps lax cookies for non-https studio auth", () => {
    const middleware = createRequireStudioAuth({ STUDIO_ACCESS_TOKEN: "studio-token" } as any);
    const req = createMockRequest({
      path: "/vivd-studio",
      query: { [STUDIO_AUTH_QUERY]: "studio-token" },
    });
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.cookies).toEqual([
      {
        name: STUDIO_AUTH_COOKIE,
        value: "studio-token",
        options: {
          httpOnly: true,
          sameSite: "lax",
          partitioned: false,
          secure: false,
          path: "/",
        },
      },
    ]);
  });

  it("accepts an existing cookie token without reissuing it", () => {
    const middleware = createRequireStudioAuth({ STUDIO_ACCESS_TOKEN: "studio-token" } as any);
    const req = createMockRequest({
      path: "/vivd-studio",
      headers: {
        cookie: `${STUDIO_AUTH_COOKIE}=studio-token`,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.cookies).toEqual([]);
  });

  it("accepts explicit auth headers", () => {
    const middleware = createRequireStudioAuth({ STUDIO_ACCESS_TOKEN: "studio-token" } as any);
    const req = createMockRequest({
      path: "/vivd-studio",
      headers: {
        [STUDIO_AUTH_HEADER]: "studio-token",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.cookies[0]?.name).toBe(STUDIO_AUTH_COOKIE);
  });
});

describe("isStudioRequestAuthorized", () => {
  it("accepts cookie auth for raw upgrade requests", () => {
    const result = isStudioRequestAuthorized(
      {
        method: "GET",
        url: "/?token=vite-hmr",
        headers: {
          cookie: `${STUDIO_AUTH_COOKIE}=studio-token`,
        },
      },
      { STUDIO_ACCESS_TOKEN: "studio-token" } as NodeJS.ProcessEnv,
    );

    expect(result.authorized).toBe(true);
    expect(result.provided).toEqual({
      source: "cookie",
      value: "studio-token",
    });
  });

  it("reads query auth from raw request urls when Express query parsing is unavailable", () => {
    const result = isStudioRequestAuthorized(
      {
        method: "GET",
        url: `/ws?${STUDIO_AUTH_QUERY}=studio-token`,
        headers: {},
      },
      { STUDIO_ACCESS_TOKEN: "studio-token" } as NodeJS.ProcessEnv,
    );

    expect(result.authorized).toBe(true);
    expect(result.provided).toEqual({
      source: "query",
      value: "studio-token",
    });
  });
});

describe("resolveStudioBootstrapRedirectTarget", () => {
  it("accepts same-origin clean studio targets", () => {
    const req = createMockRequest({
      secure: true,
      headers: {
        host: "studio.example.com",
      },
    });

    expect(
      resolveStudioBootstrapRedirectTarget(
        req,
        "https://studio.example.com/vivd-studio?embedded=1",
      ),
    ).toBe("/vivd-studio?embedded=1");
  });

  it("keeps forwarded runtime prefixes and strips bootstrap token params", () => {
    const req = createMockRequest({
      secure: true,
      headers: {
        host: "app.example.com",
        "x-forwarded-prefix": "/_studio/runtime-123",
      },
    });

    expect(
      resolveStudioBootstrapRedirectTarget(
        req,
        "https://app.example.com/_studio/runtime-123/vivd-studio?embedded=1&vivdStudioToken=secret#vivdStudioToken=secret",
      ),
    ).toBe("/_studio/runtime-123/vivd-studio?embedded=1");
  });

  it("accepts forwarded external ports for fly studio targets", () => {
    const req = createMockRequest({
      secure: true,
      headers: {
        host: "vivd-studio-prod.fly.dev:3111",
        "x-forwarded-host": "vivd-studio-prod.fly.dev",
        "x-forwarded-port": "3111",
      },
    });

    expect(
      resolveStudioBootstrapRedirectTarget(
        req,
        "https://vivd-studio-prod.fly.dev:3111/vivd-studio?embedded=1",
      ),
    ).toBe("/vivd-studio?embedded=1");
  });

  it("ignores upstream host ports when forwarded host points at the tenant origin", () => {
    const req = createMockRequest({
      secure: true,
      headers: {
        host: "vivd-studio-prod.fly.dev:3111",
        "x-forwarded-host": "felix-pahlke.vivd.studio",
        "x-forwarded-prefix": "/_studio/runtime-123",
      },
    });

    expect(
      resolveStudioBootstrapRedirectTarget(
        req,
        "https://felix-pahlke.vivd.studio/_studio/runtime-123/vivd-studio?embedded=1",
      ),
    ).toBe("/_studio/runtime-123/vivd-studio?embedded=1");
  });

  it("rejects cross-origin redirect targets", () => {
    const req = createMockRequest({
      secure: true,
      headers: {
        host: "studio.example.com",
      },
    });

    expect(
      resolveStudioBootstrapRedirectTarget(
        req,
        "https://evil.example.com/vivd-studio",
      ),
    ).toBeNull();
  });

  it("rejects removed legacy preview redirect targets", () => {
    const req = createMockRequest({
      secure: true,
      headers: {
        host: "studio.example.com",
      },
    });

    expect(
      resolveStudioBootstrapRedirectTarget(
        req,
        "https://studio.example.com/preview/",
      ),
    ).toBeNull();
  });
});

describe("createStudioBootstrapHandler", () => {
  it("sets the auth cookie and redirects to the clean target for valid bootstrap posts", () => {
    const bootstrapToken = createStudioBootstrapToken({
      accessToken: "studio-token",
      studioId: "studio-1",
    });
    const handler = createStudioBootstrapHandler({
      STUDIO_ACCESS_TOKEN: "studio-token",
      STUDIO_ID: "studio-1",
    } as any);
    const req = createMockRequest({
      path: "/vivd-studio/api/bootstrap",
      secure: true,
      headers: {
        host: "studio.example.com",
      },
    });
    req.body = {
      bootstrapToken,
      next: "https://studio.example.com/vivd-studio?embedded=1",
      [STUDIO_USER_ACTION_TOKEN_PARAM]: "user-action-token-1",
    };
    const res = createMockResponse();

    handler(req, res, vi.fn());

    expect(res.statusCode).toBe(303);
    expect(res.redirectedTo).toBe("/vivd-studio?embedded=1");
    expect(res.cookies).toEqual([
      {
        name: STUDIO_AUTH_COOKIE,
        value: "studio-token",
        options: {
          httpOnly: true,
          partitioned: true,
          sameSite: "none",
          secure: true,
          path: "/",
        },
      },
      {
        name: STUDIO_USER_ACTION_TOKEN_COOKIE,
        value: "user-action-token-1",
        options: {
          httpOnly: true,
          partitioned: true,
          sameSite: "none",
          secure: true,
          path: "/",
        },
      },
    ]);
  });

  it("accepts tenant-hosted bootstrap posts routed through a Fly compatibility path", () => {
    const bootstrapToken = createStudioBootstrapToken({
      accessToken: "studio-token",
      studioId: "studio-1",
    });
    const handler = createStudioBootstrapHandler({
      STUDIO_ACCESS_TOKEN: "studio-token",
      STUDIO_ID: "studio-1",
    } as any);
    const req = createMockRequest({
      path: "/vivd-studio/api/bootstrap",
      secure: true,
      headers: {
        host: "vivd-studio-prod.fly.dev:3111",
        "x-forwarded-host": "felix-pahlke.vivd.studio",
        "x-forwarded-prefix": "/_studio/runtime-123",
      },
    });
    req.body = {
      bootstrapToken,
      next: "https://felix-pahlke.vivd.studio/_studio/runtime-123/vivd-studio?embedded=1",
    };
    const res = createMockResponse();

    handler(req, res, vi.fn());

    expect(res.statusCode).toBe(303);
    expect(res.redirectedTo).toBe("/_studio/runtime-123/vivd-studio?embedded=1");
  });

  it("rejects invalid bootstrap tokens", () => {
    const handler = createStudioBootstrapHandler({
      STUDIO_ACCESS_TOKEN: "studio-token",
      STUDIO_ID: "studio-1",
    } as any);
    const req = createMockRequest({
      path: "/vivd-studio/api/bootstrap",
      headers: {
        host: "studio.example.com",
      },
    });
    req.body = {
      bootstrapToken: "wrong",
      next: "http://studio.example.com/vivd-studio",
    };
    const res = createMockResponse();

    handler(req, res, vi.fn());

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Invalid bootstrap token" });
  });
});
