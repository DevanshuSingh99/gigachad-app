# Multi-stage build for apps/api only. The dashboard, demo page, and widget are
# built by Cloudflare Pages, which is what makes building this image on a 1 vCPU
# VM safe: what happens here is a tsc compile plus prisma generate, not a React
# bundle. See docs/10-deployment.md.

# ─── deps: install once, cached on the manifests alone ────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
# openssl is required by Prisma's query engine.
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
# Install only the workspaces this image needs. --ignore-scripts keeps the
# Prisma postinstall from running before the schema is copied in.
RUN npm ci --ignore-scripts \
      --include-workspace-root \
      --workspace @gigachad/shared \
      --workspace @gigachad/api

# ─── builder: compile shared, then the API ────────────────────────────────────
FROM deps AS builder
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace @gigachad/shared \
 && npm run build --workspace @gigachad/api

# ─── dev: same tree with devDependencies intact, for compose.override.yaml ────
FROM builder AS dev
WORKDIR /app
# tsx runs on esbuild, whose binary ships as a per-platform optional dependency.
# The lockfile was generated on macOS and carries no resolved entry for the Linux
# packages, so `npm ci` installs none of them and tsx dies at startup. Both the
# architecture and the required version are derived here rather than pinned, so
# this cannot drift out of step with whatever esbuild tsx resolves to — and it
# touches only the dev stage, never the image that ships.
RUN ESBUILD_VERSION="$(node -p "require('esbuild/package.json').version")" \
 && ESBUILD_ARCH="$(node -p "process.arch === 'arm64' ? 'arm64' : 'x64'")" \
 && npm install --no-save "@esbuild/linux-${ESBUILD_ARCH}@${ESBUILD_VERSION}"
WORKDIR /app/apps/api
ENV NODE_ENV=development
CMD ["npm", "run", "dev"]

# ─── pruner: drop devDependencies, then regenerate the client npm ci removed ──
FROM builder AS pruner
WORKDIR /app
RUN npm ci --omit=dev --ignore-scripts \
      --include-workspace-root \
      --workspace @gigachad/shared \
      --workspace @gigachad/api \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm cache clean --force

# ─── runner ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
# Copied wholesale from the pruned tree: node_modules holds workspace symlinks
# into packages/shared, so the layout has to survive intact.
COPY --from=pruner --chown=node:node /app /app
USER node
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/server.js"]
