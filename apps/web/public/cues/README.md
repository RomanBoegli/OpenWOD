Recorded voices: the fixed cues (`get-ready`, `go`, `rest`, `switch`, `three`, `two`, `one`, `paused`, `resume`, `complete`, `a`, `b`, `next`, `last-interval`, `a-waiting`, `b-waiting`, `ended`) as `<cue>.mp3` and every bundled exercise's spoken name as `names/<movement-id>.mp3`, one folder per voice pack, listed in `packs.json` with the number of names each carries.

The Docker image renders them during the build with Piper, an offline text-to-speech engine (build argument `CUES=1`, the default). Locally, `npm run cues:generate` does the same (needs `uv` and `ffmpeg`). The rendered files are ignored by git. Without them the app falls back to local beeps and the device's best English voice and says so in settings.

Packs: British male (Alan), American female (Amy), Scottish female (Alba), Northern English male, American male (Ryan). All English; Piper has no other English accents. The voices are open-licensed, see the generated `LICENSE.md`.
