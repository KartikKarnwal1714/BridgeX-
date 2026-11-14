FROM node:24-bookworm-slim AS dependencies

WORKDIR /app

# bcrypt may need a native build when no prebuilt binary is available.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=5000
WORKDIR /app

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node migrations ./migrations

USER node

EXPOSE 5000

CMD ["npm", "start"]
