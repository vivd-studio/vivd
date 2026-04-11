import {
  getContactSubmissionRetentionCleanupIntervalMs,
  getContactSubmissionRetentionDays,
  purgeExpiredContactSubmissions as purgePluginExpiredContactSubmissions,
  startContactSubmissionRetentionJob as startPluginContactSubmissionRetentionJob,
} from "@vivd/plugin-contact-form/backend/retention";
import { db } from "../../../db";
import { contactFormSubmission } from "../../../db/schema";

export {
  getContactSubmissionRetentionCleanupIntervalMs,
  getContactSubmissionRetentionDays,
} from "@vivd/plugin-contact-form/backend/retention";

const contactFormRetentionDeps = {
  db,
  tables: {
    contactFormSubmission,
  },
} as const;

export async function purgeExpiredContactSubmissions(
  now: Date = new Date(),
): Promise<number> {
  return purgePluginExpiredContactSubmissions(contactFormRetentionDeps, now);
}

export function startContactSubmissionRetentionJob(): () => void {
  return startPluginContactSubmissionRetentionJob(contactFormRetentionDeps);
}
