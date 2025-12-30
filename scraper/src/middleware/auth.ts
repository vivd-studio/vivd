import type { Request, Response, NextFunction } from "express";

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = process.env.SCRAPER_API_KEY;

  // If no API key is configured, allow all requests (dev mode)
  if (!apiKey) {
    next();
    return;
  }

  const providedKey = req.headers["x-api-key"];

  if (providedKey !== apiKey) {
    res.status(401).json({ error: "Unauthorized: Invalid or missing API key" });
    return;
  }

  next();
}
