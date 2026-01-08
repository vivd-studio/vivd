# Caddy with baked-in Caddyfile for production
FROM caddy:2-alpine

# Copy production Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile

# Create directories for dynamic site configs and published sites
RUN mkdir -p /etc/caddy/sites.d /srv/published /srv/default /etc/caddy_shared

# Copy Caddyfile to a location that can be shared with backend container
# This is mounted as a volume in docker-compose.prod.yml
COPY Caddyfile /etc/caddy_shared/Caddyfile

EXPOSE 80 443 2019
