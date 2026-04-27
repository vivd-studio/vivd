import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const sourceSrcDir = path.resolve(packageRoot, "src");
const generatedRootDir = path.resolve(packageRoot, "generated");
const generatedSrcDir = path.resolve(generatedRootDir, "src");

fs.rmSync(generatedRootDir, { recursive: true, force: true });
fs.mkdirSync(generatedRootDir, { recursive: true });
fs.cpSync(sourceSrcDir, generatedSrcDir, { recursive: true });

console.log("[docs] Prepared generated src.");
