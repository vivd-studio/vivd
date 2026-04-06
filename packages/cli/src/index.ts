import { main } from "./commands.js";

if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = await main(process.argv.slice(2));
  process.exitCode = exitCode;
}

export { main } from "./commands.js";
