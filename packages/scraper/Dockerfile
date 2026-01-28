FROM ghcr.io/puppeteer/puppeteer:24

WORKDIR /app

# Copy package files and install dependencies
# Skip Puppeteer's Chrome download - base image already has it
COPY --chown=pptruser:pptruser package*.json ./
RUN npm install

# Copy source and build
COPY --chown=pptruser:pptruser . .
RUN npm run build

EXPOSE 3001
CMD ["node", "dist/index.js"]
