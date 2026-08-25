# GyFTR CEO Office Portal — Frontend (React + Vite → static serve)
# Base image is ARM — build/run on linux/arm64 (e.g. Graviton), matching the
# Marketing and Legal portals.
#
# Build:
#   docker build --platform linux/arm64 \
#     --build-arg VITE_SUPABASE_URL=https://xxxx.supabase.co \
#     --build-arg VITE_SUPABASE_ANON_KEY=eyJ... \
#     -f frontend/Dockerfile -t gyftr-ceo-portal-frontend ./frontend
#
# Or from repo root:
#   docker compose up --build
#
# Run:
#   docker run --platform linux/arm64 -p 7868:7868 gyftr-ceo-portal-frontend
#
# NOTE: unlike the Marketing and Legal portals there is NO backend image. This
# product's data layer is Supabase (Postgres + Auth + Storage + Edge Functions),
# which is managed and external — see DEPLOY.md. Only this one container ships.

ARG BASE_IMAGE=653380732738.dkr.ecr.ap-south-1.amazonaws.com/node-24.18.0-alpine3.24-arm:node-24.18.0-alpine3.24-arm

# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM ${BASE_IMAGE} AS build

WORKDIR /app

COPY package.json package-lock.json ./

# The base image sets NODE_ENV=production, which makes npm skip devDependencies
# (vite lives there). Override it for the install only — `vite build` must still
# run with NODE_ENV=production so the bundle is not built in dev mode.
RUN NODE_ENV=development npm ci --include=dev

COPY index.html vite.config.js eslint.config.js ./
COPY public ./public
COPY src ./src

# Vite embeds these at build time — they must arrive as --build-arg, not as
# environment on the running container, or the bundle ships without them.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build

# ── Stage 2: serve static files ─────────────────────────────────────────────
FROM ${BASE_IMAGE}

WORKDIR /app

RUN npm install -g serve@14

COPY --from=build /app/dist ./dist

EXPOSE 7868

# Bind explicitly to 0.0.0.0. `-l 7868` alone leaves the interface to serve's
# defaults; if that ever resolves to localhost the container looks fine from
# inside while the load balancer health check fails from outside — which
# presents as a 503 with a perfectly healthy-looking container.
# `-s` rewrites unknown paths to index.html, which the SPA router needs.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7868/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["serve", "-s", "dist", "-l", "tcp://0.0.0.0:7868"]
