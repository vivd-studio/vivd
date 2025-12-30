import express from "express";
import { fullScrapeRouter } from "./routes/fullScrape.js";
import { screenshotRouter } from "./routes/screenshot.js";
import { scrapePageRouter } from "./routes/scrapePage.js";
import { authMiddleware } from "./middleware/auth.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: "100mb" }));

// Health check - no auth required
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Protected routes
app.use("/full-scrape", authMiddleware, fullScrapeRouter);
app.use("/screenshot", authMiddleware, screenshotRouter);
app.use("/scrape-page", authMiddleware, scrapePageRouter);

app.listen(PORT, () => {
  console.log(`Scraper service listening on port ${PORT}`);
  console.log(
    `API Key protection: ${
      process.env.SCRAPER_API_KEY ? "enabled" : "DISABLED (no key set)"
    }`
  );
});
