import express from "express";
import { db } from "../db";
import { session, projectMember } from "../db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Extended Express Request with git auth info
 */
export interface GitAuthRequest extends express.Request {
  gitAuth?: {
    sessionId: string;
    userId: string;
    projectSlug: string;
  };
}

/**
 * HTTP Basic Auth middleware for git operations
 * Extracts and validates session tokens from Authorization header
 * Format: Authorization: Basic base64(username:token)
 *
 * The username can be anything (typically git or any string)
 * The token is the actual session token
 */
export async function gitAuthMiddleware(
  req: GitAuthRequest,
  res: express.Response,
  next: express.NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Basic ")) {
      res.status(401).json({ error: "Unauthorized: Missing or invalid auth" });
      return;
    }

    // Decode base64
    const base64Credentials = authHeader.slice(6); // Remove "Basic "
    const credentials = Buffer.from(base64Credentials, "base64").toString(
      "utf8"
    );
    const [_username, token] = credentials.split(":");

    if (!token) {
      res.status(401).json({ error: "Unauthorized: Invalid credentials" });
      return;
    }

    // Query session by token
    const sessionRecord = await db.query.session.findFirst({
      where: eq(session.token, token),
      with: {
        user: true,
      },
    });

    if (!sessionRecord) {
      res.status(401).json({ error: "Unauthorized: Invalid token" });
      return;
    }

    // Check session expiration
    if (sessionRecord.expiresAt && new Date(sessionRecord.expiresAt) < new Date()) {
      res.status(401).json({ error: "Unauthorized: Token expired" });
      return;
    }

    // Extract project slug from URL
    const slug = req.params.slug;
    if (!slug) {
      res.status(400).json({ error: "Bad request: Missing project slug" });
      return;
    }

    // Check project access
    const member = await db.query.projectMember.findFirst({
      where: and(
        eq(projectMember.userId, sessionRecord.user.id),
        eq(projectMember.projectSlug, slug)
      ),
    });

    if (!member) {
      res.status(403).json({ error: "Forbidden: No access to project" });
      return;
    }

    // Attach auth info to request
    (req as GitAuthRequest).gitAuth = {
      sessionId: sessionRecord.id,
      userId: sessionRecord.user.id,
      projectSlug: slug,
    };

    next();
  } catch (error) {
    console.error("[GitAuth] Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
