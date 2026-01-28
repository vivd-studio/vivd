const debugEnabled = process.env.OPENCODE_DEBUG === "true";
export const debugLog = (...args: unknown[]) => {
  if (debugEnabled) {
    console.log(...args);
  }
};

