# syntax=docker/dockerfile:1
FROM oven/bun:1.4-alpine AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile && bun run build

FROM oven/bun:1.4-alpine
LABEL org.opencontainers.image.source="https://github.com/Jex-y/nas-apps"
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /repo/dist ./
COPY --from=build /repo/deploy/stack /stack
USER bun
EXPOSE 3000
CMD ["bun", "index.js"]
