# Vivd Production Readiness Roadmap

Consolidated plan to get vivd ready for production deployments. The goal: enable real customers to build and deploy production websites with vivd.

> [!NOTE]
> This is the main roadmap document. Previous `ideas.md` and `implementation.md` have been consolidated here.

---

## Priority Framework

| Priority | Meaning              | Criteria                         |
| -------- | -------------------- | -------------------------------- |
| **P0**   | Must-have for launch | Blocking for production use      |
| **P1**   | High priority        | Critical for good UX/safety      |
| **P2**   | Medium priority      | Important but can launch without |
| **P3**   | Nice-to-have         | Future enhancements              |

---

## P0: Must-Have for Production Launch

### 1. Production Checklist Automation

> [!IMPORTANT]
> Every published site needs these checks before going live.

**Problem**: Sites could go live missing critical legal/SEO/functionality elements.

**Solution**: Automated "review for publish" workflow that runs prompts against the coding agent.

**Checklist items**:

- [x] Impressum / Imprint page exists and is linked
- [x] Datenschutz / Privacy policy exists and is linked
- [x] Cookie banner (if cookies are used)
- [x] Sitemap.xml exists
- [x] Robots.txt exists
- [x] Favicon is set
- [x] Custom 404.html page exists
- [x] All navigation links work (no broken internal links)
- [x] Contact form is functional (if present)
- [x] SEO meta tags are set (title, description, OG tags)
- [x] Alt text on images

**Implementation**:

- [x] Create a `publish-checklist` procedure in backend
- [ ] Add a pre-publish hook that runs the checklist (Implemented as dialog step instead)
- [x] Display results in modal before publishing
- [x] Allow override with warning

**Follow-up Tasks**:

- [ ] **Fix-it Prompt**: Add a "Fix this" button/prompt that asks the agent to resolve specific checklist deficiencies.
- [x] **File Migration**: Migrate all vivd-specific files (like `project.json`) to the `.vivd/` folder to keep the project root clean.

---

### 2. Project Template Files (AGENTS.md per project)

> [!IMPORTANT]
> The agent needs context about what it can do and who it's working with.

**Problem**: The agent doesn't know it's working on a live production website with potentially non-technical users.

**Solution**: Every new project gets template files that explain context to the agent.

**Template files to create**:

- `AGENTS.md` – project-specific agent context

**AGENTS.md content should include**:

```markdown
# Project: {project_name}

Your name is vivd. You work in vivd-studio and are responsible for building the customers website. This is a live production website. Code changes will be deployed to the internet.
This website might have been created from an old website - in that case the .vivd/ folder will contain screenshots, website-text and image descriptions of the old website. It is also possible that the website was created from scratch - in that case the .vivd/ folder will be empty.
Currently you cannot create images on your own, if you need this, tell the user to open the assets sidebar and use "AI Edit" on existing images or use the "Create new Image with AI" tool, which can take in multiple existing images as reference.

## Important Guidelines

1. **Non-technical users**: You may be working with people unfamiliar with code.
   If necessary ask clarifying questions.
2. **Production ready**: All code must be production-quality:
   - No console.logs left in production
   - No placeholder content
   - Proper error handling
   - Mobile responsive
3. **Available plugins**: {list of enabled plugins}
4. **Custom tools available**:
   - Image generation: Use when user needs new images
5. **Before suggesting changes**: Consider SEO, accessibility, and mobile UX.
```

---

### 3. Licensing & Usage Tracking (Basic)

> [!CAUTION]
> Without limits, customers could abuse AI/image generation.

**Problem**: No control over resource usage per instance.

**Minimum for launch**:

- [ ] Create `LicenseService` to read env var limits
- [ ] Token tracking: hook into OpenCode events, store monthly usage
- [ ] Image generation tracking: wrap calls with counter
- [ ] Show usage in admin dashboard
- [ ] **Warning at 80%**: Alert users approaching their limit
- [ ] **Hard block at 100%**: Disable feature until limits refresh
- [ ] Graceful messaging explaining when limits refresh

**Env vars** (from implementation.md):
| Var | Default | Purpose |
|-----|---------|---------|
| `LICENSE_IMAGE_GEN` | `true` | Enable image generation |
| `LICENSE_MAX_PROJECTS` | `1` | Sites per instance |
| `LICENSE_AI_TOKENS_PER_MONTH` | `10M` | Monthly token cap |
| `LICENSE_IMAGE_GEN_PER_MONTH` | `50` | Monthly image limit |
| `LICENSE_WARNING_THRESHOLD` | `0.8` | Warn at 80% usage |

