# Vivd

Vivd is an AI-powered website builder that let's Anyone build their own website.

- You can Preview your page in an Editor and just tell the Agent what you want, and he will implement it in the website (be it content, text, images, pages, subpages, job-listings, etc.).
- Like a CMS you control with "Saying what you want", replacing the need for a web-agency. The AI is your Designer, Developer, Security Reviewer, Content Creator and sparring partner.
- easy Editor that let's you drag&drop new assets, like images or files directly into your site and also directly edit text on the page.
- a server to host your website - you just have to click "publish" and it will be available on the internet.

# Frontend

The frontend is a React with Vite application that provides a user interface for interacting with the backend.

- we are using trpc for api-calls.
- the generated website files will be served by the backend from statically from the projects/ folder.
- Try to use shadcn components if possible.
- use react-hook-form for forms
- use our tailwind tokens from index.css for styling
- for api-calls with trpc, always deconstruct queries or mutations, for example: const { x, y, z } = trpc.example.useMutation()

# Backend

The backend is a Node.js application that provides an API for interacting with the frontend. The backend statically serves all the generated index.htmls from the projects/ folder

- express.js
- drizzle-orm with migrations for database (DON't EVER RUN DB PUSH, allways apply migrations)
- better-auth for authentication
- puppeteer for scraping
- trpc for api-calls
- opencode for ai-agent

# Deployment & Development

We are using the docker-compose.yml file to deploy all of our services (backend, frontend, database) so this file needs to be ready to deploy. (PROD)
The docker-compose.override.yml file is used to override the docker-compose.yml file for local development. (DEV)

## How it works

1. **Scrapes** a target URL for text, images, and a screenshot using Puppeteer.
2. **Analyzes** the content and current brand visual.
3. **Generates** a new, high-converting landing page (HTML/Tailwind) via OpenRouter API.

We save all the generated and downloaded files from the url in the projects/domain-name folder and also keep a project.json in the root folder, that tracks the url, created_at, status, etc.

Afterwards we can use an Agent to request changes on to our website. The agent is an opencode agent (https://opencode.ai/docs) and we are consuming its SDK in our backend.

## Testing Note

> [!IMPORTANT] > **Do not run tests on every change.**
> The workflow is long-running and uses paid API calls. Running tests frequently can be pricey and time-consuming.

# Architecture

Vivd uses a **single-tenant architecture** where each user gets their own isolated instance:
(There is an option planned for the software to be used multitenant though)

Per-User Instance
Frontend / Backend (+ opencode agent) / Postgres Database / Caddy Server for live website
Dedicated Volume (projects/)

- **Backend**: Each user has their own backend container with an embedded opencode agent
- **Database**: Separate Postgres database per user (isolated data)
- **Volumes**: Dedicated storage volumes for generated files and assets
- **Agent**: opencode runs within the backend, scoped to that user's project files only
- **Publishing**: A separate Caddy server serves the published live website

# Implementation Plan

We are constantly keeping track of the implementation plan in the implementation.md file, it's kind of our main-quest. If you are tasked to work on it, ask if you can tick of certain elements so we can mark them as done.

# Skills

To get further information on certain topics, you can load extra information from the .skills folder.

Available skills:

- .skills/DOKPLOY.md (We deploy on Dokploy, here you can find all information on the platform)
- .skills/OPENCODE.md (We use OpenCode as our AI coding agent, here you can find docs and configuration reference)
