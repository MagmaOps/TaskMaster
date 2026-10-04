# syntax=docker/dockerfile:1

# --- Build stage: produce the static Vite bundle ---
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The app calls RELATIVE /api (see src/config/env.ts), so no API URL is baked in;
# the ingress routes /api to the backend. VITE_GOOGLE_CLIENT_ID can be provided
# at build time to enable the Google button (empty by default -> hidden).
ARG VITE_GOOGLE_CLIENT_ID=""
ARG VITE_ENV="production"
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
ENV VITE_ENV=${VITE_ENV}
RUN npm run build

# --- Runtime stage: nginx serving the static bundle ---
FROM nginx:1.31.6-alpine AS runtime

# SPA config: history-fallback to index.html; /api is handled by the ingress.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

# nginx runs its master as root by default but workers drop privileges; the
# config binds to 8080 so the container can run without extra capabilities.
CMD ["nginx", "-g", "daemon off;"]
