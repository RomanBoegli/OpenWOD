Pre-rendered spoken cues (`get-ready`, `go`, `rest`, `switch`, `three`, `two`, `one`, `paused`, `resume`, `complete`) as `.mp3`.

Generate them once with `npm run cues:generate` (needs `uv` and `ffmpeg`; downloads an open-licensed Piper voice on first run) and commit the result together with the generated `LICENSE.md`. Until the clips exist, the app falls back to local beeps and the device voice automatically.
