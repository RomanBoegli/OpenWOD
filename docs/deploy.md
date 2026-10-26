# Deploying OpenWOD

One container serves the app and its API.
The household's data lives in a SQLite database inside a named volume mounted at `/data`.
The stack is called `openwod` and so is its single container.

## Portainer from Git (the standard route)

The root [compose.yaml](../compose.yaml) uses a **prebuilt image**.
Nothing is built on the server.

1. Push the repository to GitHub and run the release workflow (a `v*` tag publishes that tag, a manual run publishes `sha-<commit>`).
   It validates, runs the browser tests, and builds native amd64 and arm64 images with the recorded cue voices.
   On each native runner it starts the candidate container, waits for readiness, and runs `npm run test:production` against that container in Chromium, Firefox and WebKit.
   A real workout, all five voice packs, name clips and browser audio decoding must pass before the candidate image is pushed.
   The combined GHCR manifest is published only when both architectures pass.
   Failures retain browser traces for seven days and print the container logs.
   Existing tags are never overwritten.
2. In Portainer Community Edition on Docker Standalone, create a stack from **Repository**: the Git URL and reference, Compose path `compose.yaml`.
   Name the stack `openwod` so it matches the `name` in the file and the volume is `openwod_openwod-data`.
3. Set `APP_IMAGE` to the published reference (a digest is best) and optionally `HTTP_PORT` (default `8080`).
   The placeholders in [.env.example](../.env.example) must be replaced in the stack variables.
   No `.env` file is needed on the server.
   Private repositories need Git credentials.
   Private packages need registry credentials.
4. Deploy, confirm the container is healthy, and open the app through your trusted HTTPS reverse proxy (for example `https://openwod.example.org` to `http://docker-host:8080`).
   HTTPS is needed for the screen wake lock.

| Setting | Meaning |
| --- | --- |
| `APP_IMAGE` | Required prebuilt image reference for production Compose. |
| `HTTP_PORT` | Host port, default `8080`. |
| `PORT` | Server port inside the container, fixed to `8080` by Compose. |
| `HOST` | Server bind address. Defaults to `0.0.0.0`. |
| `DATABASE_PATH` | The SQLite file. Defaults to `/data/app.sqlite`, inside the persistent volume. |
| `LOG_LEVEL` | `fatal`, `error`, `warn`, `info` (default), `debug`, `trace` or `silent`. Logs never contain workout content. |
| `TRUST_PROXY` | `false` (default), `true`, or a comma-separated list of proxy addresses whose forwarded headers are trusted. |
| `WEB_ROOT` | Optional absolute path to built frontend assets. Default `dist/web`. |

Health endpoints: `/api/v1/health/live` (process responsive, with the version) and `/api/v1/health/ready` (database open and migrated, with `persistence: true` and the schema version).
The container's health check uses the ready endpoint, so a database that cannot be opened makes the container unhealthy instead of serving without data.

## What the server stores

Workouts, collections, the movement catalogue's edits and the session log of the household live in the database.
Each device keeps a cache of them for an instant start and for reading while the server is away, and an outbox of changes that could not be uploaded yet.
A running session is checkpointed on the device, never on the server, so a server restart or redeploy during a workout changes nothing in the player.
Preferences such as names, theme and sound stay on each device.

## Backup

The backup is a consistent copy of the database, taken with the SQLite backup API while the server keeps running.
Take it from the app under Settings → General → Download backup, or with a request:

```sh
curl --fail -o openwod-$(date +%F).sqlite http://docker-host:8080/api/v1/backup
```

Keep the file outside the container and the volume.
An offline copy with the stack stopped works too, but it must take the main file and its `-wal` and `-shm` companions together:

```sh
docker compose -p openwod stop openwod
docker run --rm -v openwod_openwod-data:/data -v "$PWD":/out alpine sh -c 'cp /data/app.sqlite* /out/'
docker compose -p openwod start openwod
```

The server also writes a backup by itself before every schema migration, under `/data/backups/`, named `pre-migration-v<from>-to-v<to>-<timestamp>.sqlite`.
The export under Settings → General is the same data as JSON for reading elsewhere and is not a sharing file and not a backup format.

## Restore into a fresh stack

1. Create and start the stack as above, then stop its container: `docker compose -p openwod stop openwod`.
2. Copy the backup into the volume, replacing the empty database and any journal files:

   ```sh
   docker run --rm -v openwod_openwod-data:/data -v "$PWD":/in alpine sh -c 'rm -f /data/app.sqlite /data/app.sqlite-wal /data/app.sqlite-shm && cp /in/openwod-backup.sqlite /data/app.sqlite && chown 1000:1000 /data/app.sqlite'
   ```

3. Start the container and check `/api/v1/health/ready` reports `persistence: true` and the expected `schemaVersion`.

The script `scripts/rehearse-restore.sh` runs exactly this against a throwaway stack built from source and checks that a saved workout survives.
Run it before a release.

## Upgrade

Select a newer tested image, re-pull and redeploy the same stack.
The `/data` volume stays attached.
If the new version carries a schema migration, the server first writes the pre-migration backup under `/data/backups/`, then migrates inside a transaction, then starts serving.
Watch the container logs for the line `Database migrated.` and the health check turning healthy.
A running player is not interrupted by a redeploy: its assets are content-hashed and already loaded, and the session is checkpointed on the device.
Still, finish the session first when you can.

## Rollback

Rolling back is choosing the previous image.
If the previous image understands the current schema, nothing else is needed.
If the schema is newer than that image supports, the old image refuses to start and says so in its log, because it would otherwise misread the data.
Then restore the matching pre-migration backup from `/data/backups/` as above.
Anything written after that migration is lost by that restore, so decide knowingly.

Stopping or recreating a stack keeps its named volume.
Renaming the stack creates a separate, empty one.

## Local preview from source

```sh
docker compose -f deploy/compose.dev.yaml up --build -d
docker compose -f deploy/compose.dev.yaml logs openwod
docker compose -f deploy/compose.dev.yaml down
```

The preview stack is named `openwod-preview`, binds to loopback on port 8080, and keeps its own volume.
The image build renders the five recorded voices with Piper (several minutes the first time, cached afterwards).
Pass `--build-arg CUES=0` to skip them.
With the preview running, `npm run test:production` runs the same real-interval and recorded-voice tests used to gate release images, in all three browser engines.
Set `OPENWOD_PRODUCTION_URL` to test a candidate container on a different URL or port.

## Trusted network only

There is no login yet.
Keep the app behind your own network or an authenticating proxy.
Do not expose it to the public internet until the login milestone.

## Troubleshooting

- Unhealthy at startup: check the container logs, the image architecture, that the host port is free, and that the volume is writable by user 1000.
  A log line starting with `The database was written by a newer OpenWOD` means a rollback hit a newer schema.
- "Server unreachable" in the app header: the browser cannot reach `/api/v1`.
  The library keeps working from the device's cache and uploads later.
  Check the proxy path and the container health.
- A workout shows "Not yet on the server": it waits in the device's outbox.
  It uploads as soon as the server answers, or shows a conflict notice in the library if someone changed the same workout meanwhile.
- No sound: use Test sound in settings.
  Check the browser and device volume.
  The recorded voices need the image built with `CUES=1` (the default).
  The settings page says so when they are missing.
- No screen wake lock: it needs a secure context (HTTPS or localhost) and a supporting browser.
  The app says so in the player.
