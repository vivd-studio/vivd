# Frontend build
FROM node:22-alpine AS build
WORKDIR /app

# Copy package.json only (not package-lock.json to avoid cross-platform optional dep issues)
COPY package.json ./

# Fresh install for this platform
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Production with nginx
FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
