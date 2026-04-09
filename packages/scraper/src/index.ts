import express from "express";
import { fullScrapeRouter } from "./httpRoutes/fullScrape.js";
import { previewLogsRouter } from "./httpRoutes/previewLogs.js";
import { screenshotRouter } from "./httpRoutes/screenshot.js";
import { scrapePageRouter } from "./httpRoutes/scrapePage.js";
import { findLinksRouter } from "./httpRoutes/findLinks.js";
import { thumbnailRouter } from "./httpRoutes/thumbnail.js";
import { authMiddleware } from "./middleware/auth.js";
import {
  concurrencyLimiter,
  getConcurrencyStats,
} from "./middleware/concurrency.js";

const app = express();
const PORT = process.env.PORT || 3001;
const MAX_CONCURRENT_SCRAPES = parseInt(
  process.env.MAX_CONCURRENT_SCRAPES || "2",
  10
);

app.use(express.json({ limit: "100mb" }));

// Health check - no auth required, includes concurrency stats
app.get("/health", (_req, res) => {
  const stats = getConcurrencyStats();
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    concurrency: stats,
  });
});

// Protected routes with concurrency limiting for heavy operations
// Full scrape and screenshot are the most resource-intensive
app.use("/full-scrape", authMiddleware, concurrencyLimiter, fullScrapeRouter);
app.use("/preview-logs", authMiddleware, concurrencyLimiter, previewLogsRouter);
app.use("/screenshot", authMiddleware, concurrencyLimiter, screenshotRouter);
app.use("/scrape-page", authMiddleware, concurrencyLimiter, scrapePageRouter);
// find-links is lighter weight but still uses a browser
app.use("/find-links", authMiddleware, concurrencyLimiter, findLinksRouter);
// thumbnail endpoint for project card previews
app.use("/thumbnail", authMiddleware, concurrencyLimiter, thumbnailRouter);

app.listen(PORT, () => {
  console.log(`Scraper service listening on port ${PORT}`);
  console.log(`Max concurrent scrapes: ${MAX_CONCURRENT_SCRAPES}`);
  console.log(
    `API Key protection: ${
      process.env.SCRAPER_API_KEY ? "enabled" : "DISABLED (no key set)"
    }`
  );
});
