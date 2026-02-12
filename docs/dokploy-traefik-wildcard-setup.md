# Dokploy + Traefik Wildcard Setup (`*.vivd.studio`)

> Production runbook based on the working setup validated on **2026-02-12**.

## Goal

Route every tenant subdomain (`{tenant}.vivd.studio`) through Dokploy Traefik to the Vivd Caddy service, with a valid Let's Encrypt wildcard certificate.

## Final Working State (Summary)

- Wildcard DNS in Hetzner is configured for `*.vivd.studio`.
- Traefik file-provider router `vivd-tenants` forwards wildcard hosts to `http://caddy:80`.
- Traefik ACME resolver `letsencrypt_hetzner` issues `*.vivd.studio` via DNS challenge.
- Health check works through Traefik:
  - `curl -skI --resolve test.vivd.studio:443:127.0.0.1 https://test.vivd.studio/health` -> `HTTP/2 200`
- Live cert is valid:
  - `CN=*.vivd.studio`, issuer Let's Encrypt (`R12`).

## Prerequisites

- Exactly one Vivd Caddy instance for this environment (avoid duplicate `caddy` DNS targets).
- Dokploy Traefik running with:
  - file provider enabled for `/etc/dokploy/traefik/dynamic`
  - `web` and `websecure` entrypoints enabled
- Hetzner DNS zone for `vivd.studio` with wildcard record(s) pointing to this server.

## 1) Traefik Dynamic Router

Create/edit `/etc/dokploy/traefik/dynamic/vivd-wildcard.yml`:

```yaml
http:
  routers:
    vivd-tenants:
      rule: 'HostRegexp(`^[a-z0-9-]+\.vivd\.studio$`)'
      entryPoints: [websecure]
      service: vivd-caddy
      tls:
        certResolver: letsencrypt_hetzner
        domains:
          - main: "*.vivd.studio"

  services:
    vivd-caddy:
      loadBalancer:
        servers:
          - url: "http://caddy:80"
```

Notes:
- Keep this as a separate file in Traefik `dynamic/` so it is easy to reason about and rollback.
- If Dokploy UI cannot create files, use SSH and create it directly under `/etc/dokploy/traefik/dynamic`.

## 2) Traefik ACME Resolver (Hetzner DNS challenge)

In Traefik static config (`/etc/dokploy/traefik/traefik.yml`), ensure a resolver like:

```yaml
certificatesResolvers:
  letsencrypt_hetzner:
    acme:
      email: <your-email>
      storage: /etc/dokploy/traefik/dynamic/acme.json
      dnsChallenge:
        provider: hetzner
```

Set Hetzner credentials on the `dokploy-traefik` container environment:

- `HETZNER_API_TOKEN=<token>`
- `HETZNER_API_KEY=<token>` (optional compatibility variable; keep if your setup expects it)

Security:
- Store these in Dokploy secrets/env, not committed files.
- Rotate token immediately if it was ever exposed in logs/chat.

## 3) Restart + Validate

Restart Traefik:

```bash
docker restart dokploy-traefik
```

Check for config/ACME errors:

```bash
docker logs --since=10m dokploy-traefik | grep -Ei 'vivd-wildcard|vivd-tenants|acme|challenge|certificate|error|invalid|parse'
```

Test routing:

```bash
curl -skI --resolve test.vivd.studio:443:127.0.0.1 https://test.vivd.studio/health
```

Expected:
- `HTTP/2 200`
- `server: Caddy`

Inspect served certificate:

```bash
echo | openssl s_client -servername test.vivd.studio -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject -issuer -ext subjectAltName -dates
```

Expected:
- wildcard SAN includes `DNS:*.vivd.studio`
- issuer is Let's Encrypt, not `TRAEFIK DEFAULT CERT`

## 4) Network Diagnostics Used

If routing fails, validate Traefik -> Caddy service resolution:

```bash
docker run --rm --network container:dokploy-traefik curlimages/curl:8.6.0 -sv http://caddy:80/health
docker run --rm --network container:dokploy-traefik busybox:1.36 nslookup caddy
```

Expected:
- `/health` returns `200 OK`
- `nslookup caddy` resolves to only the intended Caddy target(s)

## Known Pitfalls We Hit

1. Multiple Caddy containers in the same network
- Symptom: `caddy` resolves to multiple IPs and routing is non-deterministic.
- Fix: keep only one active Caddy target per environment.

2. ACME duplicate TXT errors in Hetzner
- Symptom: Traefik log shows `invalid_input: duplicate value ...` while creating TXT records.
- Fix:
  - remove stale `_acme-challenge` TXT entries in Hetzner
  - restart Traefik and retry issuance
  - avoid unnecessary duplicate domain requests in a single cert definition

3. Confusing stale log lines
- Old errors can still appear when using large `--since` windows.
- Validate with a short window right after restart and always confirm with live `curl` + `openssl`.

## Operational Decision

This setup keeps Traefik as the edge TLS terminator and router, while Caddy remains the internal app reverse proxy/content server for Vivd.
