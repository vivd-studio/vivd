/**
 * Docker Compose Template Generator
 *
 * Generates docker-compose.yml content for vivd instances
 * based on the production template with instance-specific configuration.
 */

export interface InstanceConfig {
  domain: string;
  betterAuthUrl: string;
  betterAuthSecret: string;
  opencodeModel: string;

  // Database
  postgresUser: string;
  postgresPassword: string;
  postgresDb: string;

  // API Keys
  openrouterApiKey: string;
  googleApiKey: string;

  // GitHub
  githubToken: string;
  githubOrg: string;
  githubRepoPrefix: string;
  githubSyncEnabled: boolean;

  // Scraper
  scraperUrl: string;
  scraperApiKey: string;

  // Features
  singleProjectMode: boolean;
}

/**
 * Generate a docker-compose.yml file for a vivd instance
 */
export function generateComposeFile(_config: InstanceConfig): string {
  return `services:
  caddy:
    image: ghcr.io/vivd-studio/vivd-caddy:latest
    pull_policy: always
    restart: unless-stopped
    volumes:
      - caddy_data:/data
      - caddy_config:/config
      - caddy_sites:/etc/caddy/sites.d
      - caddy_caddyfile:/etc/caddy_shared
      - published_sites:/srv/published:ro
    depends_on:
      - backend
    networks:
      - vivd-network

  backend:
    image: ghcr.io/vivd-studio/vivd-server:latest
    pull_policy: always
    restart: unless-stopped
    environment:
      - DATABASE_URL=postgresql://\${POSTGRES_USER}:\${POSTGRES_PASSWORD}@postgres:5432/\${POSTGRES_DB}
      - PORT=3000
      - OPENROUTER_API_KEY=\${OPENROUTER_API_KEY}
      - GOOGLE_API_KEY=\${GOOGLE_API_KEY}
      - OPENCODE_MODEL=\${OPENCODE_MODEL}
      - DOMAIN=\${DOMAIN}
      - TRUSTED_DOMAINS=\${TRUSTED_DOMAINS:-}
      - PUBLISHED_DIR=/srv/published
      - CADDY_SITES_DIR=/etc/caddy/sites.d
      - CADDY_ADMIN_URL=http://caddy:2019
      - SCRAPER_URL=\${SCRAPER_URL:-http://scraper:3001}
      - SCRAPER_API_KEY=\${SCRAPER_API_KEY}
      - GITHUB_SYNC_ENABLED=\${GITHUB_SYNC_ENABLED:-false}
      - GITHUB_SYNC_STRICT=\${GITHUB_SYNC_STRICT:-false}
      - GITHUB_ORG=\${GITHUB_ORG:-}
      - GITHUB_TOKEN=\${GITHUB_TOKEN:-}
      - GITHUB_REPO_PREFIX=\${GITHUB_REPO_PREFIX:-}
      - GITHUB_REMOTE_NAME=\${GITHUB_REMOTE_NAME:-origin}
      - GITHUB_REPO_VISIBILITY=\${GITHUB_REPO_VISIBILITY:-private}
      - GITHUB_API_URL=\${GITHUB_API_URL:-https://api.github.com}
      - GITHUB_GIT_HOST=\${GITHUB_GIT_HOST:-github.com}
      - BETTER_AUTH_SECRET=\${BETTER_AUTH_SECRET}
      - BETTER_AUTH_URL=\${BETTER_AUTH_URL}
      - SINGLE_PROJECT_MODE=\${SINGLE_PROJECT_MODE:-false}
    volumes:
      - backend_data:/app/projects
      - opencode_data:/root/.local/share/opencode/storage
      - published_sites:/srv/published
      - caddy_sites:/etc/caddy/sites.d
      - caddy_caddyfile:/etc/caddy_shared:ro
    depends_on:
      - postgres
    networks:
      - vivd-network

  frontend:
    image: ghcr.io/vivd-studio/vivd-ui:latest
    pull_policy: always
    restart: unless-stopped
    environment:
      - VITE_APP_ENV=\${VITE_APP_ENV}
    depends_on:
      - backend
    networks:
      - vivd-network

  postgres:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: \${POSTGRES_USER}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: \${POSTGRES_DB}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER} -d \${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 5
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - vivd-network

networks:
  vivd-network:

volumes:
  postgres_data:
  backend_data:
  opencode_data:
  caddy_data:
  caddy_config:
  caddy_sites:
  caddy_caddyfile:
  published_sites:
`;
}

/**
 * Get the list of required environment variables
 */
export function getRequiredEnvVars(): string[] {
  return [
    "DOMAIN",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_SECRET",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
    "OPENROUTER_API_KEY",
    "GOOGLE_API_KEY",
    "OPENCODE_MODEL",
    "SCRAPER_URL",
    "SCRAPER_API_KEY",
    "VITE_APP_ENV",
  ];
}

/**
 * Get optional environment variables with their defaults
 */
export function getOptionalEnvVars(): Record<string, string> {
  return {
    GITHUB_SYNC_ENABLED: "false",
    GITHUB_SYNC_STRICT: "false",
    GITHUB_ORG: "",
    GITHUB_TOKEN: "",
    GITHUB_REPO_PREFIX: "",
    GITHUB_REMOTE_NAME: "origin",
    GITHUB_REPO_VISIBILITY: "private",
    GITHUB_API_URL: "https://api.github.com",
    GITHUB_GIT_HOST: "github.com",
    SINGLE_PROJECT_MODE: "false",
    TRUSTED_DOMAINS: "",
  };
}
