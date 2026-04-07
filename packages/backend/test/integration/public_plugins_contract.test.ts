/**
 * DB-backed integration tests for the real public plugin HTTP contract.
 *
 * Run with:
 *   npm run test:integration -w @vivd/backend -- test/integration/public_plugins_contract.test.ts
 *
 * Requires:
 *   VIVD_RUN_DB_INTEGRATION_TESTS=1
 *   DATABASE_URL
 */
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import multer from "multer";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../../src/db";
import {
  analyticsEvent,
  contactFormSubmission,
  organization,
  projectMeta,
  projectPluginInstance,
} from "../../src/db/schema";
import { createPublicPluginsRouter } from "../../src/httpRoutes/plugins";
import { projectPluginService } from "../../src/services/plugins/ProjectPluginService";

const RUN_DB_INTEGRATION_TESTS =
  process.env.VIVD_RUN_DB_INTEGRATION_TESTS === "1";
const DATABASE_URL = (process.env.DATABASE_URL || "").trim();
const SHOULD_RUN = RUN_DB_INTEGRATION_TESTS && DATABASE_URL.length > 0;

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

function pushEnv(
  overrides: Record<string, string | undefined>,
): () => void {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (typeof value === "undefined") {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const [key, value] of previous.entries()) {
      if (typeof value === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function createOrgFixture() {
  const suffix = uniqueSuffix();
  const orgId = `it-org-${suffix}`;
  const orgSlug = `it-org-${suffix}`;
  const projectSlug = `plugin-contract-${suffix}`;
  const analyticsInstanceId = `analytics-${suffix}`;
  const contactInstanceId = `contact-${suffix}`;
  const analyticsToken = `analytics-token-${suffix}`;
  const contactToken = `contact-token-${suffix}`;

  await db.insert(organization).values({
    id: orgId,
    slug: orgSlug,
    name: `Integration ${suffix}`,
    status: "active",
  });

  await db.insert(projectMeta).values({
    organizationId: orgId,
    slug: projectSlug,
    source: "scratch",
    title: "Public Plugin Contract Project",
    description: "",
    currentVersion: 1,
    publicPreviewEnabled: true,
  });

  await db.insert(projectPluginInstance).values([
    {
      id: analyticsInstanceId,
      organizationId: orgId,
      projectSlug,
      pluginId: "analytics",
      status: "enabled",
      publicToken: analyticsToken,
      configJson: {},
    },
    {
      id: contactInstanceId,
      organizationId: orgId,
      projectSlug,
      pluginId: "contact_form",
      status: "enabled",
      publicToken: contactToken,
      configJson: {
        recipientEmails: ["owner@example.com"],
      },
    },
  ]);

  return {
    orgId,
    projectSlug,
    analyticsInstanceId,
    analyticsToken,
    contactInstanceId,
    contactToken,
  };
}

async function cleanupOrgFixture(orgId: string): Promise<void> {
  await db.delete(organization).where(eq(organization.id, orgId));
}

async function startPublicPluginServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
  });

  app.use(createPublicPluginsRouter({ upload }));

  const server = await new Promise<Server>((resolve) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => {
      resolve(listeningServer);
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    throw new Error("Failed to resolve public plugin test server address");
  }

  return {
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

async function postForm(
  url: string,
  body: URLSearchParams,
  headers: Record<string, string>,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      ...headers,
    },
    body: body.toString(),
  });
}

