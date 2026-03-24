export function getDefinedStudioMachineEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const definedEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      definedEnv[key] = value;
    }
  }

  return definedEnv;
}
