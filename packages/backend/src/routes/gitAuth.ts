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
    const respondUnauthorized = (error: string) => {
      // Git clients typically only send credentials after a Basic challenge.
      // Without this header, `git clone https://user:pass@host/...` can fail with
      // "Authentication failed" because no Authorization header is sent.
      res.setHeader("WWW-Authenticate", 'Basic realm="Vivd Git"');
      res.status(401).json({ error });
    };

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Basic ")) {
      respondUnauthorized("Unauthorized: Missing or invalid auth");
      return;
    }

    // Decode base64
    const base64Credentials = authHeader.slice(6); // Remove "Basic "
    const credentials = Buffer.from(base64Credentials, "base64").toString(
      "utf8"
    );
    const colonIndex = credentials.indexOf(":");
    const token = colonIndex >= 0 ? credentials.slice(colonIndex + 1) : "";

    if (!token) {
      respondUnauthorized("Unauthorized: Invalid credentials");
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
      respondUnauthorized("Unauthorized: Invalid token");
      return;
    }

    const role = sessionRecord.user.role ?? "user";

    // Check session expiration
    if (sessionRecord.expiresAt && new Date(sessionRecord.expiresAt) < new Date()) {
      respondUnauthorized("Unauthorized: Token expired");
      return;
    }

    // Extract project slug from URL
    const rawSlug = req.params.slug;
    const slug =
      typeof rawSlug === "string"
        ? rawSlug
        : Array.isArray(rawSlug) && typeof rawSlug[0] === "string"
          ? rawSlug[0]
          : null;

    if (!slug) {
      res.status(400).json({ error: "Bad request: Missing project slug" });
      return;
    }

    // Check project access.
    // Client editors are restricted to their assigned project; admins/users can access all.
    if (role === "client_editor") {
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
