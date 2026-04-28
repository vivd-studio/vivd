FROM node:23-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/theme/package.json packages/theme/package.json
COPY packages/docs/package.json packages/docs/package.json

RUN npm ci -w @vivd/theme -w @vivd/docs --include-workspace-root=false

FROM deps AS dev
COPY packages/theme ./packages/theme
COPY packages/docs ./packages/docs
COPY packages/shared ./packages/shared
COPY scripts ./scripts

RUN mkdir -p ./packages/studio

WORKDIR /app/packages/docs
EXPOSE 4321
CMD ["npm", "run", "dev"]

FROM deps AS build
COPY packages/theme ./packages/theme
COPY packages/docs ./packages/docs
COPY packages/shared ./packages/shared
COPY scripts ./scripts

RUN mkdir -p ./packages/studio

ARG VIVD_DOCS_SITE_URL=https://docs.vivd.studio
ENV VIVD_DOCS_SITE_URL=${VIVD_DOCS_SITE_URL}

RUN npm run build -w @vivd/docs

FROM nginx:alpine AS prod
COPY --from=build /app/packages/docs/dist /usr/share/nginx/html
COPY packages/docs/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
