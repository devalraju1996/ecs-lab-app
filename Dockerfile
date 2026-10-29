FROM node:20-alpine

WORKDIR /app

# Install dependencies first so this layer is cached between builds
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY index.js ./

# Folder for the /data volume, owned by the non-root "node" user.
# VOLUME lets ECS copy this folder (and its ownership) into the task volume.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

ENV PORT=3000 \
    APP_ENV=docker \
    APP_VERSION=v1

USER node
EXPOSE 3000

# Docker-level health check (ECS uses its own one from the task definition)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:3000/health || exit 1

CMD ["node", "index.js"]
