import * as fs from "fs";

const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL || "http://caddy:2019";
const CADDY_ADMIN_ORIGIN = (() => {
  try {
    return new URL(CADDY_ADMIN_URL).origin;
  } catch {
    return null;
  }
})();

/**
 * Trigger Caddy to reload its configuration by posting the Caddyfile.
 *
 * The Caddyfile must be accessible to this container at /etc/caddy/Caddyfile.
 * In local dev, this is mounted from ./Caddyfile.
 * In production, a shared volume or copy of the Caddyfile must be available.
 */
export async function reloadCaddyConfig(): Promise<void> {
  try {
    const caddyfilePaths = [
      "/etc/caddy/Caddyfile",
      "/etc/caddy_shared/Caddyfile",
    ];

    let caddyfileContent: string | null = null;

    for (const caddyfilePath of caddyfilePaths) {
      try {
        caddyfileContent = fs.readFileSync(caddyfilePath, "utf-8");
        console.log(`Found Caddyfile at ${caddyfilePath}`);
        break;
      } catch {
        // Try next path.
      }
    }

    if (!caddyfileContent) {
      console.warn(
        "Caddyfile not found at any expected location - Caddy reload skipped. " +
          "Ensure the Caddyfile is mounted or shared with the backend container.",
      );
      return;
    }

    const response = await fetch(`${CADDY_ADMIN_URL}/load`, {
      method: "POST",
      headers: {
        "Content-Type": "text/caddyfile",
        ...(CADDY_ADMIN_ORIGIN ? { Origin: CADDY_ADMIN_ORIGIN } : {}),
      },
      body: caddyfileContent,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Caddy reload failed with status ${response.status}: ${errorText}`,
      );
      return;
    }

    console.log("Caddy configuration reloaded successfully");
  } catch (error) {
    console.warn(
      "Could not reload Caddy (this is normal in development):",
      error,
    );
  }
}