describe.sequential("DB integration: public plugin HTTP contract", () => {
  it.skipIf(!SHOULD_RUN)(
    "serves analytics runtime and records analytics + contact-form outcomes through the real public router",
    { timeout: 90_000 },
    async () => {
      const fixture = await createOrgFixture();
      const server = await startPublicPluginServer();
      const publicHost = new URL(server.baseUrl).host;
      const sourceOrigin = `${server.baseUrl}`;
      const sourceReferer = `${server.baseUrl}/landing?utm_source=newsletter&utm_medium=email&utm_campaign=spring-launch`;
      const restoreEnv = pushEnv({
        VIVD_EMAIL_PROVIDER: "noop",
        VIVD_INSTALL_PROFILE: "solo",
        VIVD_PUBLIC_PLUGIN_API_BASE_URL: server.baseUrl,
      });

      try {
        const scriptResponse = await fetch(
          `${server.baseUrl}/plugins/analytics/v1/script.js?token=${fixture.analyticsToken}`,
        );
        const scriptText = await scriptResponse.text();

        expect(scriptResponse.status).toBe(200);
        expect(scriptResponse.headers.get("access-control-allow-origin")).toBe("*");
        expect(scriptResponse.headers.get("content-type")).toContain(
          "application/javascript",
        );
        expect(scriptText).toContain(fixture.analyticsToken);
        expect(scriptText).toContain(
          `${server.baseUrl}/plugins/analytics/v1/track`,
        );

        const pageviewResponse = await postForm(
          `${server.baseUrl}/plugins/analytics/v1/track`,
          new URLSearchParams({
            token: fixture.analyticsToken,
            eventType: "pageview",
            path: "/landing?utm_source=newsletter&utm_medium=email&utm_campaign=spring-launch",
            sourceHost: publicHost,
            referrerHost: "google.com",
            visitorId: `visitor-${uniqueSuffix()}`,
            sessionId: `session-${uniqueSuffix()}`,
            deviceType: "desktop",
          }),
          {
            Origin: sourceOrigin,
            Referer: sourceReferer,
            "User-Agent": "Vivd Plugin Contract Test",
          },
        );
        expect(pageviewResponse.status).toBe(200);
        expect(await pageviewResponse.json()).toEqual({ ok: true });
        expect(pageviewResponse.headers.get("access-control-allow-origin")).toBe(
          "*",
        );

        const formViewResponse = await postForm(
          `${server.baseUrl}/plugins/analytics/v1/track`,
          new URLSearchParams({
            token: fixture.analyticsToken,
            eventType: "custom",
            eventName: "contact_form_view",
            path: "/landing",
            sourceHost: publicHost,
            referrerHost: "google.com",
            visitorId: "visitor-shared",
            sessionId: "session-shared",
            deviceType: "desktop",
          }),
          {
            Origin: sourceOrigin,
            Referer: sourceReferer,
            "User-Agent": "Vivd Plugin Contract Test",
          },
        );
        expect(formViewResponse.status).toBe(200);
        expect(await formViewResponse.json()).toEqual({ ok: true });

        const formStartResponse = await postForm(
          `${server.baseUrl}/plugins/analytics/v1/track`,
          new URLSearchParams({
            token: fixture.analyticsToken,
            eventType: "custom",
            eventName: "contact_form_start",
            path: "/landing",
            sourceHost: publicHost,
            referrerHost: "google.com",
            visitorId: "visitor-shared",
            sessionId: "session-shared",
            deviceType: "desktop",
          }),
          {
            Origin: sourceOrigin,
            Referer: sourceReferer,
            "User-Agent": "Vivd Plugin Contract Test",
          },
        );
        expect(formStartResponse.status).toBe(200);
        expect(await formStartResponse.json()).toEqual({ ok: true });

        const submitResponse = await postForm(
          `${server.baseUrl}/plugins/contact/v1/submit`,
          new URLSearchParams({
            token: fixture.contactToken,
            name: "Ada Lovelace",
            email: "ada@example.com",
            message: "Please tell me more about Vivd.",
            utm_source: "newsletter",
            utm_medium: "email",
            utm_campaign: "spring-launch",
          }),
          {
            Origin: sourceOrigin,
            Referer: sourceReferer,
            "User-Agent": "Vivd Plugin Contract Test",
          },
        );
        expect(submitResponse.status).toBe(200);
        expect(await submitResponse.json()).toEqual({ ok: true });
        expect(submitResponse.headers.get("access-control-allow-origin")).toBe("*");

        const analyticsRows = await db
          .select()
          .from(analyticsEvent)
          .where(eq(analyticsEvent.pluginInstanceId, fixture.analyticsInstanceId));
        expect(analyticsRows).toHaveLength(3);

        const pageviewRow = analyticsRows.find((row) => row.eventType === "pageview");
        expect(pageviewRow?.path).toBe("/landing");
        expect(pageviewRow?.sourceHost).toBe(publicHost);
        expect(pageviewRow?.referrerHost).toBe("google.com");
        expect(pageviewRow?.payload).toMatchObject({
          userAgent: "Vivd Plugin Contract Test",
          utmSource: "newsletter",
          utmMedium: "email",
          utmCampaign: "spring-launch",
        });

        const startRow = analyticsRows.find(
          (row) =>
            row.eventType === "custom" &&
            (row.payload as Record<string, unknown>)?.eventName ===
              "contact_form_start",
        );
        expect(startRow?.path).toBe("/landing");
        expect(startRow?.sourceHost).toBe(publicHost);

        const contactRows = await db
          .select()
          .from(contactFormSubmission)
          .where(eq(contactFormSubmission.pluginInstanceId, fixture.contactInstanceId));
        expect(contactRows).toHaveLength(1);
        expect(contactRows[0]?.sourceHost).toBe(publicHost);
        expect(contactRows[0]?.payload).toMatchObject({
          name: "Ada Lovelace",
          email: "ada@example.com",
          message: "Please tell me more about Vivd.",
          utm_source: "newsletter",
          utm_medium: "email",
          utm_campaign: "spring-launch",
        });

        const summary = await projectPluginService.getAnalyticsSummary({
          organizationId: fixture.orgId,
          projectSlug: fixture.projectSlug,
          rangeDays: 7,
        });
        expect(summary.enabled).toBe(true);
        expect(summary.totals).toMatchObject({
          events: 3,
          pageviews: 1,
          uniqueVisitors: 2,
          uniqueSessions: 2,
        });
        expect(summary.topPages).toContainEqual({
          path: "/landing",
          pageviews: 1,
          uniqueVisitors: 1,
        });
        expect(summary.topReferrers).toContainEqual({
          referrerHost: "google.com",
          events: 3,
        });
        expect(summary.contactForm).toMatchObject({
          enabled: true,
          submissions: 1,
          uniqueSourceHosts: 1,
          conversionRatePct: 100,
        });
        expect(summary.contactForm.topSourceHosts).toContainEqual({
          sourceHost: publicHost,
          submissions: 1,
        });
        expect(summary.funnel).toMatchObject({
          pageviews: 1,
          formViews: 1,
          formStarts: 1,
          submissions: 1,
        });
        expect(summary.attribution.sources).toContainEqual({
          utmSource: "newsletter",
          pageviews: 1,
          submissions: 1,
          submissionRatePct: 100,
        });
        expect(summary.attribution.campaigns).toContainEqual({
          utmSource: "newsletter",
          utmMedium: "email",
          utmCampaign: "spring-launch",
          pageviews: 1,
          submissions: 1,
          submissionRatePct: 100,
        });
      } finally {
        restoreEnv();
        await server.close();
        await cleanupOrgFixture(fixture.orgId);
      }
    },
  );

  it.skipIf(SHOULD_RUN)(
    "documents skip reason when DB integration env is missing",
    () => {
      const reasons: string[] = [];
      if (!RUN_DB_INTEGRATION_TESTS) {
        reasons.push("VIVD_RUN_DB_INTEGRATION_TESTS!=1");
      }
      if (!DATABASE_URL) {
        reasons.push("missing DATABASE_URL");
      }
      expect(reasons.length).toBeGreaterThan(0);
    },
  );
});
