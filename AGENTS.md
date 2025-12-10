# Landing Page Agent

This project is an automated agent that scrapes websites and generates modern landing pages using AI.

# Frontend

The frontend is a React with Vite application that provides a user interface for interacting with the backend.

- The client is generated with hey-api.
- Try to use shadcn components if possible.
- use react-hook-form for forms
- use our tailwind tokens from index.css for styling
- for api-calls with trpc, always deconstruct queries or mutations, for example: const { x, y, z } = trpc.example.useMutation()

# Backend

The backend is a Node.js application that provides an API for interacting with the frontend. The backend statically serves all the generated index.htmls from the generated/ folder

- express.js
- drizzle-orm with migrations for database
- better-auth for authentication
- puppeteer for scraping

# Deployment & Development

We are using the docker-compose.yml file to deploy all of our services (backend, frontend, database) so this file needs to be ready to deploy. (PROD)
The docker-compose.override.yml file is used to override the docker-compose.yml file for local development. (DEV)


## How it works
1. **Scrapes** a target URL for text, images, and a screenshot using Puppeteer.
2. **Analyzes** the content and current brand visual.
3. **Generates** a new, high-converting landing page (HTML/Tailwind) via OpenRouter API.

We save all the generated and downloaded files from the url in the generated/domain-name folder and also keep a project.json in the root folder, that tracks the url, created_at, status, etc.


## Testing Note
> [!IMPORTANT]
> **Do not run tests on every change.**
> The workflow is long-running and uses paid API calls. Running tests frequently can be pricey and time-consuming.
