import * as fs from "fs";
import * as path from "path";

export const CADDY_SYSTEM_PAGES_DIRNAME = "_system";
export const DEFAULT_404_FILENAME = "default-404.html";
export const UNPUBLISHED_SITE_PLACEHOLDER_FILENAME =
  "unpublished-site-placeholder.html";

export function getCaddySystemPagesDir(caddySitesDir: string): string {
  return path.join(caddySitesDir, CADDY_SYSTEM_PAGES_DIRNAME);
}

function writeFileIfChanged(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) {
    const current = fs.readFileSync(filePath, "utf-8");
    if (current === content) return;
  }
  fs.writeFileSync(filePath, content, "utf-8");
}

function buildBaseStyles(): string {
  return `
    :root {
      color-scheme: light;
      --bg: #f5f8f1;
      --panel: rgba(255, 255, 255, 0.9);
      --text: #142018;
      --muted: #4d5d52;
      --border: rgba(20, 32, 24, 0.12);
      --accent: #9ee85a;
      --accent-strong: #6dbd2e;
      --shadow: 0 24px 80px rgba(33, 56, 22, 0.14);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, "Segoe UI", Helvetica, Arial, sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(158, 232, 90, 0.42), transparent 34%),
        radial-gradient(circle at bottom right, rgba(109, 189, 46, 0.22), transparent 30%),
        linear-gradient(180deg, #fbfdf8 0%, var(--bg) 100%);
      display: grid;
      place-items: center;
      padding: 24px;
    }

    main {
      width: min(720px, 100%);
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 28px;
      padding: 32px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(158, 232, 90, 0.18);
      color: #234112;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }

    .eyebrow::before {
      content: "";
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: linear-gradient(180deg, var(--accent), var(--accent-strong));
      box-shadow: 0 0 0 6px rgba(158, 232, 90, 0.14);
    }

    h1 {
      margin: 20px 0 12px;
      font-size: clamp(32px, 5vw, 52px);
      line-height: 1.02;
      letter-spacing: -0.04em;
    }

    p {
      margin: 0;
      color: var(--muted);
      font-size: 17px;
      line-height: 1.65;
      max-width: 58ch;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 28px;
    }

    .button,
    .ghost {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      padding: 0 18px;
      border-radius: 14px;
      text-decoration: none;
      font-weight: 700;
      transition:
        transform 0.16s ease,
        box-shadow 0.16s ease,
        border-color 0.16s ease,
        background 0.16s ease;
    }

    .button {
      color: #102108;
      background: linear-gradient(180deg, #b6f57d 0%, var(--accent) 100%);
      box-shadow: 0 10px 30px rgba(109, 189, 46, 0.3);
    }

    .ghost {
      color: var(--text);
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.72);
    }

    .button:hover,
    .ghost:hover {
      transform: translateY(-1px);
    }

    code {
      font-family: "SFMono-Regular", Menlo, Monaco, Consolas, monospace;
      font-size: 0.94em;
      padding: 0.18rem 0.42rem;
      border-radius: 8px;
      background: rgba(20, 32, 24, 0.06);
      color: #173012;
    }

    .card {
      margin-top: 28px;
      padding: 18px 18px 20px;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.66);
    }

    .card strong {
      display: block;
      margin-bottom: 8px;
      font-size: 14px;
      letter-spacing: 0.01em;
    }

    .card p {
      font-size: 15px;
    }

    @media (max-width: 640px) {
      main {
        padding: 24px;
        border-radius: 22px;
      }

      p {
        font-size: 16px;
      }

      .actions {
        flex-direction: column;
      }

      .button,
      .ghost {
        width: 100%;
      }
    }
  `;
}

function buildUnpublishedSitePlaceholderHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Open Vivd Studio</title>
    <style>
${buildBaseStyles()}
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">Vivd Control Plane</div>
      <h1>This domain does not have a published site yet.</h1>
      <p>
        The live website for this domain has not been deployed yet. To manage this
        workspace, open the Vivd control plane at <code>/vivd-studio</code>.
      </p>
      <div class="actions">
        <a class="button" href="/vivd-studio">Open /vivd-studio</a>
        <a class="ghost" href="/vivd-studio/login">Log in</a>
      </div>
      <div class="card">
        <strong>What happens next</strong>
        <p>
          Once a project is published to this domain, the live site will appear here
          automatically. Until then, use <code>/vivd-studio</code> to open the
          control plane, review the project, and publish it.
        </p>
      </div>
    </main>
  </body>
</html>
`;
}

function buildDefault404Html(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Page Not Found</title>
    <style>
${buildBaseStyles()}
      main {
        width: min(560px, 100%);
      }

      .code {
        margin-top: 24px;
        font-size: clamp(72px, 16vw, 128px);
        line-height: 0.9;
        letter-spacing: -0.06em;
        font-weight: 800;
        color: rgba(20, 32, 24, 0.12);
      }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">404</div>
      <div class="code">404</div>
      <h1>Page not found</h1>
      <p>
        The page you requested does not exist on this host. If you were trying to
        manage the site, open <code>/vivd-studio</code> instead.
      </p>
      <div class="actions">
        <a class="button" href="/">Go to homepage</a>
        <a class="ghost" href="/vivd-studio">Open /vivd-studio</a>
      </div>
    </main>
  </body>
</html>
`;
}

export function ensureCaddyStaticPages(caddySitesDir: string): void {
  const systemPagesDir = getCaddySystemPagesDir(caddySitesDir);
  fs.mkdirSync(systemPagesDir, { recursive: true });

  writeFileIfChanged(
    path.join(systemPagesDir, DEFAULT_404_FILENAME),
    buildDefault404Html(),
  );
  writeFileIfChanged(
    path.join(systemPagesDir, UNPUBLISHED_SITE_PLACEHOLDER_FILENAME),
    buildUnpublishedSitePlaceholderHtml(),
  );
}
