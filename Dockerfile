FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production || bun install --production

FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY drizzle ./drizzle
CMD ["bun", "run", "src/main.ts"]
