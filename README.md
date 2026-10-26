# OpenWOD

*Not born. Made.*

A workout player for training at home, solo or with a partner, on the screen across the room. Timed circuits, AMRAPs, EMOMs, for-time pieces, you-go-I-go and strength sets, with a clock you can trust, voices that call the boundaries, and a library you can grow yourself.

It runs as one small container on your own machine. No account, no cloud, no tracking.

## Try it in a minute

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173, pick a workout, press Start. Everything you build or import stays in your browser until the household server milestone lands.

## What it does

- **Six formats, one engine.** Timed circuits run on the clock. AMRAPs keep the whole block on screen with a round and rep counter. EMOMs start work on every boundary and never wait. For-time pieces count up and end on Done, with an optional cap. You-go-I-go hands over on Switch and counts team rounds. Strength sets rest on a timer between Done taps.
- **Readable from two metres.** Big targets (reps, calories, metres), stable A and B lanes, a perimeter timer that drains and turns amber and red, and a background wash that turns the whole screen with the phase. Light, medium and heavy loads sit next to each movement as blue, red and black chips.
- **A real library.** 53 bundled workouts: the CrossFit benchmarks from Fran to Murph, 22 pieces curated from a coach's class programming, HYROX-style sessions and partner circuits. Filters stack: athletes, format, collection, duration, difficulty, equipment, and "only my equipment". Every card shows the gear it needs, a projected difficulty and when you last did it.
- **Your own workouts.** An editor for every format with targets, levelled loads, pair rules and rests, autosaved drafts, and duplicate-and-edit for anything bundled. Type a movement and pick it from 190 exercises grouped by family (every clean, every pull-up); imports open in the editor with unknown movements flagged. Workouts travel as single `.wod.yaml` files you can send to anyone.
- **Settings that matter.** General, sound, equipment, exercises and collections on their own pages: appearance and athlete names, recorded voice packs, the equipment you own, merging equipment spellings, the exercise catalogue with default loads for men and women, and collections.
- **Sound you can count on.** Local beeps on the audio clock at the exact boundary, and five English voices (British, Scottish, Northern English and American, men and women) rendered offline with Piper and shipped inside the image: they say Go, Rest, the countdown, who is up and every bundled movement, so nothing depends on your device's voices. Your own exercises are read by the device's best voice for movement names.

## Run it at home

The root [compose.yaml](compose.yaml) deploys a prebuilt image; Portainer can read it straight from Git. See [docs/deploy.md](docs/deploy.md) for the walkthrough, the settings table and the HTTPS note. To build from source locally:

```sh
docker compose -p openwod-preview -f deploy/compose.dev.yaml up --build -d
```

There is no login yet: keep it on your own network.

## Develop

```sh
npm run check     # types, generated files, unit tests
npm run build
npm run test:e2e  # Chromium, Firefox, WebKit
```

Repository layout, test strategy, the frozen timing traces and the cue voices are in [docs/development.md](docs/development.md). The architecture decisions are in [docs/architecture.md](docs/architecture.md), the file format in [docs/formats.md](docs/formats.md), and the record of what has been verified in [docs/validation.md](docs/validation.md). The requirements and the implementation plan live in [AGENT.md](AGENT.md).

## Status

This is the player and library milestone. Reloading mid-session starts over; checkpoints, recovery, a household database and login are the next milestone. The real 60-minute timing run and physical iPad checks are still to do.

Licence: [GNU GPL version 3](LICENSE). Bundled workouts carry their own attribution; the code licence does not apply to them.
