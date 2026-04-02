import express from "express";
import fs from "fs-extra";

type StudioClientHttpRoutesDeps = {
  app: express.Express;
  requireStudioAuth: () => express.RequestHandler;
  clientPath: string;
  clientIndexPath: string;
  resolveInitialGenerationSessionId?: (
    req: express.Request,
  ) => Promise<string | null>;
  getProxyBasePath: (req: express.Request) => string | null;
  rewriteRootAssetUrlsInText: (text: string, basePath: string) => string;
  injectBasePathScript: (html: string, basePath: string) => string;
  onStudioActivity?: () => void;
};

const INITIAL_SESSION_REDIRECT_WAIT_MS = 2_000;

function readRequestUrl(req: express.Request): URL {
  const host = req.get("host") || "localhost";
  return new URL(req.originalUrl || req.url, `http://${host}`);
}

function readSearchParam(req: express.Request, key: string): string | null {
  const value = readRequestUrl(req).searchParams.get(key);
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isTruthySearchParam(req: express.Request, key: string): boolean {
  const value = readSearchParam(req, key);
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true";
}

function buildRequestUrlWithSessionId(
  req: express.Request,
  sessionId: string,
): string {
  const url = readRequestUrl(req);
  url.searchParams.set("sessionId", sessionId);
  return `${url.pathname}${url.search}`;
}

async function sendStudioClientIndex(options: {
  req: express.Request;
  res: express.Response;
  clientIndexPath: string;
  resolveInitialGenerationSessionId?: (
    req: express.Request,
  ) => Promise<string | null>;
  getProxyBasePath: (req: express.Request) => string | null;
  rewriteRootAssetUrlsInText: (text: string, basePath: string) => string;
  injectBasePathScript: (html: string, basePath: string) => string;
}): Promise<void> {
  if (
    options.resolveInitialGenerationSessionId &&
    isTruthySearchParam(options.req, "initialGeneration") &&
    !readSearchParam(options.req, "sessionId")
  ) {
    const resolvePromise = options
      .resolveInitialGenerationSessionId(options.req)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[InitialGeneration] Failed to resolve initial session during Studio shell request: ${message}`,
        );
        return null;
      });

    const sessionId =
      (await Promise.race([
        resolvePromise,
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), INITIAL_SESSION_REDIRECT_WAIT_MS),
        ),
      ])) || null;

    if (sessionId) {
      options.res.redirect(buildRequestUrlWithSessionId(options.req, sessionId));
      return;
    }

    void resolvePromise;
  }

  let html = await fs.readFile(options.clientIndexPath, "utf8");
  const proxyBasePath = options.getProxyBasePath(options.req);
  if (proxyBasePath) {
    html = options.rewriteRootAssetUrlsInText(html, proxyBasePath);
    html = options.injectBasePathScript(html, proxyBasePath);
  }
  options.res.type("html").send(html);
}

export function registerStudioClientHttpRoutes(
  deps: StudioClientHttpRoutesDeps,
) {
  const {
    app,
    requireStudioAuth,
    clientPath,
    clientIndexPath,
    resolveInitialGenerationSessionId,
    getProxyBasePath,
    rewriteRootAssetUrlsInText,
    injectBasePathScript,
    onStudioActivity,
  } = deps;

  const sendIndex = (req: express.Request, res: express.Response) =>
    sendStudioClientIndex({
      req,
      res,
      clientIndexPath,
      resolveInitialGenerationSessionId,
      getProxyBasePath,
      rewriteRootAssetUrlsInText,
      injectBasePathScript,
    });

  const markStudioActivity: express.RequestHandler = (_req, _res, next) => {
    onStudioActivity?.();
    next();
  };

  app.get("/vivd-studio", requireStudioAuth(), markStudioActivity, async (req, res) => {
    await sendIndex(req, res);
  });

  app.get("/vivd-studio/", requireStudioAuth(), markStudioActivity, async (req, res) => {
    await sendIndex(req, res);
  });

  app.use(
    "/vivd-studio",
    requireStudioAuth(),
    markStudioActivity,
    express.static(clientPath, {
      index: false,
      redirect: false,
    }),
  );

  app.get(/.*/, (req, res, next) => {
    if (
      req.path === "/" ||
      req.path.startsWith("/trpc") ||
      req.path.startsWith("/preview") ||
      req.path.startsWith("/vivd-studio/api/")
    ) {
      return next();
    }

    onStudioActivity?.();
    return requireStudioAuth()(req, res, (authError?: unknown) => {
      if (authError) return next(authError);
      void sendIndex(req, res).catch(next);
    });
  });
}
