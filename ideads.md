# Urgent fixes:

# Todos / Ideas for everything (features, ui, etc.)

- for scratch workflow - add import from Linkedin, Facebook, Instagram, Twitter, etc.
- add a "just improve" prompt, that will be asked to just improve the current version in any way (make a good prompt for this)
- lets create the a landingpage for vivd with vivd-studio (with the new "start from scratch" feature)
- make it possible to drop files in the agent chat. The files should be uploaded to the project. Images should go in assets/images, other files in assets/files. Also images dropped in the chat should be directly added to the opencode agent prompt
- have a "review for publish" workflow, that checks the site for several issues:
  - check if the site has a custom 404.html
  - check if favicon is set
  - check if impressum / imprint is created
  - check if privacy policy is created
  - check if robots.txt is created
  - check if sitemap.xml is created
  - check if contact form is live and hooked up
  - general code & security checks

## From Implementation Plan

### Scratch Project Flow

- wizard to generate site from scratch (no source URL): business type, name, industry → assets → style → AI generates full site
- adapt backend `processUrl` to `generateProject({ type: 'scratch' | 'url', ... })`

### Licensing System

- create `LicenseService` to read limits from env vars and check before operations (return 402 when exceeded)
- **Feature limits** (env vars):
  - `LICENSE_IMAGE_GEN` (default: true) - enable/disable image generation
  - `LICENSE_MAX_PROJECTS` (default: 1) - sites per instance
  - `LICENSE_MAX_USERS` (default: 3) - team members
- **AI rate limits** (env vars):
  - `LICENSE_AI_TOKENS_PER_MINUTE` (default: 500k) - burst protection
  - `LICENSE_AI_TOKENS_PER_MONTH` (default: 10M) - monthly cap
  - `LICENSE_AI_REQUESTS_PER_DAY` (default: 200) - request throttle
  - `LICENSE_IMAGE_GEN_PER_DAY` (default: 20) / `PER_MONTH` (default: 50)
- token tracking: hook into OpenCode task events, store cumulative usage per month in DB
- image generation tracking: wrap image gen calls with counter
- frontend: show usage stats in admin dashboard + graceful "limit reached" messaging
- future: license server verification for non-managed customers

### Distribution (GHCR)

- create GitHub Actions workflow to build and push images to GHCR
- create customer template docker-compose (uses `image:` not `build:`)
- document customer onboarding (PAT generation, docker login)

### Update Strategy

- add Watchtower to template compose (opt-in) for auto-updates
- create `CHANGELOG.md` format
- add version display in admin UI

### Future Enhancements

- template gallery: pre-built starting points
- customer billing dashboard (for self-service)
- license server (for non-managed deployments)
- master dashboard: your view across all customer instances
- chat refactoring: review and split chat panel into smaller components
