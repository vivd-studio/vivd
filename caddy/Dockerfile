# Caddy with baked-in Caddyfile for production
FROM caddy:2-alpine

# Copy production Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile

# Create directories for dynamic site configs and published sites
RUN mkdir -p /etc/caddy/sites.d /srv/published /srv/default

EXPOSE 80 443 2019
