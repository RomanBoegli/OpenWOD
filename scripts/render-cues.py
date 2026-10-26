"""Renders spoken clips with Piper for scripts/generate-cues.ts. Reads one JSON spec and writes MP3s.

Spec: {"outDir": str, "voicesDir": str, "packs": [{"id": str, "voice": str}], "clips": {"<name>": "<text>"}, "names": {"<movement-id>": "<text>"}}
Each pack renders every clip into <outDir>/<pack>/<name>.mp3 and every movement name into <outDir>/<pack>/names/<id>.mp3.
Files that already exist are kept (an interrupted render resumes). Needs the piper-tts package and ffmpeg on PATH.

Every clip is trimmed and brought to the same level in two passes: the trimmed clip's RMS is measured, a plain gain moves it to
TARGET_MEAN_DB, and a limiter keeps the peaks under -1 dBFS. (ffmpeg's single-pass loudnorm cannot measure clips shorter than
three seconds and left them peak-aligned about 15 dB too quiet, with the odd one 14 dB louder than its neighbours.)
Piper samples noise on every synthesis, so a clip can once in a while come out as silence that trims to nothing: such a
clip is synthesised again, up to ATTEMPTS times, and the failure names the clip when every attempt was silent.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import wave
from array import array
from pathlib import Path

from piper import PiperVoice

TRIM = 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse'
TARGET_MEAN_DB = -18.0
PEAK_LIMIT = 0.891  # -1 dBFS
ATTEMPTS = 3


def mean_volume_db(wav_path: Path) -> float | None:
    """The RMS level of the trimmed clip, or None when nothing is left after trimming (ffmpeg then reports no level)."""
    probe = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(wav_path), '-af', f'{TRIM},volumedetect', '-f', 'null', '-'], capture_output=True, text=True, check=True)
    match = re.search(r'mean_volume: (-?[\d.]+) dB', probe.stderr)
    return float(match.group(1)) if match else None


def describe(wav_path: Path) -> str:
    """Frame count and peak sample of a 16-bit WAV, for the warning about a silent clip."""
    with wave.open(str(wav_path), 'rb') as wav_file:
        samples = array('h', wav_file.readframes(wav_file.getnframes()))
    return f'{len(samples)} frames, peak {max((abs(sample) for sample in samples), default=0)}'


def download(voice: str, voices_dir: Path) -> Path:
    model = voices_dir / f'{voice}.onnx'
    if not model.exists() or not model.with_suffix('.onnx.json').exists():
        subprocess.run([sys.executable, '-m', 'piper.download_voices', voice, '--download-dir', str(voices_dir)], check=True)
    return model


def render(voice: PiperVoice, text: str, target: Path, work: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    wav_path = work / 'clip.wav'
    for attempt in range(1, ATTEMPTS + 1):
        with wave.open(str(wav_path), 'wb') as wav_file:
            voice.synthesize_wav(text, wav_file)
        level = mean_volume_db(wav_path)
        if level is not None:
            break
        print(f'warning: {target} ({text!r}) came out silent on attempt {attempt} of {ATTEMPTS}: {describe(wav_path)}', file=sys.stderr, flush=True)
    else:
        raise RuntimeError(f'{target} ({text!r}) came out silent {ATTEMPTS} times')
    # Trim silence, bring the clip to the shared level, encode mono MP3 (decodable by every supported browser).
    gain = TARGET_MEAN_DB - level
    audio_filter = f'{TRIM},volume={gain:.2f}dB,alimiter=limit={PEAK_LIMIT}:attack=2:release=50:level=false'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav_path), '-af', audio_filter, '-ac', '1', '-ar', '32000', '-b:a', '48k', str(target)], check=True)


def main() -> None:
    spec = json.loads(Path(sys.argv[1]).read_text())
    out_dir = Path(spec['outDir'])
    voices_dir = Path(spec['voicesDir'])
    voices_dir.mkdir(parents=True, exist_ok=True)
    rendered = 0
    with tempfile.TemporaryDirectory(prefix='openwod-cues-') as work_name:
        work = Path(work_name)
        for pack in spec['packs']:
            model = download(pack['voice'], voices_dir)
            voice = PiperVoice.load(str(model))
            jobs = [(out_dir / pack['id'] / f'{name}.mp3', text) for name, text in spec['clips'].items()]
            jobs += [(out_dir / pack['id'] / 'names' / f'{movement}.mp3', text) for movement, text in spec['names'].items()]
            todo = [(target, text) for target, text in jobs if not target.exists()]
            for target, text in todo:
                render(voice, text, target, work)
            rendered += len(todo)
            print(f"{pack['id']}: {len(todo)} rendered, {len(jobs) - len(todo)} kept", flush=True)
    print(f'rendered {rendered} clip(s) into {out_dir}')


if __name__ == '__main__':
    os.environ.setdefault('PYTHONUNBUFFERED', '1')
    main()
