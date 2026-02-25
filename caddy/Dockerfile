# Caddy with baked-in Caddyfile for production
FROM caddy:2-alpine

# Keep the shared Caddyfile in sync on every container start so backend reloads
# always use the same config Caddy is actually running.
COPY caddy/entrypoint.sh /usr/local/bin/vivd-caddy-entrypoint.sh

# Copy production Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile

# Create directories for dynamic site configs and published sites
RUN mkdir -p /etc/caddy/sites.d /srv/published /srv/default /etc/caddy_shared

# Copy Caddyfile to a location that can be shared with backend container
# This is mounted as a volume in docker-compose.prod.yml
COPY Caddyfile /etc/caddy_shared/Caddyfile

RUN chmod +x /usr/local/bin/vivd-caddy-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/vivd-caddy-entrypoint.sh"]

EXPOSE 80 443 2019
