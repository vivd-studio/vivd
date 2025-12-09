# Stage 1: Development
FROM node:23 AS dev
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Expose default Vite port
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]

# Stage 2: Build
FROM node:23 AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 3: Production
FROM nginx:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
