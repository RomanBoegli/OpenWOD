ARG NODE_IMAGE=node:24.22.1-bookworm-slim

# Dependencies once: everything below shares this layer and only a lockfile change rebuilds it.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --include=dev

# The recorded voices. They depend only on the two cue scripts and the movement catalogue, so an edit anywhere else
# in the app reuses this layer. CUES=1 renders them with Piper (offline text-to-speech); CUES=0 skips them for fast local builds.
FROM deps AS cues
ARG CUES=1
RUN if [ "$CUES" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip && rm -rf /var/lib/apt/lists/* \
      && pip3 install --no-cache-dir --break-system-packages piper-tts==1.8.0; \
    fi
COPY scripts/generate-cues.ts scripts/render-cues.py ./scripts/
COPY packages/domain/src/movements.ts ./packages/domain/src/movements.ts
RUN if [ "$CUES" = "1" ]; then \
      CUES_OUT=/cues PIPER_VOICES=/tmp/piper-voices PIPER_PYTHON=python3 npx tsx scripts/generate-cues.ts && rm -rf /tmp/piper-voices; \
    else mkdir -p /cues; fi

# The app: checks, build, and the voices copied in last so the build layers never depend on them.
FROM deps AS build
COPY . .
RUN npm run check && npm run build
COPY --from=cues /cues ./dist/web/cues

FROM ${NODE_IMAGE} AS runtime
ARG VERSION=1.1.0
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
  CMD node -e "fetch('http://127.0.0.1:8080/api/v1/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]
