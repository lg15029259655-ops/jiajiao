FROM node:24.14.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY . .
EXPOSE 8765
CMD ["node", "server.js"]
