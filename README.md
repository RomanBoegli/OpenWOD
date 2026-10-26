# **OpenWOD**

*Not born.
Made.*

OpenWOD is a self-hosted virtual training coach for home workouts, solo or in pairs.
It executes structured sessions in six formats (timed circuits, AMRAP, EMOM, for time, you-go-I-go and strength sets) on a deterministic clock, announces every transition by voice, and maintains an extensible workout library.
It runs as a single container on your own hardware and requires no account, cloud service or telemetry.

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/openwod-logo-dark.svg">
    <img src="assets/brand/openwod-logo-light.svg" alt="OpenWOD" width="320">
  </picture>
  </br></br>
  <img src="docs/images/hero.png" alt="The library with its filters and cards, and the player running a partner circuit in the dark theme" width="960">
  </br></br>

**[👋 Introduction](#-introduction)** | **[🚀 Setup](#-setup)** | **[🏠 Run it at home](#-run-it-at-home)** | **[📄 Workout files](#-workout-files)** | **[🔧 Developer notes](#-developer-notes)** | **[🧹 Cleanup](#-cleanup)** | **[🙏 Acknowledgements](#-acknowledgements)**

  </br>

[![Check](https://github.com/RomanBoegli/OpenWOD/actions/workflows/check.yml/badge.svg)](https://github.com/RomanBoegli/OpenWOD/actions/workflows/check.yml)
[![Release image](https://github.com/RomanBoegli/OpenWOD/actions/workflows/release.yml/badge.svg)](https://github.com/RomanBoegli/OpenWOD/actions/workflows/release.yml)
[![Licence: GPL v3](https://img.shields.io/badge/licence-GPLv3-2f7a0f.svg)](LICENSE)

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React_19-20232A?logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-000000?logo=fastify&logoColor=white)
![Node.js](https://img.shields.io/badge/Node_24-5FA04E?logo=nodedotjs&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?logo=playwright&logoColor=white)

</div>

## 👋 Introduction

OpenWOD plays a workout the way a coach would run it: it tells you what is next, counts you in, calls the boundaries, and otherwise stays out of the way.
Pick a session from the library, press Start, and put the phone down.

| Format | What the clock does |
| --- | --- |
| **Timed circuit** | Work and rest slots on the clock, rounds and blocks with their own rests, A and B lanes that can alternate. |
| **AMRAP** | The whole block stays on screen with a round and rep counter. The timer never tells you what to do next, you do. |
| **EMOM** | Work starts on every boundary and never waits. An early Done shows the rest you earned. |
| **For time** | Counts up, ends on Done, with an optional cap. |
| **You go, I go** | Hands over on Switch and counts team rounds. |
| **Strength** | Rest on a timer between Done taps, set by set. |

### Features

- [x] Six formats on one deterministic clock: timed circuit, AMRAP, EMOM, for time, you go / I go, strength
- [x] Solo or pair sessions with stable A and B lanes, alternating stations and team rounds
- [x] Readable from two metres: big targets, a draining timer ring with amber and red marks, a background pulse
- [x] Light, medium and heavy loads per movement, women's amounts, kilograms or pounds
- [x] Beeps on the audio clock and five offline voices that call Go, Rest, the countdown, who is up and every movement
- [x] 53 bundled workouts as hand-written YAML: benchmarks with their published Rx, advanced pieces from class programming, HYROX, partner circuits
- [x] Library filters that stack: athletes, format, collection, duration, difficulty, equipment, only my equipment
- [x] A projected difficulty per workout, calibrated to your taste in settings
- [x] An editor for every format with autosaved drafts, duplicate-and-edit, and equipment derived from the movements
- [x] A movement catalogue of 190 records grouped by family, with search, merge and rename
- [x] Collections, a session log on every card, import and export of single `.wod.yaml` files
- [x] One container, no account, no cloud, no tracking.
      Light and dark themes
- [x] A household server: one SQLite database shared by every device, with a cache and an outbox on each device for the time the server is away
- [x] Recovery after a reload or a killed browser, and one tab in control of a session
- [x] History with Repeat and score corrections, backups through the SQLite backup API, versioned migrations
- [x] Workout packs with sharing provenance: reimports recognised, newer revisions can replace
- [ ] Login (the server stays on a trusted network until then)

> [!NOTE]
> Everything you build, import or log stays in your browser until the household server milestone lands.
> There is no login yet, so keep a shared instance on your own network.

## 🚀 Setup

### Requirements

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| **Node.js 24** | `brew install node@24` | `sudo apt install nodejs` (from NodeSource) or `nvm install 24` | `winget install OpenJS.NodeJS` |
| **Docker** (to run the image) | `brew install --cask docker` | `sudo apt install docker.io docker-compose-v2` | `winget install Docker.DockerDesktop` |

### 1. Clone and install

```sh
git clone https://github.com/RomanBoegli/OpenWOD.git openwod
cd openwod
npm ci
```

### 2. Run it

```sh
npm run dev:full
```

Open http://127.0.0.1:5173, pick a workout, press Start.
The household API runs beside the dev server and keeps its data in `.data/app.sqlite`.

> [!TIP]
> Press **Test sound** in the header once: browsers only play audio after a tap, and that tap unlocks the beeps and voices for the session.

### 3. Check your change

```sh
npm run check      # types, generated schemas and workout bundle, unit tests
npm run test:e2e   # Playwright in Chromium, Firefox and WebKit
```

## 🏠 Run it at home

The root [compose.yaml](compose.yaml) deploys a prebuilt image, and Portainer can read it straight from Git.
The walkthrough, the settings table and the HTTPS note are in [docs/deploy.md](docs/deploy.md).
To build and run from source locally:

```sh
docker compose -f deploy/compose.dev.yaml up --build -d
```

The image build renders the cue voices with Piper, so the first build takes a few minutes.
Afterwards the container serves the app and its API on port 8080 with no network dependency at all, and the household's data lives in the `/data` volume.
Backup, restore, upgrade and rollback are in [docs/deploy.md](docs/deploy.md).

## 📄 Workout files

A workout is one `.wod.yaml` file: readable, diffable, and the same whether it is bundled, built in the editor or sent to a friend.
Durations are human (`40s`, `1m30s`, `10m`), loads carry a women's amount, and movement names resolve against the catalogue.
A `.wods.yaml` pack carries several workouts and their collections, and a sharing identity on each workout lets an installation recognise a reimport and offer a newer revision as a replacement.

```yaml
format: openwod.workout
formatVersion: 3
workout:
  id: fran
  title: Fran
  participants: 1
  prep: 10s
  sections:
    - id: fran-for-time
      title: 21-15-9
      format: forTime
      cap: 10m
      body:
        type: sequence
        children:
          - type: task
            assignments:
              A:
                name: Thrusters
                reps: 21
                load:
                  heavy: { value: 43, women: 29, unit: kg }
          - type: task
            assignments:
              A: { name: Pull-ups, reps: 21 }
```

The format is specified in [docs/formats.md](docs/formats.md) and published as JSON Schemas under [schemas/](schemas/).
The bundled registry, its load convention and the content review are in [workouts/README.md](workouts/README.md).
Add a file to a folder under `workouts/`, run `npm run workouts:bundle`, and it is in the app.

## 🔧 Developer notes

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev:full` | The API on port 8787 beside the Vite dev server, which proxies `/api` to it. |
| `npm run dev` | Vite dev server for the web app only. |
| `npm run check` | Typecheck, schema and registry drift, the legacy-name guard, 129 unit tests including the frozen timing traces. |
| `npm run build` | Production bundle of the web app and the server. |
| `npm run test:e2e` | Browser scenarios. Add `--project=firefox --project=webkit` to pick engines. |
| `npm run workouts:bundle` | Rebuilds `packages/domain/src/generated/bundled.ts` from `workouts/`. |
| `npm run schemas:generate` | Rebuilds the published JSON Schemas from the TypeBox source. |

### Project structure

```
apps/
  server/        Fastify: the household API over SQLite, migrations, health, the built app
  web/           React 19 + Vite: library, editor, player, history, settings, the data layer under src/data/
packages/
  domain/        Schema (TypeBox), compiler, difficulty, loads, movement catalogue, YAML exchange
  engine/        The clock: deterministic session engine, warning marks, wash curve
assets/brand/    Logos and the brand mark
deploy/          Local Compose from source (the root compose.yaml deploys the image)
docs/            architecture, deploy, development, formats, validation
schemas/         Published JSON Schemas (generated)
scripts/         Bundle, schema generation, cue rendering, checks
tests/           unit (Vitest), e2e (Playwright), production smoke
workouts/        The registry: one folder per collection, one .wod.yaml per workout
```

### Where to read more

- [docs/architecture.md](docs/architecture.md): the decisions behind the engine, the formats, the catalogue and the settings.
- [docs/development.md](docs/development.md): repository layout, test strategy, the frozen traces and the cue voices.
- [docs/validation.md](docs/validation.md): what has been verified, wave by wave.
- [AGENT.md](AGENT.md): the requirements, the plan and the running change log.

### Releasing

Pushing a `v*` tag runs the **Release image** workflow: it validates, runs the browser tests, builds native amd64 and arm64 images with the voices rendered inside, smoke-tests both, and publishes a multi-arch manifest.
A manual run publishes `sha-<commit>` instead.
The step-by-step process, from the version bump to the digest in the Portainer stack, is in [docs/development.md](docs/development.md#cutting-a-release).

## 🧹 Cleanup

```sh
rm -rf node_modules .cache dist test-results
docker compose -p openwod-preview -f deploy/compose.dev.yaml down -v
```

## 🙏 Acknowledgements

The code is licensed under the [GNU GPL version 3](LICENSE).
The bundled workout files are data under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), each citing its source (see [workouts/README.md](workouts/README.md)).
The benchmark workouts and station standards are those published by CrossFit and HYROX.
CrossFit® is a registered trademark of CrossFit, LLC, and HYROX® of Upsolut Sports AG.
OpenWOD is an independent project with no affiliation to or endorsement by either.
The cue voices are rendered with [Piper](https://github.com/OHF-Voice/piper1-gpl).

If OpenWOD is useful in your work, cite it via the **Cite this repository** button on GitHub (it reads [CITATION.cff](CITATION.cff)) or with:

```bibtex
@software{boegli_openwod_2026,
  author  = {B{\"o}gli, Roman},
  title   = {{OpenWOD}},
  year    = {2026},
  url     = {https://github.com/RomanBoegli/OpenWOD},
  license = {GPL-3.0}
}
```
