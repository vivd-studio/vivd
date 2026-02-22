import { lt } from "drizzle-orm";
import { db } from "../../../db";
import { contactFormSubmission } from "../../../db/schema";

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

function parseNonNegativeInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function getContactSubmissionRetentionDays(): number {
  return parseNonNegativeInteger(
    process.env.VIVD_CONTACT_FORM_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS,
  );
}

export function getContactSubmissionRetentionCleanupIntervalMs(): number {
  const intervalMs = parseNonNegativeInteger(
    process.env.VIVD_CONTACT_FORM_RETENTION_CLEANUP_INTERVAL_MS,
    DEFAULT_CLEANUP_INTERVAL_MS,
  );
  return intervalMs > 0 ? intervalMs : DEFAULT_CLEANUP_INTERVAL_MS;
}

function getRetentionCutoff(now: Date, retentionDays: number): Date {
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - retentionMs);
}

export async function purgeExpiredContactSubmissions(
  now: Date = new Date(),
): Promise<number> {
  const retentionDays = getContactSubmissionRetentionDays();
  if (retentionDays === 0) return 0;

  const cutoff = getRetentionCutoff(now, retentionDays);
  const deletedRows = await db
    .delete(contactFormSubmission)
    .where(lt(contactFormSubmission.createdAt, cutoff))
    .returning({ id: contactFormSubmission.id });

  return deletedRows.length;
}

export function startContactSubmissionRetentionJob(): () => void {
  const cleanupIntervalMs = getContactSubmissionRetentionCleanupIntervalMs();

  const runCleanup = async () => {
    try {
      const deletedCount = await purgeExpiredContactSubmissions();
      if (deletedCount > 0) {
        console.log(
          `[ContactSubmissionRetention] Purged ${deletedCount} expired submissions`,
        );
      }
    } catch (error) {
      console.error(
        "[ContactSubmissionRetention] Failed to purge expired submissions:",
        error,
      );
    }
  };

  void runCleanup();

  const timer = setInterval(() => {
    void runCleanup();
  }, cleanupIntervalMs);

  return () => {
    clearInterval(timer);
  };
}
