import express from "express";
import fs from "fs-extra";

type StudioClientHttpRoutesDeps = {
  app: express.Express;
  requireStudioAuth: () => express.RequestHandler;
  clientPath: string;
  clientIndexPath: string;
  getProxyBasePath: (req: express.Request) => string | null;
  rewriteRootAssetUrlsInText: (text: string, basePath: string) => string;
  injectBasePathScript: (html: string, basePath: string) => string;
};

async function sendStudioClientIndex(options: {
  req: express.Request;
  res: express.Response;
  clientIndexPath: string;
  getProxyBasePath: (req: express.Request) => string | null;
  rewriteRootAssetUrlsInText: (text: string, basePath: string) => string;
  injectBasePathScript: (html: string, basePath: string) => string;
}): Promise<void> {
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
    getProxyBasePath,
    rewriteRootAssetUrlsInText,
    injectBasePathScript,
  } = deps;

  const sendIndex = (req: express.Request, res: express.Response) =>
    sendStudioClientIndex({
      req,
      res,
      clientIndexPath,
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
