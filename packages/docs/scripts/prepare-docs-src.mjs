import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const sourceSrcDir = path.resolve(packageRoot, "src");
const generatedRootDir = path.resolve(packageRoot, "generated");
const generatedSrcDir = path.resolve(generatedRootDir, "src");
const showOperatorGuides =
  process.env.PUBLIC_VIVD_DOCS_SHOW_OPERATOR_GUIDES === "true";

const operatorGuidePaths = [
  "content/docs/self-hosting.mdx",
  "content/docs/self-host-config-reference.mdx",
  "content/docs/instance-settings.mdx",
  "content/docs/email-and-deliverability.mdx",
];

function ensureDraftFrontmatter(content) {
  if (!content.startsWith("---\n")) {
    return content;
  }

  const frontmatterEnd = content.indexOf("\n---\n", 4);
  if (frontmatterEnd === -1) {
    return content;
  }

  const frontmatter = content.slice(4, frontmatterEnd);
  if (/^draft:\s+/m.test(frontmatter)) {
    return content.replace(/^draft:\s+.*$/m, "draft: true");
  }

  return `${content.slice(0, frontmatterEnd)}\ndraft: true${content.slice(frontmatterEnd)}`;
}

fs.rmSync(generatedRootDir, { recursive: true, force: true });
fs.mkdirSync(generatedRootDir, { recursive: true });
fs.cpSync(sourceSrcDir, generatedSrcDir, { recursive: true });

if (!showOperatorGuides) {
  for (const relativePath of operatorGuidePaths) {
    const fullPath = path.resolve(generatedSrcDir, relativePath);
    const original = fs.readFileSync(fullPath, "utf-8");
    fs.writeFileSync(fullPath, ensureDraftFrontmatter(original), "utf-8");
  }
}

console.log(
  `[docs] Prepared generated src (${showOperatorGuides ? "with" : "without"} operator guides).`,
);
