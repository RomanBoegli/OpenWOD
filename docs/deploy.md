# Deploying OpenWOD

One container serves the app and its API. Data will live in a named volume at `/data` from the persistence milestone on; today the server stores nothing and the browser keeps your library, settings and session log.

## Portainer from Git (the standard route)

The root [compose.yaml](../compose.yaml) uses a **prebuilt image**; nothing is built on the server.

1. Push the repository to GitHub and run the release workflow (a `v*` tag publishes that tag; a manual run publishes `sha-<commit>`). It validates, runs the browser tests, builds native amd64 and arm64 images with the recorded cue voices, smoke-tests both, and publishes a combined manifest to GHCR. Existing tags are never overwritten.
2. In Portainer Community Edition on Docker Standalone, create a stack from **Repository**: the Git URL and reference, Compose path `compose.yaml`.
3. Set `APP_IMAGE` to the published reference (a digest is best) and optionally `HTTP_PORT` (default `8080`). The placeholders in [.env.example](../.env.example) must be replaced in the stack variables; no `.env` file is needed on the server. Private repositories need Git credentials; private packages need registry credentials.
4. Deploy, confirm the container is healthy, and open the app through your trusted HTTPS reverse proxy (for example `https://openwod.example.org` to `http://docker-host:8080`). HTTPS is needed for the screen wake lock.

| Setting | Meaning |
| --- | --- |
| `APP_IMAGE` | Required prebuilt image reference for production Compose. |
| `HTTP_PORT` | Host port, default `8080`. |
| `PORT` | Server port inside the container, fixed to `8080` by Compose. |
| `HOST` | Server bind address; defaults to `0.0.0.0`. |
| `WEB_ROOT` | Optional absolute path to built frontend assets; default `dist/web`. |

Health endpoints: `/api/v1/health/live` (process responsive) and `/api/v1/health/ready` (service ready; reports `persistence: false` until the database milestone).

## Local preview from source

```sh
docker compose -p openwod-preview -f deploy/compose.dev.yaml up --build -d
docker compose -p openwod-preview -f deploy/compose.dev.yaml logs app
docker compose -p openwod-preview -f deploy/compose.dev.yaml down
```

The preview binds to loopback on port 8080. The image build renders the five recorded voices with Piper (several minutes the first time, cached afterwards); pass `--build-arg CUES=0` to skip them. With the preview running, `npm run test:production` runs the real-interval smoke test in all three browser engines.

## Upgrade and rollback

Select a newer tested image, re-pull and redeploy the same stack; the `/data` volume stays attached. Rolling back is choosing the previous image. Stopping or recreating a stack keeps its named volume; renaming the stack creates a separate, empty one. Database migrations, backups and restores arrive with the persistence milestone and will be documented here.

## Trusted network only

There is no login yet. Keep the app behind your own network or an authenticating proxy; do not expose it to the public internet until the login milestone.

## Troubleshooting

- Unhealthy at startup: check the container logs, the image architecture, and that the host port is free.
- No sound: use Test sound in settings; check the browser and device volume. The recorded voices need the image built with `CUES=1` (the default); the settings page says so when they are missing.
- No screen wake lock: it needs a secure context (HTTPS or localhost) and a supporting browser; the app says so in the player.
