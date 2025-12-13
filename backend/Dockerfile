# Stage 1: Base (Dependencies)
FROM node:23 AS base
WORKDIR /app
# Install chrome dependencies for Puppeteer
RUN apt-get update \
    && apt-get install -y chromium fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 curl unzip wget gnupg ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install opencode CLI (required for SDK to spawn server)
RUN npm install -g opencode-ai


ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
COPY package*.json ./
RUN npm install
COPY . .
COPY entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# Stage 2: Development
FROM base AS dev
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Stage 3: Production
FROM base AS prod
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