---

### 4. CLI for New Project Deployment

> [!IMPORTANT]
> Each customer needs their own compose/server. Manual setup won't scale.

**Problem**: Setting up new customer instances via Dokploy is manual.

**Solution**: CLI tool to bootstrap new vivd instances.

**Phase 1 (MVP) – Creation**:

```bash
vivd-cli deploy --customer "acme-corp" --domain "acme.com"
```

- Creates new compose stack in Dokploy
- Sets up env vars (DB, domain, license keys)
- Configures DNS records if possible
- Returns ready-to-use URL

**Phase 2 – Maintenance** (later):

```bash
vivd-cli update --customer "acme-corp"  # Pull latest images
vivd-cli status --customer "acme-corp"  # Health check
vivd-cli logs --customer "acme-corp"    # View logs
```

---

## P1: High Priority (Pre-launch or fast follow)

### 5. From-Scratch Wizard Improvements

**Current state**: Single-view wizard, basic prompts.

**Improvements needed**:

#### 5.1 Step-based flow

- Step 1: Business info (name, type, industry)
- Step 2: Content sources (optional LinkedIn, Instagram, etc.)
- Step 3: Style preferences (theme, colors)
- Step 4: Reference URLs with context ("copy exactly" vs "inspired by")
- Step 5: Template selection / inspiration gallery
- Step 6: Review & generate

#### 5.2 More themes

- Expand color palettes (currently limited)
- Dark mode variants
- Industry-specific themes (restaurant, agency, shop, etc.)

#### 5.3 Template gallery

> [!NOTE]
> Needs research before implementation.

- Screenshots of beautiful websites as starting points
- Categories: Portfolio, Business, E-commerce, Blog, Restaurant, Agency
- Templates become part of the generation prompt

**Research tasks**:

- [ ] Identify 10-15 beautiful website examples per category
- [ ] Capture screenshots at consistent sizes
- [ ] Document what makes each template effective
- [ ] Consider licensing for any templates we base designs on

#### 5.4 Reference URL clarification

- Ask: "Should the new page look exactly like this?"
- Ask: "Or just take inspiration from a specific element?"
- Let user highlight what they like

---

### 6. Plugin System (Phase 1 & 2)

> [!NOTE]
> Core runtime + contact form plugin is minimum for launch.

**From plugin-system-design.md**:

#### Phase 1: Core Runtime

- [ ] Create `plugins/` folder structure in monorepo
- [ ] Plugin manifest schema and validation (Zod)
- [ ] PluginManager for loading/registering plugins
- [ ] PluginRouter for request routing (`/_api/<plugin>/<action>`)
- [ ] Database schema for plugin state
- [ ] Caddy routing integration

#### Phase 2a: Contact Form Plugin

- [ ] Implement `plugins/contact-form/`
- [ ] Email sending integration (Resend/SMTP)
- [ ] Client widget (`<div data-vivd-plugin="contact-form">`)
- [ ] Admin page for submissions (`/admin/contact-submissions`)
- [ ] Agent documentation (how to enable & configure)

#### Phase 2b: Cookie Banner Plugin (German GDPR/TTDSG)

> [!IMPORTANT]
> Required for legal compliance in Germany/EU when using analytics or marketing cookies.

**Context**: Sites will mainly run in Germany. Many won't use cookies at all, but those with analytics/marketing need full GDPR compliance.

**German requirements (GDPR + TTDSG)**:

- Consent required BEFORE setting non-essential cookies
- Users must be able to reject as easily as accept
- Granular consent per category (no "all or nothing")
- Consent must be revocable at any time
- Record of consent (who, when, what)

**Implementation**:

- [ ] Research German TTDSG specifics
- [ ] Implement `plugins/cookie-consent/`
- [ ] **Smart detection**: Auto-detect if cookies are used (analytics scripts, tracking pixels)
- [ ] **If no cookies detected**: No banner needed (just ensure no cookies are set)
- [ ] Consent categories:
  - Necessary (always allowed, no consent needed)
  - Analytics (e.g., Google Analytics, Plausible)
  - Marketing (e.g., Facebook Pixel, Google Ads)
- [ ] Store consent proof in localStorage + optional backend log
- [ ] Block non-essential scripts until consent given
- [ ] "Cookie settings" / "Datenschutz-Einstellungen" link in footer
- [ ] Integration with production checklist (warn if cookies detected but no consent banner)

