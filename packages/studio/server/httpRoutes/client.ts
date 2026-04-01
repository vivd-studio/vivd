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
};

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
    const sessionId =
      (await options.resolveInitialGenerationSessionId(options.req)) || null;

    if (sessionId) {
      options.res.redirect(buildRequestUrlWithSessionId(options.req, sessionId));
      return;
    }
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

  app.get("/vivd-studio", requireStudioAuth(), async (req, res) => {
    await sendIndex(req, res);
  });

  app.get("/vivd-studio/", requireStudioAuth(), async (req, res) => {
    await sendIndex(req, res);
  });

  app.use(
    "/vivd-studio",
    requireStudioAuth(),
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

    return requireStudioAuth()(req, res, (authError?: unknown) => {
      if (authError) return next(authError);
      void sendIndex(req, res).catch(next);
    });
  });
}
