# GyFTR CEO Office Portal — Backend API
#
# Base image is ARM — build and run on linux/arm64 (Graviton), matching the
# Marketing and Legal portal backends and the frontend image in this repo.
#
# Build:
#   docker build --platform linux/arm64 -f backend/Dockerfile -t gyftr-ceo-portal-api ./backend
#
# Or from repo root:
#   docker compose up --build

ARG BASE_IMAGE=653380732738.dkr.ecr.ap-south-1.amazonaws.com/node-24.18.0-alpine3.24-arm:node-24.18.0-alpine3.24-arm
FROM ${BASE_IMAGE}

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=7869

EXPOSE 7869

# Everything this container needs is injected at runtime — DB_* or
# AWS_SECRET_NAME, COGNITO_*, ATTACHMENTS_BUCKET, FRONTEND_URL. Nothing secret
# is baked into the image, which is what makes the image itself safe to keep in
# ECR and safe to roll back to.
#
# Unlike the frontend, there is no build-time configuration at all here: the
# same image runs in UAT and production with different environment.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7869/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
