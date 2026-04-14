import {
  ensureReferencedAstroCmsToolkit,
  projectReferencesCmsToolkit,
} from "@vivd/shared/cms";
import type { ProjectFramework } from "./projectType.js";

export { projectReferencesCmsToolkit };

export async function ensureAstroCmsToolkit(
  projectDir: string,
  framework: ProjectFramework,
): Promise<void> {
  if (framework !== "astro") {
    return;
  }

  const result = await ensureReferencedAstroCmsToolkit(projectDir);
  if (result && result.created.length > 0) {
    console.log(
      `[AstroCMS] Ensured local CMS toolkit for ${projectDir}: ${result.created.join(", ")}`,
    );
  }
}
