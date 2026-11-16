ARG NODE_IMAGE=node:24.22.1-bookworm-slim

# The deps, cues and build stages produce JavaScript, MP3 and other files that are the same for every architecture, so they
# run on the building machine's own platform: a multi-architecture build on one machine renders the voices once instead of
# once per target under emulation. In the release workflow each runner builds its own architecture, so nothing changes there.
# Dependencies once: the build stage uses this layer and only a package.json or lockfile change rebuilds it.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --include=dev

# The recorded voices. The stage starts from the bare Node image, not from deps, so a version bump or a dependency
# update never re-renders them: only the two cue scripts and the movement catalogue reach this layer. The runner (tsx)
# is pinned here and installed on its own because the script needs nothing else from the app's node_modules.
# CUES=1 renders them with Piper (offline text-to-speech); CUES=0 skips them for fast local builds.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS cues
ARG CUES=1
WORKDIR /app
RUN if [ "$CUES" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip && rm -rf /var/lib/apt/lists/* \
      && pip3 install --no-cache-dir --break-system-packages piper-tts==1.8.0 \
      && npm install -g tsx@4.23.15 && npm cache clean --force; \
    fi
COPY scripts/generate-cues.ts scripts/render-cues.py ./scripts/
COPY packages/domain/src/movements.ts ./packages/domain/src/movements.ts
COPY packages/domain/src/generated/cue-phrases.json ./packages/domain/src/generated/cue-phrases.json
RUN if [ "$CUES" = "1" ]; then \
      CUES_OUT=/cues PIPER_VOICES=/tmp/piper-voices PIPER_PYTHON=python3 tsx scripts/generate-cues.ts && rm -rf /tmp/piper-voices; \
    else mkdir -p /cues; fi

# The app: checks, build, and the voices copied in last so the build layers never depend on them.
FROM deps AS build
COPY . .
RUN npm run check && npm run build
COPY --from=cues /cues ./dist/web/cues

FROM ${NODE_IMAGE} AS runtime
ARG VERSION=1.6.0
ARG REVISION=unknown
ARG SOURCE_URL=unknown
LABEL org.opencontainers.image.title="OpenWOD" \
      org.opencontainers.image.description="OpenWOD: a workout player for training at home. Not born. Made." \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="${SOURCE_URL}" \
      org.opencontainers.image.licenses="GPL-3.0-only"
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 DATABASE_PATH=/data/app.sqlite LOG_LEVEL=info TRUST_PROXY=false
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir -p /data && chown node:node /data
COPY --from=build /app/dist ./dist
COPY LICENSE ./LICENSE
VOLUME /data
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';fetch((process.env.HTTPS_CERT?'https':'http')+'://127.0.0.1:8080/api/v1/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]
