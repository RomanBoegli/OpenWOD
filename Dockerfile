ARG NODE_IMAGE=node:24.22.1-bookworm-slim
FROM ${NODE_IMAGE} AS build
# CUES=1 renders the recorded cue packs with Piper (offline text-to-speech) during the build; CUES=0 skips it for fast local builds.
ARG CUES=1
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --include=dev
COPY . .
RUN if [ "$CUES" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip && rm -rf /var/lib/apt/lists/* \
      && pip3 install --no-cache-dir --break-system-packages piper-tts==1.8.0 \
      && PIPER_RUNNER=piper node scripts/generate-cues.mjs; \
    fi
RUN npm run check && npm run build

FROM ${NODE_IMAGE} AS runtime
ARG VERSION=0.1.0
ARG REVISION=unknown
ARG SOURCE_URL=unknown
LABEL org.opencontainers.image.title="OpenWOD" \
      org.opencontainers.image.description="OpenWOD: a workout player for training at home. Not born. Made." \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="${SOURCE_URL}" \
      org.opencontainers.image.licenses="GPL-3.0-only"
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir -p /data && chown node:node /data
COPY --from=build /app/dist ./dist
COPY LICENSE ./LICENSE
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/v1/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]
