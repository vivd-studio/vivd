FROM node:23-bookworm-slim

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN chown node:node /app
USER node

# Copy package files and install dependencies
# Skip Puppeteer's browser download - we install Chromium from Debian so the image stays multi-arch.
COPY --chown=node:node package*.json ./
RUN npm install

# Copy source and build
COPY --chown=node:node . .
RUN npm run build

EXPOSE 3001
CMD ["node", "dist/index.js"]
