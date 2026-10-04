# syntax=docker/dockerfile:1

# --- Build stage: install deps and compile TypeScript to dist/ ---
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Runtime stage ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Keep the full dependency set (not pruned): the migrate Job reuses this image
# and runs `npm run migrate`, which executes the TypeScript migrations via
# node-pg-migrate + ts-node (both dev deps). One image serves the API and
# migrations; the extra weight is acceptable for a self-hosted lab.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/src/database ./src/database
COPY --chown=node:node package.json package-lock.json tsconfig.json ./

USER node
EXPOSE 3001

# Default: run the API. The migrate Job overrides the command with the migrate
# script (see k8s/base/migrate-job.yaml).
CMD ["node", "dist/server.js"]
