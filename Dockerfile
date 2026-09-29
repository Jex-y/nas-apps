# syntax=docker/dockerfile:1
FROM oven/bun:1.4-alpine AS build
WORKDIR /repo
COPY --parents package.json bun.lock server/package.json apps/*/package.json packages/*/package.json ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4-alpine
# Links the image to its repository on GHCR; the deploy script prunes old images by it.
ARG SOURCE_URL=""
LABEL org.opencontainers.image.source=$SOURCE_URL
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /repo/deploy/stack /stack
COPY --from=build /repo/dist ./
ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA
USER bun
EXPOSE 3000
CMD ["bun", "index.js"]
