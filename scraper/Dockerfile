FROM ghcr.io/puppeteer/puppeteer:latest

USER root
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Switch back to non-root user for security
USER pptruser

EXPOSE 3001
CMD ["node", "dist/index.js"]
