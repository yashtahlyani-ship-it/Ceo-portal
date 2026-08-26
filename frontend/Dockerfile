# GyFTR CEO Office Portal — Frontend (React + Vite → static serve)
# Base image is ARM — build/run on linux/arm64 (e.g. Graviton), matching the
# Marketing and Legal portals.
#
# Build:
#   docker build --platform linux/arm64 \
#     --build-arg VITE_API_URL=https://ceo-api.gyftr.net \
#     --build-arg VITE_COGNITO_USER_POOL_ID=ap-south-1_XXXXXXXXX \
#     --build-arg VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxx \
#     -f frontend/Dockerfile -t gyftr-ceo-portal-frontend ./frontend
#
# Or from repo root:
#   docker compose up --build
#
# Run:
#   docker run --platform linux/arm64 -p 7868:7868 gyftr-ceo-portal-frontend
#
# This container serves static files and holds no credentials. All three build
# args are public values — an API hostname and two Cognito pool identifiers,
# the same class of thing as the Supabase anon key they replaced. The pool ids
# identify where to authenticate; they grant nothing on their own.

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
# environment on the running container, or the bundle ships without them and
# the app renders a sign-in screen it can never complete.
ARG VITE_API_URL
ARG VITE_COGNITO_USER_POOL_ID
ARG VITE_COGNITO_CLIENT_ID

ENV VITE_API_URL=$VITE_API_URL \
    VITE_COGNITO_USER_POOL_ID=$VITE_COGNITO_USER_POOL_ID \
    VITE_COGNITO_CLIENT_ID=$VITE_COGNITO_CLIENT_ID

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
#
# Security response headers (X-Content-Type-Options, X-Frame-Options,
# Referrer-Policy, Permissions-Policy) come from public/serve.json, which Vite
# copies into dist/ and `serve` picks up from the directory it is serving.
#
# They used to be set by vercel.json. When the platform moved to AWS that file
# was retired and the headers went with it — which is exactly what a migration
# loses quietly: nothing breaks, no test fails, and the protection is simply
# gone. Keeping them in the image means they travel with the container rather
# than with a hosting provider.
#
# NOTE: serve.json rejects unknown keys, including `$comment` — there is no way
# to leave a note inside that file, which is why this explanation lives here.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7868/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["serve", "-s", "dist", "-l", "tcp://0.0.0.0:7868"]
