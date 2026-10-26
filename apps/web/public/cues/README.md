Recorded spoken cues (`get-ready`, `go`, `rest`, `switch`, `three`, `two`, `one`, `paused`, `resume`, `complete`) as `.mp3`, one folder per voice pack, listed in `packs.json`.

The Docker image renders them during the build with Piper, an offline text-to-speech engine (build argument `CUES=1`, the default). Locally, `npm run cues:generate` does the same (needs `uv` and `ffmpeg`). The rendered files are ignored by git. Without them the app falls back to local beeps and the device voice and says so in settings.

Packs: British male (Alan), American female (Amy), Scottish female (Alba). Piper has no other English accents; the voices are open-licensed, see the generated `LICENSE.md`.
