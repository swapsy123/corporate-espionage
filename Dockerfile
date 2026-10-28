FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node package*.json ./
RUN --mount=type=secret,id=build_ca,target=/tmp/build-ca.pem \
    if [ -f /tmp/build-ca.pem ]; then NODE_EXTRA_CA_CERTS=/tmp/build-ca.pem npm ci --include=dev; else npm ci --include=dev; fi
COPY --chown=node:node . .
RUN npm run build && mkdir -p /var/data && chown node:node /var/data
ENV NODE_ENV=production CHROMIUM_PATH=/usr/bin/chromium DATABASE_PATH=/var/data/levr-beta.sqlite
USER node
EXPOSE 3000
CMD ["npm","start"]
