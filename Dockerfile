FROM node:22-bookworm AS dev
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["npm", "run", "dev"]

FROM dev AS build
RUN npm run build

FROM node:22-bookworm AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV ACORNOPS_AGENT_WRITE_ENABLED=false
RUN apt-get update \
    && apt-get install --no-install-recommends -y iproute2 systemd \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
CMD ["node", "dist/index.js"]
