# Node 24 includes the SQLite runtime used by this application.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY client ./client
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/var/data/levr.sqlite
WORKDIR /app
RUN mkdir -p /var/data && chown node:node /var/data
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node server ./server
USER node
EXPOSE 3000
VOLUME ["/var/data"]
CMD ["node", "server/index.js"]
