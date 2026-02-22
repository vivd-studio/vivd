/**
 * DB-backed integration tests for usage/plugin service idempotency paths.
 *
 * Run with:
 *   npm run test:integration -w @vivd/backend -- test/integration/db_usage_plugin_services.test.ts
 *
 * Requires:
 *   VIVD_RUN_DB_INTEGRATION_TESTS=1
 *   DATABASE_URL
 */
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../../src/db";
import {
  organization,
  projectMeta,
  projectPluginInstance,
  usagePeriod,
  usageRecord,
} from "../../src/db/schema";
import { projectPluginService } from "../../src/services/plugins/ProjectPluginService";
import { usageService } from "../../src/services/usage/UsageService";

const RUN_DB_INTEGRATION_TESTS =
  process.env.VIVD_RUN_DB_INTEGRATION_TESTS === "1";
const DATABASE_URL = (process.env.DATABASE_URL || "").trim();
const SHOULD_RUN = RUN_DB_INTEGRATION_TESTS && DATABASE_URL.length > 0;

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

async function createOrgFixture() {
  const suffix = uniqueSuffix();
  const orgId = `it-org-${suffix}`;
  const orgSlug = `it-org-${suffix}`;
  await db.insert(organization).values({
    id: orgId,
    slug: orgSlug,
    name: `Integration ${suffix}`,
    status: "active",
  });
  return { orgId, orgSlug };
}

async function cleanupOrgFixture(orgId: string): Promise<void> {
  await db.delete(organization).where(eq(organization.id, orgId));
}

describe.sequential("DB integration: usage/plugin services", () => {
  it.skipIf(!SHOULD_RUN)(
    "keeps plugin ensure idempotent and unique under parallel calls",
    { timeout: 90_000 },
    async () => {
      const { orgId } = await createOrgFixture();
      const projectSlug = `project-${uniqueSuffix()}`;

      try {
        await db.insert(projectMeta).values({
          organizationId: orgId,
          slug: projectSlug,
          source: "scratch",
          title: "Plugin Integration Project",
          description: "",
          currentVersion: 1,
          publicPreviewEnabled: true,
        });

        const results = await Promise.all(
          Array.from({ length: 12 }, () =>
            projectPluginService.ensureContactFormPlugin({
              organizationId: orgId,
              projectSlug,
            }),
          ),
        );

        const rows = await db
          .select()
          .from(projectPluginInstance)
          .where(
            and(
              eq(projectPluginInstance.organizationId, orgId),
              eq(projectPluginInstance.projectSlug, projectSlug),
              eq(projectPluginInstance.pluginId, "contact_form"),
            ),
          );

        expect(rows).toHaveLength(1);
        expect(results.every((result) => result.instanceId === rows[0]!.id)).toBe(
          true,
        );
        expect(results.some((result) => result.created)).toBe(true);
      } finally {
        await cleanupOrgFixture(orgId);
      }
    },
  );

  it.skipIf(!SHOULD_RUN)(
    "records AI cost idempotently and avoids double-counting period aggregates",
    { timeout: 90_000 },
    async () => {
      const { orgId } = await createOrgFixture();
      const sessionId = `session-${uniqueSuffix()}`;
      const partId = `part-${uniqueSuffix()}`;
      const idempotencyKey = `${sessionId}:${partId}`;

      try {
        await usageService.recordAiCost(
          orgId,
          0.75,
          undefined,
          sessionId,
          "Integration Session",
          "proj-a",
          partId,
        );
        await usageService.recordAiCost(
          orgId,
          0.75,
          undefined,
          sessionId,
          "Integration Session",
          "proj-a",
          partId,
        );

        const records = await db
          .select()
          .from(usageRecord)
          .where(
            and(
              eq(usageRecord.organizationId, orgId),
              eq(usageRecord.idempotencyKey, idempotencyKey),
            ),
          );
        expect(records).toHaveLength(1);

        const periods = await db
          .select()
          .from(usagePeriod)
          .where(eq(usagePeriod.organizationId, orgId));
        expect(periods).toHaveLength(3);

        const current = await usageService.getCurrentUsage(orgId);
        expect(current.daily.cost).toBeCloseTo(0.75, 6);
        expect(current.weekly.cost).toBeCloseTo(0.75, 6);
        expect(current.monthly.cost).toBeCloseTo(0.75, 6);
      } finally {
        await cleanupOrgFixture(orgId);
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
