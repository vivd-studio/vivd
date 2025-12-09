# Stage 1: Development
FROM node:23 AS dev
WORKDIR /app

# Setup backend types/files availability
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install
COPY backend ./

# Setup frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend ./

# Expose default Vite port
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]

# Stage 2: Build
FROM node:23 AS build
WORKDIR /app

# Setup backend for types
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install
COPY backend ./

# Setup frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend ./

# Build
RUN npm run build

# Stage 3: Production
FROM nginx:alpine AS prod
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
