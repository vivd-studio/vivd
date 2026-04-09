import { Router } from "express";
import { browserPool, isBrowserError } from "../services/browser.js";
import { capturePreviewLogs } from "../services/previewLogs.js";
import { log } from "../utils/logger.js";

export const previewLogsRouter = Router();

previewLogsRouter.post("/", async (req, res) => {
  const { url, waitMs, headers, limit, level, contains } = req.body;

  if (typeof url !== "string" || url.trim().length === 0) {
    res.status(400).json({ error: "Missing or invalid 'url' input" });
    return;
  }

  const browser = await browserPool.acquire();

  try {
    const page = await browserPool.createPage(browser);
    const result = await capturePreviewLogs(page, {
      url: url.trim(),
      waitMs,
      headers,
      limit,
      level,
      contains,
    });

    await page.close();

    res.json(result);
    log(`Preview log capture completed: ${result.entries.length} entries returned`);
  } catch (error: any) {
    log(`Preview log capture error: ${error.message}`);
    const unhealthy = isBrowserError(error);
    if (unhealthy) {
      log("Browser error detected, will mark browser as unhealthy");
    }
    browserPool.release(browser, unhealthy);
    res
      .status(500)
      .json({ error: error.message || "Preview log capture failed" });
    return;
  }

  browserPool.release(browser);
});