---

### 7. Custom Image Generation Tool

**Problem**: Agent can't generate images, limiting what users can create.

**Solution**: OpenRouter-based image generation as custom tool.

**Implementation**:

- Create `.opencode/tool/generate-image.ts` template
- Include in project template files
- Uses OpenRouter API for image generation
- Saves images to `assets/images/`
- Tracks usage for licensing

---

## P2: Medium Priority (Post-launch improvements)

### 8. Studio UX Improvements

#### 8.1 Code view in assets sidebar

- Show actual source code (index.html, CSS, etc.)
- Allow inline editing
- Syntax highlighting

#### 8.2 File explorer feel

- Tree structure like VSCode
- Collapse/expand folders
- File icons by type
- Drag & drop reordering

#### 8.3 File upload in chat

- Drop images → `assets/images/`
- Drop files → `assets/files/`
- Images included in agent prompt

---

### 9. "Just Improve" Prompt

**Feature**: One-click button to ask the agent to improve the current page.

**Prompt engineering**:

```
Analyze the current page and make 3-5 improvements. Consider:
- Visual appeal and modern design trends
- Mobile responsiveness
- Loading performance
- Accessibility
- SEO best practices
- Content clarity and conversion optimization

Make the changes without asking, then explain what you improved.
```

---

### 10. Plugin System (Phase 3-4)

#### Phase 3: Booking Plugin

- [ ] Implement `plugins/booking/`
- [ ] Calendar/time slot widget
- [ ] Admin page for managing bookings
- [ ] Email confirmations

#### Phase 4: External Plugin Support

- [ ] Git-based plugin installation
- [ ] Plugin version management
- [ ] Plugin update mechanism

---

## P3: Future Enhancements

### 11. Plugin System (Phase 5-6)

- Sandbox for custom agent-created plugins
- Plugin development template
- Hot-reload for development
- PLUGINS.md auto-generation

### 12. Advanced Licensing

- License server for non-managed deployments
- Customer billing dashboard
- Master dashboard (your view across all instances)

### 13. Social Media Import

- Import content from LinkedIn, Facebook, Instagram, Twitter
- Auto-populate content in from-scratch flow

### 14. Newsletter Plugin

- Email signup with double opt-in
- Admin subscriber list
- Integration with email providers

### 15. Update Strategy

- Manual redeploy via Dokploy UI or CLI
- Create `CHANGELOG.md` with versioned releases
- Version display in admin UI
- Optional: cron-based auto-update checking

### 16. Internal / Dogfooding

- Create vivd landing page using vivd-studio
- Use as demo and validation of scratch workflow

---

## Recommended Work Order

Based on dependencies and impact:

```
Week 1-2: P0 Foundation
├── Production checklist automation
├── Project template files (AGENTS.md)
└── Basic licensing/tracking setup

Week 3-4: P0 & P1
├── CLI for deployments (MVP)
├── Plugin runtime (Phase 1)
└── Contact form plugin (Phase 2)

Week 5-6: P1
├── From-scratch wizard step-based flow
├── Template gallery
└── Custom image generation tool

Week 7-8: P2
├── Studio code view
├── File explorer UX
└── "Just improve" feature
```

---

## Files to Update/Create

| File                                       | Action          | Purpose                 |
| ------------------------------------------ | --------------- | ----------------------- |
| `backend/src/services/LicenseService.ts`   | Create          | Usage tracking & limits |
| `backend/src/services/PublishChecklist.ts` | Create          | Pre-publish validation  |
| `backend/templates/AGENTS.md`              | Create          | Project template        |
| `plugins/`                                 | Create dir      | Plugin infrastructure   |
| `plugins/contact-form/`                    | Create          | First plugin            |
| `.opencode/tool/generate-image.ts`         | Create template | Image generation        |
| `vivd-cli/`                                | Create          | Deployment CLI          |
| `frontend/src/components/wizard/`          | Refactor        | Step-based wizard       |

---

## Decisions Made

| Question         | Decision                                                      |
| ---------------- | ------------------------------------------------------------- |
| CLI scope        | Creation first, then maintenance features                     |
| Plugin priority  | Contact-form first, then cookie-banner                        |
| Template gallery | Needs research (identify beautiful examples)                  |
| Licensing        | Hard block when limit reached, warning at 80%                 |
| Cookie banner    | Full GDPR/TTDSG compliance for German market, smart detection |
| Target market    | Germany/EU (legal compliance focus)                           |
