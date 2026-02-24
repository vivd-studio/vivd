import { and, eq, or } from "drizzle-orm";
import { db } from "../../db";
import { studioMachineVisit } from "../../db/schema";

export type StudioVisitIdentity = {
  organizationId: string;
  projectSlug: string;
  version: number;
};

export function studioVisitKey(identity: StudioVisitIdentity): string {
  return `${identity.organizationId}:${identity.projectSlug}:v${identity.version}`;
}

export async function recordStudioVisit(
  identity: StudioVisitIdentity,
  visitedAt: Date = new Date(),
): Promise<void> {
  await db
    .insert(studioMachineVisit)
    .values({
      organizationId: identity.organizationId,
      projectSlug: identity.projectSlug,
      version: identity.version,
      lastVisitedAt: visitedAt,
      createdAt: visitedAt,
      updatedAt: visitedAt,
    })
    .onConflictDoUpdate({
      target: [
        studioMachineVisit.organizationId,
        studioMachineVisit.projectSlug,
        studioMachineVisit.version,
      ],
      set: {
        lastVisitedAt: visitedAt,
        updatedAt: visitedAt,
      },
    });
}

export async function listStudioVisitMsByIdentity(
  identities: StudioVisitIdentity[],
): Promise<Map<string, number>> {
  const uniqueIdentityMap = new Map<string, StudioVisitIdentity>();
  for (const identity of identities) {
    uniqueIdentityMap.set(studioVisitKey(identity), identity);
  }
  const uniqueIdentities = Array.from(uniqueIdentityMap.values());
  if (uniqueIdentities.length === 0) return new Map();

  const conditions = uniqueIdentities.map((identity) =>
    and(
      eq(studioMachineVisit.organizationId, identity.organizationId),
      eq(studioMachineVisit.projectSlug, identity.projectSlug),
      eq(studioMachineVisit.version, identity.version),
    ),
  );
  const where = conditions.length === 1 ? conditions[0] : or(...conditions);
  if (!where) return new Map();

  const rows = await db
    .select({
      organizationId: studioMachineVisit.organizationId,
      projectSlug: studioMachineVisit.projectSlug,
      version: studioMachineVisit.version,
      lastVisitedAt: studioMachineVisit.lastVisitedAt,
    })
    .from(studioMachineVisit)
    .where(where);

  const result = new Map<string, number>();
  for (const row of rows) {
    const lastVisitedAt = row.lastVisitedAt?.getTime();
    if (typeof lastVisitedAt !== "number" || !Number.isFinite(lastVisitedAt)) continue;
    result.set(
      studioVisitKey({
        organizationId: row.organizationId,
        projectSlug: row.projectSlug,
        version: row.version,
      }),
      lastVisitedAt,
    );
  }

  return result;
}
