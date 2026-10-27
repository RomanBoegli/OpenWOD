# Deploying OpenWOD

OpenWOD comes in two shapes built from the same sources.
The static site runs in the browser alone and keeps the library in that browser.
The container serves the app and the household API, and the household's data lives in a SQLite database inside a named volume mounted at `/data`.
The stack is called `openwod` and so is its single container.

## Static site (GitHub Pages or any web server)

The static site is the same app without a server.
Every release is published at [https://romanboegli.ch/OpenWOD/](https://romanboegli.ch/OpenWOD/), with the five recorded voices.
Open it and play: there is nothing to install and no account.

The library lives in the browser's own storage (IndexedDB), so it is per browser and per browser profile.
Two devices, or Safari and Firefox on one computer, each keep a library of their own, and nothing is shared across the household.
The backup is a file you keep yourself: Settings → General → This browser → Download backup saves `openwod-backup-YYYY-MM-DD.json`.
The same card shows the storage used and the counts, and Restore from backup reads such a file back after a confirmation that shows its counts and date.
A restore replaces the browser's whole library.
The browser keeps the newest 2000 sessions and drops older ones, and a restore says how many did not fit.

A browser may clear a site's storage when the device runs low on space.
Keep data on this device on the same card asks the browser to keep the library (`navigator.storage.persist()`), and "Kept on this device" then says Yes.
Browsers usually agree for an installed app or a site used often, so download a backup now and then until they do.
A private window forgets everything when it closes.

To host it yourself, take `openwod-static-vX.Y.Z.zip` from the [GitHub Release](https://github.com/RomanBoegli/OpenWOD/releases) and unpack it into any web root.
The site uses relative paths and hash routes, so it works in a subfolder and needs no rewrite rules.
Serve it over HTTPS: the screen wake lock, the single-tab lock and persistent storage are offered in a secure context alone.
`npm run build:static` builds the same site into `dist/static` from source, without the voices unless `npm run cues:generate` ran first.

A household that wants one library for every device uses the container below.
A backup from the static site restores into the container and the other way round.

## Portainer from Git (the standard route)

The root [compose.yaml](../compose.yaml) uses a **prebuilt image**.
Nothing is built on the server.
Without Portainer, the same file runs with plain Docker Compose, and any LLM assistant can guide you through it.

1. Push the repository to GitHub and run the release workflow (a `v*` tag publishes that tag, a manual run publishes `sha-<commit>`).
   It validates, runs the browser tests, and builds native amd64 and arm64 images with the recorded cue voices.
   On each native runner it starts the candidate container, waits for readiness, and runs `npm run test:production` against that container in Chromium, Firefox and WebKit.
   A real workout, all five voice packs, name clips and browser audio decoding must pass before the candidate image is pushed.
   The combined GHCR manifest is published only when both architectures pass.
   Failures retain browser traces for seven days and print the container logs.
   Existing tags are never overwritten.
   A tag run also builds the static site, tests it in the same three engines, publishes it to GitHub Pages and creates the GitHub Release with the zip.
   The image name is the lower-cased GitHub repository under `ghcr.io`, and a freshly published package is private until its visibility is changed or the stack gets registry credentials.
2. In Portainer Community Edition on Docker Standalone, create a stack from **Repository**: the Git URL and reference, Compose path `compose.yaml`.
   Name the stack `openwod` so it matches the `name` in the file and the volume is `openwod_openwod-data`.
3. Set `APP_IMAGE` to the published reference (a digest is best) and optionally `HTTP_PORT` (default `8080`), `DATABASE_PATH`, `LOG_LEVEL` and `TRUST_PROXY`.
   Every variable in the table below that Compose passes has its default in the file, so only `APP_IMAGE` is required.
   The placeholders in [.env.example](../.env.example) must be replaced in the stack variables.
   No `.env` file is needed on the server.
   Private repositories need Git credentials.
   Private packages need registry credentials.
4. Deploy, confirm the container is healthy, and open the app.
   Plain HTTP on the home network plays workouts, but the screen wake lock needs HTTPS: either a trusted reverse proxy in front (for example `https://openwod.example.org` to `http://docker-host:8080`) or the container's own certificate, see [HTTPS](#https).

| Setting | Meaning |
| --- | --- |
| `APP_IMAGE` | Required prebuilt image reference for production Compose. |
| `HTTP_PORT` | Host port, default `8080`. |
| `PORT` | Server port inside the container, fixed to `8080` by Compose. |
| `HOST` | Server bind address. Defaults to `0.0.0.0`. |
| `DATABASE_PATH` | The SQLite file. Defaults to `/data/app.sqlite`, inside the persistent volume. Keep it under `/data`. |
| `LOG_LEVEL` | `fatal`, `error`, `warn`, `info` (default), `debug`, `trace` or `silent`. Logs never contain workout content. |
| `TRUST_PROXY` | `false` (default), `true`, or a comma-separated list of proxy addresses whose forwarded headers are trusted. |
| `HTTPS_KEY` | The TLS private key, as a file path inside the container or as the PEM text with newlines written as `\n`. Empty by default. |
| `HTTPS_CERT` | The TLS certificate, the same way. Set both or neither. With both the container serves HTTPS on its port. |
| `WEB_ROOT` | Optional absolute path to built frontend assets. Default `dist/web`. |

Health endpoints: `/api/v1/health/live` (process responsive, with the version) and `/api/v1/health/ready` (database open and migrated, with `persistence: true` and the schema version).
The container's health check uses the ready endpoint, so a database that cannot be opened makes the container unhealthy instead of serving without data.

## HTTPS

The container serves plain HTTP unless it is given a key and a certificate, the same way Actual Budget does it.
Then it serves HTTPS on the same port, and the health check follows.
This is the route for a home network without a reverse proxy, with a certificate you make yourself.

1. Make the certificate on your computer with [mkcert](https://github.com/FiloSottile/mkcert), naming every address the app is opened at:

   ```sh
   mkcert -install
   mkcert -cert-file openwod-cert.pem -key-file openwod-key.pem YOUR_SERVER_ADDRESS openwod.local
   ```

   `mkcert -install` puts the root certificate into this computer's trust store.
   Every other device needs the root certificate once: `mkcert -CAROOT` names the folder holding `rootCA.pem`, which is sent to the phone, installed as a profile and, on iOS, switched on under Settings → General → About → Certificate Trust Settings.
   A device that already trusts a mkcert root for another app trusts this certificate too.
2. Hand the two files to the container, one of two ways.
   As stack variables, which needs no access to the server's files: each file becomes one line with its newlines written as `\n`, printed ready to paste into the stack's variables:

   ```sh
   printf 'HTTPS_CERT=%s\n' "$(awk 'NF { printf "%s\\n", $0 }' openwod-cert.pem)"
   printf 'HTTPS_KEY=%s\n' "$(awk 'NF { printf "%s\\n", $0 }' openwod-key.pem)"
   ```

   Or as files in the data volume, copied in with `docker cp openwod-cert.pem openwod:/data/cert.pem` and the key alike, with `HTTPS_CERT=/data/cert.pem` and `HTTPS_KEY=/data/key.pem` as the variables.
3. Update the stack and open `https://YOUR_SERVER_ADDRESS:YOUR_PORT`, with the host port of the stack (`HTTP_PORT`, default `8080`).
   The log's first line names the protocol, and a key without a certificate, or the other way round, stops the container with a message naming the variable.

The private key is a secret: anyone holding it can impersonate the server on your network.
Keep the files out of the repository and renew them before the date mkcert prints.

## On a phone's home screen

The app installs as a web app: in Safari on iOS open the share sheet and choose Add to Home Screen, in Chrome on Android choose Install app or Add to Home screen from the menu.
It then opens full screen under its own icon, with the status bar in the theme's colour and no browser bars around the training view.
Install it from the HTTPS address when you have one, so the screen wake lock works in the installed app as well.
The installed app still loads from the server on every start and keeps the device cache and outbox like the browser does, so it is not an offline copy.

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
Export all data under Settings → General is the same data as JSON.
It is not a sharing file, but it restores into any OpenWOD, a household server or the static site.

## Restore from a JSON export

Settings → General → Restore from backup reads an `openwod.export` file, from this server or from the static site, and shows its counts and export date before anything changes.
After the confirmation it replaces the household's whole library, for every device.
The server first writes a copy of the current database under `/data/backups/`, named `pre-restore-<timestamp>.sqlite`, and then replaces everything in one transaction, so an invalid file or a failure changes nothing.
A file written by a newer OpenWOD is refused with a request to update first.
The same restore is `POST /api/v1/import/restore` with the export as the body.

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
- Opened over plain HTTP on a LAN address (for example `http://YOUR_SERVER_ADDRESS:8080` on a phone): everything works, including playing a workout, saving and sharing.
  Only two things still need HTTPS, because the browser offers them in a secure context alone: the screen wake lock and the single-tab lock that stops a second tab from controlling the same session.
  The [HTTPS](#https) section gives the container its own certificate for them.
  Without HTTPS the player says so for the wake lock and a second tab is only warned best-effort.
